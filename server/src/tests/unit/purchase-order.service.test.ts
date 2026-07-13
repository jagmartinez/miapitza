import { describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { PurchaseOrderService } from '../../services/purchase-order.service';

describe('PurchaseOrderService accounting invariants', () => {
    it('defaults an omitted invoice type to a fully settled cash purchase', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 2 } as never);
        jest.spyOn(prisma.supplier, 'findFirst').mockResolvedValue({ id: 3 } as never);
        jest.spyOn(prisma.product, 'findMany').mockResolvedValue([{ id: 4 }] as never);

        let createdOrderData: Record<string, unknown> = {};
        const tx = {
            purchaseOrder: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    createdOrderData = args.data;
                    return { id: 10 };
                }),
                findUnique: jest.fn(async () => ({ id: 10 }))
            },
            purchaseOrderItem: { create: jest.fn(async () => ({})) },
            productUnit: { findFirst: jest.fn(async () => null) },
            product: { findFirst: jest.fn(async () => ({ baseUnit: null })) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await PurchaseOrderService.create(1, {
            branchId: 2,
            supplierId: 3,
            items: [{ productId: 4, quantity: 2, cost: 10.125 }]
        });

        expect(createdOrderData.invoiceType).toBe('CASH');
        expect(createdOrderData.total).toBe(20.25);
        expect(createdOrderData.paymentStatus).toBe('PAID');
        expect(createdOrderData.paidAmount).toBe(20.25);
    });

    it('rejects payments before a credit purchase has been received', async () => {
        jest.spyOn(prisma.purchaseOrder, 'findFirst').mockResolvedValue({
            id: 10,
            invoiceType: 'CREDIT',
            status: 'ISSUED',
            paidAmount: 0,
            total: 100
        } as never);

        await expect(PurchaseOrderService.addPayment(10, 1, { amount: 10 }))
            .rejects.toThrow(/recibidas/i);
    });

    it('normalizes payments to currency precision before status and persistence', async () => {
        jest.spyOn(prisma.purchaseOrder, 'findFirst').mockResolvedValue({
            id: 10,
            invoiceType: 'CREDIT',
            status: 'RECEIVED',
            paidAmount: 0,
            total: 10
        } as never);
        let paymentData: Record<string, unknown> = {};
        let updateData: Record<string, unknown> = {};
        const tx = {
            purchaseOrderPayment: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    paymentData = args.data;
                    return { id: 1 };
                })
            },
            purchaseOrder: {
                updateMany: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    updateData = args.data;
                    return { count: 1 };
                }),
                findUnique: jest.fn(async () => ({ paidAmount: 10 }))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await PurchaseOrderService.addPayment(10, 1, { amount: 9.999 });
        expect(paymentData.amount).toBe(10);
        expect(updateData.paidAmount).toBe(10);
        expect(updateData.paymentStatus).toBe('PAID');
    });

    it('rechecks the state under lock and rejects a concurrent receipt before editing', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, status: 'RECEIVED' })),
                update: jest.fn(async () => ({}))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PurchaseOrderService.update(10, 1, { notes: 'late edit' }))
            .rejects.toThrow(/RECEIVED/);
        expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('keeps issued commercial terms immutable while allowing cancellation', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const tx = {
            $queryRaw: jest.fn(async () => []),
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, status: 'ISSUED', invoiceType: 'CREDIT', total: 50 })),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return {};
                })
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(PurchaseOrderService.update(10, 1, { notes: 'changed' }))
            .rejects.toThrow(/inmutable/i);
        await expect(PurchaseOrderService.update(10, 1, { status: 'CANCELLED' }))
            .resolves.toEqual({});
        expect(updates).toEqual([{ status: 'CANCELLED' }]);
    });
});
