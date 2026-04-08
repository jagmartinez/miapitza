import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';

/** Valid state transitions for orders */
const VALID_TRANSITIONS: Record<string, string[]> = {
    'OPEN': ['SENT_TO_KITCHEN', 'CANCELLED'],
    'SENT_TO_KITCHEN': ['IN_PREPARATION', 'READY', 'CANCELLED'],
    'IN_PREPARATION': ['READY', 'CANCELLED'],
    'READY': ['DELIVERED', 'PAID', 'CANCELLED'],
    'DELIVERED': ['PAID', 'CANCELLED'],
    'PAID': [],      // terminal
    'CANCELLED': [], // terminal
};

export class OrderService {
    private static calculateFinalTotal(subtotal: number, discount: number, tax: number, tipAmount: number): number {
        const safeSubtotal = Math.max(0, Number(subtotal) || 0);
        const safeDiscount = Math.max(0, Number(discount) || 0);
        const safeTax = Math.max(0, Number(tax) || 0);
        const safeTip = Math.max(0, Number(tipAmount) || 0);
        const discountedSubtotal = Math.max(0, safeSubtotal - safeDiscount);
        return Math.round((discountedSubtotal + safeTax + safeTip) * 100) / 100;
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
        const hasSentItems = items.some(item => item.sentAt != null);
        const hasInProgressItem = items.some(item => item.status === 'IN_PROGRESS');
        const hasPendingKitchenItem = items.some(item => item.sentAt != null && item.status !== 'DONE');
        const hasReadyItems = items.length > 0 && items.every(item => item.status === 'DONE');

        if (hasReadyItems) return 'READY';
        if (hasInProgressItem) return 'IN_PREPARATION';
        if (hasPendingKitchenItem || hasSentItems) return 'SENT_TO_KITCHEN';
        return 'OPEN';
    }

