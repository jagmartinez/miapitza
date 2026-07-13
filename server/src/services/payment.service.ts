import prisma from '../utils/prisma';
import { OrderStatus } from '@prisma/client';
import { InventoryConsumptionService } from './inventory-consumption.service';

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
        const amount = Math.round(Number(data.amount) * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Amount must be a positive number');
        }

        // Validate payment method before entering transaction (tenant-scoped:
        // company-owned methods or system-wide methods with companyId = null)
        const paymentMethod = await prisma.paymentMethod.findFirst({
            where: {
                id: data.paymentMethodId,
                OR: [{ companyId }, { companyId: null }]
            }
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
                include: { payments: { where: { status: 'ACTIVE' } }, items: { include: { menuItem: { include: { recipes: { include: { product: true, unitOfMeasure: { select: { abbreviation: true } } } } } } } } }
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
            const totalCents = Math.round(Number(order.total) * 100);
            const totalPaidCents = order.payments.reduce((sum: number, p: { amount: unknown }) => sum + Math.round(Number(p.amount) * 100), 0);
            const amountCents = Math.round(amount * 100);
            const remainingCents = totalCents - totalPaidCents;

            if (amountCents > remainingCents) {
                throw new Error(`Amount exceeds remaining balance. Remaining: ${(remainingCents / 100).toFixed(2)}`);
            }

            const payment = await tx.payment.create({
                data: {
                    orderId: data.orderId,
                    paymentMethodId: data.paymentMethodId,
                    amount,
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
                        endDate: null,
                        cashRegister: { branchId: order.branchId }
                    },
                    select: { id: true, cashRegisterId: true }
                });

                if (!activeShift) {
                    throw new Error('No active cash shift found for this user. Please open a shift first.');
                }

                // Serialize with shift close. Otherwise this payment can observe
                // an open shift and post cash after a concurrent close commits.
                await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${activeShift.id} AND companyId = ${companyId} FOR UPDATE`;
                const lockedShift = await tx.cashShift.findFirst({
                    where: {
                        id: activeShift.id,
                        userId,
                        companyId,
                        endDate: null,
                        cashRegister: { branchId: order.branchId }
                    },
                    select: { id: true, cashRegisterId: true }
                });
                if (!lockedShift) {
                    throw new Error('El turno de caja fue cerrado durante el cobro; vuelva a intentarlo');
                }

                await tx.cashMovement.create({
                    data: {
                        shiftId: lockedShift.id,
                        type: 'IN',
                        amount,
                        description: `Venta Orden #${data.orderId}`,
                        reference: `PAY-${payment.id}`
                    }
                });
                if (order.cashRegisterId && order.cashRegisterId !== lockedShift.cashRegisterId) {
                    throw new Error('La orden ya está asociada a otra caja registradora');
                }
                if (!order.cashRegisterId) {
                    await tx.order.update({ where: { id: order.id }, data: { cashRegisterId: lockedShift.cashRegisterId } });
                }
            }

            // Check if order is fully paid
            const newTotalPaidCents = totalPaidCents + amountCents;

            if (newTotalPaidCents >= totalCents) {
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
                        const claimed = await tx.promotion.updateMany({
                            where: {
                                id: promo.id,
                                ...(promo.usageLimit === null
                                    ? {}
                                    : { usageCount: { lt: promo.usageLimit } })
                            },
                            data: { usageCount: { increment: 1 } }
                        });
                        if (claimed.count !== 1) {
                            throw new Error('Promotion usage limit reached');
                        }
                    }
                }

                // Free the associated table once the order is PAID, but only if
                // no other active order still occupies it (shared-table safety).
                // Idempotent: setting AVAILABLE on an already-free table is a no-op.
                if (order.tableId) {
                    const otherActiveOnTable = await tx.order.count({
                        where: {
                            companyId,
                            tableId: order.tableId,
                            id: { not: order.id },
                            status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'] }
                        }
                    });
                    if (otherActiveOnTable === 0) {
                        await tx.table.update({
                            where: { id: order.tableId },
                            data: { status: 'AVAILABLE' }
                        });
                    }
                }

                // Auto-deduct inventory through the shared, idempotent consumption
                // service. Skips automatically if the order was already consumed
                // (e.g. OrderService.complete already ran).
                //
                // A PAID sale MUST descargar inventario: if the branch has no
                // warehouse we abort the whole payment transaction instead of
                // silently confirming a sale that would lose the descargue.
                const branchId = order.branchId;
                const warehouse = branchId
                    ? await tx.warehouse.findFirst({ where: { branchId, companyId } })
                    : null;

                if (!warehouse) {
                    throw new Error(
                        `No hay almacén configurado para la sucursal ${branchId ?? '(sin sucursal)'}; ` +
                        `no se puede descargar inventario para la orden ${order.id}.`
                    );
                }

                await InventoryConsumptionService.consumeForOrder(tx, {
                    order,
                    warehouseId: warehouse.id,
                    userId,
                    companyId
                });
            }

            return payment;
        });
    }

    static async delete(id: number, companyId: number, userId: number, reversalReason?: string) {
        if (!reversalReason?.trim()) throw new Error('Reversal reason is required');
        const target = await prisma.payment.findFirst({
            where: { id, status: 'ACTIVE', order: { companyId } },
            select: { orderId: true }
        });

        if (!target) {
            throw new Error('Payment not found');
        }

        return await prisma.$transaction(async (tx) => {
            // Serialize payment removal with payment creation, order completion
            // and cancellation. The status alone is not an inventory marker: a
            // fully-paid order may already be DELIVERED.
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${target.orderId} AND companyId = ${companyId} FOR UPDATE`;

            const payment = await tx.payment.findFirst({
                where: { id, orderId: target.orderId, status: 'ACTIVE', order: { companyId } },
                include: {
                    order: {
                        include: { payments: { where: { status: 'ACTIVE' } }, items: true }
                    }
                }
            });
            if (!payment) throw new Error('Payment not found');
            if (payment.order.invoiceNumber) {
                throw new Error('No se puede revertir un pago de una orden facturada; emita una nota de crédito');
            }

            // Preserve the original payment and cash IN as immutable ledger rows.
            // A cash refund is represented by a compensating OUT movement in an
            // OPEN shift. Never mutate a closed shift: doing so would rewrite its
            // historical arqueo after it was signed off.
            const originalCashMovement = await tx.cashMovement.findFirst({ where: { reference: `PAY-${id}`, type: 'IN' } });
            if (originalCashMovement) {
                let refundShift = await tx.cashShift.findFirst({
                    where: {
                        userId,
                        companyId,
                        endDate: null,
                        cashRegister: { branchId: payment.order.branchId }
                    },
                    select: { id: true }
                });
                if (!refundShift) {
                    const originalShift = await tx.cashShift.findFirst({
                        where: {
                            id: originalCashMovement.shiftId,
                            companyId,
                            endDate: null,
                            cashRegister: { branchId: payment.order.branchId }
                        },
                        select: { id: true }
                    });
                    refundShift = originalShift;
                }
                if (!refundShift) {
                    throw new Error('Debe abrir un turno de caja en la sucursal de la orden para registrar el reembolso en efectivo');
                }
                await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${refundShift.id} AND companyId = ${companyId} FOR UPDATE`;
                const lockedRefundShift = await tx.cashShift.findFirst({
                    where: { id: refundShift.id, companyId, endDate: null },
                    select: { id: true }
                });
                if (!lockedRefundShift) throw new Error('El turno de caja para el reembolso ya fue cerrado');
                await tx.cashMovement.create({
                    data: {
                        shiftId: lockedRefundShift.id,
                        type: 'OUT',
                        amount: payment.amount,
                        description: `Reverso Pago #${id} Orden #${payment.orderId}`,
                        reference: `REV-PAY-${id}`
                    }
                });

            }

            await tx.payment.update({
                where: { id },
                data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId, reversalReason: reversalReason.trim() }
            });

            const totalBefore = payment.order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const remainingPaid = payment.order.payments
                .filter((p) => p.id !== id)
                .reduce((sum, p) => sum + Number(p.amount), 0);
            const orderTotal = Number(payment.order.total);
            const wasFullyPaid = totalBefore + 0.01 >= orderTotal;
            const becomesUnderpaid = remainingPaid + 0.01 < orderTotal;

            if (becomesUnderpaid && payment.order.status !== 'CANCELLED') {
                // Financial reversal must preserve the operational fact that the
                // order was already delivered.
                const newStatus = payment.order.status === 'DELIVERED'
                    ? 'DELIVERED'
                    : this.deriveOrderStatus(payment.order);

                await tx.order.update({
                    where: { id: payment.orderId },
                    data: { status: newStatus, closedAt: null }
                });

                // Reverse based on the outstanding ORD-{id} movements, not on a
                // display status. This also covers PAID -> DELIVERED orders.
                await InventoryConsumptionService.reverseForOrder(tx, {
                    orderId: payment.orderId,
                    userId,
                    companyId
                });

                // The order is open again. Keep its table occupied unless another
                // active order already does so (setting OCCUPIED is idempotent).
                if (payment.order.tableId) {
                    await tx.table.update({
                        where: { id: payment.order.tableId },
                        data: { status: 'OCCUPIED' }
                    });
                }

                // Promotion usage is financial-state based as well: it was counted
                // when the order first became fully paid, regardless of later
                // operational status changes.
                if (wasFullyPaid && payment.order.discountCode) {
                    const promo = await tx.promotion.findFirst({
                        where: { companyId, code: payment.order.discountCode.toUpperCase() },
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

            // Existing cancelled records remain terminal. Their inventory was
            // already reversed by OrderService.cancel; payment cleanup must not
            // reopen them.
            if (payment.order.status === 'CANCELLED' && wasFullyPaid) {
                const outstanding = await InventoryConsumptionService.reverseForOrder(tx, {
                    orderId: payment.orderId,
                    userId,
                    companyId
                });
                if (outstanding.reversed && payment.order.discountCode) {
                    const promo = await tx.promotion.findFirst({
                        where: { companyId, code: payment.order.discountCode.toUpperCase() },
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

            return { success: true };
        });
    }

    // Get payment summary for an order
    static async getOrderPaymentSummary(orderId: number, companyId: number) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: {
                payments: {
                    where: { status: 'ACTIVE' },
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
