import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';
import { PedidosYaService } from './pedidosya.service';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { DynamicPricingService } from './dynamic-pricing.service';

/** Valid state transitions for orders */
const VALID_TRANSITIONS: Record<string, string[]> = {
    'OPEN': ['SENT_TO_KITCHEN', 'CANCELLED'],
    'SENT_TO_KITCHEN': ['IN_PREPARATION', 'READY', 'CANCELLED'],
    'IN_PREPARATION': ['READY', 'CANCELLED'],
    // PAID is intentionally NOT reachable via manual updateStatus: it must only
    // be set by PaymentService once the order is fully paid (which also triggers
    // inventory consumption). Allowing 'PAID' here would skip cobro y descargue.
    'READY': ['DELIVERED', 'CANCELLED'],
    'DELIVERED': ['CANCELLED'],
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

    /**
     * Validate and materialize an item's selected modifiers, mirroring the
     * membership check used by `addItem`: every modifierId must belong to one of
     * the MenuItem's modifier groups. Returns the OrderItemModifier create rows
     * plus their combined extra price so the caller can fold it into the unit price.
     */
    private static async resolveItemModifiers(
        tx: Prisma.TransactionClient,
        menuItem: { modifierGroups: { modifiers: { id: number }[] }[] },
        modifierIds?: number[]
    ): Promise<{ create: { modifierId: number; name: string; price: Prisma.Decimal | number }[]; total: number }> {
        if (!modifierIds || modifierIds.length === 0) {
            return { create: [], total: 0 };
        }

        const validModifierIds = new Set(
            menuItem.modifierGroups.flatMap((g) => g.modifiers.map((m) => m.id))
        );
        const invalidIds = modifierIds.filter((id) => !validModifierIds.has(id));
        if (invalidIds.length > 0) {
            throw new Error('Modificadores inválidos para este producto');
        }

        const modifiers = await tx.modifier.findMany({
            where: { id: { in: modifierIds }, active: true }
        });
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
        items?: Array<{
            menuItemId: number;
            quantity: number;
            price: number;
            notes?: string;
            modifierIds?: number[];
        }>;
    }) {
        return await prisma.$transaction(async (tx) => {
            // The order's table (if any) must belong to the same company AND the
            // same branch as the order, so branch-scoped reporting/billing stays consistent.
            if (data.tableId) {
                const table = await tx.table.findFirst({
                    where: { id: data.tableId, companyId },
                    select: { id: true, branchId: true }
                });
                if (!table) {
                    throw new Error('Mesa no encontrada para esta empresa');
                }
                if (table.branchId !== data.branchId) {
                    throw new Error('La mesa pertenece a otra sucursal');
                }
            }

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
                        for (const item of data.items) {
                            const menuItem = await tx.menuItem.findFirst({
                                where: { id: item.menuItemId, companyId, active: true },
                                include: {
                                    modifierGroups: {
                                        include: { modifiers: { select: { id: true } } }
                                    }
                                }
                            });
                            if (!menuItem) {
                                throw new Error('Elemento de menú no encontrado o inactivo');
                            }

                            // Validate + price the selected modifiers (same rule as addItem).
                            const modifiers = await this.resolveItemModifiers(tx, menuItem, item.modifierIds);

                            // Resolve the branch-effective price (falls back to the
                            // base MenuItem price when no branch price is configured),
                            // then fold in the selected modifiers' extra price.
                            const basePrice = data.branchId
                                ? await DynamicPricingService.getPrice(item.menuItemId, data.branchId, companyId)
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
                        where: { id: item.menuItemId, companyId, active: true },
                        include: {
                            modifierGroups: {
                                include: { modifiers: { select: { id: true } } }
                            }
                        }
                    });
                    if (!menuItem) {
                        throw new Error('Elemento de menú no encontrado o inactivo');
                    }

                    // Validate + price the selected modifiers (same rule as addItem).
                    const modifiers = await this.resolveItemModifiers(tx, menuItem, item.modifierIds);

                    // Resolve the branch-effective price (falls back to the base
                    // MenuItem price when no branch price is configured), then fold
                    // in the selected modifiers' extra price.
                    const basePrice = data.branchId
                        ? await DynamicPricingService.getPrice(item.menuItemId, data.branchId, companyId)
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

            // Resolve the branch-effective price for the order's branch (falls
            // back to the base MenuItem price when no branch price is configured).
            const basePrice = order.branchId
                ? await DynamicPricingService.getPrice(data.menuItemId, order.branchId, companyId)
                : Number(menuItem.price);
            const unitPrice = basePrice + modifiersTotal;
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
        return await prisma.$transaction(async (tx) => {
            // Re-check ownership and status INSIDE the transaction to prevent a TOCTOU race.
            const item = await tx.orderItem.findUnique({
                where: { id: itemId },
                include: { order: true }
            });

            if (!item || item.order.companyId !== companyId) {
                throw new Error('Item not found');
            }

            if (item.order.status === 'PAID' || item.order.status === 'CANCELLED') {
                throw new Error('Cannot remove items from paid or cancelled orders');
            }

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

            // When the whole order is marked as READY (e.g. "Todo Listo" in KDS),
            // force every still-open item to DONE so the kitchen timeline (firstStartedAt / readyAt)
            // reflects the actual completion time instead of staying blank.
            if (status === 'READY') {
                const now = new Date();
                await tx.orderItem.updateMany({
                    where: { orderId: id, status: { not: 'DONE' } },
                    data: { status: 'DONE', finishedAt: now }
                });
                await tx.orderItem.updateMany({
                    where: { orderId: id, startedAt: null },
                    data: { startedAt: now }
                });
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

        if (updatedOrder.salesChannel === 'PEDIDOSYA') {
            PedidosYaService.syncOrderStatus(companyId, id, status).catch((err) => {
                console.error(`[OrderService] Failed to sync PedidosYa status for order ${id}:`, err);
            });
        }

        return this.withTimeline(updatedOrder);
    }

    static async sendToKitchen(id: number, companyId: number) {
        const now = new Date();

        return await prisma.$transaction(async (tx) => {
            // Re-check status INSIDE the transaction to prevent a TOCTOU race.
            const order = await tx.order.findFirst({
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
                                        product: true,
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

        if (!order) {
            throw new Error('Order not found');
        }

        if (order.status !== 'PAID') {
            throw new Error('Order must be paid before completing');
        }

        return await prisma.$transaction(async (tx) => {
            // Validate the target warehouse belongs to this tenant and branch
            // before touching stock (warehouseId comes from the request body).
            const warehouse = await tx.warehouse.findFirst({
                where: { id: warehouseId, companyId, branchId: order.branchId }
            });

            if (!warehouse) {
                throw new Error('Almacén no encontrado para esta empresa/sucursal');
            }

            // Deduct inventory through the shared, idempotent consumption service.
            // Skips automatically if the order was already consumed when it became PAID.
            await InventoryConsumptionService.consumeForOrder(tx, {
                order,
                warehouseId,
                userId: order.userId,
                companyId
            });

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

    static async cancel(
        id: number,
        companyId: number,
        cancelledById?: number,
        cancelReason?: string,
        // `allowPaidReversal` is reserved for channel integrations (e.g. PedidosYa)
        // that must honor an external cancellation even after the order was PAID.
        // It reverses any consumed inventory instead of rejecting the cancel.
        options?: { allowPaidReversal?: boolean }
    ) {
        return await prisma.$transaction(async (tx) => {
            // Serialize cancel with payment, delivery and another cancellation.
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.order.findFirst({
                where: { id, companyId },
                include: { table: true, payments: true }
            });

            if (!order) throw new Error('Order not found');
            if (order.status === 'CANCELLED') throw new Error('Order is already cancelled');

            const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const fullyPaid = order.payments.length > 0 && totalPaid + 0.01 >= Number(order.total);

            // Payment state is authoritative. A paid order may currently display
            // PAID or DELIVERED; both require an explicit financial reversal.
            if (fullyPaid && !options?.allowPaidReversal) {
                throw new Error('Cannot cancel paid orders');
            }
            if (!fullyPaid && totalPaid > 0) {
                throw new Error(`Order has existing payments totaling ${totalPaid.toFixed(2)}. Please refund/delete payments before cancelling.`);
            }

            const reversalUserId = cancelledById ?? order.userId;

            // Restore outstanding recipe consumption before changing the terminal
            // state. The operation is idempotent by ORD-{id} net movements.
            await InventoryConsumptionService.reverseForOrder(tx, {
                orderId: id,
                userId: reversalUserId,
                companyId
            });

            // Authoritative channel cancellations also reverse the local payment
            // ledger. This prevents cancelled delivery orders from remaining as
            // revenue/cash and mirrors PaymentService.delete semantics atomically.
            if (fullyPaid && options?.allowPaidReversal) {
                const paymentIds = order.payments.map((payment) => payment.id);
                if (paymentIds.length > 0) {
                    await tx.cashMovement.deleteMany({
                        where: { reference: { in: paymentIds.map((paymentId) => `PAY-${paymentId}`) } }
                    });
                    await tx.payment.deleteMany({ where: { id: { in: paymentIds }, orderId: id } });
                }

                if (order.discountCode) {
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
                    cancelledById: cancelledById || null,
                    cancelReason: cancelReason || null,
                    cancelledAt: new Date(),
                    closedAt: fullyPaid ? new Date() : order.closedAt
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
                            tableId: order.tableId,
                            reversedPayments: fullyPaid ? order.payments.length : 0,
                            reversedAmount: fullyPaid ? totalPaid : 0
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

}
