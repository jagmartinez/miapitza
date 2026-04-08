import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

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
        items: Array<{
            productId: number;
            quantity: number;
            cost: number;
        }>;
    }) {
        // Verify branch
        const branch = await prisma.branch.findUnique({
            where: { id: data.branchId, companyId }
        });

        if (!branch) {
            throw new Error('Branch not found or unauthorized');
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
                    companyId,
                    total,
                    status: 'DRAFT'
                }
            });

            // Create order items
            for (const item of data.items) {
                await tx.purchaseOrderItem.create({
                    data: {
                        purchaseOrderId: order.id,
                        productId: item.productId,
                        quantity: item.quantity,
                        cost: item.cost,
                        subtotal: item.quantity * item.cost
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

        return await prisma.purchaseOrder.update({
            where: { id },
            data,
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

            // Update each product's stock and cost
            for (const item of order.items) {
                // Get or create stock record
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

                // Update stock
                await tx.stock.update({
                    where: {
                        warehouseId_productId: {
                            warehouseId,
                            productId: item.productId
                        }
                    },
                    data: {
                        quantity: Number(stock.quantity) + Number(item.quantity)
                    }
                });

                // Calculate cost data for the movement
                const unitCost = Number(item.cost || 0);
                const movementTotalCost = unitCost * Number(item.quantity);
                const newBalanceQty = Number(stock.quantity) + Number(item.quantity);
                const newBalanceCost = newBalanceQty * unitCost;

                // Create inventory movement
                await tx.inventoryMovement.create({
                    data: {
                        warehouseId,
                        productId: item.productId,
                        userId,
                        companyId,
                        type: 'IN',
                        quantity: Number(item.quantity),
                        unitCost,
                        totalCost: movementTotalCost,
                        balanceQty: newBalanceQty,
                        balanceCost: newBalanceCost,
                        reason: 'Purchase order received',
                        reference: `PO-${order.id}`
                    }
                });

                // Update product cost automatically
                await CostingService.updateProductCost(
                    item.productId,
                    companyId,
                    item.id,
                    Number(item.quantity),
                    Number(item.cost),
                    warehouseId
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

        return await prisma.$transaction(async (tx: Tx) => {
            const item = await tx.purchaseOrderItem.create({
                data: {
                    purchaseOrderId: orderId,
                    productId: data.productId,
                    quantity: data.quantity,
                    cost: data.cost,
                    subtotal: data.quantity * data.cost
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
}
