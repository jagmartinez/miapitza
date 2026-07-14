import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { AuditLogService } from './audit-log.service';

type Tx = Prisma.TransactionClient;

export class PurchaseOrderService {
    private static roundMoney(value: number): number {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    static async getAll(companyId: number, filters?: {
        branchId?: number;
        supplierId?: number;
        status?: 'DRAFT' | 'ISSUED' | 'RECEIVED' | 'CANCELLED';
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
                    paymentStatus: invoiceType === 'CASH' ? 'PAID' : 'PENDING',
                    // A8: a CASH purchase is settled immediately; keep paidAmount in
                    // sync with the total so PAID never coexists with paidAmount = 0.
                    paidAmount: invoiceType === 'CASH' ? total : 0,
                    companyId,
                    total,
                    status: 'DRAFT'
                }
            });

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

    static async update(id: number, companyId: number, data: {
        supplierId?: number;
        notes?: string;
        invoiceNumber?: string;
        invoicePdf?: string;
        invoiceDate?: string;
        invoiceType?: 'CASH' | 'CREDIT';
        paymentDueDate?: string;
        bank?: string;
        transferNumber?: string;
        status?: 'DRAFT' | 'ISSUED' | 'RECEIVED' | 'CANCELLED';
    }) {
        // Receiving must go through the receive() flow so stock movements and costs
        // are generated. Block marking RECEIVED via a plain edit.
        if (data.status === 'RECEIVED') {
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

        return await prisma.$transaction(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const existing = await tx.purchaseOrder.findFirst({ where: { id, companyId } });
            if (!existing) throw new Error('Purchase order not found');
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
            if (data.invoiceType === 'CASH') {
                updateData.paymentStatus = 'PAID';
                updateData.paidAmount = existing.total;
            } else if (data.invoiceType === 'CREDIT' && existing.invoiceType === 'CASH') {
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
    }

    static async delete(id: number, companyId: number) {
        return await prisma.$transaction(async (tx: Tx) => {
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.purchaseOrder.findFirst({ where: { id, companyId } });
            if (!order) throw new Error('Purchase order not found');
            if (order.status !== 'DRAFT') throw new Error('Can only delete draft purchase orders');

            // Delete items first
            await tx.purchaseOrderItem.deleteMany({
                where: { purchaseOrderId: id }
            });

            // Delete order
            return await tx.purchaseOrder.delete({
                where: { id }
            });
        });
    }

    // Receive purchase order (update inventory)
    static async receive(id: number, companyId: number, userId: number, warehouseId: number) {
        const order = await prisma.purchaseOrder.findFirst({
            where: { id, companyId },
            include: {
                items: true,
                branch: { select: { id: true } }
            }
        });

        if (!order) {
            throw new Error('Purchase order not found');

        }

        // Validate warehouse belongs to the PO's branch
        const warehouse = await prisma.warehouse.findFirst({
            where: { id: warehouseId, companyId }
        });
        if (!warehouse) {
            throw new Error('Almacén no encontrado');
        }
        if (order.branchId && warehouse.branchId && warehouse.branchId !== order.branchId) {
            throw new Error('El almacén no pertenece a la sucursal de la orden de compra');
        }

        if (order.status === 'RECEIVED') {
            throw new Error('Purchase order already received');
        }

        if (order.status === 'CANCELLED') {
            throw new Error('Cannot receive cancelled purchase order');
        }

        if (order.status === 'DRAFT') {
            throw new Error('Cannot receive a draft purchase order. It must be issued first.');
        }

        return await prisma.$transaction(async (tx: Tx) => {
            // Serialize receipt attempts. Without locking the order row, two workers
            // can both observe ISSUED and duplicate stock, FIFO layers and costing.
            await tx.$queryRaw`SELECT id FROM \`PurchaseOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const lockedOrder = await tx.purchaseOrder.findFirst({
                where: { id, companyId },
                include: { items: true }
            });
            if (!lockedOrder) throw new Error('Purchase order not found');
            if (lockedOrder.status === 'RECEIVED') throw new Error('Purchase order already received');
            if (lockedOrder.status === 'CANCELLED') throw new Error('Cannot receive cancelled purchase order');
            if (lockedOrder.status !== 'ISSUED') {
                throw new Error('Cannot receive a draft purchase order. It must be issued first.');
            }

            // The warehouse scope is mutable while it has no history. Revalidate
            // it under lock in the same transaction that posts the receipt so a
            // concurrent branch reassignment cannot redirect an issued PO.
            await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${warehouseId} AND companyId = ${companyId} FOR UPDATE`;
            const lockedWarehouse = await tx.warehouse.findFirst({
                where: { id: warehouseId, companyId },
                select: { branchId: true }
            });
            if (!lockedWarehouse) throw new Error('Almacén no encontrado');
            if (lockedOrder.branchId && lockedWarehouse.branchId && lockedWarehouse.branchId !== lockedOrder.branchId) {
                throw new Error('El almacén no pertenece a la sucursal de la orden de compra');
            }

            // Import CostingService / engine dynamically to avoid circular deps.
            const { CostingService } = await import('./costing.service');
            const { InventoryEngineService } = await import('./inventory-engine.service');

            // Update each product's stock and cost (using base-unit quantities)
            const orderedItems = [...lockedOrder.items].sort((a, b) => a.productId - b.productId);
            for (const item of orderedItems) {
                // Resolve the base-unit quantity/cost. Prefer the stored converted
                // values; check `!= null` (not truthiness) so a legitimate 0 is kept
                // instead of falling back to the raw figures.
                let conversionFactor: number | null =
                    item.conversionFactor != null ? Number(item.conversionFactor) : null;
                let baseQuantity: number | null =
                    item.baseQuantity != null ? Number(item.baseQuantity) : null;
                let baseCost: number | null =
                    item.baseCost != null ? Number(item.baseCost) : null;

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
                    baseCost = conv.baseCost;
                    await tx.purchaseOrderItem.update({
                        where: { id: item.id },
                        data: {
                            purchaseUnit: conv.originalUnit,
                            conversionFactor,
                            baseQuantity,
                            baseCost
                        }
                    });
                }

                const stockQty = baseQuantity != null ? baseQuantity : Number(item.quantity);
                const costPerBase = baseCost != null ? baseCost : Number(item.cost);

                // Serialize company-wide cost updates for this product even when
                // simultaneous receipts target different warehouses.
                await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${item.productId} AND companyId = ${companyId} FOR UPDATE`;

                // C1: capture the pre-receipt GLOBAL stock (sum across ALL of the
                // company's warehouses for this product) BEFORE the engine mutates
                // the receiving warehouse's stock. The weighted-average cost and
                // ProductCostHistory must use this global figure.
                const globalAgg = await tx.stock.aggregate({
                    _sum: { quantity: true },
                    where: { productId: item.productId, companyId }
                });
                const globalStockBefore = Number(globalAgg._sum.quantity ?? 0);

                // IN through the engine: values the entry at costPerBase, opens a
                // PURCHASE FIFO layer, and (A6/D6) keeps the accumulated valued
                // balance (previous warehouse value + entry cost). The engine reads
                // currentAverageCost BEFORE updateProductCost folds in the new cost.
                await InventoryEngineService.applyMovement(tx, {
                    type: 'IN',
                    companyId,
                    warehouseId,
                    productId: item.productId,
                    userId,
                    quantity: stockQty,
                    unitCost: costPerBase,
                    originalQuantity: Number(item.quantity),
                    originalUnit: item.purchaseUnit || null,
                    conversionFactor: conversionFactor != null ? conversionFactor : null,
                    reason: 'Purchase order received',
                    reference: `PO-${lockedOrder.id}`,
                    sourceType: 'PURCHASE'
                });

                // Update product cost (global moving average) using base-unit values,
                // inside this transaction so cost writes commit/rollback atomically.
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
            }

            // Update order status. A8: if the order is CASH, settle paidAmount on
            // receipt so the total (which may have changed via addItem/removeItem
            // while DRAFT) and paidAmount stay consistent. No payment row is created
            // for CASH, mirroring create(), so this does not duplicate payments.
            return await tx.purchaseOrder.update({
                where: { id },
                data: {
                    status: 'RECEIVED',
                    ...(lockedOrder.invoiceType === 'CASH'
                        ? { paymentStatus: 'PAID', paidAmount: lockedOrder.total }
                        : {})
                },
                include: {
                    supplier: true,
                    branch: true,
                    items: {
                        include: {
                            product: true
                        }
                    }
                }
            });
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
                    total: newTotal,
                    ...(lockedOrder.invoiceType === 'CASH' ? { paidAmount: newTotal, paymentStatus: 'PAID' as const } : {})
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
                    total: newTotal,
                    ...(lockedOrder.invoiceType === 'CASH'
                        ? { paidAmount: newTotal, paymentStatus: 'PAID' as const }
                        : {})
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
        if (order.status !== 'RECEIVED') throw new Error('Solo se pueden registrar pagos en órdenes recibidas');

        const currentPaid = this.roundMoney(Number(order.paidAmount) + paymentAmount);
        const orderTotal = Number(order.total);

        if (currentPaid > orderTotal) {
            throw new Error(`El monto excede el saldo pendiente. Saldo: ${(orderTotal - Number(order.paidAmount)).toFixed(2)}`);
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
                    status: 'RECEIVED',
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

    /** Reverse a completed receipt only while all of its original FIFO layers remain. */
    static async reverseReceipt(
        id: number,
        companyId: number,
        userId: number,
        reversalReason: string
    ) {
        const reason = reversalReason.trim();
        if (!reason) throw new Error('El motivo del reverso de recepción es requerido');

        const result = await prisma.$transaction(async (tx: Tx) => {
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
            if (order.status !== 'RECEIVED') {
                throw new Error('Solo se puede revertir la recepción de una orden recibida');
            }

            const activePayments = await tx.purchaseOrderPayment.count({
                where: { purchaseOrderId: id, status: 'ACTIVE' }
            });
            if (activePayments > 0) {
                throw new Error('Revierta primero todos los abonos activos de esta orden');
            }

            const reference = `PO-${id}`;
            const receiptBatches = await tx.inventoryBatch.findMany({
                where: { companyId, sourceRef: reference, sourceType: 'PURCHASE' },
                select: { warehouseId: true, productId: true, originalQty: true }
            });
            if (receiptBatches.length === 0) {
                throw new Error('No se encontraron las capas originales de la recepción');
            }
            const warehouseIds = [...new Set(receiptBatches.map((batch) => batch.warehouseId))];
            if (warehouseIds.length !== 1) {
                throw new Error('La recepción histórica abarca varias bodegas y requiere revisión manual');
            }

            const quantityByProduct = new Map<number, number>();
            for (const batch of receiptBatches) {
                quantityByProduct.set(
                    batch.productId,
                    (quantityByProduct.get(batch.productId) || 0) + Number(batch.originalQty)
                );
            }

            const { InventoryEngineService } = await import('./inventory-engine.service');
            const { CostingService } = await import('./costing.service');
            for (const [productId, quantity] of [...quantityByProduct.entries()].sort((a, b) => a[0] - b[0])) {
                await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
                const product = await tx.product.findFirst({
                    where: { id: productId, companyId },
                    select: { name: true }
                });
                if (!product) throw new Error(`Producto ${productId} no encontrado`);
                await InventoryEngineService.applyMovement(tx, {
                    type: 'OUT',
                    companyId,
                    warehouseId: warehouseIds[0],
                    productId,
                    userId,
                    quantity,
                    reason: `Reverso de recepción OC #${id}: ${reason}`,
                    reference,
                    consumeSourceRef: reference,
                    valueFromConsumedLayers: true,
                    productName: product.name
                });
            }

            await CostingService.reversePurchaseCost(
                tx,
                order.items.map((item) => item.id),
                companyId
            );
            const updated = await tx.purchaseOrder.update({
                where: { id },
                data: { status: 'CANCELLED', paidAmount: 0, paymentStatus: 'PENDING' }
            });
            return { updated, warehouseId: warehouseIds[0], products: quantityByProduct.size };
        });

        AuditLogService.log({
            companyId,
            userId,
            entityType: 'PurchaseOrder',
            entityId: id,
            action: 'REVERSE_RECEIPT',
            details: { reason, warehouseId: result.warehouseId, products: result.products }
        }).catch((error) => console.error('[PurchaseOrderService] receipt reversal audit failed:', error));

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
                select: { id: true, invoiceType: true, status: true, total: true }
            });
            if (!order) throw new Error('Orden de compra no encontrada');
            const actor = await tx.user.findFirst({
                where: { id: userId, OR: [{ companyId }, { companyId: null }] },
                select: { id: true }
            });
            if (!actor) throw new Error('Usuario no autorizado para esta empresa');
            if (order.invoiceType !== 'CREDIT' || order.status !== 'RECEIVED') {
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
            const total = Number(order.total);
            const paymentStatus = paidAmount <= 0
                ? 'PENDING'
                : paidAmount >= total
                    ? 'PAID'
                    : 'PARTIAL';

            await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: { paidAmount, paymentStatus }
            });

            return { reversed, paidAmount, paymentStatus };
        });

        AuditLogService.log({
            companyId,
            userId,
            entityType: 'PurchaseOrderPayment',
            entityId: paymentId,
            action: 'REVERSE',
            details: { purchaseOrderId, amount: result.reversed.amount, reason }
        }).catch((error) => console.error('[PurchaseOrderService] payment reversal audit failed:', error));

        return result;
    }
}
