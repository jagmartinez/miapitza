import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';
import { PedidosYaService } from './pedidosya.service';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { SaleWarehouseService } from './sale-warehouse.service';
import { DynamicPricingService } from './dynamic-pricing.service';
import {
    claimPromotionUsageAtSettlement,
    evaluateOrderPromotion,
    getActivePromotionReservation,
    PromotionValidationError,
    releasePromotionReservationForOrder,
    syncOrderLinePromotionDiscounts,
    type PromotionEvaluation
} from './promotion.service';
import { DEFAULT_COMPANY_SETTINGS, SettingService } from './setting.service';
import {
    DiscountAuthRequiredError,
    MAX_DISCOUNT_REASON,
    MIN_DISCOUNT_REASON,
    discountPercentOf,
    getConfiguredDiscountLimit,
    getManualDiscountLimit,
    getCompanyDiscountCap,
    resolveLimit,
    maxDiscountForLimit
} from './discount-authorization.service';
import { isValidTimeZone, zonedDateKey } from '../utils/timezone';
import { reconcileTableGroupForTable } from './table-group.service';
import { tableOpenAccountWhere, tableOperationalOrderWhere } from './table-occupancy-policy';
import { selectLatestKitchenBatch } from './kitchen-batch';
import { KitchenError } from './kitchen-errors';
import { isRetryableTransactionError, SETTLEMENT_TRANSACTION_OPTIONS, transactionWithP2034Retry } from '../utils/transaction-retry';

/** User-facing (Spanish) messages other flows compare against. */
export const PROMOTION_NOT_ACTIVE_MESSAGE = 'El código de promoción no existe o no está activo';
export const ORDER_ALREADY_CANCELLED_MESSAGE = 'La orden ya está cancelada';

/** Valid state transitions for orders */
const VALID_TRANSITIONS: Record<string, string[]> = {
    // Sending and starting preparation have dedicated operations because they
    // also stamp item-level kitchen state. A generic status write must not skip it.
    'OPEN': [],
    'SENT_TO_KITCHEN': ['READY'],
    'IN_PREPARATION': ['READY'],
    // Delivery has a dedicated operation because it atomically consumes stock
    // from an explicit warehouse. Full payment owns table-account release.
    'READY': [],
    'DELIVERED': [],
    'CANCELLED': [], // terminal
};

export interface FiscalCustomerInput {
    customerName?: unknown;
    customerTaxId?: unknown;
    customerTaxIdType?: unknown;
    customerFiscalAddress?: unknown;
    customerEmail?: unknown;
    customerPhone?: unknown;
}

export interface OrderCancelOptions {
    allowPaidReversal?: boolean;
    wasteWarehouseId?: number;
    /**
     * True when `wasteWarehouseId` is a configured default (not chosen by the
     * user): the waste then follows the branch ingredient routing. A
     * user-selected waste warehouse is never re-routed.
     */
    wasteWarehouseIsDefault?: boolean;
    fiscalCreditNoteId?: number;
    fiscalInvoiceCancellationId?: number;
    externalRefundReference?: string;
    externalRefundReferences?: Array<{ paymentId: number; reference: string }>;
}

const kitchenBatchOrderInclude = {
    order: {
        include: {
            table: true,
            user: { select: { id: true, name: true, color: true } },
        },
    },
    items: {
        include: {
            menuItem: true,
            modifiers: true,
        },
        orderBy: { id: 'asc' as const },
    },
} satisfies Prisma.KitchenBatchInclude;

const voidResultOrderInclude = {
    table: true,
    user: { select: { id: true, name: true, color: true } },
    items: { include: { menuItem: true, modifiers: true }, orderBy: { id: 'asc' as const } },
} satisfies Prisma.OrderInclude;

type KitchenBatchOrderRow = Prisma.KitchenBatchGetPayload<{
    include: typeof kitchenBatchOrderInclude;
}>;

export class OrderService {
    private static assertMenuItemSellable(menuItem: {
        name: string;
        type: string;
        _count?: { recipes: number };
    }): void {
        if (menuItem.type === 'PREPARED' && Number(menuItem._count?.recipes ?? 0) === 0) {
            throw new Error(
                `El plato preparado "${menuItem.name}" no tiene receta de venta y está bloqueado hasta corregir su BOM`
            );
        }
    }

