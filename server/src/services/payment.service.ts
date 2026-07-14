import prisma from '../utils/prisma';
import type { PaymentMethodType, Prisma } from '@prisma/client';

export class PaymentService {
    private static normalizeMoney(value: unknown): { amount: number; cents: number } {
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) {
            throw new Error('Amount must be a positive number');
        }
        const cents = Math.round(raw * 100);
        if (Math.abs(raw - cents / 100) > 1e-9) {
            throw new Error('Amount must have at most two decimal places');
        }
        return { amount: cents / 100, cents };
    }

    private static normalizeOptionalText(value: unknown, field: string): string | null {
        if (value === undefined || value === null) return null;
        const normalized = String(value).trim();
        if (!normalized) return null;
        if (normalized.length > 191) throw new Error(`${field} is too long`);
        return normalized;
    }

    private static async assertActiveCashLedger(
        tx: Prisma.TransactionClient,
        payment: { id: number; amount: unknown },
        companyId: number,
        branchId: number
    ): Promise<void> {
        const movements = await tx.cashMovement.findMany({
            where: { reference: { in: [`PAY-${payment.id}`, `REV-PAY-${payment.id}`] } },
            select: {
                type: true,
                amount: true,
                reference: true,
                shift: { select: { companyId: true, cashRegister: { select: { branchId: true } } } }
            }
        });
        const amountCents = Math.round(Number(payment.amount) * 100);
        const inboundReference = movements.filter((movement) => movement.reference === `PAY-${payment.id}`);
        const validInbound = inboundReference.filter((movement) =>
            movement.type === 'IN'
            && Math.round(Number(movement.amount) * 100) === amountCents
            && movement.shift.companyId === companyId
            && movement.shift.cashRegister.branchId === branchId
        );
        if (inboundReference.length !== 1 || validInbound.length !== 1) {
            throw new Error('El pago en efectivo no tiene exactamente un asiento PAY íntegro; requiere remediación manual');
        }
        if (movements.some((movement) => movement.reference === `REV-PAY-${payment.id}`)) {
            throw new Error('El pago activo ya tiene un contramovimiento de caja; requiere remediación manual');
        }
    }

    static async getByOrderId(orderId: number, companyId: number) {
        return await prisma.payment.findMany({
            where: { orderId, order: { companyId } },
            include: {
                paymentMethod: {
                    select: {
                        id: true,
                        name: true,
                        type: true
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
        idempotencyKey?: string;
    }, userId: number) {
        const { amount, cents: amountCents } = this.normalizeMoney(data.amount);
        if (!Number.isInteger(data.orderId) || data.orderId <= 0) throw new Error('Invalid order id');
        if (!Number.isInteger(data.paymentMethodId) || data.paymentMethodId <= 0) throw new Error('Invalid payment method id');
        const reference = this.normalizeOptionalText(data.reference, 'Reference');
        const payerName = this.normalizeOptionalText(data.payerName, 'Payer name');
        const idempotencyKey = this.normalizeOptionalText(data.idempotencyKey, 'Idempotency key');

        // ALL validation and writes inside a single transaction to prevent race conditions
        return await prisma.$transaction(async (tx) => {
            // Pessimistic lock: prevent concurrent payments on the same order
            await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${data.orderId} AND companyId = ${companyId} FOR UPDATE`;

            const order = await tx.order.findFirst({
                where: { id: data.orderId, companyId },
                include: { payments: { where: { status: 'ACTIVE' } } }
            });

            if (!order) {
                throw new Error('Order not found');
            }

            const actor = await tx.user.findFirst({
                where: { id: userId, companyId, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!actor) throw new Error('Invalid user for this company');

            if (idempotencyKey) {
                const existing = await tx.payment.findUnique({
                    where: { orderId_idempotencyKey: { orderId: order.id, idempotencyKey } },
                    include: { paymentMethod: true }
                });
                if (existing) {
                    if (existing.status === 'REVERSED') {
                        throw new Error('Idempotency key belongs to a reversed payment and cannot be reused');
                    }
                    const sameRequest = Math.round(Number(existing.amount) * 100) === amountCents
                        && existing.paymentMethodId === data.paymentMethodId
                        && (existing.reference || null) === reference
                        && (existing.payerName || null) === payerName;
                    if (!sameRequest) throw new Error('Idempotency key reused with different payment data');
                    if (existing.methodType === 'CASH') {
                        await this.assertActiveCashLedger(tx, existing, companyId, order.branchId);
                    }
                    return existing;
                }
            }

            if (!order.invoiceNumber?.trim()) {
                throw new Error('Debe emitir la factura de la orden antes de procesar cualquier pago');
            }

            // Lock and re-read the semantic method inside the same transaction.
            // An administrator cannot deactivate or re-type it between validation
            // and the corresponding cash ledger decision.
            await tx.$queryRaw`SELECT id FROM \`PaymentMethod\` WHERE id = ${data.paymentMethodId} FOR UPDATE`;
            const paymentMethod = await tx.paymentMethod.findFirst({
                where: {
                    id: data.paymentMethodId,
                    active: true,
                    OR: [{ companyId }, { companyId: null }]
                },
                select: { id: true, type: true }
            });
            if (!paymentMethod) throw new Error('Invalid or inactive payment method');
            const methodType: PaymentMethodType = paymentMethod.type;
            const isCash = methodType === 'CASH';

            if (order.financialStatus === 'PAID') {
                throw new Error('Order already paid');
            }

            if (order.status === 'CANCELLED') {
                throw new Error('Cannot pay cancelled orders');
            }

            // Calculate total paid INSIDE the transaction
            const totalCents = Math.round(Number(order.total) * 100);
            const totalPaidCents = order.payments.reduce((sum: number, p: { amount: unknown }) => sum + Math.round(Number(p.amount) * 100), 0);
            const remainingCents = totalCents - totalPaidCents;

            if (amountCents > remainingCents) {
                throw new Error(`Amount exceeds remaining balance. Remaining: ${(remainingCents / 100).toFixed(2)}`);
            }

            const payment = await tx.payment.create({
                data: {
                    orderId: data.orderId,
                    paymentMethodId: data.paymentMethodId,
                    methodType,
                    amount,
                    reference,
                    payerName,
                    idempotencyKey,
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
                    data: { financialStatus: 'PAID', closedAt: new Date() }
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

                // Payment is a financial fact only. Physical stock is consumed
                // exactly once by the operational DELIVERED/complete workflow,
                // which receives an explicit warehouse instead of guessing one.
            } else {
                await tx.order.update({
                    where: { id: data.orderId },
                    data: { financialStatus: 'PARTIAL', closedAt: null }
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
                        include: { payments: { where: { status: 'ACTIVE' } } }
                    }
                }
            });
            if (!payment) throw new Error('Payment not found');
            const actor = await tx.user.findFirst({
                where: { id: userId, companyId, status: 'ACTIVE' },
                select: { id: true }
            });
            if (!actor) throw new Error('Invalid user for this company');
            // Preserve the original payment and cash IN as immutable ledger rows.
            // A cash refund is represented by a compensating OUT movement in an
            // OPEN shift. Never mutate a closed shift: doing so would rewrite its
            // historical arqueo after it was signed off.
            if (payment.methodType === 'CASH') {
                await this.assertActiveCashLedger(tx, payment, companyId, payment.order.branchId);
                const refundShift = await tx.cashShift.findFirst({
                    where: {
                        userId,
                        companyId,
                        endDate: null,
                        cashRegister: { branchId: payment.order.branchId }
                    },
                    select: { id: true }
                });
                if (!refundShift) {
                    throw new Error('Debe abrir un turno de caja en la sucursal de la orden para registrar el reembolso en efectivo');
                }
                await tx.$queryRaw`SELECT id FROM \`CashShift\` WHERE id = ${refundShift.id} AND companyId = ${companyId} FOR UPDATE`;
                const lockedRefundShift = await tx.cashShift.findFirst({
                    where: {
                        id: refundShift.id,
                        userId,
                        companyId,
                        endDate: null,
                        cashRegister: { branchId: payment.order.branchId }
                    },
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

            const totalBeforeCents = payment.order.payments.reduce(
                (sum, current) => sum + Math.round(Number(current.amount) * 100),
                0
            );
            const remainingPaidCents = payment.order.payments
                .filter((p) => p.id !== id)
                .reduce((sum, current) => sum + Math.round(Number(current.amount) * 100), 0);
            const orderTotalCents = Math.round(Number(payment.order.total) * 100);
            const wasFullyPaid = totalBeforeCents >= orderTotalCents;
            const becomesUnderpaid = remainingPaidCents < orderTotalCents;
            const financialStatus = remainingPaidCents === 0
                ? 'UNPAID'
                : (remainingPaidCents >= orderTotalCents ? 'PAID' : 'PARTIAL');

            await tx.order.update({
                where: { id: payment.orderId },
                data: {
                    financialStatus,
                    ...(becomesUnderpaid ? { closedAt: null } : {})
                }
            });

            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Payment',
                    entityId: id,
                    action: 'PAYMENT_REVERSED',
                    userId,
                    details: {
                        orderId: payment.orderId,
                        invoiceNumber: payment.order.invoiceNumber,
                        amount: Number(payment.amount),
                        methodType: payment.methodType,
                        reason: reversalReason.trim(),
                        resultingFinancialStatus: financialStatus
                    }
                }
            });

            if (wasFullyPaid && becomesUnderpaid) {
                // Financial reversal changes only the financial lifecycle. The
                // kitchen/delivery status and physical stock are independent facts.
                // Promotion usage is financial-state based: it was counted
                // when the order first became fully paid, regardless of later
                // operational status changes.
                if (payment.order.discountCode) {
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

        const totalCents = Math.round(Number(order.total) * 100);
        const totalPaidCents = order.payments.reduce(
            (sum, payment) => sum + Math.round(Number(payment.amount) * 100),
            0
        );

        return {
            orderId,
            total: totalCents / 100,
            totalPaid: totalPaidCents / 100,
            remaining: Math.max(0, totalCents - totalPaidCents) / 100,
            status: order.financialStatus,
            operationalStatus: order.status,
            payments: order.payments
        };
    }
}
