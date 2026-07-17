import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { PaymentService } from '../../services/payment.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('PaymentService financial/physical boundary and domain replay', () => {
    it('settles a fully paid order without selecting a warehouse or moving inventory', async () => {
        const consume = jest.spyOn(InventoryConsumptionService, 'consumeForOrder');
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, total: 10,
                    financialStatus: 'UNPAID', status: 'READY', cashRegisterId: null,
                    discountCode: null, invoiceNumber: 'FAC-2-000009', invoiceFiscalStatus: 'ISSUED', payments: []
                })),
                update: jest.fn(async (_args: unknown) => ({}))
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn(async () => ({ id: 3, type: 'CARD' })) },
            payment: {
                create: jest.fn(async () => ({ id: 44, orderId: 9, amount: 10, methodType: 'CARD' }))
            },
            cashMovement: { create: jest.fn() },
            warehouse: { findFirst: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await PaymentService.create(1, { orderId: 9, paymentMethodId: 3, amount: 10 }, 7);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ financialStatus: 'PAID' })
        }));
        expect(tx.warehouse.findFirst).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
    });

    it('rejects payment before an invoice is issued', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, total: 10,
                    financialStatus: 'UNPAID', status: 'READY', invoiceNumber: null, payments: []
                })),
                update: jest.fn()
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn() },
            payment: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.create(1, {
            orderId: 9, paymentMethodId: 3, amount: 10
        }, 7)).rejects.toThrow(/factura.*antes/i);
        expect(tx.paymentMethod.findFirst).not.toHaveBeenCalled();
        expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('replays the same committed payment key after settlement without another charge', async () => {
        const existing = {
            id: 44,
            orderId: 9,
            paymentMethodId: 3,
            amount: 10,
            reference: null,
            payerName: 'Ana',
            idempotencyKey: 'stable-key',
            methodType: 'CARD',
            status: 'ACTIVE',
            paymentMethod: { id: 3, type: 'CARD' }
        };
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, total: 10,
                    financialStatus: 'PAID', status: 'READY', payments: [{ amount: 10 }]
                })),
                update: jest.fn()
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            payment: {
                findUnique: jest.fn(async () => existing),
                create: jest.fn()
            },
            paymentMethod: { findFirst: jest.fn() },
            cashMovement: { findMany: jest.fn(), create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.create(1, {
            orderId: 9,
            paymentMethodId: 3,
            amount: 10,
            payerName: ' Ana ',
            idempotencyKey: 'stable-key'
        }, 7)).resolves.toBe(existing);
        expect(tx.payment.create).not.toHaveBeenCalled();
        expect(tx.paymentMethod.findFirst).not.toHaveBeenCalled();
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('rejects key reuse with a different financial payload', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: { findFirst: jest.fn(async () => ({ id: 9, branchId: 2, payments: [] })) },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            payment: {
                findUnique: jest.fn(async () => ({
                    id: 44, paymentMethodId: 3, amount: 9, reference: null, payerName: null,
                    methodType: 'CARD', status: 'ACTIVE', paymentMethod: { id: 3 }
                })),
                create: jest.fn()
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.create(1, {
            orderId: 9, paymentMethodId: 3, amount: 10, idempotencyKey: 'stable-key'
        }, 7)).rejects.toThrow(/different payment data/i);
        expect(tx.payment.create).not.toHaveBeenCalled();
    });
});