    private static normalizeFiscalCustomer(data: FiscalCustomerInput) {
        const text = (value: unknown, max: number, field: string): string | null => {
            if (value === undefined || value === null) return null;
            const normalized = String(value).trim();
            if (!normalized) return null;
            if (normalized.length > max) throw new Error(`${field} excede la longitud permitida`);
            return normalized;
        };
        const normalized = {
            customerName: text(data.customerName, 191, 'Nombre fiscal del cliente'),
            customerTaxId: text(data.customerTaxId, 100, 'Identificación tributaria'),
            customerTaxIdType: text(data.customerTaxIdType, 50, 'Tipo de identificación tributaria'),
            customerFiscalAddress: text(data.customerFiscalAddress, 1000, 'Dirección fiscal'),
            customerEmail: text(data.customerEmail, 191, 'Correo del cliente'),
            customerPhone: text(data.customerPhone, 50, 'Teléfono del cliente')
        };
        if (normalized.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.customerEmail)) {
            throw new Error('El correo fiscal del cliente no es válido');
        }
        const hasTaxIdentity = Boolean(normalized.customerTaxId || normalized.customerTaxIdType);
        if (hasTaxIdentity && (!normalized.customerName || !normalized.customerTaxId || !normalized.customerTaxIdType)) {
            throw new Error('Nombre, identificación tributaria y tipo de identificación deben registrarse juntos');
        }
        return normalized;
    }

    private static syncPedidosYaStatus(companyId: number, order: { id: number; salesChannel?: string; status: string }) {
        if (order.salesChannel !== 'PEDIDOSYA') return;
        PedidosYaService.syncOrderStatus(companyId, order.id, order.status).catch((error) => {
            // PedidosYaService persists PENDING/FAILED metadata before surfacing
            // the error, so this is observable even though local kitchen work
            // must not be rolled back by a remote outage.
            console.error(`[OrderService] Failed to sync PedidosYa status for order ${order.id}:`, error);
        });
    }

    /** Non-negative money -> integer cents, half-up, immune to binary float noise (1.005 -> 101). */
    private static toCents(value: number): number {
        const safe = Math.max(0, Number(value) || 0);
        return Math.round(Number((safe * 100).toFixed(6)));
    }

    /** All money arithmetic in integer cents so 0.1 + 0.2 style drift never reaches a total. */
    private static calculateFinalTotal(subtotal: number, discount: number, tax: number, tipAmount: number): number {
        const discountedCents = Math.max(0, this.toCents(subtotal) - this.toCents(discount));
        return (discountedCents + this.toCents(tax) + this.toCents(tipAmount)) / 100;
    }

    /**
     * Tax = discounted subtotal × rate (rate is a PERCENT, e.g. 15 = 15%),
     * computed in integer cents and rounded half-up: 15% of 1.50 = 0.225 ->
     * 0.23 (float math gives 0.22499… -> 0.22). Rates keep up to 4 decimals.
     */
    private static taxFromRate(discountedSubtotal: number, taxRatePercent: number): number {
        const rate = Number(taxRatePercent);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
            throw new Error('La tasa de impuesto configurada no es válida');
        }
        const baseCents = this.toCents(discountedSubtotal);
        // percent × 10^4 -> integer; cents × rate / (100 × 10^4), half-up.
        const scaledRate = Math.round(Number((rate * 10_000).toFixed(6)));
        const denominator = 100 * 10_000;
        const taxCents = Math.floor((baseCents * scaledRate + denominator / 2) / denominator);
        return taxCents / 100;
    }

    private static async getCompanyTaxRate(
        tx: Prisma.TransactionClient,
        companyId: number
    ): Promise<number> {
        // Prefer canonical `tax_rate`; fall back to legacy `taxRate` rows written by older Settings UI.
        const settings = await tx.setting.findMany({
            where: {
                companyId,
                name: { in: [`${companyId}_tax_rate`, `${companyId}_taxRate`] }
            },
            select: { name: true, value: true }
        });
        const byName = new Map(settings.map((row) => [row.name, row.value]));
        const raw = byName.get(`${companyId}_tax_rate`)
            ?? byName.get(`${companyId}_taxRate`)
            ?? DEFAULT_COMPANY_SETTINGS.tax_rate;
        const rate = Number.parseFloat(raw);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
            throw new Error('La tasa de impuesto configurada no es válida');
        }
        return rate;
    }

    /** Tax is always derived from company tax_rate × discounted subtotal — never trusted from the client. */
    private static async repriceTax(
        tx: Prisma.TransactionClient,
        companyId: number,
        subtotal: number,
        discount: number
    ): Promise<number> {
        const discountedSubtotal = Math.max(0, Number(subtotal) - Math.max(0, Number(discount)));
        const taxRate = await this.getCompanyTaxRate(tx, companyId);
        return this.taxFromRate(discountedSubtotal, taxRate);
    }

    private static async getOrderItemsSubtotal(
        tx: Prisma.TransactionClient,
        orderId: number
    ): Promise<number> {
        const items = await tx.orderItem.findMany({
            where: { orderId },
            select: { subtotal: true }
        });
        return items.reduce((sum, item) => sum + Number(item.subtotal), 0);
    }

    /**
     * Authoritative promotion evaluation over the persisted order lines
     * (branch, happy hour, per-item, N x M and combo rules). `apply` when the
     * code is being (re)assigned, `reprice` when its lines changed.
     */
    private static async evaluatePromotionForOrder(
        tx: Prisma.TransactionClient,
        companyId: number,
        orderId: number,
        code: string,
        subtotal: number,
        mode: 'apply' | 'reprice'
    ): Promise<PromotionEvaluation> {
        return evaluateOrderPromotion(tx, { companyId, orderId, code, subtotal, mode }, PROMOTION_NOT_ACTIVE_MESSAGE);
    }

    /**
     * Reprices the stored discount after the lines changed. Line-based
     * promotions also refresh the per-line attribution (OrderItem.promotionDiscount)
     * so partial credit notes and split bills return/charge each line exactly.
     * Manual discounts never carry attribution (cleared when a code is removed).
     */
    private static async repriceStoredDiscount(
        tx: Prisma.TransactionClient,
        companyId: number,
        orderId: number,
        subtotal: number,
        discount: Prisma.Decimal | number,
        discountCode: string | null
    ): Promise<number> {
        if (discountCode) {
            const evaluation = await this.evaluatePromotionForOrder(tx, companyId, orderId, discountCode, subtotal, 'reprice');
            if (evaluation.lineBased) await syncOrderLinePromotionDiscounts(tx, orderId, evaluation.lineDiscounts);
            return evaluation.discount;
        }
        return Math.round(Math.min(Math.max(0, Number(discount)), Math.max(0, subtotal)) * 100) / 100;
    }

    private static withTimeline<T extends { items?: Array<{ startedAt?: Date | string | null; finishedAt?: Date | string | null }> }>(order: T): T & {
        firstStartedAt: string | null;
        readyAt: string | null;
    } {
        const startedTimes = (order.items || [])
            .map(item => item.startedAt ? new Date(item.startedAt).getTime() : null)
            .filter((value): value is number => value !== null)
            .sort((a, b) => a - b);
        const finishedTimes = (order.items || [])
            .map(item => item.finishedAt ? new Date(item.finishedAt).getTime() : null)
            .filter((value): value is number => value !== null)
            .sort((a, b) => a - b);
        const readyAt = finishedTimes.length > 0 && finishedTimes.length === (order.items || []).length
            ? new Date(finishedTimes[finishedTimes.length - 1]).toISOString()
            : null;

        return {
            ...order,
            firstStartedAt: startedTimes.length > 0 ? new Date(startedTimes[0]).toISOString() : null,
            readyAt
        };
    }

    /**
     * A commercial order can receive several sequential kitchen sends. The KDS
     * must operate on the most recently sent wave, not replay DONE lines or SLA
     * timestamps from an earlier wave on the same account.
     */
    private static withLatestKitchenBatch<T extends {
        items?: Array<{
            sentAt?: Date | string | null;
            startedAt?: Date | string | null;
            finishedAt?: Date | string | null;
        }>;
    }>(order: T): T & {
        items: NonNullable<T['items']>;
        firstStartedAt: string | null;
        readyAt: string | null;
    } {
        const items = (order.items ?? []) as NonNullable<T['items']>;
        const batchItems = selectLatestKitchenBatch(items) as NonNullable<T['items']>;
        return this.withTimeline({ ...order, items: batchItems }) as T & {
            items: NonNullable<T['items']>;
            firstStartedAt: string | null;
            readyAt: string | null;
        };
    }

    private static kitchenBatchOrderStatus(status: string) {
        if (status === 'IN_PREPARATION') return 'IN_PREPARATION' as const;
        if (status === 'READY' || status === 'RELEASED') return 'READY' as const;
        return 'SENT_TO_KITCHEN' as const;
    }

    private static withPersistentKitchenBatch(batch: KitchenBatchOrderRow) {
        return this.withTimeline({
            ...batch.order,
            status: this.kitchenBatchOrderStatus(batch.status),
            kitchenBatchId: batch.id,
            kitchenBatchSequence: batch.sequence,
            kitchenBatchStatus: batch.status,
            kitchenBatchSentAt: batch.sentAt,
            kitchenStartedAt: batch.startedAt,
            kitchenReleasedAt: batch.releasedAt,
            kitchenReadyAt: batch.readyAt,
            items: batch.items,
        });
    }

    private static async syncOrderKitchenCompatibility(
        tx: Prisma.TransactionClient,
        orderId: number,
    ) {
        const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                status: true,
                kitchenReleasedAt: true,
                items: { where: { sentAt: null }, select: { id: true } },
                kitchenBatches: {
                    select: {
                        status: true,
                        startedAt: true,
                        startedById: true,
                        releasedAt: true,
                        releasedById: true,
                    },
                    orderBy: { sentAt: 'asc' },
                },
            },
        });
        if (!order) throw new Error('Orden no encontrada');
        if (order.status === 'CANCELLED' || order.status === 'DELIVERED') return order.status;

        const active = order.kitchenBatches.filter((batch) => batch.status !== 'RELEASED');
        const inPreparation = active.filter((batch) => batch.status === 'IN_PREPARATION');
        const pending = active.filter((batch) => batch.status === 'PENDING');
        const ready = active.filter((batch) => batch.status === 'READY');
        const released = order.kitchenBatches.filter((batch) => batch.status === 'RELEASED');
        const latestRelease = released[released.length - 1];
        const earliestStarted = inPreparation
            .filter((batch) => batch.startedAt)
            .sort((left, right) => left.startedAt!.getTime() - right.startedAt!.getTime())[0];

        const nextStatus = inPreparation.length > 0
            ? 'IN_PREPARATION' as const
            : pending.length > 0
                ? 'SENT_TO_KITCHEN' as const
                : ready.length > 0
                    ? 'READY' as const
                    : order.items.length > 0
                        ? 'OPEN' as const
                        : order.kitchenBatches.length > 0
                            ? 'READY' as const
                            : 'OPEN' as const;

        await tx.order.update({
            where: { id: orderId },
            data: {
                status: nextStatus,
                kitchenStartedAt: earliestStarted?.startedAt ?? null,
                kitchenStartedById: earliestStarted?.startedById ?? null,
                kitchenReleasedAt: active.length > 0 ? null : latestRelease?.releasedAt ?? order.kitchenReleasedAt,
                kitchenReleasedById: active.length > 0 ? null : latestRelease?.releasedById ?? null,
            },
        });
        return nextStatus;
    }

    private static async findKitchenBatchForOperation(
        tx: Prisma.TransactionClient,
        orderId: number,
        companyId: number,
        kitchenBatchId?: number,
    ) {
        if (kitchenBatchId !== undefined && (!Number.isInteger(kitchenBatchId) || kitchenBatchId <= 0)) {
            throw new Error('Tanda de cocina inválida');
        }
        const batch = await tx.kitchenBatch.findFirst({
            where: {
                ...(kitchenBatchId ? { id: kitchenBatchId } : {}),
                orderId,
                companyId,
                status: { not: 'RELEASED' },
            },
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        });
        if (!batch) {
            const released = await tx.kitchenBatch.findFirst({
                where: {
                    ...(kitchenBatchId ? { id: kitchenBatchId } : {}),
                    orderId,
                    companyId,
                    status: 'RELEASED',
                },
                select: { id: true },
            });
            throw new KitchenError(
                'La tanda de cocina no existe o ya fue liberada',
                released ? 'KITCHEN_BATCH_RELEASED' : 'KITCHEN_BATCH_NOT_FOUND',
            );
        }
        return batch;
    }

    private static deriveStatusFromItems(order: {
        items?: Array<{ sentAt?: Date | null; status?: string }>;
        kitchenReleasedAt?: Date | null;
    }) {
        const items = order.items || [];
        const sentItems = selectLatestKitchenBatch(items).filter((item) => item.sentAt != null);
        const hasSentItems = sentItems.length > 0;
        const hasInProgressItem = sentItems.some((item) => item.status === 'IN_PROGRESS');
        const hasPendingKitchenItem = sentItems.some((item) => item.status !== 'DONE');
        const hasUnsentItem = items.some((item) => item.sentAt == null);
        const currentBatchReady = hasSentItems
            && sentItems.every((item) => item.status === 'DONE');

        if (hasInProgressItem) return 'IN_PREPARATION';
        if (hasPendingKitchenItem) return 'SENT_TO_KITCHEN';
        // Unsent additions are a draft for the next wave. The completed current
        // wave must stay READY until kitchen explicitly releases it; otherwise
        // the KDS would lose work before handoff. Release moves the order back
        // to OPEN when such a draft exists.
        if (currentBatchReady) {
            return order.kitchenReleasedAt && hasUnsentItem ? 'OPEN' : 'READY';
        }
        return 'OPEN';
    }

    /**
     * Free-text filter for the orders list: order number (#123 / 123),
     * invoice number, customer name and table number. MySQL's default
     * collations are case-insensitive, so `contains` is case-insensitive.
     * Tenant/branch scoping stays in the outer where clause.
     */
    static buildOrderSearchWhere(rawSearch?: string): Prisma.OrderWhereInput | null {
        const search = typeof rawSearch === 'string' ? rawSearch.trim().slice(0, 100) : '';
        if (!search) return null;
        const or: Prisma.OrderWhereInput[] = [
            { customerName: { contains: search } },
            { invoiceNumber: { contains: search } },
            { table: { is: { number: { contains: search } } } },
            { user: { is: { name: { contains: search } } } },
        ];
        const numeric = search.replace(/^#/, '').trim();
        if (/^\d{1,10}$/.test(numeric)) {
            const id = Number(numeric);
            if (Number.isSafeInteger(id) && id > 0 && id <= 2147483647) or.push({ id });
        }
        return { OR: or };
    }

    static async getAll(companyId: number, filters?: {
        branchId?: number;
        tableId?: number;
        status?: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'CANCELLED';
        financialStatus?: 'UNPAID' | 'PARTIAL' | 'PAID';
        startDate?: Date;
        endDate?: Date;
        settledStartDate?: Date;
        settledEndDate?: Date;
        invoicedStartDate?: Date;
        invoicedEndDate?: Date;
        invoicedOnly?: boolean;
        search?: string;
        page?: number;
        limit?: number;
    }) {
        const where: Prisma.OrderWhereInput = { companyId };
        const searchWhere = this.buildOrderSearchWhere(filters?.search);
        if (searchWhere) where.AND = [searchWhere];

        if (filters?.branchId) {
            where.branchId = filters.branchId;
        }

        if (filters?.tableId) {
            where.tableId = filters.tableId;
        }

        if (filters?.status) {
            where.status = filters.status;
        }
        if (filters?.financialStatus) {
            where.financialStatus = filters.financialStatus;
        }

        if (filters?.startDate || filters?.endDate) {
            where.createdAt = {};
            if (filters.startDate) {
                where.createdAt.gte = filters.startDate;
            }
            if (filters.endDate) {
                where.createdAt.lte = filters.endDate;
            }
        }

        if (filters?.settledStartDate || filters?.settledEndDate) {
            where.closedAt = {};
            if (filters.settledStartDate) where.closedAt.gte = filters.settledStartDate;
            if (filters.settledEndDate) where.closedAt.lte = filters.settledEndDate;
        }
        if (filters?.invoicedOnly) {
            where.invoiceNumber = { not: null };
        }
        if (filters?.invoicedStartDate || filters?.invoicedEndDate) {
            where.invoicedAt = {};
            if (filters.invoicedStartDate) where.invoicedAt.gte = filters.invoicedStartDate;
            if (filters.invoicedEndDate) where.invoicedAt.lte = filters.invoicedEndDate;
        }

        // Pagination defaults
        const page = filters?.page || 1;
        const limit = Math.min(filters?.limit || 50, 200); // Cap at 200
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true
                        }
                    },
                    table: {
                        select: {
                            id: true,
                            number: true,
                            location: true
                        }
                    },
                    user: {
                        select: {
                            id: true,
                            name: true,
                            color: true
                        }
                    },
                    cancelledBy: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    _count: {
                        select: {
                            items: true
                        }
                    },
                    payments: {
                        include: {
                            paymentMethod: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    },
                    items: {
                        include: {
                            menuItem: true
                        }
                    },
                    fiscalCreditNotes: {
                        select: { id: true, number: true, status: true, issuedAt: true },
                        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
                        take: 1
                    },
                    fiscalInvoiceCancellation: {
                        select: { id: true, cancelledAt: true, reason: true }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take: limit
            }),
            prisma.order.count({ where })
        ]);

        return {
            data: data.map((order) => {
                const { fiscalCreditNotes, ...rest } = order;
                return this.withTimeline({ ...rest, fiscalCreditNote: fiscalCreditNotes[0] || null });
            }),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    static async getById(id: number, companyId: number) {
        const order = await prisma.order.findFirst({
            where: { id, companyId },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                table: {
                    select: {
                        id: true,
                        number: true,
                        location: true
                    }
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        color: true
                    }
                },
                items: {
                    include: {
                        menuItem: {
                            select: {
                                id: true,
                                name: true,
                                price: true
                            }
                        },
                        modifiers: true
                    }
                },
                payments: {
                    include: {
                        paymentMethod: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                fiscalCreditNotes: {
                    select: { id: true, number: true, status: true, issuedAt: true },
                    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
                    take: 1
                },
                fiscalInvoiceCancellation: {
                    select: { id: true, cancelledAt: true, reason: true }
                }
            }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }

        const { fiscalCreditNotes, ...rest } = order;
        return this.withTimeline({ ...rest, fiscalCreditNote: fiscalCreditNotes[0] || null });
    }

    /**
     * Validate and materialize an item's selected modifiers, mirroring the
     * membership check used by `addItem`: every modifierId must belong to one of
     * the MenuItem's modifier groups. Returns the OrderItemModifier create rows
     * plus their combined extra price so the caller can fold it into the unit price.
     */
    private static async resolveItemModifiers(
        tx: Prisma.TransactionClient,
        companyId: number,
        menuItem: { modifierGroups: { minSelect: number; maxSelect: number | null; modifiers: { id: number }[] }[] },
        modifierIds?: number[]
    ): Promise<{ create: { modifierId: number; name: string; price: Prisma.Decimal | number }[]; total: number }> {
        const selectedIds = modifierIds || [];
        if (new Set(selectedIds).size !== selectedIds.length) throw new Error('No se puede seleccionar el mismo modificador más de una vez');

        const validModifierIds = new Set(
            menuItem.modifierGroups.flatMap((g) => g.modifiers.map((m) => m.id))
        );
        const invalidIds = selectedIds.filter((id) => !validModifierIds.has(id));
        if (invalidIds.length > 0) {
            throw new Error('Modificadores inválidos para este producto');
        }

        for (const group of menuItem.modifierGroups) {
            const count = group.modifiers.filter((modifier) => selectedIds.includes(modifier.id)).length;
            const minimum = group.minSelect;
            if (count < minimum) throw new Error(`Debe seleccionar al menos ${minimum} modificador(es)`);
            if (group.maxSelect !== null && count > group.maxSelect) throw new Error(`Solo puede seleccionar ${group.maxSelect} modificador(es)`);
        }
        if (selectedIds.length === 0) return { create: [], total: 0 };

        const modifiers = await tx.modifier.findMany({
            where: {
                id: { in: selectedIds },
                active: true,
                modifierGroup: { companyId }
            }
        });
        if (modifiers.length !== selectedIds.length) throw new Error('Uno o más modificadores están inactivos');
        const total = modifiers.reduce((sum, mod) => sum + Number(mod.price), 0);

        return {
            create: modifiers.map((mod) => ({ modifierId: mod.id, name: mod.name, price: mod.price })),
            total
        };
    }

    static async create(companyId: number, data: {
        branchId: number;
        tableId?: number;
        userId: number;
        customerName?: string;
        customerTaxId?: string;
        customerTaxIdType?: string;
        customerFiscalAddress?: string;
        customerEmail?: string;
        customerPhone?: string;
        orderType?: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
        /** Party size (1..99); optional, waiter mode. */
        guests?: number;
        items?: Array<{
            menuItemId: number;
            quantity: number;
            price: number;
            notes?: string;
            modifierIds?: number[];
        }>;
    }) {
        if (!Number.isInteger(data.branchId) || data.branchId <= 0) throw new Error('Sucursal inválida');
        const fiscalCustomer = this.normalizeFiscalCustomer(data);
        const guests = data.guests === undefined || data.guests === null ? undefined : this.assertGuests(data.guests);
        for (const item of data.items || []) {
            if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('La cantidad debe ser un entero mayor a 0');
        }
        // Table -> Order lock order; replayed whole on deadlock/lock-wait.
        return await transactionWithP2034Retry(async (tx) => {
            const branch = await tx.branch.findFirst({ where: { id: data.branchId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!branch) throw new Error('Sucursal no encontrada o inactiva para esta empresa');
            // The order's table (if any) must belong to the same company AND the
            // same branch as the order, so branch-scoped reporting/billing stays consistent.
            if (data.tableId) {
                await tx.$queryRaw`SELECT id FROM \`Table\` WHERE id = ${data.tableId} AND companyId = ${companyId} FOR UPDATE`;
                const table = await tx.table.findFirst({
                    where: { id: data.tableId, companyId },
                    select: { id: true, branchId: true, status: true, activeTableGroupId: true }
                });
                if (!table) {
                    throw new Error('Mesa no encontrada para esta empresa');
                }
                if (table.branchId !== data.branchId) {
                    throw new Error('La mesa pertenece a otra sucursal');
                }
            }

            // Reuse the table's active operational order. A stale/offline create
            // must never open a second check for the same occupied table.
            if (data.tableId) {
                const existingOrder = await tx.order.findFirst({
                    where: {
                        companyId,
                        tableId: data.tableId,
                        ...tableOperationalOrderWhere(),
                        branchId: data.branchId
                    },
                    // If a reversed payment re-opened an older account on a
                    // table that a new party already occupies, merge into the
                    // newest (current party's) order, never the old debt.
                    orderBy: { id: 'desc' },
                    include: {
                        items: true,
                        payments: { where: { status: 'ACTIVE' }, select: { id: true } }
                    }
                });

                if (existingOrder) {
                    // A reused account keeps its party size unless the caller sends one.
                    if (guests !== undefined) {
                        await tx.order.update({ where: { id: existingOrder.id }, data: { guests } });
                        existingOrder.guests = guests;
                    }
                    // Merge items into existing order
                    if (data.items && data.items.length > 0) {
                        if (existingOrder.invoiceNumber || existingOrder.preInvoicedAt) {
                            throw new Error('No se puede modificar una orden con prefactura o factura emitida');
                        }
                        if (existingOrder.payments.length > 0) {
                            throw new Error('No se puede modificar una orden con pagos activos; revierta los pagos primero');
                        }
                        for (const item of data.items) {
                            const menuItem = await tx.menuItem.findFirst({
                                where: { id: item.menuItemId, companyId, active: true, OR: [{ branchId: null }, { branchId: data.branchId }] },
                                include: {
                                    _count: { select: { recipes: true } },
                                    modifierGroups: {
                                        where: { active: true },
                                        include: { modifiers: { where: { active: true }, select: { id: true } } }
                                    }
                                }
                            });
                            if (!menuItem) {
                                throw new Error('Elemento de menú no encontrado o inactivo');
                            }
                            this.assertMenuItemSellable(menuItem);

                            // Validate + price the selected modifiers (same rule as addItem).
                            const modifiers = await this.resolveItemModifiers(tx, companyId, menuItem, item.modifierIds);

                            // Resolve the branch-effective price (falls back to the
                            // base MenuItem price when no branch price is configured),
                            // then fold in the selected modifiers' extra price.
                            const basePrice = data.branchId
                                ? await DynamicPricingService.getPrice(item.menuItemId, data.branchId, companyId, tx)
                                : Number(menuItem.price);
                            const unitPrice = basePrice + modifiers.total;
                            const subtotal = unitPrice * item.quantity;
                            await tx.orderItem.create({
                                data: {
                                    orderId: existingOrder.id,
                                    menuItemId: item.menuItemId,
                                    quantity: item.quantity,
                                    price: unitPrice,
                                    subtotal: subtotal,
                                    notes: item.notes || '',
                                    modifiers: { create: modifiers.create }
                                }
                            });
                        }

                        // Recompute final total from authoritative item subtotals + stored adjustments.
                        const newSubtotal = await this.getOrderItemsSubtotal(tx, existingOrder.id);
                        const repricedDiscount = await this.repriceStoredDiscount(
                            tx, companyId, existingOrder.id, newSubtotal, existingOrder.discount, existingOrder.discountCode
                        );
                        const repricedTax = await this.repriceTax(tx, companyId, newSubtotal, repricedDiscount);
                        const newTotal = this.calculateFinalTotal(
                            newSubtotal,
                            repricedDiscount,
                            repricedTax,
                            Number(existingOrder.tipAmount || 0)
                        );
                        await tx.order.update({
                            where: { id: existingOrder.id },
                            data: {
                                total: newTotal,
                                discount: repricedDiscount,
                                tax: repricedTax,
                                ...fiscalCustomer,
                                ...(existingOrder.status === 'READY' && existingOrder.kitchenReleasedAt ? {
                                    status: 'OPEN' as const
                                } : {})
                            }
                        });

                        // Return the updated existing order
                        return await tx.order.findUnique({
                            where: { id: existingOrder.id },
                            include: {
                                table: true,
                                branch: true,
                                items: {
                                    include: {
                                        menuItem: true
                                    }
                                }
                            }
                        });
                    } else {
                        // If no items provided, just return existing order to open it
                        return existingOrder;
                    }
                }

                const table = await tx.table.findFirst({
                    where: { id: data.tableId, companyId },
                    select: { status: true, activeTableGroupId: true }
                });
                if (!table || (table.status !== 'AVAILABLE' && table.activeTableGroupId === null)) {
                    throw new Error('La mesa no está disponible para abrir una nueva orden');
                }

                // Block walk-ins under the same tenant-configured window used by
                // reservation allocation. One shared setting prevents the two
                // entry points from disagreeing about table availability.
                const now = new Date();
                const reservationWindowMs = (
                    await SettingService.getReservationTableWindowMinutes(companyId, tx)
                ) * 60 * 1000;
                const reservationConflicts = await tx.reservation.findMany({
                    where: {
                        companyId,
                        branchId: data.branchId,
                        tableId: data.tableId,
                        status: { in: ['PENDING', 'CONFIRMED'] },
                        date: {
                            gt: new Date(now.getTime() - reservationWindowMs),
                            lt: new Date(now.getTime() + reservationWindowMs)
                        }
                    },
                    select: { id: true, status: true }
                });
                if (reservationConflicts.length > 0) {
                    throw new Error('La mesa tiene una reservación vigente; complete el check-in o cancele la reservación antes de abrir la orden');
                }
            }

            // Create new order if no existing one found
            const order = await tx.order.create({
                data: {
                    companyId,
                    branchId: data.branchId,
                    tableId: data.tableId,
                    userId: data.userId,
                    ...fiscalCustomer,
                    ...(guests !== undefined ? { guests } : {}),
                    orderType: data.orderType,
                    total: 0,
                    status: 'OPEN'
                },
                include: {
                    table: true,
                    branch: true
                }
            });

            // Add items if provided
            if (data.items && data.items.length > 0) {
                let totalAmount = 0;

                for (const item of data.items) {
                    const menuItem = await tx.menuItem.findFirst({
                        where: { id: item.menuItemId, companyId, active: true, OR: [{ branchId: null }, { branchId: data.branchId }] },
                        include: {
                            _count: { select: { recipes: true } },
                            modifierGroups: {
                                where: { active: true },
                                include: { modifiers: { where: { active: true }, select: { id: true } } }
                            }
                        }
                    });
                    if (!menuItem) {
                        throw new Error('Elemento de menú no encontrado o inactivo');
                    }
                    this.assertMenuItemSellable(menuItem);

                    // Validate + price the selected modifiers (same rule as addItem).
                    const modifiers = await this.resolveItemModifiers(tx, companyId, menuItem, item.modifierIds);

                    // Resolve the branch-effective price (falls back to the base
                    // MenuItem price when no branch price is configured), then fold
                    // in the selected modifiers' extra price.
                    const basePrice = data.branchId
                        ? await DynamicPricingService.getPrice(item.menuItemId, data.branchId, companyId, tx)
                        : Number(menuItem.price);
                    const unitPrice = basePrice + modifiers.total;
                    const subtotal = unitPrice * item.quantity;
                    totalAmount += subtotal;

                    await tx.orderItem.create({
                        data: {
                            orderId: order.id,
                            menuItemId: item.menuItemId,
                            quantity: item.quantity,
                            price: unitPrice,
                            subtotal: subtotal,
                            notes: item.notes || '',
                            modifiers: { create: modifiers.create }
                        }
                    });
                }

                // Update order total from subtotal + company tax rate + stored tip.
                const initialDiscount = Number(order.discount || 0);
                const initialTax = await this.repriceTax(tx, companyId, totalAmount, initialDiscount);
                const newTotal = this.calculateFinalTotal(
                    totalAmount,
                    initialDiscount,
                    initialTax,
                    Number(order.tipAmount || 0)
                );
                await tx.order.update({
                    where: { id: order.id },
                    data: { total: newTotal, tax: initialTax }
                });

                (order as { total: number | typeof order.total }).total = newTotal;
            }

            // Update table status to OCCUPIED if a table is assigned
            if (data.tableId) {
                await tx.table.update({
                    where: { id: data.tableId },
                    data: { status: 'OCCUPIED' }
                });
            }

            // Fetch complete order with items
            return await tx.order.findUnique({
                where: { id: order.id },
                include: {
                    table: true,
                    branch: true,
                    items: {
                        include: {
                            menuItem: true
                        }
                    }
                }
            });
        });
    }

    static async addItem(orderId: number, companyId: number, data: {
        menuItemId: number;
        quantity: number;
        notes?: string;
        modifierIds?: number[];
    }) {
        // Validate quantity
        if (!Number.isInteger(data.quantity) || data.quantity <= 0) {
            throw new Error('La cantidad debe ser un entero mayor a 0');
        }

        return await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                include: { payments: { where: { status: 'ACTIVE' }, select: { id: true } } }
            });

            if (!order) {
                throw new Error('Orden no encontrada');
            }

            if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
                throw new Error('No se pueden agregar artículos a órdenes pagadas, entregadas o canceladas');
            }
            if (order.invoiceNumber || order.preInvoicedAt) {
                throw new Error('No se puede modificar una orden con prefactura o factura emitida');
            }
            if (order.payments.length > 0) {
                throw new Error('No se puede modificar una orden con pagos activos; revierta los pagos primero');
            }

            const menuItem = await tx.menuItem.findFirst({
                where: {
                    id: data.menuItemId,
                    companyId,
                    active: true,
                    OR: [{ branchId: null }, { branchId: order.branchId }]
                },
                include: {
                    _count: { select: { recipes: true } },
                    modifierGroups: {
                        where: { active: true },
                        include: { modifiers: { where: { active: true }, select: { id: true } } }
                    }
                }
            });
            if (!menuItem) {
                throw new Error('Elemento de menú no encontrado, inactivo o no disponible en la sucursal');
            }
            this.assertMenuItemSellable(menuItem);
            const modifiers = await this.resolveItemModifiers(tx, companyId, menuItem, data.modifierIds);

            // Resolve the branch-effective price for the order's branch (falls
            // back to the base MenuItem price when no branch price is configured).
            const basePrice = order.branchId
                ? await DynamicPricingService.getPrice(data.menuItemId, order.branchId, companyId, tx)
                : Number(menuItem.price);
            const unitPrice = basePrice + modifiers.total;
            const subtotal = unitPrice * data.quantity;

            const item = await tx.orderItem.create({
                data: {
                    orderId,
                    menuItemId: data.menuItemId,
                    quantity: data.quantity,
                    price: unitPrice,
                    subtotal: subtotal,
                    notes: data.notes,
                    modifiers: {
                        create: modifiers.create
                    }
                },
                include: {
                    menuItem: true,
                    modifiers: true
                }
            });

            const newSubtotal = await this.getOrderItemsSubtotal(tx, orderId);
            const repricedDiscount = await this.repriceStoredDiscount(
                tx, companyId, orderId, newSubtotal, order.discount, order.discountCode
            );
            const repricedTax = await this.repriceTax(tx, companyId, newSubtotal, repricedDiscount);
            const newTotal = this.calculateFinalTotal(
                newSubtotal,
                repricedDiscount,
                repricedTax,
                Number(order.tipAmount || 0)
            );

            await tx.order.update({
                where: { id: orderId },
                data: {
                    total: newTotal,
                    discount: repricedDiscount,
                    tax: repricedTax,
                    // A released READY wave may reopen as a draft. An unreleased
                    // READY wave stays visible in KDS until explicit handoff.
                    ...(order.status === 'READY' && order.kitchenReleasedAt ? {
                        status: 'OPEN' as const
                    } : {})
                }
            });

            return item;
        });
    }

    static async removeItem(itemId: number, companyId: number, branchId?: number, actorUserId?: number) {
        return await prisma.$transaction(async (tx) => {
            const target = await tx.orderItem.findFirst({
                where: { id: itemId, order: { companyId, ...(branchId !== undefined ? { branchId } : {}) } },
                select: { orderId: true }
            });
            if (!target) throw new Error('Línea de la orden no encontrada');

            // Serialize item removal with payments, cancellation and pricing changes.
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${target.orderId} AND companyId = ${companyId} FOR UPDATE`;
            const item = await tx.orderItem.findUnique({
                where: { id: itemId },
                include: {
                    order: {
                        include: { payments: { where: { status: 'ACTIVE' }, select: { id: true } } }
                    }
                }
            });

            if (!item || item.order.companyId !== companyId) {
                throw new Error('Línea de la orden no encontrada');
            }
            if (branchId !== undefined && item.order.branchId !== branchId) {
                throw new Error('Línea de la orden no encontrada');
            }

            if (item.order.status === 'CANCELLED' || item.order.status === 'DELIVERED') {
                throw new Error('No se pueden eliminar artículos de órdenes pagadas, entregadas o canceladas');
            }
            if (item.order.invoiceNumber || item.order.preInvoicedAt) {
                throw new Error('No se puede modificar una orden con prefactura o factura emitida');
            }
            if (item.sentAt !== null) {
                throw new Error('No se puede eliminar un articulo ya enviado a cocina; use un flujo de anulacion/merma');
            }
            if (item.order.payments.length > 0) {
                throw new Error('No se puede modificar una orden con pagos activos; revierta los pagos primero');
            }

            await tx.orderItem.delete({
                where: { id: itemId }
            });

            const newSubtotal = await this.getOrderItemsSubtotal(tx, item.orderId);
            const repricedDiscount = await this.repriceStoredDiscount(
                tx, companyId, item.orderId, newSubtotal, item.order.discount, item.order.discountCode
            );
            const priced = await this.repriceAfterLineShrink(
                tx, companyId, item.order, newSubtotal, repricedDiscount, actorUserId
            );

            await tx.order.update({
                where: { id: item.orderId },
                data: { total: priced.total, discount: priced.discount, tax: priced.tax, ...(priced.tipAmount !== undefined ? { tipAmount: priced.tipAmount } : {}) }
            });
            // Removing the only unsent draft line after a released wave must
            // restore the kitchen-derived status (READY), otherwise the order
            // stays OPEN and cannot be delivered. Legacy orders without batch
            // rows keep their stored status.
            if (await tx.kitchenBatch.count({ where: { orderId: item.orderId } }) > 0) {
                await this.syncOrderKitchenCompatibility(tx, item.orderId);
            }

            return { success: true, orderId: item.orderId };
        });
    }

    /** Party size must be a whole number between 1 and 99. */
    private static assertGuests(value: unknown): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 99) {
            throw new Error('El número de personas debe ser un entero entre 1 y 99');
        }
        return value;
    }

    /** PATCH /orders/:id/guests - party size of an open account. */
    static async setGuests(orderId: number, companyId: number, guests: number) {
        const value = this.assertGuests(guests);
        return await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                select: { id: true, status: true, branchId: true }
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.status === 'CANCELLED') {
                throw new Error('No se pueden cambiar las personas de una orden cancelada');
            }
            return await tx.order.update({
                where: { id: orderId },
                data: { guests: value },
                select: { id: true, guests: true }
            });
        });
    }

    /**
     * PATCH /orders/items/:itemId - change quantity and/or notes of a line that
     * was NOT sent to the kitchen yet. Same blocking rules as `addItem`. The line
     * keeps the unit price it was added with (base + modifiers), so a quantity
     * edit never silently picks up a later price change; the order discount,
     * tax and total are repriced exactly as after `addItem`/`removeItem`.
     */
    static async updateItem(
        itemId: number,
        companyId: number,
        branchId: number | undefined,
        data: { quantity?: number; notes?: string | null },
        actorUserId?: number
    ) {
        const hasQuantity = data.quantity !== undefined;
        const hasNotes = data.notes !== undefined;
        if (!hasQuantity && !hasNotes) {
            throw new Error('Indique la cantidad o las notas a modificar');
        }
        if (hasQuantity && (typeof data.quantity !== 'number' || !Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 999)) {
            throw new Error('La cantidad debe ser un entero entre 1 y 999');
        }
        if (hasNotes && data.notes !== null && (typeof data.notes !== 'string' || data.notes.length > 200)) {
            throw new Error('Las notas no pueden superar 200 caracteres');
        }

        return await prisma.$transaction(async (tx) => {
            const target = await tx.orderItem.findFirst({
                where: { id: itemId, order: { companyId, ...(branchId !== undefined ? { branchId } : {}) } },
                select: { orderId: true }
            });
            if (!target) throw new Error('Línea de la orden no encontrada');

            // Serialize with payments, cancellation, pricing and kitchen sends.
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${target.orderId} AND companyId = ${companyId} FOR UPDATE`;
            const item = await tx.orderItem.findUnique({
                where: { id: itemId },
                include: {
                    order: {
                        include: { payments: { where: { status: 'ACTIVE' }, select: { id: true } } }
                    }
                }
            });
            if (!item || item.order.companyId !== companyId) {
                throw new Error('Línea de la orden no encontrada');
            }
            if (branchId !== undefined && item.order.branchId !== branchId) {
                throw new Error('Línea de la orden no encontrada');
            }

            if (item.order.status === 'CANCELLED' || item.order.status === 'DELIVERED') {
                throw new Error('No se pueden modificar artículos de órdenes pagadas, entregadas o canceladas');
            }
            if (item.order.invoiceNumber || item.order.preInvoicedAt) {
                throw new Error('No se puede modificar una orden con prefactura o factura emitida');
            }
            if (item.order.payments.length > 0) {
                throw new Error('No se puede modificar una orden con pagos activos; revierta los pagos primero');
            }
            // Re-checked under the lock: a concurrent send-to-kitchen wins.
            if (item.sentAt !== null) {
                throw new Error('El artículo ya enviado a cocina no se puede editar; use una anulación');
            }
            if (item.voidedAt) {
                throw new Error('La línea fue anulada y no se puede editar');
            }

            // Asking for more of a dish that went inactive / lost its recipe
            // since it was added must fail like addItem would.
            if (hasQuantity && (data.quantity as number) > item.quantity) {
                const menuItem = await tx.menuItem.findFirst({
                    where: {
                        id: item.menuItemId,
                        companyId,
                        active: true,
                        OR: [{ branchId: null }, { branchId: item.order.branchId }]
                    },
                    include: { _count: { select: { recipes: true } } }
                });
                if (!menuItem) {
                    throw new Error('Elemento de menú no encontrado, inactivo o no disponible en la sucursal');
                }
                this.assertMenuItemSellable(menuItem);
            }

            const lineData: Prisma.OrderItemUpdateInput = {};
            if (hasQuantity) {
                lineData.quantity = data.quantity;
                lineData.subtotal = Number(item.price) * (data.quantity as number);
            }
            if (hasNotes) {
                lineData.notes = data.notes && data.notes.trim() ? data.notes.trim() : null;
            }
            const updated = await tx.orderItem.update({
                where: { id: itemId },
                data: lineData,
                include: { menuItem: true, modifiers: true }
            });

            const newSubtotal = await this.getOrderItemsSubtotal(tx, item.orderId);
            const repricedDiscount = await this.repriceStoredDiscount(
                tx, companyId, item.orderId, newSubtotal, item.order.discount, item.order.discountCode
            );
            const priced = await this.repriceAfterLineShrink(
                tx, companyId, item.order, newSubtotal, repricedDiscount, actorUserId
            );
            await tx.order.update({
                where: { id: item.orderId },
                data: { total: priced.total, discount: priced.discount, tax: priced.tax, ...(priced.tipAmount !== undefined ? { tipAmount: priced.tipAmount } : {}) }
            });

            return updated;
        });
    }

    /**
     * POST /orders/:id/items/deliver - the waiter hands lines to the guests.
     * Only lines the kitchen finished (DONE), not voided and not yet delivered
     * are stamped; everything else is reported in `skipped`. Replaying the same
     * request writes nothing (already delivered lines land in `skipped`).
     */
    static async deliverItems(orderId: number, companyId: number, userId: number, itemIds: number[]) {
        if (
            !Array.isArray(itemIds)
            || itemIds.length < 1
            || itemIds.length > 100
            || itemIds.some((id) => !Number.isInteger(id) || id < 1)
        ) {
            throw new Error('Indique entre 1 y 100 líneas a entregar');
        }
        const ids = Array.from(new Set(itemIds));

        return await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                select: { id: true, status: true }
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.status === 'CANCELLED') {
                throw new Error('No se pueden entregar líneas de una orden cancelada');
            }

            const lines = await tx.orderItem.findMany({
                where: { id: { in: ids }, orderId },
                select: { id: true, status: true, voidedAt: true, quantity: true, deliveredAt: true }
            });
            const deliverable = new Set(
                lines
                    .filter((l) => l.status === 'DONE' && !l.voidedAt && l.quantity > 0 && !l.deliveredAt)
                    .map((l) => l.id)
            );
            const alreadyDelivered = new Set(
                lines.filter((l) => !l.voidedAt && l.quantity > 0 && l.deliveredAt).map((l) => l.id)
            );
            const toDeliver = ids.filter((id) => deliverable.has(id));
            if (toDeliver.length > 0) {
                // The where repeats the eligibility guards so a concurrent
                // void/delivery can never be overwritten.
                await tx.orderItem.updateMany({
                    where: { id: { in: toDeliver }, orderId, status: 'DONE', voidedAt: null, deliveredAt: null },
                    data: { deliveredAt: new Date(), deliveredById: userId }
                });
            }
            return {
                delivered: toDeliver,
                // Delivered on an earlier call: lets a replay tell this apart from "not ready".
                alreadyDelivered: ids.filter((id) => alreadyDelivered.has(id)),
                // Not eligible: unknown, not DONE yet, voided.
                skipped: ids.filter((id) => !deliverable.has(id) && !alreadyDelivered.has(id))
            };
        });
    }

    /** `${companyId}_tipRate` x net subtotal, the only tip the POS can offer. */
    private static async getMaxTip(
        tx: Prisma.TransactionClient,
        companyId: number,
        netSubtotal: number
    ): Promise<number> {
        const tipRateSetting = await tx.setting.findUnique({
            where: { companyId_name: { companyId, name: `${companyId}_tipRate` } },
            select: { value: true }
        });
        const configuredTipRate = Number.parseFloat(tipRateSetting?.value ?? '0');
        const tipRate = Number.isFinite(configuredTipRate) && configuredTipRate >= 0 && configuredTipRate <= 100
            ? configuredTipRate
            : 0;
        return Math.round(Math.max(0, netSubtotal) * tipRate) / 100;
    }

    /**
     * Authoritative repricing after a line quantity changed outside the menu
     * flow (kitchen void). Subtotal comes from the persisted lines, a promotion
     * is recalculated against the new subtotal (and dropped, never kept stale,
     * when it no longer applies), tax is company rate x net subtotal and the
     * stored tip is capped to the configured rate over the new net subtotal.
     */
    static async recomputeOrderPricingWithTransaction(
        tx: Prisma.TransactionClient,
        companyId: number,
        order: {
            id: number;
            discount: Prisma.Decimal | number;
            discountCode: string | null;
            tipAmount: Prisma.Decimal | number | null;
        }
    ) {
        const subtotal = Math.round(await this.getOrderItemsSubtotal(tx, order.id) * 100) / 100;
        let discountCode = order.discountCode;
        let promotionRemoved: { code: string; reason: string } | null = null;
        let discount: number;
        try {
            discount = await this.repriceStoredDiscount(tx, companyId, order.id, subtotal, order.discount, discountCode);
        } catch (error) {
            if (!discountCode || !(error instanceof Error)) throw error;
            const isPromotionRejection = error instanceof PromotionValidationError
                || error.message === PROMOTION_NOT_ACTIVE_MESSAGE;
            if (!isPromotionRejection) throw error;
            promotionRemoved = { code: discountCode, reason: error.message };
            discountCode = null;
            discount = 0;
            await syncOrderLinePromotionDiscounts(tx, order.id, []);
        }
        const tax = await this.repriceTax(tx, companyId, subtotal, discount);
        const maxTip = await this.getMaxTip(tx, companyId, subtotal - discount);
        const storedTip = Math.round(Math.max(0, Number(order.tipAmount || 0)) * 100) / 100;
        const tipAmount = Math.min(storedTip, maxTip);
        const total = this.calculateFinalTotal(subtotal, discount, tax, tipAmount);
        return { subtotal, discount, discountCode, tax, tipAmount, total, promotionRemoved };
    }

    /**
     * Per-line kitchen void: removes `quantity` units (default: the whole line)
     * of a line already sent to kitchen. The voided units are wasted from a
     * branch warehouse under WASTE-ORD-{orderId}-L{voidLineId} (negative stock
     * allowed and alerted, exactly like a prepared full-order cancel), the
     * voided row is kept with quantity 0 so the KDS still shows it, totals are
     * repriced and the kitchen batch stays operable/releasable.
     *
     * Pre-invoiced, invoiced, paid/partially paid, delivered and cancelled
     * orders are refused: their counterflows are the prefactura reversal, a
     * fiscal credit note or a payment reversal. `idempotencyKey` makes a
     * retried request (offline replay, double tap) return the first result.
     */
    static async voidKitchenItem(
        orderId: number,
        itemId: number,
        companyId: number,
        actorUserId: number,
        input: {
            quantity?: number;
            reason?: string;
            wasteWarehouseId?: number;
            idempotencyKey?: string;
        }
    ) {
        if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
            throw new Error('Orden o línea inválida');
        }
        if (!Number.isInteger(actorUserId) || actorUserId <= 0) throw new Error('Usuario inválido');
        const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
        if (reason.length < 3 || reason.length > 500) {
            throw new Error('El motivo de anulación es obligatorio (3 a 500 caracteres)');
        }
        const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
        if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
            throw new Error('La clave idempotente de anulación es obligatoria (8 a 191 caracteres)');
        }
        if (input.quantity !== undefined && (!Number.isInteger(input.quantity) || input.quantity <= 0)) {
            throw new Error('La cantidad a anular debe ser un entero mayor a 0');
        }
        if (
            input.wasteWarehouseId !== undefined
            && (!Number.isInteger(input.wasteWarehouseId) || input.wasteWarehouseId <= 0)
        ) {
            throw new Error('Bodega de merma inválida');
        }

        return transactionWithP2034Retry(async (tx) => {
            // Same Table -> Order lock order as payment, cancel and release.
            await this.lockTableThenOrder(tx, companyId, orderId);

            const replay = await tx.orderItem.findFirst({
                where: { voidIdempotencyKey: idempotencyKey, order: { companyId } },
                select: { id: true, orderId: true, voidedFromItemId: true, voidedQuantity: true, voidReason: true, kitchenBatchId: true }
            });
            if (replay) {
                if (replay.orderId !== orderId || (replay.voidedFromItemId ?? replay.id) !== itemId) {
                    throw new Error('La clave idempotente ya fue usada para anular otra línea');
                }
                // Same key, different request: a conflict, never a silent replay.
                const quantityDiffers = input.quantity !== undefined && input.quantity !== replay.voidedQuantity;
                const reasonDiffers = (replay.voidReason ?? '').trim() !== reason;
                if (quantityDiffers || reasonDiffers) {
                    throw Object.assign(
                        new Error('La clave idempotente ya fue usada con otra cantidad o motivo; genere una nueva anulación'),
                        { statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' }
                    );
                }
                const current = await tx.order.findFirst({
                    where: { id: orderId, companyId },
                    include: voidResultOrderInclude
                });
                if (!current) throw new Error('Orden no encontrada');
                return {
                    replayed: true,
                    order: current,
                    branchId: current.branchId,
                    voidItemId: replay.id,
                    voidedQuantity: replay.voidedQuantity,
                    kitchenBatchId: replay.kitchenBatchId,
                    promotionRemoved: null,
                    manualDiscountClamped: null,
                };
            }

            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                include: { payments: { where: { status: 'ACTIVE' }, select: { id: true } } }
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.status === 'CANCELLED') throw new Error('La orden está cancelada');
            if (order.status === 'DELIVERED') {
                throw new Error('La orden ya fue entregada; use una cancelación o nota de crédito');
            }
            // Channel orders (PedidosYa, delivery apps) carry channel pricing
            // (commission, tax-inclusive totals) that a line repricing would
            // corrupt: they use the channel's own cancellation flow.
            if (order.salesChannel !== 'RESTAURANT') {
                throw new Error('No se pueden anular líneas de órdenes de canales externos; use el flujo de cancelación del canal');
            }
            if (order.invoiceNumber) {
                throw new Error('La orden ya está facturada; emita una nota de crédito para anular productos');
            }
            if (order.preInvoicedAt) {
                throw new Error('La orden tiene prefactura emitida; revierta la prefactura antes de anular productos');
            }
            if (order.payments.length > 0 || order.financialStatus !== 'UNPAID') {
                throw new Error('La orden tiene pagos registrados; revierta los pagos antes de anular productos');
            }

            const item = await tx.orderItem.findFirst({
                where: { id: itemId, orderId },
                include: {
                    modifiers: true,
                    menuItem: {
                        include: {
                            recipes: {
                                include: {
                                    product: { include: { baseUnit: { select: { abbreviation: true } } } },
                                    unitOfMeasure: { select: { abbreviation: true } }
                                }
                            }
                        }
                    }
                }
            });
            if (!item) throw new Error('Línea de la orden no encontrada');
            if (item.voidedAt || item.quantity <= 0) throw new Error('La línea ya fue anulada');
            if (item.sentAt === null) {
                throw new Error('La línea no se ha enviado a cocina; elimínela de la orden en lugar de anularla');
            }
            const voidQuantity = input.quantity ?? item.quantity;
            if (voidQuantity > item.quantity) {
                throw new Error(`Solo hay ${item.quantity} unidad(es) disponibles para anular en esta línea`);
            }

            // Plain validation read only: consumeForOrder takes the first
            // warehouse lock ({fallback ∪ routed} ascending) and re-validates
            // the branch under it. A standalone Warehouse lock here would be
            // out of ascending order and deadlock with transfers/costing.
            let wasteWarehouseId: number;
            const explicitWasteWarehouse = input.wasteWarehouseId !== undefined;
            if (input.wasteWarehouseId !== undefined) {
                const warehouse = await tx.warehouse.findFirst({
                    where: { id: input.wasteWarehouseId, companyId, branchId: order.branchId, type: 'BRANCH' },
                    select: { id: true }
                });
                if (!warehouse) throw new Error('Bodega de merma no encontrada para la empresa/sucursal de la orden');
                wasteWarehouseId = warehouse.id;
            } else {
                const resolved = await SaleWarehouseService.resolve(tx, companyId, order.branchId);
                if (resolved.warehouseId === null) {
                    throw new Error('Seleccione la bodega donde se registrará la merma de la línea anulada');
                }
                wasteWarehouseId = resolved.warehouseId;
            }

            const now = new Date();
            const unitPriceCents = Math.round(Number(item.price) * 100);
            const remainingQuantity = item.quantity - voidQuantity;
            let voidLineId = item.id;
            if (remainingQuantity > 0) {
                // Partial void: the voided units become their own row so the
                // waste, the KDS strike-through and the audit refer to exactly
                // those units while the original line keeps the rest.
                await tx.orderItem.update({
                    where: { id: item.id },
                    data: {
                        quantity: remainingQuantity,
                        subtotal: (unitPriceCents * remainingQuantity) / 100
                    }
                });
                const created = await tx.orderItem.create({
                    data: {
                        orderId,
                        menuItemId: item.menuItemId,
                        kitchenBatchId: item.kitchenBatchId,
                        quantity: voidQuantity,
                        price: item.price,
                        subtotal: (unitPriceCents * voidQuantity) / 100,
                        notes: item.notes,
                        status: item.status,
                        sentAt: item.sentAt,
                        startedAt: item.startedAt,
                        finishedAt: item.finishedAt,
                        deliveredAt: item.deliveredAt,
                        deliveredById: item.deliveredById,
                        originOrderId: item.originOrderId,
                        originTableId: item.originTableId,
                        voidedFromItemId: item.id,
                        modifiers: {
                            create: item.modifiers.map((modifier) => ({
                                modifierId: modifier.modifierId,
                                name: modifier.name,
                                price: modifier.price
                            }))
                        }
                    },
                    select: { id: true }
                });
                voidLineId = created.id;
            }

            const wasteReference = `WASTE-ORD-${orderId}-L${voidLineId}`;
            // Runs while the void row still carries its quantity, so recipe and
            // linked-modifier waste both use exactly the voided units.
            const waste = await InventoryConsumptionService.consumeForOrder(tx, {
                order: { id: order.id, userId: order.userId, items: [{ ...item, id: voidLineId, quantity: voidQuantity }] },
                orderItemIds: [voidLineId],
                warehouseId: wasteWarehouseId,
                userId: actorUserId,
                companyId,
                reference: wasteReference,
                reason: `WASTE: Anulación de línea #${voidLineId} de orden #${orderId}: ${reason}`.slice(0, 500),
                modifierReason: `WASTE: Merma de modificador por anulación de línea #${voidLineId} de orden #${orderId}`,
                // Prepared food: a short balance never blocks the void. Stock may
                // go negative and the alert is recorded under wasteReference.
                allowNegative: true,
                // A warehouse chosen by the user is honored as-is; the default
                // sale warehouse follows the branch ingredient routing.
                route: !explicitWasteWarehouse,
                expectedBranchId: order.branchId
            });

            await tx.orderItem.update({
                where: { id: voidLineId },
                data: {
                    quantity: 0,
                    subtotal: 0,
                    voidedQuantity: voidQuantity,
                    voidedAt: now,
                    voidedById: actorUserId,
                    voidReason: reason,
                    voidWasteReference: wasteReference,
                    voidWasteWarehouseId: wasteWarehouseId,
                    voidIdempotencyKey: idempotencyKey,
                    // A voided row is closed work for the KDS: it never blocks
                    // start/ready and is rendered as voided, not pending.
                    status: 'DONE',
                    finishedAt: item.finishedAt ?? now
                }
            });

            // A batch whose every line is now voided has nothing left to cook:
            // move it to READY so the kitchen can acknowledge and release it.
            let kitchenBatchReadied = false;
            if (item.kitchenBatchId) {
                const batch = await tx.kitchenBatch.findFirst({
                    where: { id: item.kitchenBatchId, companyId },
                    select: { id: true, status: true, startedAt: true, startedById: true }
                });
                if (batch && (batch.status === 'PENDING' || batch.status === 'IN_PREPARATION')) {
                    const live = await tx.orderItem.count({
                        where: { kitchenBatchId: batch.id, quantity: { gt: 0 } }
                    });
                    if (live === 0) {
                        await tx.kitchenBatch.update({
                            where: { id: batch.id },
                            data: {
                                status: 'READY',
                                readyAt: now,
                                startedAt: batch.startedAt ?? now,
                                startedById: batch.startedById ?? actorUserId
                            }
                        });
                        kitchenBatchReadied = true;
                    }
                }
            }
            if (await tx.kitchenBatch.count({ where: { orderId } }) > 0) {
                await this.syncOrderKitchenCompatibility(tx, orderId);
            }

            const previous = {
                total: Number(order.total),
                discount: Number(order.discount),
                discountCode: order.discountCode,
                tax: Number(order.tax),
                tipAmount: Number(order.tipAmount || 0)
            };
            const pricing = await this.recomputeOrderPricingWithTransaction(tx, companyId, order);
            // Every line voided: nothing was sold, so the promotion is dropped
            // (a zero-total completion must never claim its usage).
            if (pricing.subtotal <= 0 && pricing.discountCode) {
                pricing.promotionRemoved = {
                    code: pricing.discountCode,
                    reason: 'Todas las líneas de la orden fueron anuladas; se retiró la promoción'
                };
                pricing.discountCode = null;
                pricing.discount = 0;
                pricing.tax = 0;
                pricing.tipAmount = 0;
                pricing.total = 0;
            }
            // A fixed manual discount grows as a percentage when the subtotal
            // shrinks: re-apply the role cap of whoever set it.
            const manualDiscountClamped = await this.clampManualDiscountAfterVoid(tx, companyId, order, pricing);
            await tx.order.update({
                where: { id: orderId },
                data: {
                    total: pricing.total,
                    discount: pricing.discount,
                    discountCode: pricing.discountCode,
                    tax: pricing.tax,
                    tipAmount: pricing.tipAmount
                }
            });

            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: orderId,
                    action: 'KITCHEN_LINE_VOID',
                    userId: actorUserId,
                    details: {
                        orderItemId: item.id,
                        voidLineId,
                        menuItemId: item.menuItemId,
                        voidedQuantity: voidQuantity,
                        remainingQuantity,
                        unitPrice: unitPriceCents / 100,
                        reason,
                        kitchenBatchId: item.kitchenBatchId,
                        kitchenBatchReadied,
                        wasteReference,
                        wasteWarehouseId,
                        negativeStockProductIds: waste.negativeProductIds ?? [],
                        previous,
                        repriced: {
                            subtotal: pricing.subtotal,
                            discount: pricing.discount,
                            discountCode: pricing.discountCode,
                            tax: pricing.tax,
                            tipAmount: pricing.tipAmount,
                            total: pricing.total
                        },
                        promotionRemoved: pricing.promotionRemoved,
                        manualDiscountClamped,
                        idempotencyKey
                    }
                }
            });

            const updated = await tx.order.findFirst({
                where: { id: orderId, companyId },
                include: voidResultOrderInclude
            });
            if (!updated) throw new Error('Orden no encontrada');
            return {
                replayed: false,
                order: updated,
                branchId: updated.branchId,
                voidItemId: voidLineId,
                voidedQuantity: voidQuantity,
                kitchenBatchId: item.kitchenBatchId,
                promotionRemoved: pricing.promotionRemoved,
                manualDiscountClamped,
            };
        }, SETTLEMENT_TRANSACTION_OPTIONS);
    }

    /**
     * Re-validates a manual (non-promotion) discount against
     * maxManualDiscountPercent after a line void shrank the subtotal. The cap
     * applies when the discount's author (last PRICING_UPDATED, else the
     * order creator) has a capped role, or, for a supervisor-authorized
     * discount, min(authorizer limit, the percentage that was authorized); an excess is clamped to the cap over
     * the new subtotal and tax/tip/total are repriced. Mutates `pricing`.
     */
    private static async clampManualDiscountAfterVoid(
        tx: Prisma.TransactionClient,
        companyId: number,
        order: { id: number; userId: number; tipAmount: Prisma.Decimal | number | null },
        pricing: { subtotal: number; discount: number; discountCode: string | null; tax: number; tipAmount: number; total: number }
    ): Promise<{ previousDiscount: number; discount: number; maxPercent: number; authorUserId: number } | null> {
        if (pricing.discountCode || !(pricing.discount > 0)) return null;
        // A supervisor-authorized discount is bounded by the authorizer's own
        // limit, not by the (lower) limit of the requester who asked for it.
        const stamped = await tx.order.findUnique({
            where: { id: order.id },
            select: { discountAuthorizedById: true, discountAuthorizedPercent: true }
        });
        const authorizerId = stamped?.discountAuthorizedById ?? null;
        const authorizedPercent = stamped?.discountAuthorizedPercent === null || stamped?.discountAuthorizedPercent === undefined
            ? null
            : Number(stamped.discountAuthorizedPercent);
        // The applier is the last PRICING_UPDATED that actually changed the
        // discount: tip-only edits also write PRICING_UPDATED and must not
        // transfer ownership of someone else's discount.
        const recentPricing = authorizerId ? [] : await tx.auditLog.findMany({
            where: { companyId, entityType: 'Order', entityId: order.id, action: 'PRICING_UPDATED' },
            orderBy: { id: 'desc' },
            take: 50,
            select: { userId: true, details: true }
        });
        const discountChange = recentPricing.find((entry) => {
            const details = (entry.details ?? {}) as { previousDiscount?: unknown; discount?: unknown };
            return details.previousDiscount !== undefined && details.discount !== undefined
                && Number(details.previousDiscount) !== Number(details.discount);
        });
        const authorUserId = authorizerId ?? discountChange?.userId ?? order.userId;
        const author = await tx.user.findFirst({
            where: { id: authorUserId, companyId },
            select: {
                role: { select: { name: true, maxDiscountPercent: true } },
                userRoles: { select: { role: { select: { name: true, maxDiscountPercent: true } } } }
            }
        });
        if (!author) return null;
        // Same limit the discount was applied under: the authorizer's, else the
        // applier's (role limit under the company cap; MESERO = company cap).
        const authorRoles = [author.role, ...(author.userRoles ?? []).map((row) => row.role)].filter(Boolean);
        const roleLimit = resolveLimit(
            new Set(authorRoles.map((role) => role.name)),
            authorRoles.map((role) => role.maxDiscountPercent),
            await getCompanyDiscountCap(tx, companyId)
        );
        // A supervisor approved a specific percentage, not their whole role limit:
        // later shrinks may never push the discount past what they saw.
        const maxPercent = authorizerId && authorizedPercent !== null && authorizedPercent >= 0
            ? Math.min(roleLimit, authorizedPercent)
            : roleLimit;
        if (maxPercent >= 100) return null;
        const maxDiscount = Math.floor(Math.max(0, pricing.subtotal) * maxPercent) / 100;
        if (pricing.discount <= maxDiscount) return null;
        const previousDiscount = pricing.discount;
        pricing.discount = maxDiscount;
        pricing.tax = await this.repriceTax(tx, companyId, pricing.subtotal, maxDiscount);
        const maxTip = await this.getMaxTip(tx, companyId, pricing.subtotal - maxDiscount);
        const storedTip = Math.round(Math.max(0, Number(order.tipAmount || 0)) * 100) / 100;
        pricing.tipAmount = Math.min(storedTip, maxTip);
        pricing.total = this.calculateFinalTotal(pricing.subtotal, maxDiscount, pricing.tax, pricing.tipAmount);
        return { previousDiscount, discount: maxDiscount, maxPercent, authorUserId };
    }

    /**
     * Tax/total after unsent lines were removed or shrunk. A manual discount is
     * re-capped to the percent limit it was granted under (authorizer's, else the
     * applier's, else the acting user's) so shrinking the subtotal cannot push
     * the effective percent past it. The clamp is audited like the void path.
     */
    private static async repriceAfterLineShrink(
        tx: Prisma.TransactionClient,
        companyId: number,
        order: { id: number; userId: number; discount: Prisma.Decimal | number | null; discountCode: string | null; tipAmount: Prisma.Decimal | number | null },
        subtotal: number,
        discount: number,
        actorUserId?: number
    ): Promise<{ discount: number; tax: number; total: number; tipAmount?: number }> {
        const pricing = {
            subtotal,
            discount,
            discountCode: order.discountCode,
            tax: await this.repriceTax(tx, companyId, subtotal, discount),
            tipAmount: Number(order.tipAmount || 0),
            total: 0
        };
        pricing.total = this.calculateFinalTotal(subtotal, discount, pricing.tax, pricing.tipAmount);
        const originalTip = pricing.tipAmount;
        const clamped = await this.clampManualDiscountAfterVoid(
            tx, companyId,
            // No qualifying audit => the order creator owns the discount (never the actor).
            { id: order.id, userId: order.userId, tipAmount: order.tipAmount },
            pricing
        );
        if (clamped) {
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: order.id,
                    action: 'MANUAL_DISCOUNT_CLAMPED',
                    userId: actorUserId ?? order.userId,
                    details: {
                        reason: 'LINE_CHANGE',
                        subtotal,
                        previousDiscount: clamped.previousDiscount,
                        discount: clamped.discount,
                        maxPercent: clamped.maxPercent,
                        limitOwnerUserId: clamped.authorUserId
                    }
                }
            });
        }
        return {
            discount: pricing.discount,
            tax: pricing.tax,
            total: pricing.total,
            ...(pricing.tipAmount !== originalTip ? { tipAmount: pricing.tipAmount } : {})
        };
    }

    static async updateStatus(
        id: number,
        companyId: number,
        status: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'CANCELLED',
        kitchenActorUserId?: number
    ) {
        // READY is a kitchen-controlled transition. Keeping the actor explicit
        // prevents the generic waiter/cashier status endpoint from bypassing KDS
        // permissions and lets the state change + audit record commit atomically.
        if (status === 'READY' && (!Number.isInteger(kitchenActorUserId) || Number(kitchenActorUserId) <= 0)) {
            throw new Error('Use el flujo dedicado de cocina para marcar una orden como lista');
        }
        const updatedOrder = await prisma.$transaction(async (tx) => {
            // Lock order row to keep transition validation and update atomic.
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;

            const existing = await tx.order.findFirst({
                where: { id, companyId },
                include: { items: { select: { id: true, sentAt: true, status: true } } }
            });

            if (!existing) {
                throw new Error('Orden no encontrada');
            }

            if (status === 'READY') {
                const kitchenActor = await tx.user.findFirst({
                    where: { id: kitchenActorUserId!, companyId, status: 'ACTIVE' },
                    select: { id: true }
                });
                if (!kitchenActor) throw new Error('Usuario de cocina no válido para esta empresa');
            }

            // The dedicated KDS operation can be retried after the state/audit
            // transaction committed but a notification response failed. Return
            // the already-ready order so the durable, deduplicated notifier can
            // be attempted again without manufacturing a second transition.
            const currentKitchenBatch = status === 'READY'
                ? selectLatestKitchenBatch(existing.items ?? [])
                : [];

            if (status === 'READY' && existing.status === 'READY') {
                if (currentKitchenBatch.length === 0 || currentKitchenBatch.some((item) => item.sentAt === null)) {
                    throw new Error('La tanda marcada como lista contiene productos sin enviar a cocina');
                }
                const readyOrder = await tx.order.findUnique({
                    where: { id },
                    include: {
                        table: true,
                        user: { select: { id: true, name: true, color: true } },
                        items: { include: { menuItem: true, modifiers: true } }
                    }
                });
                if (!readyOrder) throw new Error('Orden no encontrada');
                return readyOrder;
            }

            // Cancellation has inventory/payment/table/audit counterflows and may
            // never be represented as a generic status write.
            if (status === 'CANCELLED') {
                throw new Error('Use el flujo dedicado de cancelacion de orden');
            }
            if (status === 'DELIVERED') {
                throw new Error('Use el flujo dedicado de entrega con una bodega explícita');
            }

            const allowedTransitions = VALID_TRANSITIONS[existing.status] || [];
            if (!allowedTransitions.includes(status)) {
                throw new Error(
                    `Order status transition from '${existing.status}' to '${status}' is not allowed. ` +
                    `Valid transitions: ${allowedTransitions.join(', ') || 'none (terminal state)'}`
                );
            }

            // When the whole order is marked as READY (e.g. "Todo Listo" in KDS),
            // force every still-open sent item to DONE so the kitchen timeline
            // (firstStartedAt / readyAt) reflects completion. READY is an order-
            // level assertion, so every line must already have been sent.
            if (status === 'READY') {
                if (currentKitchenBatch.length === 0) {
                    throw new Error('No se puede marcar como lista una orden vacía');
                }
                if (currentKitchenBatch.some((item) => item.sentAt === null)) {
                    throw new Error('No se puede marcar lista una tanda con productos sin enviar a cocina');
                }
                const now = new Date();
                const currentKitchenItemIds = currentKitchenBatch.map((item) => item.id);
                await tx.orderItem.updateMany({
                    where: { orderId: id, id: { in: currentKitchenItemIds }, status: { not: 'DONE' } },
                    data: { status: 'DONE', finishedAt: now }
                });
                await tx.orderItem.updateMany({
                    where: { orderId: id, id: { in: currentKitchenItemIds }, startedAt: null },
                    data: { startedAt: now }
                });
            }

            const updated = await tx.order.update({
                where: { id },
                data: {
                    status
                },
                include: {
                    table: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            color: true
                        }
                    },
                    items: {
                        include: {
                            menuItem: true,
                            modifiers: true
                        }
                    }
                }
            });

            if (status === 'READY') {
                await tx.auditLog.create({
                    data: {
                        companyId,
                        entityType: 'Order',
                        entityId: id,
                        action: 'KITCHEN_READY',
                        userId: kitchenActorUserId!,
                        details: { status: 'READY' }
                    }
                });
            }

            return updated;
        });

        this.syncPedidosYaStatus(companyId, updatedOrder);

        return this.withTimeline(updatedOrder);
    }

    static async sendToKitchen(id: number, companyId: number) {
        const now = new Date();

        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            // Re-check status INSIDE the transaction to prevent a TOCTOU race.
            const order = await tx.order.findFirst({
                where: { id, companyId },
                include: { items: true }
            });

            if (!order) {
                throw new Error('Orden no encontrada');
            }

            if (!['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'].includes(order.status)) {
                throw new Error(`No se puede enviar a cocina una orden con estado ${order.status}`);
            }

            if (order.items.length === 0) {
                throw new Error('No se puede enviar una orden vacía a cocina');
            }

            const unsentItems = order.items.filter((item) => item.sentAt == null);

            if (unsentItems.length === 0) {
                // A retry after the first transaction committed is a safe no-op.
                // It must not create a second wave or fail an offline replay.
                const currentBatch = await tx.kitchenBatch.findFirst({
                    where: { orderId: id, companyId },
                    include: kitchenBatchOrderInclude,
                    orderBy: [{ sequence: 'desc' }, { id: 'desc' }],
                });
                if (!currentBatch) {
                    throw new Error('La orden no tiene una tanda de cocina persistida');
                }
                // Repairs an order left OPEN with nothing unsent (e.g. a draft
                // line was added and removed after the last wave was released).
                await this.syncOrderKitchenCompatibility(tx, id);
                return {
                    ...this.withPersistentKitchenBatch(currentBatch),
                    kitchenBatchSent: false,
                };
            }

            const latestSequence = await tx.kitchenBatch.aggregate({
                where: { orderId: id },
                _max: { sequence: true },
            });
            const kitchenBatch = await tx.kitchenBatch.create({
                data: {
                    companyId,
                    branchId: order.branchId,
                    orderId: id,
                    sequence: (latestSequence._max.sequence ?? 0) + 1,
                    status: 'PENDING',
                    sentAt: now,
                },
            });

            // Every send owns an independent KDS lifecycle. Previous batches can
            // remain active without swallowing this new wave.
            await tx.orderItem.updateMany({
                where: { orderId: id, sentAt: null },
                data: { sentAt: now, kitchenBatchId: kitchenBatch.id }
            });

            await this.syncOrderKitchenCompatibility(tx, id);
            const createdBatch = await tx.kitchenBatch.findUnique({
                where: { id: kitchenBatch.id },
                include: kitchenBatchOrderInclude,
            });
            if (!createdBatch) throw new Error('No se pudo recuperar la tanda de cocina');
            return {
                ...this.withPersistentKitchenBatch(createdBatch),
                kitchenBatchSent: true,
            };
        });
        this.syncPedidosYaStatus(companyId, result);
        return result;
    }

    static async updateFiscalCustomer(
        id: number,
        companyId: number,
        userId: number,
        data: FiscalCustomerInput
    ) {
        const normalized = this.normalizeFiscalCustomer(data);
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id, companyId },
                select: { id: true, branchId: true, invoiceNumber: true, preInvoicedAt: true }
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.invoiceNumber || order.preInvoicedAt) {
                throw new Error('Los datos fiscales no pueden modificarse después de emitir la factura');
            }
            const actor = await tx.user.findFirst({
                where: { id: userId, companyId, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!actor) throw new Error('Usuario inválido para esta empresa');

            const updated = await tx.order.update({ where: { id }, data: normalized });
            await tx.auditLog.create({
                data: {
                    companyId,
                    userId,
                    entityType: 'Order',
                    entityId: id,
                    action: 'FISCAL_CUSTOMER_UPDATED',
                    details: {
                        hasTaxIdentity: Boolean(normalized.customerTaxId),
                        taxIdType: normalized.customerTaxIdType,
                        hasFiscalAddress: Boolean(normalized.customerFiscalAddress),
                        hasEmail: Boolean(normalized.customerEmail),
                        hasPhone: Boolean(normalized.customerPhone)
                    }
                }
            });
            return updated;
        });
    }

    static async startItem(
        orderId: number,
        itemId: number,
        companyId: number,
        actorUserId?: number,
    ) {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                select: { status: true },
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
                throw new Error(`No se puede actualizar items de una orden ${order.status}`);
            }

            const item = await tx.orderItem.findFirst({
                where: { id: itemId, orderId },
                select: { kitchenBatchId: true },
            });
            if (!item?.kitchenBatchId) {
                throw new Error('El artículo no pertenece a una tanda de cocina');
            }
            const batch = await tx.kitchenBatch.findFirst({
                where: { id: item.kitchenBatchId, orderId, companyId },
            });
            if (!batch || batch.status === 'RELEASED') {
                throw new Error('La tanda de cocina no está disponible');
            }

            const startedAt = new Date();
            const claimed = await tx.orderItem.updateMany({
                where: {
                    id: itemId,
                    orderId,
                    kitchenBatchId: batch.id,
                    status: 'PENDING',
                    sentAt: { not: null },
                },
                data: { status: 'IN_PROGRESS', startedAt },
            });
            if (claimed.count !== 1) {
                throw new Error('El item debe estar enviado y PENDIENTE para iniciar');
            }
            const updatedItem = await tx.orderItem.findUnique({
                where: { id: itemId },
                include: { menuItem: true },
            });
            if (!updatedItem) throw new Error('Item no encontrado');

            await tx.kitchenBatch.update({
                where: { id: batch.id },
                data: {
                    status: 'IN_PREPARATION',
                    startedAt: batch.startedAt ?? startedAt,
                    startedById: batch.startedById ?? actorUserId,
                },
            });
            await this.syncOrderKitchenCompatibility(tx, orderId);
            const updatedBatch = await tx.kitchenBatch.findUnique({
                where: { id: batch.id },
                include: kitchenBatchOrderInclude,
            });
            if (!updatedBatch) throw new Error('Tanda de cocina no encontrada');

            return {
                item: updatedItem,
                order: this.withPersistentKitchenBatch(updatedBatch),
                kitchenBatchId: batch.id,
            };
        });
        this.syncPedidosYaStatus(companyId, result.order);
        return result;
    }

    static async finishItem(
        orderId: number,
        itemId: number,
        companyId: number,
        actorUserId?: number,
    ) {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                select: { status: true },
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
                throw new Error(`No se puede actualizar items de una orden ${order.status}`);
            }

            const item = await tx.orderItem.findFirst({
                where: { id: itemId, orderId },
                select: { kitchenBatchId: true },
            });
            if (!item?.kitchenBatchId) {
                throw new Error('El artículo no pertenece a una tanda de cocina');
            }
            const batch = await tx.kitchenBatch.findFirst({
                where: { id: item.kitchenBatchId, orderId, companyId },
            });
            if (!batch || batch.status === 'RELEASED') {
                throw new Error('La tanda de cocina no está disponible');
            }

            const finishedAt = new Date();
            const claimed = await tx.orderItem.updateMany({
                where: {
                    id: itemId,
                    orderId,
                    kitchenBatchId: batch.id,
                    status: 'IN_PROGRESS',
                },
                data: { status: 'DONE', finishedAt },
            });
            if (claimed.count !== 1) {
                throw new Error('El item debe estar EN PROGRESO para finalizar');
            }
            const updatedItem = await tx.orderItem.findUnique({
                where: { id: itemId },
                include: { menuItem: true },
            });
            if (!updatedItem) throw new Error('Item no encontrado');

            const openItems = await tx.orderItem.count({
                where: { kitchenBatchId: batch.id, status: { not: 'DONE' } },
            });
            const allDone = openItems === 0;
            await tx.kitchenBatch.update({
                where: { id: batch.id },
                data: allDone
                    ? {
                        status: 'READY',
                        readyAt: finishedAt,
                        startedAt: batch.startedAt ?? finishedAt,
                        startedById: batch.startedById ?? actorUserId,
                    }
                    : {
                        status: 'IN_PREPARATION',
                        startedAt: batch.startedAt ?? finishedAt,
                        startedById: batch.startedById ?? actorUserId,
                    },
            });
            await this.syncOrderKitchenCompatibility(tx, orderId);
            const updatedBatch = await tx.kitchenBatch.findUnique({
                where: { id: batch.id },
                include: kitchenBatchOrderInclude,
            });
            if (!updatedBatch) throw new Error('Tanda de cocina no encontrada');

            return {
                item: updatedItem,
                allDone,
                order: this.withPersistentKitchenBatch(updatedBatch),
                kitchenBatchId: batch.id,
            };
        });
        this.syncPedidosYaStatus(companyId, result.order);
        return result;
    }

    /**
     * Shared Table -> Order lock order (payments, prefactura, invoicing and
     * order creation use it). The candidate table is read without a lock; if
     * the order moved before its row lock was granted, the current table is
     * locked afterwards (residual window covered by the deadlock retry).
     * Re-locking rows already held by the caller is a no-op.
     */
    static async lockTableThenOrder(
        tx: Prisma.TransactionClient,
        companyId: number,
        orderId: number
    ): Promise<void> {
        // The candidate table is read OUTSIDE the transaction (global client,
        // its own connection, like PaymentService). A plain read through `tx`
        // would create the InnoDB REPEATABLE READ view before the locks, and
        // every later plain read of the caller (replay keys, status, payments,
        // quantities) would see that frozen snapshot instead of the state
        // committed by the transaction we just waited for. The first statement
        // through `tx` is therefore always a locking read.
        const candidate = await this.readOrderTableIdOutsideTransaction(companyId, orderId);
        if (candidate !== null) {
            await tx.$queryRaw`SELECT id FROM \`Table\` WHERE id = ${candidate} AND companyId = ${companyId} FOR UPDATE`;
        }
        const locked = await tx.$queryRaw<Array<{ tableId: number | null }>>`SELECT id, tableId FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
        const lockedRow = Array.isArray(locked) ? locked[0] : undefined;
        // Test doubles return no rows; a real locked row is authoritative.
        if (!lockedRow) return;
        const actual = lockedRow.tableId != null ? Number(lockedRow.tableId) : null;
        if (actual !== null && actual !== candidate) {
            // The order moved to another table between the preflight and the
            // Order lock. Locking that table now would be Order -> Table (lock
            // inversion): replay the whole transaction instead.
            throw new Prisma.PrismaClientKnownRequestError(
                'La orden cambió de mesa mientras se procesaba; reintente la operación',
                { code: 'P2034', clientVersion: Prisma.prismaVersion.client }
            );
        }
    }

    /** Order.tableId read with the global client (never inside the caller's tx). Null on any failure. */
    static async readOrderTableIdOutsideTransaction(companyId: number, orderId: number): Promise<number | null> {
        try {
            const row = await prisma.order.findFirst({ where: { id: orderId, companyId }, select: { tableId: true } });
            return row?.tableId != null ? Number(row.tableId) : null;
        } catch {
            // Only a hint: a missing candidate just means the Order lock is
            // taken first and a table found there triggers a retry.
            return null;
        }
    }

    /**
     * Auto-delivery of a settled restaurant sale. A paid order whose kitchen
     * work is fully released (every line sent, every batch RELEASED) is
     * physically handed over, so its stock is consumed here, in the caller's
     * transaction, through the same completeWithTransaction used by the
     * explicit "Entregar" action. Called from full payment and kitchen
     * release; a no-op (never an error) whenever any condition is missing.
     * Delivery/PedidosYa orders keep their courier-driven completion, and a
     * branch with several sale warehouses and no Branch.defaultSaleWarehouseId
     * keeps the explicit choice.
     */
    static async autoDeliverIfSettledWithTransaction(
        tx: Prisma.TransactionClient,
        orderId: number,
        companyId: number,
        actorUserId: number
    ): Promise<{ delivered: boolean; reason?: string; order?: Awaited<ReturnType<typeof OrderService.completeWithTransaction>> }> {
        const order = await tx.order.findFirst({
            where: { id: orderId, companyId },
            select: {
                id: true,
                branchId: true,
                status: true,
                financialStatus: true,
                orderType: true,
                salesChannel: true,
                items: { select: { sentAt: true } },
                kitchenBatches: { select: { status: true } },
            },
        });
        if (!order) return { delivered: false, reason: 'NOT_FOUND' };
        if (order.status !== 'READY' || order.financialStatus !== 'PAID') {
            return { delivered: false, reason: 'NOT_READY_OR_UNPAID' };
        }
        if (order.salesChannel !== 'RESTAURANT' || order.orderType === 'DELIVERY') {
            return { delivered: false, reason: 'CHANNEL_DELIVERY' };
        }
        const items = order.items ?? [];
        const batches = order.kitchenBatches ?? [];
        if (items.length === 0 || items.some((item) => item.sentAt == null)) {
            return { delivered: false, reason: 'UNSENT_ITEMS' };
        }
        if (batches.some((batch) => batch.status !== 'RELEASED')) {
            return { delivered: false, reason: 'KITCHEN_NOT_RELEASED' };
        }
        // Branch default sale warehouse first, then the single-warehouse rule.
        const saleWarehouse = await SaleWarehouseService.resolve(tx, companyId, order.branchId);
        if (saleWarehouse.warehouseId === null) {
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: order.id,
                    action: 'AUTO_DELIVER_SKIPPED',
                    userId: actorUserId,
                    details: {
                        reason: saleWarehouse.reason,
                        branchId: order.branchId,
                    },
                },
            });
            return { delivered: false, reason: saleWarehouse.reason };
        }
        const saleWarehouseId = saleWarehouse.warehouseId;
        // Auto-delivery is a side effect of payment / kitchen release: an
        // inventory problem (missing cost, unit conversion, FIFO mismatch) must
        // never block collecting money or releasing the kitchen. Run it inside a
        // SAVEPOINT so a failure undoes only the delivery and leaves the order
        // READY for the explicit "Entregar". Deadlocks / lock timeouts abort the
        // whole MySQL transaction, so those still propagate to the retry wrapper.
        await tx.$executeRawUnsafe('SAVEPOINT auto_deliver');
        try {
            const updated = await this.completeWithTransaction(tx, order.id, companyId, saleWarehouseId, actorUserId, { automatic: true });
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT auto_deliver');
            return { delivered: true, order: updated };
        } catch (error) {
            if (isRetryableTransactionError(error)) throw error;
            try {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT auto_deliver');
            } catch {
                // The savepoint is gone only when MySQL already rolled back the
                // whole transaction (e.g. a deadlock surfaced without a Prisma
                // code): propagate the original cause so the caller can retry.
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: order.id,
                    action: 'AUTO_DELIVER_SKIPPED',
                    userId: actorUserId,
                    details: { reason: 'INVENTORY_NOT_READY', message: message.slice(0, 500), warehouseId: saleWarehouseId },
                },
            });
            console.warn('[ORDER] Auto-delivery skipped; order stays READY for explicit delivery', { orderId: order.id, companyId, message });
            return { delivered: false, reason: 'INVENTORY_NOT_READY' };
        }
    }

    static async completeWithTransaction(
        tx: Prisma.TransactionClient,
        id: number,
        companyId: number,
        warehouseId: number,
        deliveredById: number,
        options?: { automatic?: boolean }
    ) {
        if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
            throw new Error('warehouseId válido es requerido para entregar la orden');
        }
        if (!Number.isInteger(deliveredById) || deliveredById <= 0) {
            throw new Error('Usuario de entrega inválido');
        }

            // Reversal/payment/cancellation all lock the order. Completion must use
            // the same Table -> Order lock order and re-read its consumable graph
            // inside the transaction (the table group is reconciled below).
            await this.lockTableThenOrder(tx, companyId, id);
            const order = await tx.order.findFirst({
                where: { id, companyId },
                include: {
                    items: {
                        include: {
                            menuItem: {
                                include: {
                                    recipes: {
                                        include: {
                                            product: { include: { baseUnit: { select: { abbreviation: true } } } },
                                            unitOfMeasure: { select: { abbreviation: true } }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    table: true
                }
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.status !== 'READY') throw new Error('La orden debe estar lista antes de entregarla');
            if (order.items.some((item) => item.sentAt == null)) {
                throw new Error('No se puede entregar una orden con productos sin enviar a cocina');
            }

            const isZeroTotal = Math.round(Number(order.total) * 100) === 0;
            if (order.financialStatus !== 'PAID' && !isZeroTotal) {
                throw new Error('La orden debe estar pagada antes de completar');
            }

            const itemSubtotal = order.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
            if (order.financialStatus !== 'PAID' && isZeroTotal && !order.discountCode && itemSubtotal > 0) {
                throw new Error('Una orden con consumo y total cero requiere una promoción válida; el descuento manual no puede cerrar la venta');
            }

            const actor = await tx.user.findFirst({
                where: { id: deliveredById, companyId, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!actor) throw new Error('Usuario de entrega no válido para esta empresa');

            // A valid 100% promotion can reduce the amount due to exactly zero,
            // so no Payment row exists to drive settlement. Claim promotion use
            // and close the financial side here, under the same order lock, once.
            if (order.financialStatus !== 'PAID' && isZeroTotal) {
                if (order.discountCode) {
                    const { discount: authoritativeDiscount } = await this.evaluatePromotionForOrder(
                        tx, companyId, id, order.discountCode, itemSubtotal, 'reprice'
                    );
                    const authoritativeTotal = this.calculateFinalTotal(
                        itemSubtotal,
                        authoritativeDiscount,
                        Number(order.tax || 0),
                        Number(order.tipAmount || 0)
                    );
                    if (
                        Math.round(authoritativeDiscount * 100) !== Math.round(Number(order.discount) * 100)
                        || Math.round(authoritativeTotal * 100) !== Math.round(Number(order.total) * 100)
                    ) {
                        throw new Error('La promoción cambió; recalcule la orden antes de completarla');
                    }
                    // Shared settlement claim: honors an active prefactura
                    // reservation (no double count) and the usage limit.
                    await claimPromotionUsageAtSettlement(tx, {
                        companyId,
                        orderId: id,
                        discountCode: order.discountCode
                    });
                }
                await tx.order.update({
                    where: { id },
                    data: { financialStatus: 'PAID', closedAt: new Date() }
                });
                await tx.auditLog.create({
                    data: {
                        companyId,
                        entityType: 'Order',
                        entityId: id,
                        action: 'ZERO_TOTAL_SETTLED',
                        userId: deliveredById,
                        details: { discountCode: order.discountCode, total: Number(order.total) }
                    }
                });
            }

            // Validate the target warehouse belongs to this tenant and branch
            // before touching stock (warehouseId comes from the request body).
            // Plain read on purpose: consumeForOrder takes the first warehouse
            // lock ({sale ∪ routed} ascending) and re-validates the branch
            // under it. Locking the sale warehouse here first would invert the
            // ascending order whenever a routed warehouse has a lower id.
            const warehouse = await tx.warehouse.findFirst({
                where: { id: warehouseId, companyId, branchId: order.branchId, type: 'BRANCH' }
            });

            if (!warehouse) {
                throw new Error('Almacén no encontrado para esta empresa/sucursal');
            }

            // Deduct inventory through the shared, idempotent consumption service.
            // Skips automatically if inventory was already consumed at settlement.
            // The sale already happened: a short balance must not block it, so
            // stock may go negative and an alert is recorded per product.
            await InventoryConsumptionService.consumeForOrder(tx, {
                order,
                warehouseId,
                userId: deliveredById,
                companyId,
                allowNegative: true,
                expectedBranchId: order.branchId
            });

            // Order-level delivery is the source of truth: lines still waiting to be
            // served are stamped now so the waiter app stops showing them as pending.
            // (The reverse never holds: serving every line does not complete the order.)
            const deliveredNow = new Date();
            await tx.orderItem.updateMany({
                where: { orderId: id, deliveredAt: null, quantity: { gt: 0 } },
                data: { deliveredAt: deliveredNow, deliveredById }
            });

            // Update order status
            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'DELIVERED',
                    deliveredAt: deliveredNow,
                    ...(isZeroTotal ? { financialStatus: 'PAID' as const, closedAt: order.closedAt ?? new Date() } : {})
                }
            });

            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: id,
                    action: 'DELIVER',
                    userId: deliveredById,
                    details: { warehouseId, previousStatus: order.status, automatic: options?.automatic === true }
                }
            });

            // A physical table group remains occupied while any member still
            // has an operational order. The last completion closes the group.
            if (order.tableId) {
                await reconcileTableGroupForTable(
                    tx, companyId, order.tableId, deliveredById, `Orden #${order.id} completada`
                );
            }

            return updatedOrder;
    }

    static async reconcileTableAccount(
        tx: Prisma.TransactionClient,
        companyId: number,
        tableId: number,
        actorId: number,
        reason: string
    ) {
        return reconcileTableGroupForTable(
            tx,
            companyId,
            tableId,
            actorId,
            reason
        );
    }

    static async complete(
        id: number,
        companyId: number,
        warehouseId: number,
        deliveredById: number,
        options?: { syncExternal?: boolean }
    ) {
        const updatedOrder = await transactionWithP2034Retry((tx) => this.completeWithTransaction(
            tx,
            id,
            companyId,
            warehouseId,
            deliveredById
        ));

        if (options?.syncExternal !== false) {
            this.syncPedidosYaStatus(companyId, updatedOrder);
        }
        return updatedOrder;
    }

    static async cancel(
        id: number,
        companyId: number,
        cancelledById?: number,
        cancelReason?: string,
        // `allowPaidReversal` is reserved for authoritative channel cancellations.
        // Prepared local cancellations additionally require an explicit warehouse
        // so their physical consumption is recorded as waste, not silently lost.
        options?: OrderCancelOptions
    ) {
        return transactionWithP2034Retry((tx) => this.cancelWithTransaction(
            tx, id, companyId, cancelledById, cancelReason, options
        ));
    }

    /** Internal atomic cancellation used by fiscal credit notes. */
    static async cancelWithTransaction(
        tx: Prisma.TransactionClient,
        id: number,
        companyId: number,
        cancelledById?: number,
        cancelReason?: string,
        options?: OrderCancelOptions
    ) {
            // Serialize cancel with payment, delivery and another cancellation,
            // in the shared Table -> Order order (the table group is reconciled
            // below). Callers that already hold the Order lock keep it.
            await this.lockTableThenOrder(tx, companyId, id);
            const order = await tx.order.findFirst({
                where: { id, companyId },
                include: {
                    table: true,
                    payments: { where: { status: 'ACTIVE' } },
                    items: {
                        include: {
                            menuItem: {
                                include: {
                                    recipes: {
                                        include: {
                                            product: { include: { baseUnit: { select: { abbreviation: true } } } },
                                            unitOfMeasure: { select: { abbreviation: true } }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    fiscalCreditNotes: {
                        select: { id: true, number: true, status: true, issuedAt: true }
                    }
                }
            });

            if (!order) throw new Error('Orden no encontrada');
            if (order.status === 'CANCELLED') throw new Error(ORDER_ALREADY_CANCELLED_MESSAGE);
            if (order.invoiceNumber && !options?.fiscalCreditNoteId && !options?.fiscalInvoiceCancellationId) {
                throw new Error('No se puede cancelar una orden facturada; emita una nota de crédito');
            }

            const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const fullyPaid = order.financialStatus === 'PAID';

            // Payment state is authoritative. A paid order may currently display
            // Operational status never substitutes for the payment ledger.
            if (fullyPaid && !options?.allowPaidReversal) {
                throw new Error('No se pueden cancelar órdenes pagadas');
            }
            if (!fullyPaid && totalPaid > 0 && !options?.allowPaidReversal) {
                throw new Error(`La orden tiene pagos existentes por ${totalPaid.toFixed(2)}. Reembolse o elimine los pagos antes de cancelar.`);
            }

            const reversalUserId = cancelledById ?? order.userId;

            const explicitlySentItems = order.items.filter((item) => item.sentAt !== null);
            const legacyPreparedStatus = ['SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'].includes(order.status);
            // `sentAt` is authoritative for normal/partially-sent orders. Older
            // records may already be in a prepared status without item timestamps;
            // fail closed by treating every line as prepared instead of cancelling
            // physical food without a matching waste movement.
            const preparedItems = explicitlySentItems.length === 0 && legacyPreparedStatus
                ? order.items
                : explicitlySentItems;
            const requiresWaste = preparedItems.length > 0 && order.status !== 'DELIVERED';
            if (requiresWaste) {
                const wasteWarehouseId = Number(options?.wasteWarehouseId);
                if (!Number.isInteger(wasteWarehouseId) || wasteWarehouseId <= 0) {
                    throw new Error('La orden ya fue enviada a cocina; seleccione una bodega para registrar la merma antes de cancelar');
                }
                // Plain validation read: consumeForOrder takes the first
                // warehouse lock (ascending) and re-validates under it.
                const wasteWarehouse = await tx.warehouse.findFirst({
                    where: {
                        id: wasteWarehouseId,
                        companyId,
                        branchId: order.branchId,
                        type: 'BRANCH'
                    },
                    select: { id: true }
                });
                if (!wasteWarehouse) {
                    throw new Error('Bodega de merma no encontrada para la empresa/sucursal de la orden');
                }
                await InventoryConsumptionService.consumeForOrder(tx, {
                    order: { ...order, items: preparedItems },
                    orderItemIds: preparedItems.map((item) => item.id),
                    warehouseId: wasteWarehouse.id,
                    userId: reversalUserId,
                    companyId,
                    reference: `WASTE-ORD-${id}`,
                    reason: `WASTE: Merma por cancelación de orden #${id}`,
                    modifierReason: `WASTE: Merma de modificador por cancelación de orden #${id}`,
                    // The food was physically prepared: a short balance must not
                    // block the cancellation. Like the sale path, stock may go
                    // negative and consumeForOrder records the negative-stock
                    // alert (reference WASTE-ORD-{id}).
                    allowNegative: true,
                    // A waste warehouse chosen by the user (POS cancel, fiscal
                    // invoice cancellation) is honored as-is; only a configured
                    // default (e.g. PedidosYa) follows the ingredient routing.
                    route: options?.wasteWarehouseIsDefault === true,
                    expectedBranchId: order.branchId
                });
            }

            // Only an unsent OPEN order can safely restore a legacy accidental
            // consumption. Prepared/delivered food never returns to stock:
            // prepared cancellation is WASTE-ORD-{id}; delivered keeps ORD-{id}.
            if (preparedItems.length === 0 && order.status === 'OPEN') {
                await InventoryConsumptionService.reverseForOrder(tx, {
                    orderId: id,
                    userId: reversalUserId,
                    companyId,
                    reason: 'Reversa de consumo legado de orden abierta cancelada',
                    sourceType: 'ADJUSTMENT',
                    reversalOrigin: 'ORDER_CANCEL_UNSENT'
                });
            }

            // Authoritative channel cancellations also reverse the local payment
            // ledger. This prevents cancelled delivery orders from remaining as
            // revenue/cash and mirrors PaymentService.delete semantics atomically.
            if (totalPaid > 0 && options?.allowPaidReversal) {
                const paymentIds = order.payments.map((payment) => payment.id);
                if (paymentIds.length > 0) {
                    const cashPayments = order.payments.filter((payment) => payment.methodType === 'CASH');
                    const nonCashPayments = order.payments.filter((payment) => payment.methodType !== 'CASH');
                    const explicitReferences = new Map(
                        (options.externalRefundReferences || []).map((entry) => [entry.paymentId, entry.reference.trim()])
                    );
                    for (const payment of nonCashPayments) {
                        const refundReference = explicitReferences.get(payment.id)
                            || options.externalRefundReference?.trim();
                        if (!refundReference) {
                            throw new Error(`El pago no efectivo #${payment.id} requiere referencia verificable del reembolso externo`);
                        }
                        if (refundReference.length > 191) {
                            throw new Error(`La referencia de reembolso del pago #${payment.id} es demasiado larga`);
                        }
                    }
                    const unexpectedReference = [...explicitReferences.keys()].find((paymentId) =>
                        !nonCashPayments.some((payment) => payment.id === paymentId)
                    );
                    if (unexpectedReference !== undefined) {
                        throw new Error(`La referencia de reembolso corresponde a un pago no activo o en efectivo: #${unexpectedReference}`);
                    }
                    for (const payment of cashPayments) {
                        const cashEntries = await tx.cashMovement.findMany({
                            where: { reference: { in: [`PAY-${payment.id}`, `REV-PAY-${payment.id}`] } },
                            select: {
                                type: true,
                                amount: true,
                                reference: true,
                                shift: {
                                    select: {
                                        companyId: true,
                                        cashRegister: { select: { branchId: true } }
                                    }
                                }
                            }
                        });
                        const paymentCents = Math.round(Number(payment.amount) * 100);
                        const inboundReference = cashEntries.filter((entry) => entry.reference === `PAY-${payment.id}`);
                        const validInbound = inboundReference.filter((entry) =>
                            entry.type === 'IN'
                            && Math.round(Number(entry.amount) * 100) === paymentCents
                            && entry.shift.companyId === companyId
                            && entry.shift.cashRegister.branchId === order.branchId
                        );
                        if (inboundReference.length !== 1 || validInbound.length !== 1) {
                            throw new Error(`El pago en efectivo #${payment.id} no tiene un asiento PAY íntegro; requiere remediación manual`);
                        }
                        if (cashEntries.some((entry) => entry.reference === `REV-PAY-${payment.id}`)) {
                            throw new Error(`El pago activo #${payment.id} ya tiene un contramovimiento de caja; requiere remediación manual`);
                        }

                        const refundShift = await tx.cashShift.findFirst({
                            where: {
                                userId: reversalUserId,
                                companyId,
                                endDate: null,
                                cashRegister: { branchId: order.branchId }
                            },
                            select: { id: true, startDate: true }
                        });
                        if (!refundShift) {
                            throw new Error('Debe existir un turno de caja abierto en la sucursal para registrar el reembolso en efectivo');
                        }
                        const timezoneSetting = await tx.setting.findUnique({
                            where: { companyId_name: { companyId, name: `${companyId}_timezone` } },
                            select: { value: true }
                        });
                        const configuredTz = timezoneSetting?.value?.trim();
                        const timezone = configuredTz && isValidTimeZone(configuredTz)
                            ? configuredTz
                            : DEFAULT_COMPANY_SETTINGS.timezone;
                        if (zonedDateKey(new Date(refundShift.startDate), timezone) !== zonedDateKey(new Date(), timezone)) {
                            throw new Error('Tiene un turno de caja de un día anterior; ciérrelo y abra uno nuevo antes de registrar el reembolso en efectivo');
                        }
                        await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${refundShift.id} AND companyId = ${companyId} FOR UPDATE`;
                        const lockedRefundShift = await tx.cashShift.findFirst({
                            where: {
                                id: refundShift.id,
                                userId: reversalUserId,
                                companyId,
                                endDate: null,
                                cashRegister: { branchId: order.branchId }
                            },
                            select: { id: true, startDate: true }
                        });
                        if (!lockedRefundShift) throw new Error('El turno de caja para el reembolso ya fue cerrado');
                        if (zonedDateKey(new Date(lockedRefundShift.startDate), timezone) !== zonedDateKey(new Date(), timezone)) {
                            throw new Error('Tiene un turno de caja de un día anterior; ciérrelo y abra uno nuevo antes de registrar el reembolso en efectivo');
                        }
                        await tx.cashMovement.create({
                            data: {
                                shiftId: lockedRefundShift.id, type: 'OUT', amount: payment.amount,
                                description: `Reverso Pago #${payment.id} Orden #${id}`,
                                reference: `REV-PAY-${payment.id}`
                            }
                        });
                    }
                    await tx.payment.updateMany({
                        where: { id: { in: paymentIds }, orderId: id, status: 'ACTIVE' },
                        data: { status: 'REVERSED', reversedAt: new Date(), reversedById: reversalUserId, reversalReason: cancelReason || 'Order cancellation' }
                    });
                    for (const payment of nonCashPayments) {
                        await tx.payment.update({
                            where: { id: payment.id },
                            data: {
                                refundReference: explicitReferences.get(payment.id)
                                    || options.externalRefundReference!.trim()
                            }
                        });
                    }
                }

                if (
                    fullyPaid
                    && order.discountCode
                    && !(await getActivePromotionReservation(tx, companyId, order.id))
                ) {
                    const promo = await tx.promotion.findFirst({
                        where: { companyId, code: order.discountCode.toUpperCase() },
                        select: { id: true, usageCount: true }
                    });
                    if (promo && promo.usageCount > 0) {
                        await tx.promotion.update({
                            where: { id: promo.id },
                            data: { usageCount: { decrement: 1 } }
                        });
                    }
                }
            }

            // A use reserved by the prefactura returns to the pool exactly once.
            if (order.discountCode) {
                await releasePromotionReservationForOrder(tx, {
                    companyId,
                    orderId: order.id,
                    userId: cancelledById ?? order.userId,
                    reason: `Orden #${order.id} cancelada`
                });
            }

            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    ...(totalPaid > 0 && options?.allowPaidReversal ? { financialStatus: 'UNPAID' as const } : {}),
                    cancelledById: cancelledById || null,
                    cancelReason: cancelReason || null,
                    cancelledAt: new Date(),
                    closedAt: totalPaid > 0 && options?.allowPaidReversal ? null : order.closedAt
                }
            });

            if (order.tableId) {
                await reconcileTableGroupForTable(
                    tx,
                    companyId,
                    order.tableId,
                    cancelledById ?? order.userId,
                    `Orden #${order.id} cancelada`
                );
            }

            if (cancelledById) {
                await tx.auditLog.create({
                    data: {
                        companyId,
                        entityType: 'Order',
                        entityId: id,
                        action: 'CANCEL',
                        userId: cancelledById,
                        details: {
                            reason: cancelReason || null,
                            previousStatus: order.status,
                            orderedBy: order.userId,
                            tableId: order.tableId,
                            wasteWarehouseId: requiresWaste ? options?.wasteWarehouseId : null,
                            wastedItemIds: requiresWaste ? preparedItems.map((item) => item.id) : [],
                            reversedPayments: options?.allowPaidReversal ? order.payments.length : 0,
                            reversedAmount: options?.allowPaidReversal ? totalPaid : 0,
                            fiscalCreditNoteId: options?.fiscalCreditNoteId || null,
                            fiscalInvoiceCancellationId: options?.fiscalInvoiceCancellationId || null
                        }
                    }
                });
            }

            return updatedOrder;
    }

    /** Roles whose manual (non-promotion) discounts are capped by setting. */
    private static isManualDiscountCappedRole(actor?: { role?: string | null; roles?: string[] | null }): boolean {
        if (!actor) return false;
        const roles = new Set([actor.role, ...(actor.roles ?? [])].filter((role): role is string => !!role));
        if (roles.has('SUPERADMIN') || roles.has('ADMIN')) return false;
        return roles.has('MESERO');
    }

    /** `${companyId}_maxManualDiscountPercent`; absent/invalid => 100 (no cap). */
    private static async getMaxManualDiscountPercent(tx: Prisma.TransactionClient, companyId: number): Promise<number> {
        const setting = await tx.setting.findUnique({
            where: { companyId_name: { companyId, name: `${companyId}_maxManualDiscountPercent` } },
            select: { value: true }
        });
        const parsed = Number.parseFloat(setting?.value ?? '');
        return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 100;
    }

    static async updatePricing(
        id: number,
        companyId: number,
        data: {
            discount?: number;
            discountCode?: string | null;
            tax?: number;
            tipAmount?: number;
            /** Manual-discount justification (3..120). Presence opts into the limit/authorization flow. */
            discountReason?: string;
        },
        userId: number,
        actor: { role?: string | null; roles?: string[] | null },
        options?: {
            /** Requester lacks orders.discount.apply: their own manual-discount limit is 0. */
            noApplyPermission?: boolean;
            /**
             * Supervisor-authorized manual discount: applied under the same lock and
             * transaction as the pricing update, stamped with the authorizer.
             */
            authorization?: {
                supervisorUserId: number;
                revalidate: (tx: Prisma.TransactionClient, subtotal: number, discount: number) => Promise<void>;
                onApplied: (tx: Prisma.TransactionClient, info: {
                    subtotal: number; discount: number; percent: number; previousDiscount: number;
                }) => Promise<void>;
            };
        }
    ) {
        const discountReason = data.discountReason === undefined ? undefined : String(data.discountReason).trim();
        if (discountReason !== undefined
            && (discountReason.length < MIN_DISCOUNT_REASON || discountReason.length > MAX_DISCOUNT_REASON)) {
            throw new Error(`El motivo del descuento debe tener entre ${MIN_DISCOUNT_REASON} y ${MAX_DISCOUNT_REASON} caracteres`);
        }
        const authorization = options?.authorization;
        if (authorization && (discountReason === undefined || !(Number(data.discount) > 0) || data.discountCode)) {
            throw new Error('La autorización requiere un descuento manual mayor a cero con motivo');
        }
        for (const [label, value] of [
            ['discount', data.discount],
            ['tax', data.tax],
            ['tipAmount', data.tipAmount]
        ] as const) {
            if (value !== undefined && !Number.isFinite(value)) {
                throw new Error(`${label} debe ser un numero finito`);
            }
        }
        return await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id, companyId },
                select: {
                    id: true,
                    status: true,
                    discount: true,
                    discountCode: true,
                    tax: true,
                    tipAmount: true,
                    discountReason: true,
                    discountAuthorizedById: true,
                    invoiceNumber: true,
                    preInvoicedAt: true,
                    payments: { where: { status: 'ACTIVE' }, select: { id: true } }
                }
            });

            if (!order) {
                throw new Error('Orden no encontrada');
            }

            if (order.status === 'CANCELLED') {
                throw new Error('No se pueden modificar precios de órdenes pagadas o canceladas');
            }
            if (order.invoiceNumber || order.preInvoicedAt) {
                throw new Error('No se puede modificar el total de una orden facturada');
            }
            if (order.payments.length > 0) {
                throw new Error('No se puede modificar el total de una orden con pagos activos; revierta los pagos primero');
            }

            const subtotal = await this.getOrderItemsSubtotal(tx, id);
            const requestedCode = authorization
                ? ''
                : data.discountCode === undefined
                    ? undefined
                    : String(data.discountCode || '').trim().toUpperCase();
            const nextCode = requestedCode === undefined ? order.discountCode : (requestedCode || null);
            let authoritativeDiscount = data.discount
                ?? (requestedCode === '' ? 0 : Number(order.discount || 0));
            let lineDiscounts: Array<{ lineId: number; discount: number }> = [];
            if (nextCode) {
                // A new code must be valid now (happy-hour window, eligible
                // lines); re-sending the applied code only reprices it.
                const isNewCode = (order.discountCode || '').trim().toUpperCase() !== nextCode;
                const evaluation = await this.evaluatePromotionForOrder(
                    tx, companyId, id, nextCode, subtotal, isNewCode ? 'apply' : 'reprice'
                );
                authoritativeDiscount = evaluation.discount;
                lineDiscounts = evaluation.lineDiscounts;
            }
            await syncOrderLinePromotionDiscounts(tx, id, lineDiscounts);
            const nextDiscount = Math.round(Math.min(
                Math.max(0, Number(authoritativeDiscount)),
                Math.max(0, subtotal)
            ) * 100) / 100;
            const previousManual = Math.round(Number(order.discount || 0) * 100) / 100;
            const discountChanged = previousManual !== nextDiscount || (order.discountCode || null) !== nextCode;
            let applyAuthorizationStamp = false;
            let roleLimit: number | null = null;
            // A stamped discount whose reason is rewritten is no longer what the
            // supervisor approved: the stamp is dropped and the requester's own
            // limit applies again.
            const storedReason = order.discountReason ?? null;
            const reasonChanged = discountReason !== undefined && !nextCode && nextDiscount > 0
                && discountReason !== storedReason;
            const reasonRewriteOnStamp = reasonChanged && !discountChanged && !authorization
                && order.discountAuthorizedById !== null && order.discountAuthorizedById !== undefined;
            if (authorization && (nextCode || !(nextDiscount > 0))) {
                throw new Error('El descuento debe ser mayor a cero');
            }
            if (!nextCode && nextDiscount > 0 && (discountChanged || authorization || reasonRewriteOnStamp)) {
                if (authorization) {
                    // Re-validated under the order lock: supervisor still eligible and
                    // the final (clamped) discount fits their limit over this subtotal.
                    await authorization.revalidate(tx, subtotal, nextDiscount);
                    applyAuthorizationStamp = true;
                } else if (discountReason !== undefined) {
                    // Mobile flow: over the actor's own limit => nothing applied, ask for a supervisor.
                    const limit = options?.noApplyPermission ? 0 : await getManualDiscountLimit({
                        userId, companyId, role: actor?.role, roles: actor?.roles
                    }, tx);
                    if (nextDiscount > maxDiscountForLimit(subtotal, limit)) {
                        throw new DiscountAuthRequiredError(limit, discountPercentOf(nextDiscount, subtotal));
                    }
                } else if (
                    // A role's own maxDiscountPercent binds the web call too; roles
                    // without one fall through to the legacy rule below.
                    (roleLimit = await getConfiguredDiscountLimit({
                        userId, companyId, role: actor.role, roles: actor.roles
                    }, tx)) !== null
                ) {
                    if (nextDiscount > maxDiscountForLimit(subtotal, roleLimit)) {
                        throw new DiscountAuthRequiredError(roleLimit, discountPercentOf(nextDiscount, subtotal));
                    }
                } else if (this.isManualDiscountCappedRole(actor)) {
                    // Legacy web flow (no discountReason): unchanged behaviour.
                    const maxPercent = await this.getMaxManualDiscountPercent(tx, companyId);
                    const maxDiscount = Math.floor(Math.max(0, subtotal) * maxPercent) / 100;
                    if (nextDiscount > maxDiscount) {
                        throw new Error(`El descuento manual excede el máximo permitido para su rol (${maxPercent}% del subtotal)`);
                    }
                }
            }
            // Client-supplied tax is ignored: IVA is always company tax_rate × net subtotal.
            const nextTax = await this.repriceTax(tx, companyId, subtotal, nextDiscount);
            // Tip is never trusted beyond the configured company rate × net subtotal
            // (the only amount the POS offers). A lower amount, including zero, is allowed.
            const tipRateSetting = await tx.setting.findUnique({
                where: { companyId_name: { companyId, name: `${companyId}_tipRate` } },
                select: { value: true }
            });
            const configuredTipRate = Number.parseFloat(tipRateSetting?.value ?? '0');
            const tipRate = Number.isFinite(configuredTipRate) && configuredTipRate >= 0 && configuredTipRate <= 100
                ? configuredTipRate
                : 0;
            const maxTip = Math.round(Math.max(0, subtotal - nextDiscount) * tipRate) / 100;
            const requestedTip = Math.round(Math.max(0, Number(data.tipAmount ?? Number(order.tipAmount || 0))) * 100) / 100;
            const nextTip = Math.min(requestedTip, maxTip);
            const nextTotal = this.calculateFinalTotal(subtotal, nextDiscount, nextTax, nextTip);

            const previousDiscount = Math.round(Number(order.discount || 0) * 100) / 100;
            const previousTip = Math.round(Number(order.tipAmount || 0) * 100) / 100;
            if (
                previousDiscount !== nextDiscount
                || (order.discountCode || null) !== nextCode
                || previousTip !== nextTip
                || reasonChanged
            ) {
                await tx.auditLog.create({
                    data: {
                        companyId,
                        entityType: 'Order',
                        entityId: id,
                        action: 'PRICING_UPDATED',
                        userId,
                        details: {
                            subtotal,
                            previousDiscount,
                            discount: nextDiscount,
                            previousDiscountCode: order.discountCode || null,
                            discountCode: nextCode,
                            manualDiscount: !nextCode && nextDiscount > 0,
                            ...(discountReason !== undefined && !nextCode && nextDiscount > 0 ? { discountReason } : {}),
                            ...(reasonChanged ? { previousReason: storedReason } : {}),
                            ...(applyAuthorizationStamp ? { discountAuthorizedById: authorization!.supervisorUserId } : {}),
                            ...(reasonRewriteOnStamp ? { clearedAuthorizerUserId: order.discountAuthorizedById } : {}),
                            previousTipAmount: previousTip,
                            tipAmount: nextTip,
                            requestedTipAmount: requestedTip
                        }
                    }
                });
            }

            // Reason/authorizer describe the manual discount that is now on the order:
            // they follow it (set with it, cleared when it changes or goes away).
            const manualNow = !nextCode && nextDiscount > 0;
            const stampData: {
                discountReason?: string | null;
                discountAuthorizedById?: number | null;
                discountAuthorizedPercent?: number | null;
            } = {};
            if (!manualNow) {
                stampData.discountReason = null;
                stampData.discountAuthorizedById = null;
                stampData.discountAuthorizedPercent = null;
            } else if (discountChanged || discountReason !== undefined) {
                if (discountReason !== undefined) stampData.discountReason = discountReason;
                else stampData.discountReason = null;
                if (applyAuthorizationStamp) {
                    stampData.discountAuthorizedById = authorization!.supervisorUserId;
                    stampData.discountAuthorizedPercent = discountPercentOf(nextDiscount, subtotal);
                } else if (discountChanged || reasonRewriteOnStamp) {
                    stampData.discountAuthorizedById = null;
                    stampData.discountAuthorizedPercent = null;
                }
            }
            if (applyAuthorizationStamp) {
                await authorization!.onApplied(tx, {
                    subtotal,
                    discount: nextDiscount,
                    percent: discountPercentOf(nextDiscount, subtotal),
                    previousDiscount
                });
            }

            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    discount: nextDiscount,
                    discountCode: nextCode,
                    tax: nextTax,
                    tipAmount: nextTip,
                    total: nextTotal,
                    ...stampData
                },
                include: {
                    table: true,
                    branch: true,
                    items: {
                        include: {
                            menuItem: true,
                            modifiers: true
                        }
                    },
                    payments: {
                        include: {
                            paymentMethod: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    }
                }
            });
            return updatedOrder;
        });
    }

    // Get every unsettled table account that the POS may need to recover.
    // Delivered debt is included even though it is no longer in the KDS queue.
    static async getActiveOrders(companyId: number, branchId?: number) {
        const where: Prisma.OrderWhereInput = {
            companyId,
            ...tableOpenAccountWhere()
        };

        if (branchId) {
            where.branchId = branchId;
        }

        const orders = await prisma.order.findMany({
            where,
            include: {
                table: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        color: true
                    }
                },
                items: {
                    include: {
                        menuItem: true,
                        modifiers: true
                    }
                }
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        return orders.map((order) => this.withTimeline(order));
    }

    static async getKitchenQueue(companyId: number, branchId?: number) {
        const batches = await prisma.kitchenBatch.findMany({
            where: {
                companyId,
                ...(branchId ? { branchId } : {}),
                status: { in: ['PENDING', 'IN_PREPARATION', 'READY'] },
                order: { status: { notIn: ['CANCELLED', 'DELIVERED'] } },
            },
            include: kitchenBatchOrderInclude,
            orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        });
        return batches.map((batch) => this.withPersistentKitchenBatch(batch));
    }

    static async startKitchenPreparation(
        orderId: number,
        companyId: number,
        actorUserId: number,
        kitchenBatchId?: number,
    ) {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                select: { id: true, branchId: true },
            });
            if (!order) throw new Error('Orden no encontrada');
            const batch = await this.findKitchenBatchForOperation(
                tx,
                orderId,
                companyId,
                kitchenBatchId,
            );
            if (batch.status === 'IN_PREPARATION') {
                const current = await tx.kitchenBatch.findUnique({
                    where: { id: batch.id },
                    include: kitchenBatchOrderInclude,
                });
                if (!current) throw new Error('Tanda de cocina no encontrada');
                return {
                    changed: false,
                    branchId: order.branchId,
                    order: this.withPersistentKitchenBatch(current),
                    kitchenBatchId: batch.id,
                };
            }
            if (batch.status !== 'PENDING') {
                throw new KitchenError('Solo una tanda pendiente puede iniciar preparación', 'KITCHEN_INVALID_STATE');
            }

            const now = new Date();
            const started = await tx.orderItem.updateMany({
                where: { orderId, kitchenBatchId: batch.id, status: 'PENDING' },
                data: { status: 'IN_PROGRESS', startedAt: now }
            });
            if (started.count === 0) {
                throw new KitchenError('La tanda no tiene productos pendientes para iniciar', 'KITCHEN_NOTHING_PENDING');
            }

            await tx.kitchenBatch.update({
                where: { id: batch.id },
                data: {
                    status: 'IN_PREPARATION',
                    startedAt: now,
                    startedById: actorUserId,
                }
            });
            await this.syncOrderKitchenCompatibility(tx, orderId);
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: orderId,
                    action: 'KITCHEN_PREPARATION_STARTED',
                    userId: actorUserId,
                    details: {
                        kitchenBatchId: batch.id,
                        sequence: batch.sequence,
                        from: batch.status,
                        to: 'IN_PREPARATION',
                        startedItems: started.count,
                    }
                }
            });
            const updatedBatch = await tx.kitchenBatch.findUnique({
                where: { id: batch.id },
                include: kitchenBatchOrderInclude,
            });
            if (!updatedBatch) throw new Error('Tanda de cocina no encontrada');
            return {
                changed: true,
                branchId: order.branchId,
                order: this.withPersistentKitchenBatch(updatedBatch),
                kitchenBatchId: batch.id,
            };
        });

        this.syncPedidosYaStatus(companyId, result.order);
        return result;
    }

    static async markKitchenBatchReady(
        orderId: number,
        companyId: number,
        actorUserId: number,
        kitchenBatchId?: number,
    ) {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                select: { id: true, branchId: true },
            });
            if (!order) throw new Error('Orden no encontrada');
            const batch = await this.findKitchenBatchForOperation(
                tx,
                orderId,
                companyId,
                kitchenBatchId,
            );
            if (batch.status === 'READY') {
                const current = await tx.kitchenBatch.findUnique({
                    where: { id: batch.id },
                    include: kitchenBatchOrderInclude,
                });
                if (!current) throw new Error('Tanda de cocina no encontrada');
                return {
                    changed: false,
                    branchId: order.branchId,
                    order: this.withPersistentKitchenBatch(current),
                    kitchenBatchId: batch.id,
                };
            }

            const now = new Date();
            const completed = await tx.orderItem.updateMany({
                where: { orderId, kitchenBatchId: batch.id, status: { not: 'DONE' } },
                data: {
                    status: 'DONE',
                    startedAt: batch.startedAt ?? now,
                    finishedAt: now,
                },
            });
            await tx.kitchenBatch.update({
                where: { id: batch.id },
                data: {
                    status: 'READY',
                    startedAt: batch.startedAt ?? now,
                    startedById: batch.startedById ?? actorUserId,
                    readyAt: now,
                },
            });
            await this.syncOrderKitchenCompatibility(tx, orderId);
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: orderId,
                    action: 'KITCHEN_READY',
                    userId: actorUserId,
                    details: {
                        kitchenBatchId: batch.id,
                        sequence: batch.sequence,
                        from: batch.status,
                        to: 'READY',
                        completedItems: completed.count,
                    },
                },
            });
            const updatedBatch = await tx.kitchenBatch.findUnique({
                where: { id: batch.id },
                include: kitchenBatchOrderInclude,
            });
            if (!updatedBatch) throw new Error('Tanda de cocina no encontrada');
            return {
                changed: true,
                branchId: order.branchId,
                order: this.withPersistentKitchenBatch(updatedBatch),
                kitchenBatchId: batch.id,
            };
        });
        this.syncPedidosYaStatus(companyId, result.order);
        return result;
    }

    static async releaseFromKitchen(
        orderId: number,
        companyId: number,
        actorUserId: number,
        kitchenBatchId?: number,
    ) {
        const result = await transactionWithP2034Retry(async (tx) => {
            // Table -> Order: a release can auto-deliver a settled order, which
            // reconciles its table group under the same transaction.
            await this.lockTableThenOrder(tx, companyId, orderId);
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                select: {
                    id: true,
                    branchId: true,
                    status: true,
                }
            });
            if (!order) throw new Error('Orden no encontrada');
            if (kitchenBatchId !== undefined && (!Number.isInteger(kitchenBatchId) || kitchenBatchId <= 0)) {
                throw new Error('Tanda de cocina inválida');
            }
            const batch = await tx.kitchenBatch.findFirst({
                where: {
                    ...(kitchenBatchId ? { id: kitchenBatchId } : {}),
                    orderId,
                    companyId,
                },
                orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            });
            if (!batch) throw new KitchenError('Tanda de cocina no encontrada', 'KITCHEN_BATCH_NOT_FOUND');
            if (batch.status === 'RELEASED') {
                const current = await tx.kitchenBatch.findUnique({
                    where: { id: batch.id },
                    include: kitchenBatchOrderInclude,
                });
                if (!current) throw new Error('Tanda de cocina no encontrada');
                return {
                    changed: false,
                    branchId: order.branchId,
                    order: this.withPersistentKitchenBatch(current),
                    kitchenBatchId: batch.id,
                };
            }
            if (batch.status !== 'READY') {
                throw new KitchenError('La tanda debe estar lista antes de liberarla', 'KITCHEN_BATCH_NOT_READY');
            }

            const releasedAt = new Date();
            await tx.kitchenBatch.update({
                where: { id: batch.id },
                data: {
                    status: 'RELEASED',
                    releasedAt,
                    releasedById: actorUserId,
                }
            });
            const nextStatus = await this.syncOrderKitchenCompatibility(tx, orderId);
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: orderId,
                    action: 'KITCHEN_RELEASED',
                    userId: actorUserId,
                    details: {
                        kitchenBatchId: batch.id,
                        sequence: batch.sequence,
                        status: batch.status,
                        releasedAt: releasedAt.toISOString(),
                    }
                }
            });
            // An already-settled order whose last batch was just released is
            // physically handed over now: consume its stock atomically.
            const autoDelivery = nextStatus === 'READY'
                ? await this.autoDeliverIfSettledWithTransaction(tx, orderId, companyId, actorUserId)
                : { delivered: false };
            const updatedBatch = await tx.kitchenBatch.findUnique({
                where: { id: batch.id },
                include: kitchenBatchOrderInclude,
            });
            if (!updatedBatch) throw new Error('Tanda de cocina no encontrada');
            return {
                changed: true,
                branchId: order.branchId,
                order: this.withPersistentKitchenBatch(updatedBatch),
                kitchenBatchId: batch.id,
                autoDelivered: autoDelivery.delivered,
            };
        }, SETTLEMENT_TRANSACTION_OPTIONS);
        return result;
    }

    /** Batches released in the last 12 h (newest first) for the tablet's "recientes" list. */
    static async getRecentKitchenBatches(companyId: number, branchId?: number, limit = 10) {
        const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 30) : 10;
        const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
        const batches = await prisma.kitchenBatch.findMany({
            where: {
                companyId,
                ...(branchId ? { branchId } : {}),
                status: 'RELEASED',
                releasedAt: { gte: since },
            },
            include: kitchenBatchOrderInclude,
            orderBy: [{ releasedAt: 'desc' }, { id: 'desc' }],
            take: safeLimit,
        });
        return batches.map((batch) => this.withPersistentKitchenBatch(batch));
    }

    static async getKitchenHistory(companyId: number, branchId?: number, limit = 100) {
        const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
        const batches = await prisma.kitchenBatch.findMany({
            where: {
                companyId,
                ...(branchId ? { branchId } : {}),
            },
            include: kitchenBatchOrderInclude,
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
            take: safeLimit
        });
        return batches.map((batch) => this.withPersistentKitchenBatch(batch));
    }

    /**
     * Report a problem with an order from the kitchen.
     * Creates an audit log entry so managers can review.
     */
    static async reportProblem(
        orderId: number,
        companyId: number,
        userId: number,
        description: string
    ) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            select: { id: true, branchId: true, status: true, tableId: true }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }

        await prisma.auditLog.create({
            data: {
                companyId,
                entityType: 'Order',
                entityId: orderId,
                action: 'PROBLEM_REPORTED',
                userId,
                details: {
                    description,
                    orderStatus: order.status,
                    tableId: order.tableId,
                    reportedAt: new Date().toISOString()
                }
            }
        });

        return {
            orderId,
            branchId: order.branchId,
            reported: true
        };
    }

}
