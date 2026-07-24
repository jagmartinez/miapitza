import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { OrderService } from '../../services/order.service';
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

    it('atomically completes a ready table order when the last payment selects a warehouse', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, tableId: 5, total: 10,
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
            promotion: { findFirst: jest.fn(), updateMany: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const complete = jest.spyOn(OrderService, 'completeWithTransaction').mockResolvedValue({
            id: 9, status: 'DELIVERED'
        } as never);

        await PaymentService.create(1, {
            orderId: 9,
            paymentMethodId: 3,
            amount: 10,
            warehouseId: 8
        }, 7);

        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete.mock.calls[0]?.[0]).toBe(tx as never);
        expect(complete.mock.calls[0]?.slice(1)).toEqual([9, 1, 8, 7]);
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ financialStatus: 'PAID' })
        }));
    });

    it('rejects an operational warehouse on a partial payment before creating ledger rows', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, tableId: 5, total: 20,
                    financialStatus: 'UNPAID', status: 'READY', cashRegisterId: null,
                    discountCode: null, invoiceNumber: 'FAC-2-000009', invoiceFiscalStatus: 'ISSUED', payments: []
                })),
                update: jest.fn()
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn(async () => ({ id: 3, type: 'CARD' })) },
            payment: { create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PaymentService.create(1, {
            orderId: 9,
            paymentMethodId: 3,
            amount: 10,
            warehouseId: 8
        }, 7)).rejects.toThrow(/último pago/i);
        expect(tx.payment.create).not.toHaveBeenCalled();
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('releases a delivered table when its final payment arrives later', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, tableId: 5, total: 10,
                    financialStatus: 'UNPAID', status: 'DELIVERED', cashRegisterId: null,
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
            promotion: { findFirst: jest.fn(), updateMany: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const release = jest.spyOn(OrderService, 'reconcileTableAfterSettlement').mockResolvedValue(false);

        await PaymentService.create(1, { orderId: 9, paymentMethodId: 3, amount: 10 }, 7);

        expect(release).toHaveBeenCalledTimes(1);
        expect(release.mock.calls[0]?.[0]).toBe(tx as never);
        expect(release.mock.calls[0]?.slice(1)).toEqual([
            1, 5, 7, 'Orden #9 pagada después de entrega'
        ]);
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

    it('rejects reusing a financial-only payment key as a pay-and-deliver request', async () => {
        const existing = {
            id: 44,
            orderId: 9,
            paymentMethodId: 3,
            amount: 10,
            reference: null,
            payerName: null,
            idempotencyKey: 'stable-key',
            settlementWarehouseId: null,
            methodType: 'CARD',
            status: 'ACTIVE',
            paymentMethod: { id: 3, type: 'CARD' }
        };
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, tableId: 5, total: 10,
                    financialStatus: 'PAID', status: 'READY', payments: [{ amount: 10 }]
                }))
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            payment: { findUnique: jest.fn(async () => existing) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const complete = jest.spyOn(OrderService, 'completeWithTransaction');

        await expect(PaymentService.create(1, {
            orderId: 9,
            paymentMethodId: 3,
            amount: 10,
            idempotencyKey: 'stable-key',
            warehouseId: 8
        }, 7)).rejects.toThrow(/different payment data/i);
        expect(complete).not.toHaveBeenCalled();
    });

    it('replays the exact pay-and-deliver request without delivering twice', async () => {
        const existing = {
            id: 44,
            orderId: 9,
            paymentMethodId: 3,
            amount: 10,
            reference: null,
            payerName: null,
            idempotencyKey: 'stable-key',
            settlementWarehouseId: 8,
            methodType: 'CARD',
            status: 'ACTIVE',
            paymentMethod: { id: 3, type: 'CARD' }
        };
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, tableId: 5, total: 10,
                    financialStatus: 'PAID', status: 'DELIVERED', payments: [{ amount: 10 }]
                }))
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            payment: { findUnique: jest.fn(async () => existing) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const complete = jest.spyOn(OrderService, 'completeWithTransaction');

        await expect(PaymentService.create(1, {
            orderId: 9,
            paymentMethodId: 3,
            amount: 10,
            idempotencyKey: 'stable-key',
            warehouseId: 8
        }, 7)).resolves.toBe(existing);
        expect(complete).not.toHaveBeenCalled();
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
