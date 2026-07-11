import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { OrderService } from '../../services/order.service';
import { PaymentService } from '../../services/payment.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('PaymentService.delete financial-state reversal', () => {
    it('reverses a fully paid order even after it moved to DELIVERED', async () => {
        jest.spyOn(prisma.payment, 'findFirst').mockResolvedValue({ orderId: 7 } as never);
        const reverse = jest.spyOn(InventoryConsumptionService, 'reverseForOrder')
            .mockResolvedValue({ reversed: true });

        const tx = {
            $queryRaw: jest.fn(async () => []),
            payment: {
                findFirst: jest.fn(async () => ({
                    id: 11,
                    orderId: 7,
                    amount: 100,
                    order: {
                        id: 7,
                        status: 'DELIVERED',
                        total: 100,
                        tableId: 3,
                        discountCode: 'PROMO',
                        payments: [{ id: 11, amount: 100 }],
                        items: [{ status: 'DONE', sentAt: new Date() }]
                    }
                })),
                delete: jest.fn(async (_args: unknown) => ({}))
            },
            cashMovement: { deleteMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
            order: { update: jest.fn(async (_args: unknown) => ({})) },
            table: { update: jest.fn(async (_args: unknown) => ({})) },
            promotion: {
                findFirst: jest.fn(async () => ({ id: 4, usageCount: 1 })),
                update: jest.fn(async (_args: unknown) => ({}))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await PaymentService.delete(11, 1, 9);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7 },
            data: expect.objectContaining({ status: 'READY', closedAt: null })
        }));
        expect(reverse).toHaveBeenCalledWith(tx as never, { orderId: 7, userId: 9, companyId: 1 });
        expect(tx.table.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'OCCUPIED' } });
        expect(tx.promotion.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { usageCount: { decrement: 1 } } });
    });
});

describe('OrderService.cancel paid-like states', () => {
    function makeTx() {
        return {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 7,
                    companyId: 1,
                    userId: 9,
                    tableId: 3,
                    status: 'DELIVERED',
                    total: 100,
                    closedAt: new Date(),
                    discountCode: 'PROMO',
                    payments: [{ id: 11, amount: 100 }],
                    table: { id: 3 }
                })),
                update: jest.fn(async (args: { data: { status: string } }) => ({ id: 7, status: args.data.status }))
            },
            cashMovement: { deleteMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
            payment: { deleteMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
            promotion: {
                findFirst: jest.fn(async () => ({ id: 4, usageCount: 1 })),
                update: jest.fn(async (_args: unknown) => ({}))
            },
            table: { update: jest.fn(async (_args: unknown) => ({})) },
            auditLog: { create: jest.fn(async (_args: unknown) => ({})) }
        };
    }

    it('atomically reverses payments, promotion and inventory for an authoritative channel cancellation', async () => {
        const tx = makeTx();
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (db: ReturnType<typeof makeTx>) => unknown) => callback(tx)) as never);
        const reverse = jest.spyOn(InventoryConsumptionService, 'reverseForOrder')
            .mockResolvedValue({ reversed: true });

        await OrderService.cancel(7, 1, 9, 'Canal', { allowPaidReversal: true });

        expect(reverse).toHaveBeenCalledWith(tx as never, { orderId: 7, userId: 9, companyId: 1 });
        expect(tx.payment.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [11] }, orderId: 7 } });
        expect(tx.cashMovement.deleteMany).toHaveBeenCalled();
        expect(tx.promotion.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { usageCount: { decrement: 1 } } });
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7 },
            data: expect.objectContaining({ status: 'CANCELLED' })
        }));
    });

    it('still rejects manual cancellation of a delivered order that remains fully paid', async () => {
        const tx = makeTx();
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (db: ReturnType<typeof makeTx>) => unknown) => callback(tx)) as never);
        const reverse = jest.spyOn(InventoryConsumptionService, 'reverseForOrder')
            .mockResolvedValue({ reversed: true });

        await expect(OrderService.cancel(7, 1, 9, 'Manual')).rejects.toThrow(/paid/i);
        expect(reverse).not.toHaveBeenCalled();
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('does not treat an unpaid zero-total draft as financially paid', async () => {
        const tx = makeTx();
        tx.order.findFirst.mockResolvedValue({
            id: 7,
            companyId: 1,
            userId: 9,
            tableId: null,
            status: 'OPEN',
            total: 0,
            closedAt: null,
            discountCode: null,
            payments: [],
            table: null
        } as never);
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (db: ReturnType<typeof makeTx>) => unknown) => callback(tx)) as never);
        jest.spyOn(InventoryConsumptionService, 'reverseForOrder').mockResolvedValue({ reversed: false });

        await expect(OrderService.cancel(7, 1, 9, 'Vacía')).resolves.toEqual(expect.objectContaining({ status: 'CANCELLED' }));
        expect(tx.payment.deleteMany).not.toHaveBeenCalled();
    });
});
