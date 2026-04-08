import prisma from '../utils/prisma';
import { OrderStatus } from '@prisma/client';

export class PaymentService {
    private static deriveOrderStatus(order: { items?: Array<{ sentAt?: Date | null; status?: string }> }): OrderStatus {
        const items = order.items || [];
        const hasSentItems = items.some((item) => item.sentAt != null);
        const hasInProgressItems = items.some((item) => item.status === 'IN_PROGRESS');
        const allDone = items.length > 0 && items.every((item) => item.status === 'DONE');

        if (allDone) return 'READY';
        if (hasInProgressItems) return 'IN_PREPARATION';
        if (hasSentItems) return 'SENT_TO_KITCHEN';
        return 'OPEN';
    }

    static async getByOrderId(orderId: number, companyId: number) {
        return await prisma.payment.findMany({
            where: { orderId, order: { companyId } },
            include: {
                paymentMethod: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: {
                id: 'asc'
            }
        });
    }

    static async create(companyId: number, data: {
        orderId: number;
        paymentMethodId: number;
        amount: number;
        reference?: string;
        payerName?: string;
    }, userId: number) {
        // Validate amount upfront
        if (!data.amount || data.amount <= 0) {
            throw new Error('Amount must be a positive number');
        }

        // Validate payment method before entering transaction
        const paymentMethod = await prisma.paymentMethod.findFirst({
            where: { id: data.paymentMethodId }
        });

        if (!paymentMethod || !paymentMethod.active) {
            throw new Error('Invalid or inactive payment method');
        }

        const isCash = paymentMethod.name.toUpperCase() === 'EFECTIVO' || paymentMethod.name.toUpperCase() === 'CASH';

        // ALL validation and writes inside a single transaction to prevent race conditions
        return await prisma.$transaction(async (tx) => {
            // Pessimistic lock: prevent concurrent payments on the same order
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${data.orderId} AND companyId = ${companyId} FOR UPDATE`;

            const order = await tx.order.findFirst({
                where: { id: data.orderId, companyId },
                include: { payments: true, items: { include: { menuItem: { include: { recipes: { include: { product: true } } } } } } }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            if (order.status === 'PAID') {
                throw new Error('Order already paid');
            }

            if (order.status === 'CANCELLED') {
                throw new Error('Cannot pay cancelled orders');
            }

            // Calculate total paid INSIDE the transaction
            const totalPaid = order.payments.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0);
            const remaining = Number(order.total) - totalPaid;

            if (data.amount > remaining + 0.01) { // Allow 1 cent tolerance for rounding
                throw new Error(`Amount exceeds remaining balance. Remaining: ${remaining.toFixed(2)}`);
            }

            const payment = await tx.payment.create({
                data: {
                    orderId: data.orderId,
                    paymentMethodId: data.paymentMethodId,
                    amount: data.amount,
                    reference: data.reference || null,
                    payerName: data.payerName || null,
                    registeredById: userId
                },
                include: {
                    paymentMethod: true
                }
            });

            // If payment is CASH, record movement in active shift
            if (isCash) {
                const activeShift = await tx.cashShift.findFirst({
                    where: {
                        userId,
                        companyId,
                        endDate: null
                    }
                });

                if (!activeShift) {
                    throw new Error('No active cash shift found for this user. Please open a shift first.');
                }

                await tx.cashMovement.create({
                    data: {
                        shiftId: activeShift.id,
                        type: 'IN',
                        amount: data.amount,
                        description: `Venta Orden #${data.orderId}`,
                        reference: `PAY-${payment.id}`
                    }
                });
            }

            // Check if order is fully paid
            const newTotalPaid = totalPaid + data.amount;

