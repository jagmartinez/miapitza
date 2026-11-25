import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';
import { PedidosYaService } from './pedidosya.service';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { DynamicPricingService } from './dynamic-pricing.service';
import { calculatePromotionDiscount } from './promotion.service';
import { DEFAULT_COMPANY_SETTINGS, SettingService } from './setting.service';
import { isValidTimeZone, zonedDateKey } from '../utils/timezone';

/** Valid state transitions for orders */
const VALID_TRANSITIONS: Record<string, string[]> = {
    // Sending and starting preparation have dedicated operations because they
    // also stamp item-level kitchen state. A generic status write must not skip it.
    'OPEN': [],
    'SENT_TO_KITCHEN': ['READY'],
    'IN_PREPARATION': ['READY'],
    // Delivery has a dedicated operation because it atomically consumes stock
    // from an explicit warehouse and releases the table.
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
    fiscalCreditNoteId?: number;
    fiscalInvoiceCancellationId?: number;
    externalRefundReference?: string;
    externalRefundReferences?: Array<{ paymentId: number; reference: string }>;
}

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

    private static calculateFinalTotal(subtotal: number, discount: number, tax: number, tipAmount: number): number {
        const safeSubtotal = Math.max(0, Number(subtotal) || 0);
        const safeDiscount = Math.max(0, Number(discount) || 0);
        const safeTax = Math.max(0, Number(tax) || 0);
        const safeTip = Math.max(0, Number(tipAmount) || 0);
        const discountedSubtotal = Math.max(0, safeSubtotal - safeDiscount);
        return Math.round((discountedSubtotal + safeTax + safeTip) * 100) / 100;
    }

    private static taxFromRate(discountedSubtotal: number, taxRatePercent: number): number {
        const base = Math.max(0, Number(discountedSubtotal) || 0);
        const rate = Number(taxRatePercent);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
            throw new Error('La tasa de impuesto configurada no es válida');
        }
        return Math.round(base * (rate / 100) * 100) / 100;
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

    private static async calculatePromotionDiscount(
        tx: Prisma.TransactionClient,
        companyId: number,
        code: string,
        subtotal: number
    ): Promise<number> {
        const normalizedCode = code.trim().toUpperCase();
        const promotion = await tx.promotion.findFirst({
            where: { companyId, code: normalizedCode }
        });
        if (!promotion) throw new Error('Promotion is not active');
        return calculatePromotionDiscount(promotion, subtotal);
    }

    private static async repriceStoredDiscount(
        tx: Prisma.TransactionClient,
        companyId: number,
        subtotal: number,
        discount: Prisma.Decimal | number,
        discountCode: string | null
    ): Promise<number> {
        if (discountCode) {
            return this.calculatePromotionDiscount(tx, companyId, discountCode, subtotal);
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

    private static deriveStatusFromItems(order: { items?: Array<{ sentAt?: Date | null; status?: string }> }) {
        const items = order.items || [];
        const sentItems = items.filter((item) => item.sentAt != null);
        const hasSentItems = sentItems.length > 0;
        const hasInProgressItem = sentItems.some((item) => item.status === 'IN_PROGRESS');
        const hasPendingKitchenItem = sentItems.some((item) => item.status !== 'DONE');
        const hasUnsentItem = items.some((item) => item.sentAt == null);
        const wholeOrderReady = items.length > 0
            && !hasUnsentItem
            && sentItems.every((item) => item.status === 'DONE');

        if (wholeOrderReady) return 'READY';
        if (hasInProgressItem) return 'IN_PREPARATION';
        if (hasPendingKitchenItem) return 'SENT_TO_KITCHEN';
        // A completed wave followed by unsent additions is operationally open
        // again. It cannot be released or delivered until the new wave is sent.
        if (hasUnsentItem) return 'OPEN';
        if (hasSentItems) return 'SENT_TO_KITCHEN';
        return 'OPEN';
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
        page?: number;
        limit?: number;
    }) {
        const where: Prisma.OrderWhereInput = { companyId };

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
                        }
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
            throw new Error('Order not found');
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
        for (const item of data.items || []) {
            if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('Quantity must be a positive integer');
        }
        return await prisma.$transaction(async (tx) => {
            const branch = await tx.branch.findFirst({ where: { id: data.branchId, companyId, status: 'ACTIVE' }, select: { id: true } });
            if (!branch) throw new Error('Sucursal no encontrada o inactiva para esta empresa');
            // The order's table (if any) must belong to the same company AND the
            // same branch as the order, so branch-scoped reporting/billing stays consistent.
            if (data.tableId) {
                await tx.$queryRaw`SELECT id FROM \`Table\` WHERE id = ${data.tableId} AND companyId = ${companyId} FOR UPDATE`;
                const table = await tx.table.findFirst({
                    where: { id: data.tableId, companyId },
                    select: { id: true, branchId: true, status: true }
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
                        status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] },
                        branchId: data.branchId
                    },
                    include: {
                        items: true,
                        payments: { where: { status: 'ACTIVE' }, select: { id: true } }
                    }
                });

                if (existingOrder) {
                    // Merge items into existing order
                    if (data.items && data.items.length > 0) {
                        if (existingOrder.invoiceNumber) {
                            throw new Error('No se puede modificar una orden facturada');
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
                            tx, companyId, newSubtotal, existingOrder.discount, existingOrder.discountCode
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
                                ...(existingOrder.status === 'READY' ? {
                                    status: 'SENT_TO_KITCHEN' as const,
                                    kitchenReleasedAt: null,
                                    kitchenReleasedById: null,
                                    kitchenStartedAt: null,
                                    kitchenStartedById: null
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
                    select: { status: true }
                });
                if (!table || table.status !== 'AVAILABLE') {
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
            throw new Error('Quantity must be a positive integer');
        }

        return await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                include: { payments: { where: { status: 'ACTIVE' }, select: { id: true } } }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
                throw new Error('Cannot add items to paid, delivered or cancelled orders');
            }
            if (order.invoiceNumber) {
                throw new Error('No se puede modificar una orden facturada');
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
                tx, companyId, newSubtotal, order.discount, order.discountCode
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
                    // READY is no longer truthful after appending an unsent line.
                    ...(order.status === 'READY' ? {
                        status: 'SENT_TO_KITCHEN' as const,
                        kitchenReleasedAt: null,
                        kitchenReleasedById: null,
                        kitchenStartedAt: null,
                        kitchenStartedById: null
                    } : {})
                }
            });

            return item;
        });
    }

    static async removeItem(itemId: number, companyId: number, branchId?: number) {
        return await prisma.$transaction(async (tx) => {
            const target = await tx.orderItem.findFirst({
                where: { id: itemId, order: { companyId, ...(branchId !== undefined ? { branchId } : {}) } },
                select: { orderId: true }
            });
            if (!target) throw new Error('Item not found');

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
                throw new Error('Item not found');
            }
            if (branchId !== undefined && item.order.branchId !== branchId) {
                throw new Error('Item not found');
            }

            if (item.order.status === 'CANCELLED' || item.order.status === 'DELIVERED') {
                throw new Error('Cannot remove items from paid, delivered or cancelled orders');
            }
            if (item.order.invoiceNumber) {
                throw new Error('No se puede modificar una orden facturada');
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
                tx, companyId, newSubtotal, item.order.discount, item.order.discountCode
            );
            const repricedTax = await this.repriceTax(tx, companyId, newSubtotal, repricedDiscount);
            const newTotal = this.calculateFinalTotal(
                newSubtotal,
                repricedDiscount,
                repricedTax,
                Number(item.order.tipAmount || 0)
            );

            await tx.order.update({
                where: { id: item.orderId },
                data: { total: newTotal, discount: repricedDiscount, tax: repricedTax }
            });

            return { success: true };
        });
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
                throw new Error('Order not found');
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
            if (status === 'READY' && existing.status === 'READY') {
                if (existing.items.length === 0 || existing.items.some((item) => item.sentAt === null)) {
                    throw new Error('La orden marcada como lista contiene productos sin enviar a cocina');
                }
                const readyOrder = await tx.order.findUnique({
                    where: { id },
                    include: {
                        table: true,
                        user: { select: { id: true, name: true, color: true } },
                        items: { include: { menuItem: true, modifiers: true } }
                    }
                });
                if (!readyOrder) throw new Error('Order not found');
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
                if (existing.items.length === 0) {
                    throw new Error('Cannot mark an empty order as ready');
                }
                if (existing.items.some((item) => item.sentAt === null)) {
                    throw new Error('No se puede marcar lista una orden con productos sin enviar a cocina');
                }
                const now = new Date();
                await tx.orderItem.updateMany({
                    where: { orderId: id, sentAt: { not: null }, status: { not: 'DONE' } },
                    data: { status: 'DONE', finishedAt: now }
                });
                await tx.orderItem.updateMany({
                    where: { orderId: id, sentAt: { not: null }, startedAt: null },
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

        const updatedOrder = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            // Re-check status INSIDE the transaction to prevent a TOCTOU race.
            const order = await tx.order.findFirst({
                where: { id, companyId },
                include: { items: true }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            if (!['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'].includes(order.status)) {
                throw new Error(`Cannot send order to kitchen when status is ${order.status}`);
            }

            if (order.items.length === 0) {
                throw new Error('Cannot send empty order to kitchen');
            }

            const unsentItems = order.items.filter((item) => item.sentAt == null);

            if (unsentItems.length === 0) {
                throw new Error('No hay productos nuevos pendientes por enviar a cocina');
            }

            // Mark only new items as sent to preserve kitchen history for previous sends.
            await tx.orderItem.updateMany({
                where: { orderId: id, sentAt: null },
                data: { sentAt: now }
            });

            const refreshed = await tx.order.findUnique({
                where: { id },
                include: {
                    items: {
                        include: {
                            menuItem: true,
                            modifiers: true
                        }
                    }
                }
            });

            if (!refreshed) throw new Error('Order not found');
            const nextStatus = this.deriveStatusFromItems(refreshed);
            return nextStatus === refreshed.status
                ? refreshed
                : tx.order.update({
                    where: { id },
                    data: {
                        status: nextStatus,
                        ...(order.status === 'READY' ? {
                            kitchenReleasedAt: null,
                            kitchenReleasedById: null,
                            kitchenStartedAt: null,
                            kitchenStartedById: null
                        } : {})
                    },
                    include: {
                        items: {
                            include: { menuItem: true, modifiers: true }
                        }
                    }
                });
        });
        this.syncPedidosYaStatus(companyId, updatedOrder);
        return updatedOrder;
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
                select: { id: true, branchId: true, invoiceNumber: true }
            });
            if (!order) throw new Error('Order not found');
            if (order.invoiceNumber) {
                throw new Error('Los datos fiscales no pueden modificarse después de emitir la factura');
            }
            const actor = await tx.user.findFirst({
                where: { id: userId, companyId, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!actor) throw new Error('Invalid user for this company');

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

    static async startItem(orderId: number, itemId: number, companyId: number) {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({ where: { id: orderId, companyId }, select: { status: true } });
            if (!order) throw new Error('Orden no encontrada');
            if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
                throw new Error(`No se puede actualizar items de una orden ${order.status}`);
            }
            const claimed = await tx.orderItem.updateMany({
                where: { id: itemId, orderId, status: 'PENDING', sentAt: { not: null } },
                data: { status: 'IN_PROGRESS', startedAt: new Date() }
            });
            if (claimed.count !== 1) throw new Error('El item debe estar enviado y PENDIENTE para iniciar');
            const updatedItem = await tx.orderItem.findUnique({
                where: { id: itemId },
                include: { menuItem: true }
            });
            if (!updatedItem) throw new Error('Item no encontrado');

            const currentOrder = await tx.order.findUnique({
                where: { id: orderId },
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

            if (!currentOrder) {
                throw new Error('Order not found');
            }

            const nextStatus = this.deriveStatusFromItems(currentOrder);
            const updatedOrder = nextStatus !== currentOrder.status
                ? await tx.order.update({
                    where: { id: orderId },
                    data: { status: nextStatus },
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
                })
                : currentOrder;

            return {
                item: updatedItem,
                order: this.withTimeline(updatedOrder)
            };
        });
        this.syncPedidosYaStatus(companyId, result.order);
        return result;
    }

    static async finishItem(orderId: number, itemId: number, companyId: number) {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({ where: { id: orderId, companyId }, select: { status: true } });
            if (!order) throw new Error('Orden no encontrada');
            if (order.status === 'CANCELLED' || order.status === 'DELIVERED') {
                throw new Error(`No se puede actualizar items de una orden ${order.status}`);
            }
            const finishedAt = new Date();
            const claimed = await tx.orderItem.updateMany({
                where: { id: itemId, orderId, status: 'IN_PROGRESS' },
                data: { status: 'DONE', finishedAt }
            });
            if (claimed.count !== 1) throw new Error('El item debe estar EN PROGRESO para finalizar');
            const updated = await tx.orderItem.findUnique({
                where: { id: itemId },
                include: { menuItem: true }
            });
            if (!updated) throw new Error('Item no encontrado');

            const orderInclude = {
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
            } as const;

            const currentOrder = await tx.order.findUnique({
                where: { id: orderId },
                include: orderInclude
            });
            if (!currentOrder) throw new Error('Order not found');

            const nextStatus = this.deriveStatusFromItems(currentOrder);
            const updatedOrder = nextStatus !== currentOrder.status
                ? await tx.order.update({
                    where: { id: orderId },
                    data: { status: nextStatus },
                    include: orderInclude
                })
                : currentOrder;

            const allDone = updatedOrder.items.length > 0
                && updatedOrder.items.every((item) => item.sentAt != null && item.status === 'DONE');

            return { item: updated, allDone, order: this.withTimeline(updatedOrder) };
        });
        this.syncPedidosYaStatus(companyId, result.order);
        return result;
    }

    static async complete(
        id: number,
        companyId: number,
        warehouseId: number,
        deliveredById: number,
        options?: { syncExternal?: boolean }
    ) {
        if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
            throw new Error('warehouseId válido es requerido para entregar la orden');
        }
        if (!Number.isInteger(deliveredById) || deliveredById <= 0) {
            throw new Error('Usuario de entrega inválido');
        }

        const updatedOrder = await prisma.$transaction(async (tx) => {
            // Reversal/payment/cancellation all lock the order. Completion must use
            // the same lock and re-read its consumable graph inside the transaction.
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
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
            if (!order) throw new Error('Order not found');
            if (order.status !== 'READY') throw new Error('Order must be ready before completing');
            if (order.items.some((item) => item.sentAt == null)) {
                throw new Error('No se puede entregar una orden con productos sin enviar a cocina');
            }

            const isZeroTotal = Math.round(Number(order.total) * 100) === 0;
            if (order.financialStatus !== 'PAID' && !isZeroTotal) {
                throw new Error('Order must be paid before completing');
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
                    const promotion = await tx.promotion.findFirst({
                        where: { companyId, code: order.discountCode.toUpperCase() }
                    });
                    if (!promotion) throw new Error('Promotion is not active');
                    const authoritativeDiscount = calculatePromotionDiscount(promotion, itemSubtotal);
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
                    const claimed = await tx.promotion.updateMany({
                        where: {
                            id: promotion.id,
                            ...(promotion.usageLimit === null
                                ? {}
                                : { usageCount: { lt: promotion.usageLimit } })
                        },
                        data: { usageCount: { increment: 1 } }
                    });
                    if (claimed.count !== 1) throw new Error('Promotion usage limit reached');
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
            await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${warehouseId} AND companyId = ${companyId} FOR UPDATE`;
            const warehouse = await tx.warehouse.findFirst({
                where: { id: warehouseId, companyId, branchId: order.branchId, type: 'BRANCH' }
            });

            if (!warehouse) {
                throw new Error('Almacén no encontrado para esta empresa/sucursal');
            }

            // Deduct inventory through the shared, idempotent consumption service.
            // Skips automatically if inventory was already consumed at settlement.
            await InventoryConsumptionService.consumeForOrder(tx, {
                order,
                warehouseId,
                userId: deliveredById,
                companyId
            });

            // Update order status
            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'DELIVERED',
                    deliveredAt: new Date(),
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
                    details: { warehouseId, previousStatus: order.status }
                }
            });

            // Free table if assigned
            if (order.tableId) {
                const otherActiveOnTable = await tx.order.count({
                    where: {
                        companyId,
                        tableId: order.tableId,
                        id: { not: order.id },
                        status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] }
                    }
                });
                if (otherActiveOnTable === 0) {
                    await tx.table.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } });
                }
            }

            return updatedOrder;
        });

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
        return prisma.$transaction((tx) => this.cancelWithTransaction(
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
            // Serialize cancel with payment, delivery and another cancellation.
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
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

            if (!order) throw new Error('Order not found');
            if (order.status === 'CANCELLED') throw new Error('Order is already cancelled');
            if (order.invoiceNumber && !options?.fiscalCreditNoteId && !options?.fiscalInvoiceCancellationId) {
                throw new Error('No se puede cancelar una orden facturada; emita una nota de crédito');
            }

            const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const fullyPaid = order.financialStatus === 'PAID';

            // Payment state is authoritative. A paid order may currently display
            // Operational status never substitutes for the payment ledger.
            if (fullyPaid && !options?.allowPaidReversal) {
                throw new Error('Cannot cancel paid orders');
            }
            if (!fullyPaid && totalPaid > 0 && !options?.allowPaidReversal) {
                throw new Error(`Order has existing payments totaling ${totalPaid.toFixed(2)}. Please refund/delete payments before cancelling.`);
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
                await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${wasteWarehouseId} AND companyId = ${companyId} FOR UPDATE`;
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
                    modifierReason: `WASTE: Merma de modificador por cancelación de orden #${id}`
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

                if (fullyPaid && order.discountCode) {
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
                const otherActiveOnTable = await tx.order.count({
                    where: {
                        companyId,
                        tableId: order.tableId,
                        id: { not: order.id },
                        status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] }
                    }
                });
                if (otherActiveOnTable === 0) {
                    await tx.table.update({ where: { id: order.tableId }, data: { status: 'AVAILABLE' } });
                }
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

    static async updatePricing(
        id: number,
        companyId: number,
        data: {
            discount?: number;
            discountCode?: string | null;
            tax?: number;
            tipAmount?: number;
        }
    ) {
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
                    invoiceNumber: true,
                    payments: { where: { status: 'ACTIVE' }, select: { id: true } }
                }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            if (order.status === 'CANCELLED') {
                throw new Error('Cannot modify pricing for paid or cancelled orders');
            }
            if (order.invoiceNumber) {
                throw new Error('No se puede modificar el total de una orden facturada');
            }
            if (order.payments.length > 0) {
                throw new Error('No se puede modificar el total de una orden con pagos activos; revierta los pagos primero');
            }

            const subtotal = await this.getOrderItemsSubtotal(tx, id);
            const requestedCode = data.discountCode === undefined
                ? undefined
                : String(data.discountCode || '').trim().toUpperCase();
            const nextCode = requestedCode === undefined ? order.discountCode : (requestedCode || null);
            let authoritativeDiscount = data.discount
                ?? (requestedCode === '' ? 0 : Number(order.discount || 0));
            if (nextCode) {
                authoritativeDiscount = await this.calculatePromotionDiscount(tx, companyId, nextCode, subtotal);
            }
            const nextDiscount = Math.round(Math.min(
                Math.max(0, Number(authoritativeDiscount)),
                Math.max(0, subtotal)
            ) * 100) / 100;
            // Client-supplied tax is ignored: IVA is always company tax_rate × net subtotal.
            const nextTax = await this.repriceTax(tx, companyId, subtotal, nextDiscount);
            const nextTip = Math.round(Math.max(0, Number(data.tipAmount ?? Number(order.tipAmount || 0))) * 100) / 100;
            const nextTotal = this.calculateFinalTotal(subtotal, nextDiscount, nextTax, nextTip);

            return await tx.order.update({
                where: { id },
                data: {
                    discount: nextDiscount,
                    discountCode: nextCode,
                    tax: nextTax,
                    tipAmount: nextTip,
                    total: nextTotal
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
        });
    }

    // Get active orders (OPEN or SENT_TO_KITCHEN)
    static async getActiveOrders(companyId: number, branchId?: number) {
        const where: Prisma.OrderWhereInput = {
            companyId,
            status: {
                in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY']
            }
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
        const orders = await prisma.order.findMany({
            where: {
                companyId,
                ...(branchId ? { branchId } : {}),
                kitchenReleasedAt: null,
                OR: [
                    { status: 'READY' },
                    {
                        status: { in: ['SENT_TO_KITCHEN', 'IN_PREPARATION'] },
                        items: { some: { sentAt: { not: null }, status: { not: 'DONE' } } }
                    }
                ]
            },
            include: {
                table: true,
                user: { select: { id: true, name: true, color: true } },
                items: { include: { menuItem: true, modifiers: true } }
            },
            orderBy: { createdAt: 'asc' }
        });
        return orders.map((order) => this.withTimeline(order));
    }

    static async startKitchenPreparation(orderId: number, companyId: number, actorUserId: number) {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                include: { items: true }
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.kitchenReleasedAt) throw new Error('La orden ya fue liberada del KDS');
            if (order.status === 'IN_PREPARATION' && order.kitchenStartedAt) {
                return { changed: false, branchId: order.branchId };
            }
            if (order.status !== 'SENT_TO_KITCHEN') {
                throw new Error('Solo una orden pendiente en cocina puede iniciar preparación');
            }

            const now = new Date();
            const started = await tx.orderItem.updateMany({
                where: { orderId, sentAt: { not: null }, status: 'PENDING' },
                data: { status: 'IN_PROGRESS', startedAt: now }
            });
            if (started.count === 0) throw new Error('La orden no tiene productos pendientes para iniciar');

            await tx.order.update({
                where: { id: orderId },
                data: {
                    status: 'IN_PREPARATION',
                    kitchenStartedAt: now,
                    kitchenStartedById: actorUserId
                }
            });
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: orderId,
                    action: 'KITCHEN_PREPARATION_STARTED',
                    userId: actorUserId,
                    details: { from: order.status, to: 'IN_PREPARATION', startedItems: started.count }
                }
            });
            return { changed: true, branchId: order.branchId };
        });

        const order = await this.getById(orderId, companyId);
        this.syncPedidosYaStatus(companyId, order);
        return { ...result, order };
    }

    static async releaseFromKitchen(orderId: number, companyId: number, actorUserId: number) {
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId },
                select: { id: true, branchId: true, status: true, kitchenReleasedAt: true }
            });
            if (!order) throw new Error('Orden no encontrada');
            if (order.kitchenReleasedAt) return { changed: false, branchId: order.branchId };
            if (order.status !== 'READY') throw new Error('La orden debe estar lista antes de liberarla');

            const releasedAt = new Date();
            await tx.order.update({
                where: { id: orderId },
                data: { kitchenReleasedAt: releasedAt, kitchenReleasedById: actorUserId }
            });
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: orderId,
                    action: 'KITCHEN_RELEASED',
                    userId: actorUserId,
                    details: { status: order.status, releasedAt: releasedAt.toISOString() }
                }
            });
            return { changed: true, branchId: order.branchId };
        });
        return { ...result, order: await this.getById(orderId, companyId) };
    }

    static async getKitchenHistory(companyId: number, branchId?: number, limit = 100) {
        const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
        const orders = await prisma.order.findMany({
            where: {
                companyId,
                ...(branchId ? { branchId } : {}),
                OR: [
                    { kitchenStartedAt: { not: null } },
                    { kitchenReleasedAt: { not: null } },
                    { status: { in: ['SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED', 'CANCELLED'] } }
                ]
            },
            include: {
                table: true,
                user: { select: { id: true, name: true, color: true } },
                kitchenStartedBy: { select: { id: true, name: true } },
                kitchenReleasedBy: { select: { id: true, name: true } },
                items: { include: { menuItem: true, modifiers: true } }
            },
            orderBy: { updatedAt: 'desc' },
            take: safeLimit
        });
        return orders.map((order) => this.withTimeline(order));
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
            throw new Error('Order not found');
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
