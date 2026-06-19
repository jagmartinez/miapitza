import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';

type Tx = Prisma.TransactionClient;

export class PurchaseOrderService {
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
     * its configured base unit. Returns null if neither exists (legacy behavior:
     * the raw quantity is treated as already being in base unit).
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
            include: { baseUnit: true }
        });
        if (product?.baseUnit?.abbreviation) {
            return product.baseUnit.abbreviation;
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
            where: { id: data.supplierId, companyId }
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
            where: { id: { in: productIds }, companyId },
            select: { id: true }
        });

        if (products.length !== productIds.length) {
            throw new Error('One or more products not found or unauthorized');
        }

        // Calculate total
        const total = data.items.reduce((sum, item) => {
            return sum + (item.quantity * item.cost);
        }, 0);

        return await prisma.$transaction(async (tx: Tx) => {
            // Create purchase order
            const order = await tx.purchaseOrder.create({
                data: {
                    branchId: data.branchId,
                    supplierId: data.supplierId,
                    notes: data.notes,
                    invoiceNumber: data.invoiceNumber,
                    invoicePdf: data.invoicePdf,
                    invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : null,
                    invoiceType: data.invoiceType || 'CASH',
                    paymentDueDate: data.paymentDueDate ? new Date(data.paymentDueDate) : null,
                    bank: data.bank,
                    transferNumber: data.transferNumber,
                    paymentStatus: data.invoiceType === 'CASH' ? 'PAID' : 'PENDING',
                    // A8: a CASH purchase is settled immediately; keep paidAmount in
                    // sync with the total so PAID never coexists with paidAmount = 0.
                    paidAmount: data.invoiceType === 'CASH' ? total : 0,
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
        // Verify PO belongs to this company
        const existing = await prisma.purchaseOrder.findFirst({
            where: { id, companyId }
        });
        if (!existing) throw new Error('Purchase order not found');

        // Don't allow updating received or cancelled orders
        if (existing.status === 'RECEIVED' || existing.status === 'CANCELLED') {
            throw new Error(`Cannot update purchase order with status ${existing.status}`);
        }

        // Receiving must go through the receive() flow so stock movements and costs
        // are generated. Block marking RECEIVED via a plain edit.
        if (data.status === 'RECEIVED') {
            throw new Error('Para recibir una orden use la acción de recepción, no la edición');
        }

        // If reassigning the supplier, ensure it belongs to this company.
        if (data.supplierId !== undefined) {
            const supplier = await prisma.supplier.findFirst({
                where: { id: data.supplierId, companyId },
                select: { id: true }
            });
            if (!supplier) throw new Error('Proveedor no encontrado para esta empresa');
        }

        const updateData: Record<string, unknown> = { ...data };
        if (data.invoiceDate !== undefined) {
            updateData.invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : null;
        }
        if (data.paymentDueDate !== undefined) {
            updateData.paymentDueDate = data.paymentDueDate ? new Date(data.paymentDueDate) : null;
        }
        if (data.invoiceType === 'CASH') {
            updateData.paymentStatus = 'PAID';
        }

        return await prisma.purchaseOrder.update({
            where: { id },
            data: updateData,
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
    }

    static async delete(id: number, companyId: number) {
        // Only allow deletion of draft orders
        const order = await prisma.purchaseOrder.findFirst({
            where: { id, companyId }
        });

        if (!order) {
            throw new Error('Purchase order not found');
        }

        if (order.status !== 'DRAFT') {
            throw new Error('Can only delete draft purchase orders');
        }

        return await prisma.$transaction(async (tx: Tx) => {
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
            // Import CostingService / engine dynamically to avoid circular deps.
            const { CostingService } = await import('./costing.service');
            const { InventoryEngineService } = await import('./inventory-engine.service');

            // Update each product's stock and cost (using base-unit quantities)
            for (const item of order.items) {
                // Resolve the base-unit quantity/cost. Prefer the stored converted
                // values; check `!= null` (not truthiness) so a legitimate 0 is kept
                // instead of falling back to the raw figures.
                let conversionFactor: number | null =
                    item.conversionFactor != null ? Number(item.conversionFactor) : null;
                let baseQuantity: number | null =
                    item.baseQuantity != null ? Number(item.baseQuantity) : null;
                let baseCost: number | null =
                    item.baseCost != null ? Number(item.baseCost) : null;

                // Legacy items created before conversion ran: if no baseQuantity was
                // stored but a purchaseUnit exists, reconvert now so kg-vs-g style
                // purchases are not mis-costed by treating the raw quantity as base.
                if (baseQuantity == null && item.purchaseUnit) {
                    const conv = await UnitConversionService.convertWithCost(
                        item.productId, companyId, Number(item.quantity), item.purchaseUnit, Number(item.cost), tx
                    );
                    conversionFactor = conv.conversionFactor;
                    baseQuantity = conv.baseQuantity;
                    baseCost = conv.baseCost;
                }

                const stockQty = baseQuantity != null ? baseQuantity : Number(item.quantity);
                const costPerBase = baseCost != null ? baseCost : Number(item.cost);

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
                    reference: `PO-${order.id}`,
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
                    ...(order.invoiceType === 'CASH'
                        ? { paymentStatus: 'PAID', paidAmount: order.total }
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
            where: { id: data.productId, companyId },
            select: { id: true }
        });
        if (!product) throw new Error('Producto no encontrado para esta empresa');

        return await prisma.$transaction(async (tx: Tx) => {
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

            const newTotal = items.reduce((sum, i) => sum + Number(i.subtotal), 0);

            await tx.purchaseOrder.update({
                where: { id: orderId },
                data: { total: newTotal }
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
            await tx.purchaseOrderItem.delete({
                where: { id: itemId }
            });

            // Recalculate total
            const items = await tx.purchaseOrderItem.findMany({
                where: { purchaseOrderId: item.purchaseOrderId }
            });

            const newTotal = items.reduce((sum, i) => sum + Number(i.subtotal), 0);

            await tx.purchaseOrder.update({
                where: { id: item.purchaseOrderId },
                data: { total: newTotal }
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
        const order = await prisma.purchaseOrder.findFirst({
            where: { id: purchaseOrderId, companyId }
        });

        if (!order) throw new Error('Orden de compra no encontrada');
        if (order.invoiceType !== 'CREDIT') throw new Error('Solo se pueden registrar pagos en facturas a crédito');

        const currentPaid = Number(order.paidAmount) + data.amount;
        const orderTotal = Number(order.total);

        if (currentPaid > orderTotal) {
            throw new Error(`El monto excede el saldo pendiente. Saldo: C$ ${(orderTotal - Number(order.paidAmount)).toFixed(2)}`);
        }

        const paymentStatus = currentPaid >= orderTotal ? 'PAID' : 'PARTIAL';

        return await prisma.$transaction(async (tx: Tx) => {
            const payment = await tx.purchaseOrderPayment.create({
                data: {
                    purchaseOrderId,
                    amount: data.amount,
                    date: data.date ? new Date(data.date) : new Date(),
                    bank: data.bank,
                    referenceNumber: data.referenceNumber,
                    observations: data.observations
                }
            });

            await tx.purchaseOrder.update({
                where: { id: purchaseOrderId },
                data: {
                    paidAmount: currentPaid,
                    paymentStatus
                }
            });

            return payment;
        });
    }

    static async getPayments(purchaseOrderId: number, companyId: number) {
        const order = await prisma.purchaseOrder.findFirst({
            where: { id: purchaseOrderId, companyId },
            select: { id: true }
        });
        if (!order) throw new Error('Orden de compra no encontrada');

        return await prisma.purchaseOrderPayment.findMany({
            where: { purchaseOrderId },
            orderBy: { date: 'desc' }
        });
    }
}