    static async getAll(companyId: number, filters?: {
        branchId?: number;
        tableId?: number;
        status?: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'PAID' | 'CANCELLED';
        startDate?: Date;
        endDate?: Date;
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

        if (filters?.startDate || filters?.endDate) {
            where.createdAt = {};
            if (filters.startDate) {
                where.createdAt.gte = filters.startDate;
            }
            if (filters.endDate) {
                where.createdAt.lte = filters.endDate;
            }
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
            data: data.map((order) => this.withTimeline(order)),
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
                }
            }
        });

        if (!order) {
            throw new Error('Order not found');
        }

        return this.withTimeline(order);
    }

    static async create(companyId: number, data: {
        branchId: number;
        tableId?: number;
        userId: number;
        customerName?: string;
        items?: Array<{
            menuItemId: number;
            quantity: number;
            price: number;
            notes?: string;
        }>;
    }) {
        return await prisma.$transaction(async (tx) => {
            // Check for existing OPEN order for this table
            if (data.tableId) {
                const existingOrder = await tx.order.findFirst({
                    where: {
                        companyId,
                        tableId: data.tableId,
                        status: 'OPEN',
                        branchId: data.branchId
                    },
                    include: {
                        items: true
                    }
                });

                if (existingOrder) {
                    // Merge items into existing order
                    if (data.items && data.items.length > 0) {
                        let totalAmount = 0;

                        for (const item of data.items) {
                            const menuItem = await tx.menuItem.findFirst({
                                where: { id: item.menuItemId, companyId, active: true }
                            });
                            if (!menuItem) {
                                throw new Error('Elemento de menú no encontrado o inactivo');
                            }

                            const unitPrice = Number(menuItem.price);
                            const subtotal = unitPrice * item.quantity;
                            totalAmount += subtotal;

                            await tx.orderItem.create({
                                data: {
                                    orderId: existingOrder.id,
                                    menuItemId: item.menuItemId,
                                    quantity: item.quantity,
                                    price: unitPrice,
                                    subtotal: subtotal,
                                    notes: item.notes || ''
                                }
                            });
                        }

                        // Recompute final total from authoritative item subtotals + stored adjustments.
                        const newSubtotal = await this.getOrderItemsSubtotal(tx, existingOrder.id);
                        const newTotal = this.calculateFinalTotal(
                            newSubtotal,
                            Number(existingOrder.discount || 0),
                            Number(existingOrder.tax || 0),
                            Number(existingOrder.tipAmount || 0)
                        );
                        await tx.order.update({
                            where: { id: existingOrder.id },
                            data: { total: newTotal }
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
            }

            // Create new order if no existing one found
            const order = await tx.order.create({
                data: {
                    companyId,
                    branchId: data.branchId,
                    tableId: data.tableId,
                    userId: data.userId,
                    customerName: data.customerName,
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
                        where: { id: item.menuItemId, companyId, active: true }
                    });
                    if (!menuItem) {
                        throw new Error('Elemento de menú no encontrado o inactivo');
                    }

                    const unitPrice = Number(menuItem.price);
                    const subtotal = unitPrice * item.quantity;
                    totalAmount += subtotal;

                    await tx.orderItem.create({
                        data: {
                            orderId: order.id,
                            menuItemId: item.menuItemId,
                            quantity: item.quantity,
                            price: unitPrice,
                            subtotal: subtotal,
                            notes: item.notes || ''
                        }
                    });
                }

                // Update order total from subtotal + stored adjustments.
                const newTotal = this.calculateFinalTotal(
                    totalAmount,
                    Number(order.discount || 0),
                    Number(order.tax || 0),
                    Number(order.tipAmount || 0)
                );
                await tx.order.update({
                    where: { id: order.id },
                    data: { total: newTotal }
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
        if (!data.quantity || data.quantity <= 0) {
            throw new Error('Quantity must be a positive number');
        }

        const menuItem = await prisma.menuItem.findFirst({
            where: { id: data.menuItemId, companyId },
            include: {
                modifierGroups: {
                    include: { modifiers: { select: { id: true } } }
                }
            }
        });

        if (!menuItem) {
            throw new Error('Elemento de menú no encontrado');
        }

        if (!menuItem.active) {
            throw new Error('El elemento de menú no está activo');
        }

        // Fetch modifiers and calculate their total
        let modifiersData: { id: number; name: string; price: Prisma.Decimal | number }[] = [];
        let modifiersTotal = 0;

        if (data.modifierIds && data.modifierIds.length > 0) {
            // Validate modifiers belong to this menu item's modifier groups
            const validModifierIds = new Set(
                menuItem.modifierGroups.flatMap((g: { modifiers: { id: number }[] }) => g.modifiers.map(m => m.id))
            );
            const invalidIds = data.modifierIds.filter(id => !validModifierIds.has(id));
            if (invalidIds.length > 0) {
                throw new Error('Modificadores inválidos para este producto');
            }

            modifiersData = await prisma.modifier.findMany({
                where: {
                    id: { in: data.modifierIds },
                    active: true
                }
            });
            modifiersTotal = modifiersData.reduce((sum, mod) => sum + Number(mod.price), 0);
        }

        const itemPrice = Number(menuItem.price);
        const subtotal = (itemPrice + modifiersTotal) * data.quantity;

        // Move order status check INSIDE transaction to prevent TOCTOU race
        return await prisma.$transaction(async (tx) => {
            const order = await tx.order.findFirst({
                where: { id: orderId, companyId }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            if (order.status === 'PAID' || order.status === 'CANCELLED') {
                throw new Error('Cannot add items to paid or cancelled orders');
            }

            const item = await tx.orderItem.create({
                data: {
                    orderId,
                    menuItemId: data.menuItemId,
                    quantity: data.quantity,
                    price: itemPrice + modifiersTotal,
                    subtotal: subtotal,
                    notes: data.notes,
                    modifiers: {
                        create: modifiersData.map(mod => ({
                            modifierId: mod.id,
                            name: mod.name,
                            price: mod.price
                        }))
                    }
                },
                include: {
                    menuItem: true,
                    modifiers: true
                }
            });

            const newSubtotal = await this.getOrderItemsSubtotal(tx, orderId);
            const newTotal = this.calculateFinalTotal(
                newSubtotal,
                Number(order.discount || 0),
                Number(order.tax || 0),
                Number(order.tipAmount || 0)
            );

            await tx.order.update({
                where: { id: orderId },
                data: { total: newTotal }
            });

            return item;
        });
    }

    static async removeItem(itemId: number, companyId: number) {
        const item = await prisma.orderItem.findUnique({
            where: { id: itemId },
            include: { order: true }
        });

        if (!item || item.order.companyId !== companyId) {
            throw new Error('Item not found');
        }

        if (item.order.status === 'PAID' || item.order.status === 'CANCELLED') {
            throw new Error('Cannot remove items from paid or cancelled orders');
        }

        return await prisma.$transaction(async (tx) => {
            await tx.orderItem.delete({
                where: { id: itemId }
            });

            const newSubtotal = await this.getOrderItemsSubtotal(tx, item.orderId);
            const newTotal = this.calculateFinalTotal(
                newSubtotal,
                Number(item.order.discount || 0),
                Number(item.order.tax || 0),
                Number(item.order.tipAmount || 0)
            );

            await tx.order.update({
                where: { id: item.orderId },
                data: { total: newTotal }
            });

            return { success: true };
        });
    }

    static async updateStatus(
        id: number,
        companyId: number,
        status: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'PAID' | 'CANCELLED'
    ) {
        const updatedOrder = await prisma.$transaction(async (tx) => {
            // Lock order row to keep transition validation and update atomic.
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;

            const existing = await tx.order.findFirst({
                where: { id, companyId }
            });

            if (!existing) {
                throw new Error('Order not found');
            }

            const allowedTransitions = VALID_TRANSITIONS[existing.status] || [];
            if (!allowedTransitions.includes(status)) {
                throw new Error(
                    `Order status transition from '${existing.status}' to '${status}' is not allowed. ` +
                    `Valid transitions: ${allowedTransitions.join(', ') || 'none (terminal state)'}`
                );
            }

            return await tx.order.update({
                where: { id },
                data: { status },
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
        });

        return this.withTimeline(updatedOrder);
    }

    static async sendToKitchen(id: number, companyId: number) {
        const order = await prisma.order.findFirst({
            where: { id, companyId },
            include: { items: true }
        });

        if (!order) {
            throw new Error('Order not found');
        }

        if (order.status === 'PAID' || order.status === 'CANCELLED') {
            throw new Error(`Cannot send order to kitchen when status is ${order.status}`);
        }

        if (order.items.length === 0) {
            throw new Error('Cannot send empty order to kitchen');
        }

        const unsentItems = order.items.filter((item) => item.sentAt == null);

        if (unsentItems.length === 0) {
            throw new Error('No hay productos nuevos pendientes por enviar a cocina');
        }

        const now = new Date();

        return await prisma.$transaction(async (tx) => {
            await tx.order.update({
                where: { id },
                data: { status: 'SENT_TO_KITCHEN' }
            });

            // Mark only new items as sent to preserve kitchen history for previous sends.
            await tx.orderItem.updateMany({
                where: { orderId: id, sentAt: null },
                data: { sentAt: now }
            });

            return await tx.order.findUnique({
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
        });
    }

    static async startItem(orderId: number, itemId: number, companyId: number) {
        const order = await prisma.order.findFirst({ where: { id: orderId, companyId }, select: { status: true } });
        if (!order) throw new Error('Orden no encontrada');
        if (order.status === 'CANCELLED') throw new Error('No se puede actualizar items de una orden cancelada');

        const item = await prisma.orderItem.findFirst({
            where: { id: itemId, order: { id: orderId, companyId } }
        });
        if (!item) throw new Error('Item no encontrado');
        if (item.status !== 'PENDING') throw new Error('El item debe estar PENDIENTE para iniciar');

        return await prisma.$transaction(async (tx) => {
            const now = new Date();

            const updatedItem = await tx.orderItem.update({
                where: { id: itemId },
                data: { status: 'IN_PROGRESS', startedAt: now },
                include: { menuItem: true }
            });

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
    }

    static async finishItem(orderId: number, itemId: number, companyId: number) {
        const order = await prisma.order.findFirst({ where: { id: orderId, companyId }, select: { status: true } });
        if (!order) throw new Error('Orden no encontrada');
        if (order.status === 'CANCELLED') throw new Error('No se puede actualizar items de una orden cancelada');

        const item = await prisma.orderItem.findFirst({
            where: { id: itemId, order: { id: orderId, companyId } }
        });
        if (!item) throw new Error('Item no encontrado');
        if (item.status !== 'IN_PROGRESS') throw new Error('El item debe estar EN PROGRESO para finalizar');

        return await prisma.$transaction(async (tx) => {
            const updated = await tx.orderItem.update({
                where: { id: itemId },
                data: { status: 'DONE', finishedAt: new Date() },
                include: { menuItem: true }
            });

            // Check if all items in the order are DONE
            const pendingItems = await tx.orderItem.count({
                where: { orderId, status: { not: 'DONE' } }
            });

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

            let updatedOrder = await tx.order.findUnique({
                where: { id: orderId },
                include: orderInclude
            });

            if (pendingItems === 0) {
                updatedOrder = await tx.order.update({
                    where: { id: orderId },
                    data: { status: 'READY' },
                    include: orderInclude
                });
            }

            return { item: updated, allDone: pendingItems === 0, order: this.withTimeline(updatedOrder!) };
        });
    }

    static async complete(id: number, companyId: number, warehouseId: number) {
        const order = await prisma.order.findFirst({
            where: { id, companyId },
            include: {
                items: {
                    include: {
                        menuItem: {
                            include: {
                                recipes: {
                                    include: {
                                        product: true
                                    }
                                }
                            }
                        }
                    }
                },
                table: true
            }
        });

        if (!order) {
            throw new Error('Order not found');
        }

        if (order.status !== 'PAID') {
            throw new Error('Order must be paid before completing');
        }

        return await prisma.$transaction(async (tx) => {
            // Deduct inventory for each item
            for (const item of order.items) {
                for (const recipe of item.menuItem.recipes) {
                    const stock = await tx.stock.findUnique({
                        where: {
                            warehouseId_productId: {
                                warehouseId,
                                productId: recipe.productId
                            }
                        }
                    });

                    if (!stock) {
                        throw new Error(`Product ${recipe.product.name} not found in warehouse`);
                    }

                    // Calculate required quantity with unit conversion
                    let recipeQty = Number(recipe.quantity);
                    const recipeUnit = recipe.unit || recipe.product.unit; // Fallback to product unit
                    const stockUnit = recipe.product.unit;

                    if (recipeUnit && stockUnit && recipeUnit !== stockUnit) {
                        recipeQty = this.convertUnit(recipeQty, recipeUnit, stockUnit);
                    }

                    const requiredQty = recipeQty * item.quantity;
                    const newQty = Number(stock.quantity) - requiredQty;

                    if (newQty < 0) {
                        throw new Error(`Insufficient stock for ${recipe.product.name}. Required: ${requiredQty} ${stockUnit}, Available: ${stock.quantity} ${stockUnit}`);
                    }

                    // Update stock
                    await tx.stock.update({
                        where: {
                            warehouseId_productId: {
                                warehouseId,
                                productId: recipe.productId
                            }
                        },
                        data: {
                            quantity: newQty
                        }
                    });

                    // Calculate cost data for the movement
                    const productData = await tx.product.findUnique({ where: { id: recipe.productId } });
                    const unitCost = Number(productData?.cost || 0);
                    const totalCost = unitCost * requiredQty;
                    const newBalanceCost = newQty * unitCost;

                    // Create inventory movement
                    await tx.inventoryMovement.create({
                        data: {
                            companyId,
                            warehouseId,
                            productId: recipe.productId,
                            userId: order.userId,
                            type: 'OUT',
                            quantity: requiredQty,
                            unitCost,
                            totalCost,
                            balanceQty: newQty,
                            balanceCost: newBalanceCost,
                            reason: 'Order consumption',
                            reference: `ORD-${order.id}`
                        }
                    });
                }
            }

            // Update order status
            const updatedOrder = await tx.order.update({
                where: { id },
                data: { status: 'DELIVERED' }
            });

            // Free table if assigned
            if (order.tableId) {
                await tx.table.update({
                    where: { id: order.tableId },
                    data: { status: 'AVAILABLE' }
                });
            }

            return updatedOrder;
        });
    }

    static async cancel(id: number, companyId: number, cancelledById?: number, cancelReason?: string) {
        const order = await prisma.order.findFirst({
            where: { id, companyId },
            include: { table: true, payments: true }
        });

        if (!order) {
            throw new Error('Order not found');
        }

        if (order.status === 'PAID') {
            throw new Error('Cannot cancel paid orders');
        }

        if (order.status === 'CANCELLED') {
            throw new Error('Order is already cancelled');
        }

        // Check for existing partial payments — require refund first
        if (order.payments && order.payments.length > 0) {
            const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            if (totalPaid > 0) {
                throw new Error(`Order has existing payments totaling ${totalPaid.toFixed(2)}. Please refund/delete payments before cancelling.`);
            }
        }

        return await prisma.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    cancelledById: cancelledById || null,
                    cancelReason: cancelReason || null,
                    cancelledAt: new Date()
                }
            });

            if (order.tableId) {
                await tx.table.update({
                    where: { id: order.tableId },
                    data: { status: 'AVAILABLE' }
                });
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
                            tableId: order.tableId
                        }
                    }
                });
            }

            return updatedOrder;
        });
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
        return await prisma.$transaction(async (tx) => {
            const order = await tx.order.findFirst({
                where: { id, companyId },
                select: {
                    id: true,
                    status: true,
                    discount: true,
                    tax: true,
                    tipAmount: true
                }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            if (order.status === 'PAID' || order.status === 'CANCELLED') {
                throw new Error('Cannot modify pricing for paid or cancelled orders');
            }

            const subtotal = await this.getOrderItemsSubtotal(tx, id);
            const nextDiscount = Math.min(
                Math.max(0, Number(data.discount ?? Number(order.discount || 0))),
                Math.max(0, subtotal)
            );
            const discountedSubtotal = Math.max(0, subtotal - nextDiscount);
            const nextTax = Math.min(
                Math.max(0, Number(data.tax ?? Number(order.tax || 0))),
                discountedSubtotal
            );
            const nextTip = Math.max(0, Number(data.tipAmount ?? Number(order.tipAmount || 0)));
            const nextTotal = this.calculateFinalTotal(subtotal, nextDiscount, nextTax, nextTip);

            return await tx.order.update({
                where: { id },
                data: {
                    discount: nextDiscount,
                    discountCode: data.discountCode === undefined ? undefined : (data.discountCode || null),
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
                in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED']
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

    private static convertUnit(amount: number, fromUnit: string, toUnit: string): number {
        // Normalize units to lowercase
        const from = fromUnit.toLowerCase();
        const to = toUnit.toLowerCase();

        if (from === to) return amount;

        // Mass conversions
        const massUnits: Record<string, number> = {
            'kg': 1000,
            'g': 1,
            'mg': 0.001,
            'lb': 453.592,
            'oz': 28.3495
        };

        if (massUnits[from] && massUnits[to]) {
            // Convert to grams then to target unit
            const grams = amount * massUnits[from];
            return grams / massUnits[to];
        }

        // Volume conversions
        const volUnits: Record<string, number> = {
            'l': 1000,
            'ml': 1,
            'gal': 3785.41,
            'oz_fl': 29.5735
        };

        if (volUnits[from] && volUnits[to]) {
            // Convert to ml then to target unit
            const ml = amount * volUnits[from];
            return ml / volUnits[to];
        }

        // If incompatible, throw error or return original (assuming 1:1)
        // For safety, we'll throw an error to alert the user
        throw new Error(`Cannot convert from ${fromUnit} to ${toUnit}`);
    }
}