            if (newTotalPaid >= Number(order.total)) {
                await tx.order.update({
                    where: { id: data.orderId },
                    data: { status: 'PAID', closedAt: new Date() }
                });

                if (order.discountCode) {
                    const promo = await tx.promotion.findFirst({
                        where: { companyId, code: order.discountCode.toUpperCase() },
                        select: { id: true, usageLimit: true, usageCount: true }
                    });
                    if (promo) {
                        if (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit) {
                            throw new Error('Promotion usage limit reached');
                        }
                        await tx.promotion.update({
                            where: { id: promo.id },
                            data: { usageCount: { increment: 1 } }
                        });
                    }
                }

                // Release table if assigned
                if (order.tableId) {
                    await tx.table.update({
                        where: { id: order.tableId },
                        data: { status: 'AVAILABLE' }
                    });
                }

                // Auto-deduct inventory: find default warehouse for the order's branch
                const branchId = order.branchId;
                if (branchId) {
                    const warehouse = await tx.warehouse.findFirst({
                        where: { branchId, companyId }
                    });

                    if (warehouse) {
                        for (const item of order.items) {
                            for (const recipe of item.menuItem.recipes) {
                                const requiredQty = Number(recipe.quantity) * item.quantity;
                                const stock = await tx.stock.findUnique({
                                    where: { warehouseId_productId: { warehouseId: warehouse.id, productId: recipe.productId } }
                                });

                                if (!stock) {
                                    throw new Error(`Insufficient stock for ${recipe.product.name}. Required: ${requiredQty}, Available: 0`);
                                }

                                const currentQty = Number(stock.quantity);
                                if (currentQty < requiredQty) {
                                    throw new Error(`Insufficient stock for ${recipe.product.name}. Required: ${requiredQty}, Available: ${currentQty}`);
                                }

                                const newQty = currentQty - requiredQty;
                                const unitCost = Number(recipe.product.cost || 0);

                                await tx.stock.update({
                                    where: { warehouseId_productId: { warehouseId: warehouse.id, productId: recipe.productId } },
                                    data: { quantity: newQty }
                                });

                                await tx.inventoryMovement.create({
                                    data: {
                                        companyId,
                                        warehouseId: warehouse.id,
                                        productId: recipe.productId,
                                        userId,
                                        type: 'OUT',
                                        quantity: requiredQty,
                                        unitCost,
                                        totalCost: unitCost * requiredQty,
                                        balanceQty: newQty,
                                        balanceCost: newQty * unitCost,
                                        reason: 'Consumo por orden',
                                        reference: `ORD-${order.id}`
                                    }
                                });
                            }
                        }
                    }
                }
            }

            return payment;
        });
    }

    static async delete(id: number, companyId: number) {
        const payment = await prisma.payment.findFirst({
            where: { id, order: { companyId } },
            include: {
                order: {
                    include: { payments: true, items: true }
                }
            }
        });

        if (!payment) {
            throw new Error('Payment not found');
        }

        return await prisma.$transaction(async (tx) => {
            // Delete corresponding cash movement if exists
            await tx.cashMovement.deleteMany({
                where: { reference: `PAY-${id}` }
            });

            await tx.payment.delete({
                where: { id }
            });

            // Determine correct status after removing payment
            if (payment.order.status === 'PAID') {
                // Check remaining payments after this deletion
                const remainingPaid = payment.order.payments
                    .filter((p) => p.id !== id)
                    .reduce((sum, p) => sum + Number(p.amount), 0);

                let newStatus: OrderStatus;
                if (remainingPaid >= Number(payment.order.total)) {
                    newStatus = 'PAID'; // Still fully paid
                } else {
                    // Determine logical pre-payment state
                    newStatus = this.deriveOrderStatus(payment.order);
                }

                if (newStatus !== 'PAID') {
                    await tx.order.update({
                        where: { id: payment.orderId },
                        data: { status: newStatus }
                    });
                }
            }

            return { success: true };
        });
    }

    // Get payment summary for an order
    static async getOrderPaymentSummary(orderId: number, companyId: number) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: {
                payments: {
                    include: {
                        paymentMethod: true
                    }
                }
            }
        });

        if (!order) {
            throw new Error('Order not found');
        }

        const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const remaining = Number(order.total) - totalPaid;

        return {
            orderId,
            total: Number(order.total),
            totalPaid,
            remaining,
            status: order.status,
            payments: order.payments
        };
    }
}
