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
        // Verify branch
        const branch = await prisma.branch.findUnique({
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
            // Import CostingService dynamically to avoid circular dependencies
            const { CostingService } = await import('./costing.service');

            // Update each product's stock and cost (using base-unit quantities)
            for (const item of order.items) {
                // Use converted base quantities if available, otherwise original
                const stockQty = item.baseQuantity ? Number(item.baseQuantity) : Number(item.quantity);
                const costPerBase = item.baseCost ? Number(item.baseCost) : Number(item.cost);

                let stock = await tx.stock.findUnique({
                    where: {
                        warehouseId_productId: {
                            warehouseId,
                            productId: item.productId
                        }
                    }
                });

                if (!stock) {
                    stock = await tx.stock.create({
                        data: {
                            warehouseId,
                            productId: item.productId,
                            companyId,
                            quantity: 0
                        }
                    });
                }

                // Capture the pre-receipt stock for this warehouse BEFORE mutating it,
                // so the weighted-average cost calculation is deterministic.
                const previousStock = Number(stock.quantity);
                const newBalanceQty = previousStock + stockQty;

                await tx.stock.update({
                    where: {
                        warehouseId_productId: {
                            warehouseId,
                            productId: item.productId
                        }
                    },
                    data: { quantity: newBalanceQty }
                });

                const movementTotalCost = costPerBase * stockQty;
                const newBalanceCost = newBalanceQty * costPerBase;

                await tx.inventoryMovement.create({
                    data: {
                        warehouseId,
                        productId: item.productId,
                        userId,
                        companyId,
                        type: 'IN',
                        quantity: stockQty,
                        originalQuantity: Number(item.quantity),
                        originalUnit: item.purchaseUnit || null,
                        conversionFactor: item.conversionFactor ? Number(item.conversionFactor) : null,
                        unitCost: costPerBase,
                        totalCost: movementTotalCost,
                        balanceQty: newBalanceQty,
                        balanceCost: newBalanceCost,
                        reason: 'Purchase order received',
                        reference: `PO-${order.id}`
                    }
                });

                // Update product cost using base-unit values, inside this transaction
                // so cost writes commit/rollback atomically with the stock changes.
                await CostingService.updateProductCost(
                    tx,
                    item.productId,
                    companyId,
                    item.id,
                    stockQty,
                    costPerBase,
                    warehouseId,
                    previousStock
                );
            }

            // Update order status
            return await tx.purchaseOrder.update({
                where: { id },
                data: { status: 'RECEIVED' },
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
