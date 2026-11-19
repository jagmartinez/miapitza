import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { AuditLogService } from './audit-log.service';
import { fileCleanupService } from './file-cleanup.service';
import { transactionWithLockRetry } from '../utils/transaction-retry';
import { randomUUID } from 'crypto';

type Tx = Prisma.TransactionClient;

export class PurchaseOrderService {
    private static invoiceStorageKey(invoiceUrl?: string | null): string | null {
        const match = invoiceUrl?.match(/^\/uploads\/invoices\/(invoice-\d+-\d+\.(?:pdf|jpg|png|webp))$/i);
        return match?.[1] ?? null;
    }

    private static async processInvoiceDeletion(companyId: number, storageKey: string | null): Promise<void> {
        if (!storageKey) return;
        await fileCleanupService.processByStorageKey(companyId, 'INVOICE', storageKey).catch((error) => {
            console.error('[PurchaseOrderInvoice] Immediate cleanup dispatch failed; outbox retained', {
                companyId,
                errorType: error instanceof Error ? error.name : typeof error,
            });
        });
    }

    private static roundMoney(value: number): number {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    static async getAll(companyId: number, filters?: {
        branchId?: number;
        supplierId?: number;
        status?: 'DRAFT' | 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
        search?: string;
    }) {
        const where: Prisma.PurchaseOrderWhereInput = { companyId };

        if (filters?.branchId) {
            where.branchId = filters.branchId;
        }

        if (filters?.supplierId) {
            where.supplierId = filters.supplierId;
        }

        if (filters?.status) {
            where.status = filters.status;
        }

        if (filters?.search) {
            where.OR = [
                { notes: { contains: filters.search } },
                { invoiceNumber: { contains: filters.search } },
                { supplier: { name: { contains: filters.search } } }
            ];
        }

        return await prisma.purchaseOrder.findMany({
            where,
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                supplier: {
                    select: {
                        id: true,
                        name: true,
                        contact: true,
                        phone: true
                    }
                },
                _count: {
                    select: {
                        items: true
                    }
                }
            },
            orderBy: {
                date: 'desc'
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const order = await prisma.purchaseOrder.findFirst({
            where: { id, companyId },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                supplier: {
                    select: {
                        id: true,
                        name: true,
                        contact: true,
                        phone: true,
                        email: true,
                        address: true
                    }
                },
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                                unit: true
                            }
                        }
                    }
                },
                payments: {
                    orderBy: { date: 'desc' }
                }
            }
        });

        if (!order) {
            throw new Error('Purchase order not found');
        }

        return order;
    }

    /**
     * Resolve a default purchase unit when the caller omits one, so the conversion
     * to base unit (and baseQuantity/baseCost) always runs instead of storing raw
     * quantities. Order per business rule: the product's default ProductUnit, then
     * its configured base unit, then the product's legacy unit. The legacy value
     * still goes through UnitConversionService, so omission never bypasses the
     * unit contract or leaves baseQuantity/baseCost without traceability.
     */
    private static async resolveDefaultPurchaseUnit(
        productId: number,
        companyId: number,
        db: Tx | typeof prisma
    ): Promise<string | null> {
        const defaultUnit = await db.productUnit.findFirst({
            where: { productId, companyId, isDefault: true, active: true },
            include: { unit: true }
        });
        if (defaultUnit?.unit?.abbreviation) {
            return defaultUnit.unit.abbreviation;
        }

        const product = await db.product.findFirst({
            where: { id: productId, companyId },
            select: { unit: true, baseUnit: { select: { abbreviation: true } } }
        });
        if (product?.baseUnit?.abbreviation) {
            return product.baseUnit.abbreviation;
        }

        if (product?.unit?.trim()) {
            return product.unit.trim();
        }

        return null;
    }

    static async create(companyId: number, data: {
        branchId: number;
        supplierId: number;
        notes?: string;
        invoiceNumber?: string;
        invoicePdf?: string;
        invoiceDate?: string;
        invoiceType?: 'CASH' | 'CREDIT';
        paymentDueDate?: string;
        bank?: string;
        transferNumber?: string;
        items: Array<{
            productId: number;
            quantity: number;
            cost: number;
            purchaseUnit?: string;
        }>;
    }) {
        for (const item of data.items) {
            if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
                throw new Error('La cantidad de cada artículo debe ser un número finito mayor a 0');
            }
            if (!Number.isFinite(item.cost) || item.cost < 0) {
                throw new Error('El costo de cada artículo debe ser un número finito mayor o igual a 0');
            }
        }
        // Verify branch (findFirst guarantees the companyId scope; findUnique can't
        // filter by a non-unique companyId and would leak cross-tenant branches).
        const branch = await prisma.branch.findFirst({
            where: { id: data.branchId, companyId }
        });

        if (!branch) {
            throw new Error('Branch not found or unauthorized');
        }

        // Verify supplier belongs to this company
        const supplier = await prisma.supplier.findFirst({
            where: { id: data.supplierId, companyId, active: true }
        });

        if (!supplier) {
            throw new Error('Supplier not found or unauthorized');
        }

        // Verify every product belongs to this company
        const productIds = [...new Set(data.items.map((item) => item.productId))];
        if (productIds.length === 0) {
            throw new Error('A purchase order requires at least one item');
        }

        const products = await prisma.product.findMany({
            where: { id: { in: productIds }, companyId, active: true },
            select: { id: true }
        });

        if (products.length !== productIds.length) {
            throw new Error('One or more products not found or unauthorized');
        }

        // Calculate total
        const total = this.roundMoney(data.items.reduce((sum, item) => {
            return sum + (item.quantity * item.cost);
        }, 0));
        const invoiceType = data.invoiceType || 'CASH';
        const invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : null;
        const paymentDueDate = data.paymentDueDate ? new Date(data.paymentDueDate) : null;
        if (invoiceDate && Number.isNaN(invoiceDate.getTime())) {
            throw new Error('La fecha de factura no es válida');
        }
        if (paymentDueDate && Number.isNaN(paymentDueDate.getTime())) {
            throw new Error('La fecha de vencimiento no es válida');
        }

        return await prisma.$transaction(async (tx: Tx) => {
            // Create purchase order
            const order = await tx.purchaseOrder.create({
                data: {
                    branchId: data.branchId,
                    supplierId: data.supplierId,
                    notes: data.notes,
                    invoiceNumber: data.invoiceNumber,
                    invoicePdf: data.invoicePdf,
                    invoiceDate,
                    invoiceType,
                    paymentDueDate,
                    bank: data.bank,
                    transferNumber: data.transferNumber,
                    // Nothing is owed before a receipt. CASH is paid on delivery:
                    // each receipt/close sets paidAmount = received value
                    // (settlementFor), same rule as auto-generated orders.
                    paymentStatus: 'PENDING',
                    paidAmount: 0,
                    companyId,
                    total,
                    status: 'DRAFT'
                }
            });
            const invoiceStorageKey = this.invoiceStorageKey(data.invoicePdf);
            if (invoiceStorageKey) {
                await fileCleanupService.cancelReservation(
                    tx,
                    companyId,
                    'INVOICE',
                    invoiceStorageKey,
                );
            }

            // Create order items with unit conversion
            for (const item of data.items) {
                let purchaseUnit: string | null = item.purchaseUnit || null;
                let conversionFactor: number | null = null;
                let baseQuantity: number | null = null;
                let baseCost: number | null = null;

                // Default to the product's unit so the conversion always runs and
                // baseQuantity/baseCost are persisted (avoids treating raw qty as base).
                if (!purchaseUnit) {
                    purchaseUnit = await this.resolveDefaultPurchaseUnit(item.productId, companyId, tx);
                }

                if (purchaseUnit) {
                    const conv = await UnitConversionService.convertWithCost(
                        item.productId, companyId, item.quantity, purchaseUnit, item.cost, tx
                    );
                    conversionFactor = conv.conversionFactor;
                    baseQuantity = conv.baseQuantity;
                    baseCost = conv.baseCost;
                    purchaseUnit = conv.originalUnit;
                }

                await tx.purchaseOrderItem.create({
                    data: {
                        purchaseOrderId: order.id,
                        productId: item.productId,
                        quantity: item.quantity,
                        cost: item.cost,
                        subtotal: item.quantity * item.cost,
                        purchaseUnit,
                        conversionFactor,
                        baseQuantity,
                        baseCost
                    }
                });
            }

            return await tx.purchaseOrder.findUnique({
                where: { id: order.id },
                include: {
                    items: {
                        include: {
                            product: true
                        }
                    },
                    supplier: true,
                    branch: true
                }
            });
        });
    }

    static async update(id: number, companyId: number, input: {
        branchId?: number;
        supplierId?: number;
        notes?: string;
        invoiceNumber?: string;
        invoicePdf?: string;
        invoiceDate?: string;
        invoiceType?: 'CASH' | 'CREDIT';
        paymentDueDate?: string;
        bank?: string;
        transferNumber?: string;
        status?: 'DRAFT' | 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
    }) {
        // Explicit allowlist: the controller forwards req.body, so tenant,
        // totals and settlement fields (companyId, total, paidAmount,
        // paymentStatus, items, ...) must never reach the Prisma update.
        const data = this.pickEditableFields(input);

        // Receiving must go through the receive() flow so stock movements and costs
        // are generated. Block marking RECEIVED via a plain edit.
        if (data.status === 'RECEIVED' || data.status === 'PARTIALLY_RECEIVED') {
            throw new Error('Para recibir una orden use la acción de recepción, no la edición');
        }

        // If reassigning the supplier, ensure it belongs to this company.
        if (data.supplierId !== undefined) {
            const supplier = await prisma.supplier.findFirst({
                where: { id: data.supplierId, companyId, active: true },
                select: { id: true }
            });
            if (!supplier) throw new Error('Proveedor no encontrado para esta empresa');
        }
        if (data.branchId !== undefined) {
            if (!Number.isInteger(data.branchId) || data.branchId <= 0) throw new Error('Sucursal inválida');
            const branch = await prisma.branch.findFirst({
                where: { id: data.branchId, companyId },
                select: { id: true }
            });
            if (!branch) throw new Error('Sucursal no encontrada para esta empresa');
        }

        let replacedInvoiceKey: string | null = null;
        const updated = await prisma.$transaction(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const existing = await tx.purchaseOrder.findFirst({ where: { id, companyId } });
            if (!existing) throw new Error('Purchase order not found');
            if (existing.status === 'PARTIALLY_RECEIVED') {
                // Stock was already posted: a plain status change would leave it
                // behind. Cancelling must reverse the receipts exactly.
                throw new Error(
                    'La orden tiene recepciones parciales: use "Cerrar saldo" para finalizarla o "Revertir recepción" para cancelarla'
                );
            }
            if (existing.status === 'RECEIVED' || existing.status === 'CANCELLED') {
                throw new Error(`Cannot update purchase order with status ${existing.status}`);
            }

            // Once issued, commercial terms and lines are immutable; the only
            // legal mutation is cancellation. This prevents a PO from changing
            // underneath an approval/receipt workflow.
            if (existing.status === 'ISSUED') {
                const keys = Object.keys(data).filter((key) => data[key as keyof typeof data] !== undefined);
                if (data.status !== 'CANCELLED' || keys.some((key) => key !== 'status')) {
                    throw new Error('Una orden emitida es inmutable; solo puede cancelarse');
                }
            }

            const updateData: Record<string, unknown> = { ...data };
            if (data.invoiceDate !== undefined) {
                const value = data.invoiceDate ? new Date(data.invoiceDate) : null;
                if (value && Number.isNaN(value.getTime())) throw new Error('La fecha de factura no es válida');
                updateData.invoiceDate = value;
            }
            if (data.paymentDueDate !== undefined) {
                const value = data.paymentDueDate ? new Date(data.paymentDueDate) : null;
                if (value && Number.isNaN(value.getTime())) throw new Error('La fecha de vencimiento no es válida');
                updateData.paymentDueDate = value;
            }
            if (data.invoiceType !== undefined && data.invoiceType !== existing.invoiceType) {
                // Only DRAFT/ISSUED orders reach here: nothing received, nothing
                // owed. CASH settles on receipt (settlementFor), CREDIT by payments.
                updateData.paymentStatus = 'PENDING';
                updateData.paidAmount = 0;
            }

            if (data.status && data.status !== existing.status) {
                const allowed: Record<'DRAFT' | 'ISSUED', Array<'ISSUED' | 'CANCELLED'>> = {
                    DRAFT: ['ISSUED', 'CANCELLED'],
                    ISSUED: ['CANCELLED']
                };
                if (!allowed[existing.status as 'DRAFT' | 'ISSUED']?.includes(data.status as 'ISSUED' | 'CANCELLED')) {
                    throw new Error(`Transición de orden de compra inválida: ${existing.status} -> ${data.status}`);
                }
            }

            if (data.status === 'CANCELLED') {
                // Payments cannot be recorded before receipt. Clear the implicit
                // cash settlement so cancelled POs are never reported as paid.
                updateData.paidAmount = 0;
                updateData.paymentStatus = 'PENDING';
            }

            const newInvoiceKey = this.invoiceStorageKey(data.invoicePdf);
            if (newInvoiceKey) {
                await fileCleanupService.cancelReservation(tx, companyId, 'INVOICE', newInvoiceKey);
            }
            const previousInvoiceKey = this.invoiceStorageKey(existing.invoicePdf);
            if (previousInvoiceKey && previousInvoiceKey !== newInvoiceKey && data.invoicePdf !== undefined) {
                await fileCleanupService.requestDeletion(
                    tx,
                    companyId,
                    'INVOICE',
                    previousInvoiceKey,
                    'PURCHASE_ORDER_INVOICE_REPLACED',
                );
                replacedInvoiceKey = previousInvoiceKey;
            }

            return tx.purchaseOrder.update({
                where: { id },
                data: updateData,
                include: {
                    supplier: true,
                    branch: true,
                    items: { include: { product: true } }
                }
            });
        });
        await this.processInvoiceDeletion(companyId, replacedInvoiceKey);
        return updated;
    }

    private static pickEditableFields(input: Parameters<typeof PurchaseOrderService.update>[2]) {
        const source = (input ?? {}) as Record<string, unknown>;
        const editable = [
            'branchId', 'supplierId', 'notes', 'invoiceNumber', 'invoicePdf', 'invoiceDate',
            'invoiceType', 'paymentDueDate', 'bank', 'transferNumber', 'status',
        ] as const;
        const picked: Record<string, unknown> = {};
        for (const key of editable) {
            if (source[key] !== undefined) picked[key] = source[key];
        }
        if (picked.invoiceType !== undefined && picked.invoiceType !== 'CASH' && picked.invoiceType !== 'CREDIT') {
            throw new Error('Tipo de factura inválido');
        }
        return picked as Parameters<typeof PurchaseOrderService.update>[2];
    }

    static async delete(id: number, companyId: number) {
        let invoiceKey: string | null = null;
        const deleted = await prisma.$transaction(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.purchaseOrder.findFirst({ where: { id, companyId } });
            if (!order) throw new Error('Purchase order not found');
            if (order.status !== 'DRAFT') throw new Error('Can only delete draft purchase orders');
            invoiceKey = this.invoiceStorageKey(order.invoicePdf);
            if (invoiceKey) {
                await fileCleanupService.requestDeletion(
                    tx,
                    companyId,
                    'INVOICE',
                    invoiceKey,
                    'PURCHASE_ORDER_DELETED',
                );
            }

            // Delete items first
            await tx.purchaseOrderItem.deleteMany({
                where: { purchaseOrderId: id }
            });

            // Delete order
            return await tx.purchaseOrder.delete({
                where: { id }
            });
        });
        await this.processInvoiceDeletion(companyId, invoiceKey);
        return deleted;
    }

    /** Tolerance for comparing DECIMAL(18,6) quantities read as JS numbers. */
    private static readonly QTY_EPS = 1e-9;

    private static round6(value: number): number {
        return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
    }

    /** Unique per-receipt movement reference and FIFO layer sourceRef. */
    static receiptReference(orderId: number, sequence: number): string {
        return `PO-${orderId}-R${sequence}`;
    }

    private static remainingQuantity(item: { quantity: unknown; receivedQuantity?: unknown }): number {
        const remaining = Number(item.quantity) - Number(item.receivedQuantity ?? 0);
        return remaining > this.QTY_EPS ? this.round6(remaining) : 0;
    }

    private static receivedValue(items: Array<{ cost: unknown; receivedQuantity?: unknown }>): number {
        return this.roundMoney(items.reduce(
            (sum, item) => sum + Number(item.receivedQuantity ?? 0) * Number(item.cost),
            0
        ));
    }

    /**
     * Amount owed to the supplier. A RECEIVED order (complete, or closed short
     * with its total adjusted) owes its total; a partially received order owes
     * only the value of what has arrived.
     */
    private static payableAmount(order: { status: string; total: unknown; receivedTotal?: unknown }): number {
        return order.status === 'PARTIALLY_RECEIVED'
            ? Number(order.receivedTotal ?? 0)
            : Number(order.total);
    }

    private static creditPaymentStatus(paid: number, payable: number): 'PENDING' | 'PARTIAL' | 'PAID' {
        if (paid <= 0) return 'PENDING';
        return paid >= payable ? 'PAID' : 'PARTIAL';
    }

    /**
     * Settlement after a receipt/close. CASH purchases are paid on delivery:
     * paidAmount follows the received value. CREDIT keeps its recorded
     * payments and only re-evaluates the status against the new payable.
     */
    private static settlementFor(invoiceType: string, paidAmount: number, payable: number) {
        if (invoiceType === 'CASH') {
            return { paidAmount: payable, paymentStatus: 'PAID' as const };
        }
        return { paymentStatus: this.creditPaymentStatus(paidAmount, payable) };
    }

    private static normalizeReceiveLines(
        lines?: Array<{ itemId: number; quantity: number }> | null
    ): Map<number, number> | null {
        if (lines == null) return null;
        if (!Array.isArray(lines) || lines.length === 0) {
            throw new Error('Indique al menos una línea con cantidad a recibir');
        }
        const normalized = new Map<number, number>();
        for (const line of lines) {
            const itemId = Number(line?.itemId);
            const quantity = Number(line?.quantity);
            if (!Number.isInteger(itemId) || itemId <= 0) {
                throw new Error('Línea de recepción inválida');
            }
            if (!Number.isFinite(quantity) || this.round6(quantity) <= 0) {
                throw new Error(`La cantidad a recibir del artículo ${itemId} debe ser mayor a 0`);
            }
            if (normalized.has(itemId)) {
                throw new Error(`El artículo ${itemId} está repetido en la recepción`);
            }
            normalized.set(itemId, this.round6(quantity));
        }
        return normalized;
    }

    private static async loadOrderWithReceipts(db: Tx, id: number) {
        return db.purchaseOrder.findUnique({
            where: { id },
            include: {
                supplier: true,
                branch: true,
                items: { include: { product: true } },
                receipts: { orderBy: { sequence: 'asc' }, include: { lines: true } }
            }
        });
    }

    /**
     * Receive a purchase order, fully or partially.
     *
     * `options.items` lists the quantity to receive now per line, in the line's
     * purchase unit; when omitted every line's remaining balance is received.
     * Each call creates one PurchaseOrderReceipt with a unique reference
     * (PO-{id}-R{n}) used as the movement reference and FIFO layer sourceRef,
     * and is keyed by `options.idempotencyKey` so a replay returns the current
     * state instead of posting stock twice.
     */
    static async receive(
        id: number,
        companyId: number,
        userId: number,
        warehouseId: number,
        options: {
            items?: Array<{ itemId: number; quantity: number }> | null;
            idempotencyKey?: string | null;
        } = {}
    ) {
        if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
            throw new Error('Almacén inválido');
        }
        const requested = this.normalizeReceiveLines(options.items);
        const idempotencyKey = options.idempotencyKey?.trim() || randomUUID();
        if (idempotencyKey.length > 191) {
            throw new Error('Clave de idempotencia demasiado larga');
        }

        return await transactionWithLockRetry(async (tx: Tx) => {
            // Serialize receipt attempts on the order row: two workers must never
            // both observe the same remaining balance.
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const lockedOrder = await tx.purchaseOrder.findFirst({
                where: { id, companyId },
                include: { items: true }
            });
            if (!lockedOrder) throw new Error('Purchase order not found');

            // Replay of an already applied receipt: no stock effect. Checked
            // before the status rules so replaying the final receipt of a now
            // RECEIVED order still answers with the order instead of an error.
            const previous = await tx.purchaseOrderReceipt.findFirst({
                where: { purchaseOrderId: id, idempotencyKey },
                select: { id: true, warehouseId: true }
            });
            if (previous) {
                if (previous.warehouseId !== warehouseId) {
                    throw new Error('La clave de idempotencia ya se usó para una recepción en otro almacén');
                }
                const current = await this.loadOrderWithReceipts(tx, id);
                return { ...current!, replayed: true };
            }

            if (lockedOrder.status === 'RECEIVED') throw new Error('Purchase order already received');
            if (lockedOrder.status === 'CANCELLED') throw new Error('Cannot receive cancelled purchase order');
            if (lockedOrder.status !== 'ISSUED' && lockedOrder.status !== 'PARTIALLY_RECEIVED') {
                throw new Error('Cannot receive a draft purchase order. It must be issued first.');
            }

            // Plan what is received now (purchase unit) per line.
            const plan: Array<{ item: (typeof lockedOrder.items)[number]; quantity: number }> = [];
            if (!requested) {
                for (const item of lockedOrder.items) {
                    const remaining = this.remainingQuantity(item);
                    if (remaining > 0) plan.push({ item, quantity: remaining });
                }
                if (plan.length === 0) throw new Error('La orden no tiene saldo pendiente por recibir');
            } else {
                for (const [itemId, quantity] of requested) {
                    const item = lockedOrder.items.find((candidate) => candidate.id === itemId);
                    if (!item) throw new Error(`El artículo ${itemId} no pertenece a esta orden de compra`);
                    const remaining = this.remainingQuantity(item);
                    if (remaining <= 0) {
                        throw new Error(`El artículo ${itemId} ya fue recibido por completo`);
                    }
                    if (quantity > remaining + this.QTY_EPS) {
                        throw new Error(
                            `La cantidad a recibir (${quantity}) excede el saldo pendiente (${remaining}) del artículo ${itemId}`
                        );
                    }
                    plan.push({ item, quantity: Math.min(quantity, remaining) });
                }
            }
            plan.sort((a, b) => a.item.productId - b.item.productId || a.item.id - b.item.id);

            const { CostingService } = await import('./costing.service');
            const { InventoryEngineService } = await import('./inventory-engine.service');

            // Canonical lock order: Warehouse FOR SHARE -> Products (ascending)
            // -> Stock (engine). The shared warehouse lock also freezes its
            // branch assignment while we validate and post the receipt.
            await InventoryEngineService.lockInventoryScope(
                tx,
                companyId,
                [warehouseId],
                plan.map(({ item }) => item.productId),
                'SHARE'
            );
            const lockedWarehouse = await tx.warehouse.findFirst({
                where: { id: warehouseId, companyId },
                select: { branchId: true }
            });
            if (!lockedWarehouse) throw new Error('Almacén no encontrado');
            if (lockedOrder.branchId && lockedWarehouse.branchId && lockedWarehouse.branchId !== lockedOrder.branchId) {
                throw new Error('El almacén no pertenece a la sucursal de la orden de compra');
            }

            const sequence = (await tx.purchaseOrderReceipt.count({ where: { purchaseOrderId: id } })) + 1;
            const reference = this.receiptReference(id, sequence);
            const receipt = await tx.purchaseOrderReceipt.create({
                data: {
                    companyId,
                    purchaseOrderId: id,
                    warehouseId,
                    userId,
                    sequence,
                    reference,
                    idempotencyKey,
                    totalValue: 0
                }
            });

            const receivedByItem = new Map<number, number>(
                lockedOrder.items.map((item) => [item.id, Number(item.receivedQuantity ?? 0)])
            );
            let receiptValue = 0;

            for (const { item, quantity } of plan) {
                // Resolve the base-unit conversion. Prefer the stored converted
                // values; check `!= null` (not truthiness) so a legitimate 0 is kept.
                let conversionFactor: number | null =
                    item.conversionFactor != null ? Number(item.conversionFactor) : null;
                let baseQuantity: number | null =
                    item.baseQuantity != null ? Number(item.baseQuantity) : null;

                // Legacy items created before conversion ran: resolve an explicit
                // unit even when purchaseUnit itself is null. Treating the raw
                // quantity as base would silently mis-cost kg-vs-g receipts.
                if (baseQuantity == null) {
                    const effectivePurchaseUnit = item.purchaseUnit ||
                        await this.resolveDefaultPurchaseUnit(item.productId, companyId, tx);
                    if (!effectivePurchaseUnit) {
                        throw new Error(
                            `El artículo ${item.id} no tiene unidad de compra/base trazable; configure la UOM antes de recibir`
                        );
                    }
                    const conv = await UnitConversionService.convertWithCost(
                        item.productId, companyId, Number(item.quantity), effectivePurchaseUnit, Number(item.cost), tx
                    );
                    conversionFactor = conv.conversionFactor;
                    baseQuantity = conv.baseQuantity;
                    await tx.purchaseOrderItem.update({
                        where: { id: item.id },
                        data: {
                            purchaseUnit: conv.originalUnit,
                            conversionFactor,
                            baseQuantity,
                            baseCost: conv.baseCost
                        }
                    });
                }

                const ordered = Number(item.quantity);
                const alreadyReceived = Number(item.receivedQuantity ?? 0);
                const completesLine = ordered - alreadyReceived - quantity <= this.QTY_EPS;
                // Base quantity proportional to the stored line conversion. The
                // receipt that completes the line takes the exact base remainder
                // so the sum of receipts equals the line's baseQuantity.
                const baseRatio = baseQuantity / ordered;
                const stockQty = completesLine
                    ? this.round6(baseQuantity - this.round6(alreadyReceived * baseRatio))
                    : this.round6(quantity * baseRatio);
                if (!(stockQty > 0)) {
                    throw new Error(`La cantidad a recibir del artículo ${item.id} es demasiado pequeña para la unidad base`);
                }
                // Value at the line's purchase price; the base unit cost keeps
                // full precision so the movement total equals quantity x cost.
                const lineValue = quantity * Number(item.cost);
                const costPerBase = lineValue / stockQty;

                // C1: capture the pre-receipt GLOBAL stock (all warehouses) BEFORE
                // the engine mutates the receiving warehouse's stock.
                const globalAgg = await tx.stock.aggregate({
                    _sum: { quantity: true },
                    where: { productId: item.productId, companyId }
                });
                const globalStockBefore = Number(globalAgg._sum.quantity ?? 0);

                // IN through the engine: values the entry at costPerBase and opens
                // a PURCHASE FIFO layer whose sourceRef is this receipt reference.
                const movement = await InventoryEngineService.applyMovement(tx, {
                    type: 'IN',
                    companyId,
                    warehouseId,
                    productId: item.productId,
                    userId,
                    quantity: stockQty,
                    unitCost: costPerBase,
                    originalQuantity: quantity,
                    originalUnit: item.purchaseUnit || null,
                    conversionFactor: conversionFactor != null ? conversionFactor : null,
                    reason: completesLine && alreadyReceived <= 0
                        ? 'Purchase order received'
                        : `Recepción parcial OC #${id}`,
                    reference,
                    sourceType: 'PURCHASE'
                });

                await CostingService.updateProductCost(
                    tx,
                    item.productId,
                    companyId,
                    item.id,
                    stockQty,
                    costPerBase,
                    warehouseId,
                    globalStockBefore
                );

                await tx.purchaseOrderReceiptLine.create({
                    data: {
                        receiptId: receipt.id,
                        purchaseOrderItemId: item.id,
                        productId: item.productId,
                        quantity,
                        baseQuantity: stockQty,
                        baseUnitCost: costPerBase,
                        totalCost: lineValue,
                        inventoryMovementId: movement?.movementId ?? null
                    }
                });

                const newReceived = completesLine ? ordered : this.round6(alreadyReceived + quantity);
                await tx.purchaseOrderItem.update({
                    where: { id: item.id },
                    data: { receivedQuantity: newReceived }
                });
                receivedByItem.set(item.id, newReceived);
                receiptValue += lineValue;
            }

            await tx.purchaseOrderReceipt.update({
                where: { id: receipt.id },
                data: { totalValue: receiptValue }
            });

            const itemsAfter = lockedOrder.items.map((item) => ({
                ...item,
                receivedQuantity: receivedByItem.get(item.id) ?? 0
            }));
            const fullyReceived = itemsAfter.every((item) => this.remainingQuantity(item) <= 0);
            const receivedTotal = this.receivedValue(itemsAfter);
            const status = fullyReceived ? 'RECEIVED' as const : 'PARTIALLY_RECEIVED' as const;
            const payable = fullyReceived ? Number(lockedOrder.total) : receivedTotal;

            await tx.purchaseOrder.update({
                where: { id },
                data: {
                    status,
                    receivedTotal,
                    ...this.settlementFor(lockedOrder.invoiceType, Number(lockedOrder.paidAmount), payable)
                }
            });

            await AuditLogService.log({
                companyId,
                userId,
                entityType: 'PurchaseOrder',
                entityId: id,
                action: 'RECEIVE',
                details: {
                    reference,
                    warehouseId,
                    status,
                    receiptValue: this.roundMoney(receiptValue),
                    lines: plan.map(({ item, quantity }) => ({ itemId: item.id, quantity }))
                }
            }, tx);

            const updated = await this.loadOrderWithReceipts(tx, id);
            return { ...updated!, replayed: false };
        });
    }

    /**
     * "Cerrar saldo": finish a partially received order, abandoning the
     * remaining quantity without any stock effect. The order total is
     * adjusted to the received value so payables, CASH settlement and the
     * purchase reports (which read RECEIVED totals) reflect what arrived.
     * The ordered quantities stay on the lines and in the audit log.
     */
    static async closeRemaining(id: number, companyId: number, userId: number, closeReason: string) {
        const reason = String(closeReason ?? '').trim();
        if (!reason) throw new Error('El motivo para cerrar el saldo es requerido');
        if (reason.length > 500) throw new Error('El motivo para cerrar el saldo es demasiado largo');

        return await transactionWithLockRetry(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.purchaseOrder.findFirst({
                where: { id, companyId },
                include: { items: true }
            });
            if (!order) throw new Error('Orden de compra no encontrada');
            if (order.status !== 'PARTIALLY_RECEIVED') {
                throw new Error(
                    order.status === 'ISSUED'
                        ? 'La orden no tiene recepciones; cancélela en lugar de cerrar el saldo'
                        : 'Solo se puede cerrar el saldo de una orden parcialmente recibida'
                );
            }

            const receivedTotal = this.receivedValue(order.items);
            const abandoned = order.items
                .map((item) => ({ itemId: item.id, productId: item.productId, quantity: this.remainingQuantity(item) }))
                .filter((line) => line.quantity > 0);
            const paidAmount = Number(order.paidAmount);
            if (order.invoiceType === 'CREDIT' && paidAmount > receivedTotal + 0.001) {
                throw new Error('Los abonos registrados superan el valor recibido; revierta el excedente antes de cerrar el saldo');
            }

            await tx.purchaseOrder.update({
                where: { id },
                data: {
                    status: 'RECEIVED',
                    total: receivedTotal,
                    receivedTotal,
                    receivingClosedAt: new Date(),
                    receivingClosedById: userId,
                    receivingCloseReason: reason,
                    ...this.settlementFor(order.invoiceType, paidAmount, receivedTotal)
                }
            });

            await AuditLogService.log({
                companyId,
                userId,
                entityType: 'PurchaseOrder',
                entityId: id,
                action: 'CLOSE_REMAINING',
                details: { reason, orderedTotal: Number(order.total), receivedTotal, abandoned }
            }, tx);

            return await this.loadOrderWithReceipts(tx, id);
        });
    }

    // Add item to existing order
    static async addItem(orderId: number, companyId: number, data: {
        productId: number;
        quantity: number;
        cost: number;
        purchaseUnit?: string;
    }) {
        if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
            throw new Error('La cantidad del artículo debe ser un número finito mayor a 0');
        }
        if (!Number.isFinite(data.cost) || data.cost < 0) {
            throw new Error('El costo del artículo debe ser un número finito mayor o igual a 0');
        }
        const order = await prisma.purchaseOrder.findFirst({
            where: { id: orderId, companyId }
        });

        if (!order) {
            throw new Error('Purchase order not found');
        }

        if (order.status !== 'DRAFT') {
            throw new Error('Can only add items to draft orders');
        }

        // Ensure the product belongs to this company (avoid cross-tenant items).
        const product = await prisma.product.findFirst({
            where: { id: data.productId, companyId, active: true },
            select: { id: true }
        });
        if (!product) throw new Error('Producto no encontrado para esta empresa');

        return await prisma.$transaction(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${orderId} AND companyId = ${companyId} FOR UPDATE`;
            const lockedOrder = await tx.purchaseOrder.findFirst({ where: { id: orderId, companyId } });
            if (!lockedOrder) throw new Error('Purchase order not found');
            if (lockedOrder.status !== 'DRAFT') throw new Error('Can only add items to draft orders');

            let purchaseUnit: string | null = data.purchaseUnit || null;
            let conversionFactor: number | null = null;
            let baseQuantity: number | null = null;
            let baseCost: number | null = null;

            // Default to the product's unit so the conversion always runs and
            // baseQuantity/baseCost are persisted (avoids treating raw qty as base).
            if (!purchaseUnit) {
                purchaseUnit = await this.resolveDefaultPurchaseUnit(data.productId, companyId, tx);
            }

            if (purchaseUnit) {
                const conv = await UnitConversionService.convertWithCost(
                    data.productId, companyId, data.quantity, purchaseUnit, data.cost, tx
                );
                conversionFactor = conv.conversionFactor;
                baseQuantity = conv.baseQuantity;
                baseCost = conv.baseCost;
                purchaseUnit = conv.originalUnit;
            }

            const item = await tx.purchaseOrderItem.create({
                data: {
                    purchaseOrderId: orderId,
                    productId: data.productId,
                    quantity: data.quantity,
                    cost: data.cost,
                    subtotal: data.quantity * data.cost,
                    purchaseUnit,
                    conversionFactor,
                    baseQuantity,
                    baseCost
                },
                include: {
                    product: true
                }
            });

            // Recalculate total
            const items = await tx.purchaseOrderItem.findMany({
                where: { purchaseOrderId: orderId }
            });

            const newTotal = this.roundMoney(items.reduce((sum, i) => sum + Number(i.subtotal), 0));

            await tx.purchaseOrder.update({
                where: { id: orderId },
                data: {
                    // CASH settles on receipt; a draft line change owes nothing yet.
                    total: newTotal
                }
            });

            return item;
        });
    }

    /**
     * Resolve the branch of the PO that owns an item. Used by the controller to
     * apply the branch-scope guard on item-level routes that only carry itemId.
     */
    static async getItemOrderBranch(itemId: number, companyId: number): Promise<number | null> {
        const item = await prisma.purchaseOrderItem.findFirst({
            where: { id: itemId, purchaseOrder: { companyId } },
            select: { purchaseOrder: { select: { branchId: true } } }
        });
        if (!item) throw new Error('Item not found');
        return item.purchaseOrder.branchId;
    }

    // Remove item from order
    static async removeItem(itemId: number, companyId: number) {
        const item = await prisma.purchaseOrderItem.findFirst({
            where: { id: itemId, purchaseOrder: { companyId } },
            include: {
                purchaseOrder: true
            }
        });

        if (!item) {
            throw new Error('Item not found');
        }

        if (item.purchaseOrder.status !== 'DRAFT') {
            throw new Error('Can only remove items from draft orders');
        }

        return await prisma.$transaction(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${item.purchaseOrderId} AND companyId = ${companyId} FOR UPDATE`;
            const lockedOrder = await tx.purchaseOrder.findFirst({ where: { id: item.purchaseOrderId, companyId } });
            if (!lockedOrder) throw new Error('Purchase order not found');
            if (lockedOrder.status !== 'DRAFT') throw new Error('Can only remove items from draft orders');

            await tx.purchaseOrderItem.delete({
                where: { id: itemId }
            });

            // Recalculate total
            const items = await tx.purchaseOrderItem.findMany({
                where: { purchaseOrderId: item.purchaseOrderId }
            });

            const newTotal = this.roundMoney(items.reduce((sum, i) => sum + Number(i.subtotal), 0));

            await tx.purchaseOrder.update({
                where: { id: item.purchaseOrderId },
                data: {
                    // CASH settles on receipt; a draft line change owes nothing yet.
                    total: newTotal
                }
            });

            return { success: true };
        });
    }

    static async addPayment(purchaseOrderId: number, companyId: number, data: {
        amount: number;
        date?: string;
        bank?: string;
        referenceNumber?: string;
        observations?: string;
    }) {
        if (!Number.isFinite(data.amount)) {
            throw new Error('El monto del pago debe ser finito');
        }
        const paymentAmount = this.roundMoney(data.amount);
        if (paymentAmount <= 0) throw new Error('El monto mínimo del pago es 0.01');
        const paymentDate = data.date ? new Date(data.date) : new Date();
        if (Number.isNaN(paymentDate.getTime())) {
            throw new Error('La fecha del pago no es válida');
        }
        const order = await prisma.purchaseOrder.findFirst({
            where: { id: purchaseOrderId, companyId }
        });

        if (!order) throw new Error('Orden de compra no encontrada');
        if (order.invoiceType !== 'CREDIT') throw new Error('Solo se pueden registrar pagos en facturas a crédito');
        if (order.status !== 'RECEIVED' && order.status !== 'PARTIALLY_RECEIVED') {
            throw new Error('Solo se pueden registrar pagos en órdenes recibidas o parcialmente recibidas');
        }

        // The payable is what has been received, not what was ordered.
        const currentPaid = this.roundMoney(Number(order.paidAmount) + paymentAmount);
        const orderTotal = this.payableAmount(order);

        if (currentPaid > orderTotal) {
            throw new Error(`El monto excede el saldo pendiente de lo recibido. Saldo: ${(orderTotal - Number(order.paidAmount)).toFixed(2)}`);
        }

        const paymentStatus = currentPaid >= orderTotal ? 'PAID' : 'PARTIAL';

        return await prisma.$transaction(async (tx: Tx) => {
            const payment = await tx.purchaseOrderPayment.create({
                data: {
                    purchaseOrderId,
                    amount: paymentAmount,
                    date: paymentDate,
                    bank: data.bank,
                    referenceNumber: data.referenceNumber,
                    observations: data.observations
                }
            });

            const claimed = await tx.purchaseOrder.updateMany({
                where: {
                    id: purchaseOrderId,
                    companyId,
                    invoiceType: 'CREDIT',
                    status: order.status,
                    paidAmount: order.paidAmount
                },
                data: {
                    paidAmount: currentPaid,
                    paymentStatus
                }
            });
            if (claimed.count !== 1) {
                throw new Error('La orden cambió durante el pago; vuelva a consultar el saldo e intente de nuevo');
            }

            return payment;
        });
    }

    /**
     * Reverse every receipt of a received or partially received order (and
     * cancel it) only while all of the receipts' original FIFO layers remain.
     * Each receipt is reversed against its own reference (PO-{id}-R{n}, or the
     * legacy PO-{id} of single-shot receipts) and warehouse, at the cost of the
     * consumed layers, so quantity and value come back out exactly.
     */
    static async reverseReceipt(
        id: number,
        companyId: number,
        userId: number,
        reversalReason: string
    ) {
        const reason = reversalReason.trim();
        if (!reason) throw new Error('El motivo del reverso de recepción es requerido');

        const result = await transactionWithLockRetry(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.purchaseOrder.findFirst({
                where: { id, companyId },
                include: { items: true }
            });
            if (!order) throw new Error('Orden de compra no encontrada');
            const actor = await tx.user.findFirst({
                where: { id: userId, OR: [{ companyId }, { companyId: null }] },
                select: { id: true }
            });
            if (!actor) throw new Error('Usuario no autorizado para esta empresa');
            if (order.status !== 'RECEIVED' && order.status !== 'PARTIALLY_RECEIVED') {
                throw new Error('Solo se puede revertir la recepción de una orden recibida o parcialmente recibida');
            }

            const activePayments = await tx.purchaseOrderPayment.count({
                where: { purchaseOrderId: id, status: 'ACTIVE' }
            });
            if (activePayments > 0) {
                throw new Error('Revierta primero todos los abonos activos de esta orden');
            }

            const legacyReference = `PO-${id}`;
            // Only the layers opened by the receipts themselves. Sale/consumption
            // reversals recreate the consumed portions with the same PURCHASE
            // sourceRef (exact FIFO lineage) but under a REVERSAL movement;
            // counting their originalQty again would overstate the receipt.
            // `PO-{id}-R` cannot match another order (PO-{id}0-R... differs).
            const receiptBatches = await tx.inventoryBatch.findMany({
                where: {
                    companyId,
                    sourceType: 'PURCHASE',
                    AND: [
                        {
                            OR: [
                                { sourceRef: legacyReference },
                                { sourceRef: { startsWith: `${legacyReference}-R` } },
                            ],
                        },
                        {
                            OR: [
                                { sourceMovementId: null },
                                { sourceMovement: { origin: null } },
                                { sourceMovement: { origin: { not: 'REVERSAL' } } },
                            ],
                        },
                    ],
                },
                select: { warehouseId: true, productId: true, originalQty: true, remainingQty: true, sourceRef: true }
            });
            // The receipt IN movements carry the full received quantity. When a
            // receipt landed on negative stock the engine covered the shortfall
            // first and opened a layer only for the rest (stock -20, receive 100
            // -> layer 80), so layers alone understate what must come back out.
            const receiptMovements = await tx.inventoryMovement.findMany({
                where: {
                    companyId,
                    type: 'IN',
                    AND: [
                        {
                            OR: [
                                { reference: legacyReference },
                                { reference: { startsWith: `${legacyReference}-R` } },
                            ],
                        },
                        { OR: [{ origin: null }, { origin: { not: 'REVERSAL' } }] },
                    ],
                },
                select: { id: true, warehouseId: true, productId: true, quantity: true, unitCost: true, totalCost: true, reference: true }
            });
            if (receiptBatches.length === 0 && receiptMovements.length === 0) {
                throw new Error('No se encontraron las capas originales de la recepción');
            }

            // One exact reversal per (receipt reference, warehouse, product):
            // `layerQuantity` comes back out of the receipt's own layers and the
            // trimmed remainder (`quantity - layerQuantity`) restores the
            // original negative balance at the receipt's unit cost.
            type ReversalGroup = {
                sourceRef: string;
                warehouseId: number;
                productId: number;
                quantity: number;
                layerQuantity: number;
                /** Still in the receipt's own layers (friendly pre-check only). */
                remainingLayerQuantity: number;
                movementValue: number;
                hasMovement: boolean;
                movementIds: number[];
            };
            const groups = new Map<string, ReversalGroup>();
            const groupFor = (sourceRef: string, warehouseId: number, productId: number) => {
                const key = `${sourceRef}|${warehouseId}|${productId}`;
                let group = groups.get(key);
                if (!group) {
                    group = {
                        sourceRef, warehouseId, productId, quantity: 0, layerQuantity: 0,
                        remainingLayerQuantity: 0, movementValue: 0, hasMovement: false, movementIds: []
                    };
                    groups.set(key, group);
                }
                return group;
            };
            for (const batch of receiptBatches) {
                const group = groupFor(batch.sourceRef || legacyReference, batch.warehouseId, batch.productId);
                group.layerQuantity += Number(batch.originalQty);
                group.remainingLayerQuantity += Number(batch.remainingQty ?? batch.originalQty);
            }
            for (const movement of receiptMovements) {
                const group = groupFor(movement.reference || legacyReference, movement.warehouseId, movement.productId);
                const quantity = Number(movement.quantity);
                group.hasMovement = true;
                group.movementIds.push(movement.id);
                group.quantity += quantity;
                group.movementValue += movement.totalCost != null
                    ? Number(movement.totalCost)
                    : quantity * Number(movement.unitCost ?? 0);
            }
            for (const group of groups.values()) {
                // Legacy layers without a traceable movement: reverse the layers.
                if (!group.hasMovement) group.quantity = group.layerQuantity;
            }
            const sortedGroups = [...groups.values()].sort((a, b) =>
                a.warehouseId - b.warehouseId
                || a.productId - b.productId
                || a.sourceRef.localeCompare(b.sourceRef)
            );
            const warehouseIds = [...new Set(sortedGroups.map((group) => group.warehouseId))];
            const productIds = [...new Set(sortedGroups.map((group) => group.productId))];

            const { InventoryEngineService } = await import('./inventory-engine.service');
            const { CostingService } = await import('./costing.service');
            // Canonical lock order: Warehouse -> Products (ascending) -> Stock.
            await InventoryEngineService.lockInventoryScope(tx, companyId, warehouseIds, productIds);
            const productNames = new Map<number, string>();
            const productNameFor = async (productId: number) => {
                let productName = productNames.get(productId);
                if (productName === undefined) {
                    const product = await tx.product.findFirst({
                        where: { id: productId, companyId },
                        select: { name: true }
                    });
                    if (!product) throw new Error(`Producto ${productId} no encontrado`);
                    productName = product.name;
                    productNames.set(productId, productName);
                }
                return productName;
            };
            // Pass 1: every exact layer leg. A shortfall leg may consume ANY
            // remaining layer, so running it before another receipt's exact leg
            // (R1 exact, R1 shortfall, R2 exact) would eat R2's own layer.
            const consumedError = (group: ReversalGroup, productName: string, detail: string) => new Error(
                `No se puede revertir la recepción ${group.sourceRef} de "${productName}": ` +
                'parte de lo recibido ya fue consumido, vendido o transferido. ' +
                `Registre un ajuste o devolución manual. (${detail})`
            );
            for (const group of sortedGroups) {
                const productName = await productNameFor(group.productId);
                const layerQuantity = this.round6(Math.min(group.layerQuantity, group.quantity));
                // Friendly pre-check (the engine's locked checks stay the backstop).
                if (layerQuantity > 0 && this.round6(group.remainingLayerQuantity) < layerQuantity) {
                    throw consumedError(
                        group, productName,
                        `Requerido: ${layerQuantity}, Disponible en lote: ${this.round6(group.remainingLayerQuantity)}`
                    );
                }
                try {
                    if (layerQuantity > 0) {
                        await InventoryEngineService.applyMovement(tx, {
                            type: 'OUT',
                            companyId,
                            warehouseId: group.warehouseId,
                            productId: group.productId,
                            userId,
                            quantity: layerQuantity,
                            reason: `Reverso de recepción OC #${id}: ${reason}`,
                            reference: group.sourceRef,
                            consumeSourceRef: group.sourceRef,
                            valueFromConsumedLayers: true,
                            origin: 'REVERSAL',
                            productName
                        });
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (/reversa exacta|Stock insuficiente/i.test(message)) {
                        throw consumedError(group, productName, message);
                    }
                    throw error;
                }
            }
            // Pass 2: the trimmed part of each receipt, which covered units
            // already sold while stock was negative. Units still backed by
            // other layers (e.g. a later order) are taken from them at the
            // receipt's unit cost plus a coverage true-up for the layer cost
            // difference; only the rest re-creates the deficit at that cost.
            for (const group of sortedGroups) {
                const layerQuantity = this.round6(Math.min(group.layerQuantity, group.quantity));
                const shortfallQuantity = this.round6(group.quantity - layerQuantity);
                if (!(shortfallQuantity > 0)) continue;
                const receiptUnitCost = group.quantity > 0 ? group.movementValue / group.quantity : 0;
                await InventoryEngineService.reverseCoveredShortfall(tx, {
                    type: 'OUT',
                    companyId,
                    warehouseId: group.warehouseId,
                    productId: group.productId,
                    userId,
                    quantity: shortfallQuantity,
                    unitCost: receiptUnitCost,
                    reason: `Reverso de recepción OC #${id} (faltante cubierto): ${reason}`,
                    reference: group.sourceRef,
                    origin: 'REVERSAL',
                    coveringMovementIds: group.movementIds,
                    productName: await productNameFor(group.productId)
                });
            }

            await CostingService.reversePurchaseCost(
                tx,
                order.items.map((item) => item.id),
                companyId
            );
            await tx.purchaseOrderItem.updateMany({
                where: { purchaseOrderId: id },
                data: { receivedQuantity: 0 }
            });
            await tx.purchaseOrderReceipt.updateMany({
                where: { purchaseOrderId: id, reversedAt: null },
                data: { reversedAt: new Date() }
            });
            const updated = await tx.purchaseOrder.update({
                where: { id },
                data: { status: 'CANCELLED', paidAmount: 0, paymentStatus: 'PENDING', receivedTotal: 0 }
            });
            const result = { updated, warehouseIds, products: productIds.length };
            await AuditLogService.log({
                companyId,
                userId,
                entityType: 'PurchaseOrder',
                entityId: id,
                action: 'REVERSE_RECEIPT',
                details: {
                    reason,
                    previousStatus: order.status,
                    warehouseIds,
                    products: result.products,
                    receipts: [...new Set(sortedGroups.map((group) => group.sourceRef))]
                }
            }, tx);
            return result;
        });

        return result.updated;
    }

    static async getPayments(purchaseOrderId: number, companyId: number) {
        const order = await prisma.purchaseOrder.findFirst({
            where: { id: purchaseOrderId, companyId },
            select: { id: true }
        });
        if (!order) throw new Error('Orden de compra no encontrada');

        return await prisma.purchaseOrderPayment.findMany({
            where: { purchaseOrderId },
            include: { reversedBy: { select: { id: true, name: true } } },
            orderBy: { date: 'desc' }
        });
    }

    /** Reverse a payment without deleting its immutable ledger row. */
    static async reversePayment(
        purchaseOrderId: number,
        paymentId: number,
        companyId: number,
        userId: number,
        reversalReason: string
    ) {
        const reason = reversalReason.trim();
        if (!reason) throw new Error('El motivo del reverso es requerido');

        const result = await prisma.$transaction(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${purchaseOrderId} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.purchaseOrder.findFirst({
                where: { id: purchaseOrderId, companyId },
                select: { id: true, invoiceType: true, status: true, total: true, receivedTotal: true }
            });
            if (!order) throw new Error('Orden de compra no encontrada');
            const actor = await tx.user.findFirst({
                where: { id: userId, OR: [{ companyId }, { companyId: null }] },
                select: { id: true }
            });
            if (!actor) throw new Error('Usuario no autorizado para esta empresa');
            if (order.invoiceType !== 'CREDIT' || (order.status !== 'RECEIVED' && order.status !== 'PARTIALLY_RECEIVED')) {
                throw new Error('Solo se pueden revertir pagos de órdenes de crédito recibidas');
            }

            const payment = await tx.purchaseOrderPayment.findFirst({
                where: { id: paymentId, purchaseOrderId },
                select: { id: true, status: true, amount: true }
            });
            if (!payment) throw new Error('Pago de orden de compra no encontrado');
            if (payment.status === 'REVERSED') throw new Error('El pago ya fue revertido');

            const reversed = await tx.purchaseOrderPayment.update({
                where: { id: paymentId },
                data: {
                    status: 'REVERSED',
                    reversedAt: new Date(),
                    reversedById: userId,
                    reversalReason: reason
                }
            });

            const active = await tx.purchaseOrderPayment.aggregate({
                where: { purchaseOrderId, status: 'ACTIVE' },
                _sum: { amount: true }
            });
            const paidAmount = this.roundMoney(Number(active._sum.amount ?? 0));
            const total = this.payableAmount(order);
            const paymentStatus = paidAmount <= 0
                ? 'PENDING'
                : paidAmount >= total
                    ? 'PAID'
                    : 'PARTIAL';

            await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: { paidAmount, paymentStatus }
            });

            const result = { reversed, paidAmount, paymentStatus };
            await AuditLogService.log({
                companyId,
                userId,
                entityType: 'PurchaseOrderPayment',
                entityId: paymentId,
                action: 'REVERSE',
                details: { purchaseOrderId, amount: result.reversed.amount, reason }
            }, tx);
            return result;
        });

        return result;
    }
}
