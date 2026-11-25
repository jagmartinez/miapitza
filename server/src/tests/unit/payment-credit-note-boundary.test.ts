import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { PaymentService } from '../../services/payment.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('PaymentService fiscal credit-note boundary', () => {
    it('blocks a new charge after a partial credit note', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: { findFirst: jest.fn(async () => ({
                id: 9, companyId: 1, branchId: 2, total: 230,
                invoiceNumber: 'FAC-9', invoiceFiscalStatus: 'PARTIALLY_CREDITED',
                financialStatus: 'PAID', status: 'DELIVERED', payments: []
            })) },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn() },
            payment: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.create(1, {
            orderId: 9, paymentMethodId: 3, amount: 115
        }, 7)).rejects.toThrow(/contraflujo fiscal/i);
        expect(tx.paymentMethod.findFirst).not.toHaveBeenCalled();
        expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('still replays the exact committed payment before applying the fiscal mutation guard', async () => {
        const existing = {
            id: 44, orderId: 9, paymentMethodId: 3, amount: 230,
            reference: null, payerName: null, idempotencyKey: 'pay-stable',
            methodType: 'CARD', status: 'ACTIVE', paymentMethod: { id: 3, type: 'CARD' }
        };
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: { findFirst: jest.fn(async () => ({
                id: 9, branchId: 2, invoiceFiscalStatus: 'PARTIALLY_CREDITED', payments: []
            })) },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            payment: { findUnique: jest.fn(async () => existing), create: jest.fn() },
            paymentMethod: { findFirst: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.create(1, {
            orderId: 9, paymentMethodId: 3, amount: 230, idempotencyKey: 'pay-stable'
        }, 7)).resolves.toBe(existing);
        expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('blocks manual payment reversal once any credit-note allocation exists', async () => {
        jest.spyOn(prisma.payment, 'findFirst').mockResolvedValue({ orderId: 9 } as never);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            payment: { findFirst: jest.fn(async () => ({
                id: 44, orderId: 9, amount: 230, methodType: 'CASH',
                fiscalCreditNoteRefunds: [{ id: 1, amount: 115 }],
                order: {
                    id: 9, branchId: 2, invoiceFiscalStatus: 'PARTIALLY_CREDITED',
                    payments: [{ id: 44, amount: 230 }]
                }
            })), update: jest.fn() },
            user: { findFirst: jest.fn() },
            cashMovement: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.delete(44, 1, 7, 'Reverso manual'))
            .rejects.toThrow(/contraflujo fiscal/i);
        expect(tx.payment.update).not.toHaveBeenCalled();
        expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('reports immutable gross amounts and the actionable net balance explicitly', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 9, total: 230, financialStatus: 'PAID', status: 'DELIVERED',
            fiscalCreditNotes: [{ total: 115 }],
            payments: [{
                id: 44, amount: 230, status: 'ACTIVE', paymentMethod: { id: 3, name: 'Tarjeta' },
                fiscalCreditNoteRefunds: [{ amount: 115 }]
            }]
        } as never);

        const summary = await PaymentService.getOrderPaymentSummary(9, 1);

        expect(summary).toMatchObject({
            grossTotal: 230,
            credited: 115,
            netTotal: 115,
            grossPaid: 230,
            refunded: 115,
            netPaid: 115,
            total: 115,
            totalPaid: 115,
            remaining: 0,
            status: 'PAID'
        });
    });
});
