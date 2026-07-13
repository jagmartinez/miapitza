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
                        branchId: 2,
                        invoiceNumber: null,
                        status: 'DELIVERED',
                        total: 100,
                        tableId: 3,
                        discountCode: 'PROMO',
                        payments: [{ id: 11, amount: 100 }],
                        items: [{ status: 'DONE', sentAt: new Date() }]
                    }
                })),
                update: jest.fn(async (_args: unknown) => ({}))
            },
            cashMovement: {
                findFirst: jest.fn(async () => ({ shiftId: 2, type: 'IN', amount: 100 })),
                create: jest.fn(async (_args: unknown) => ({}))
            },
            cashShift: { findFirst: jest.fn(async () => ({ id: 8 })) },
            order: { update: jest.fn(async (_args: unknown) => ({})) },
            table: { update: jest.fn(async (_args: unknown) => ({})) },
            promotion: {
                findFirst: jest.fn(async () => ({ id: 4, usageCount: 1 })),
                update: jest.fn(async (_args: unknown) => ({}))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await PaymentService.delete(11, 1, 9, 'Customer refund');

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7 },
            data: expect.objectContaining({ status: 'DELIVERED', closedAt: null })
        }));
        expect(reverse).toHaveBeenCalledWith(tx as never, { orderId: 7, userId: 9, companyId: 1 });
        expect(tx.table.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'OCCUPIED' } });
        expect(tx.promotion.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { usageCount: { decrement: 1 } } });
        expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ shiftId: 8, type: 'OUT', reference: 'REV-PAY-11' })
        }));
    });

    it('does not rewrite a closed shift when no open shift can receive the cash refund', async () => {
        jest.spyOn(prisma.payment, 'findFirst').mockResolvedValue({ orderId: 7 } as never);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            payment: {
                findFirst: jest.fn(async () => ({
                    id: 11, orderId: 7, amount: 100,
                    order: {
                        id: 7, branchId: 2, invoiceNumber: null, status: 'PAID', total: 100,
                        tableId: null, discountCode: null, payments: [{ id: 11, amount: 100 }], items: []
                    }
                })),
                update: jest.fn()
            },
            cashMovement: {
                findFirst: jest.fn(async () => ({ shiftId: 2, type: 'IN', amount: 100 })),
                create: jest.fn()
            },
            cashShift: { findFirst: jest.fn(async () => null) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(PaymentService.delete(11, 1, 9, 'Customer refund')).rejects.toThrow(/abrir un turno/i);
        expect(tx.cashMovement.create).not.toHaveBeenCalled();
        expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('blocks payment reversal after an invoice number was assigned', async () => {
        jest.spyOn(prisma.payment, 'findFirst').mockResolvedValue({ orderId: 7 } as never);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            payment: {
                findFirst: jest.fn(async () => ({
                    id: 11, orderId: 7, amount: 100,
                    order: {
                        id: 7, branchId: 2, invoiceNumber: 'FAC-2-000001', status: 'PAID', total: 100,
                        tableId: null, discountCode: null, payments: [{ id: 11, amount: 100 }], items: []
                    }
                }))
            },
            cashMovement: { findFirst: jest.fn(), create: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(PaymentService.delete(11, 1, 9, 'Customer refund')).rejects.toThrow(/nota de crédito/i);
        expect(tx.cashMovement.findFirst).not.toHaveBeenCalled();
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
                    branchId: 2,
                    invoiceNumber: null,
                    userId: 9,
                    tableId: 3,
                    status: 'DELIVERED',
                    total: 100,
                    closedAt: new Date(),
                    discountCode: 'PROMO',
                    payments: [{ id: 11, amount: 100 }],
                    table: { id: 3 }
                })),
                update: jest.fn(async (args: { data: { status: string } }) => ({ id: 7, status: args.data.status })),
                count: jest.fn(async () => 0)
            },
            cashMovement: {
                findMany: jest.fn(async () => [{ shiftId: 2, reference: 'PAY-11', amount: 100 }]),
                create: jest.fn(async (_args: unknown) => ({}))
            },
            cashShift: { findFirst: jest.fn(async () => ({ id: 8 })) },
            payment: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
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
        expect(tx.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: { in: [11] }, orderId: 7, status: 'ACTIVE' },
            data: expect.objectContaining({ status: 'REVERSED', reversedById: 9 })
        }));
        expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ type: 'OUT', reference: 'REV-PAY-11' })
        }));
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
        expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });
});
