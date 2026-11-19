import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';

afterEach(() => {
    jest.restoreAllMocks();
});

function pricingTx(tipRate: string | null) {
    return {
        $queryRaw: jest.fn(async () => []),
        order: {
            findFirst: jest.fn(async () => ({
                id: 41, status: 'OPEN', discount: 0, discountCode: null, tax: 0, tipAmount: 0,
                invoiceNumber: null, preInvoicedAt: null, payments: []
            })),
            update: jest.fn(async (args: unknown) => args)
        },
        orderItem: { findMany: jest.fn(async () => [{ subtotal: 100 }]) },
        setting: {
            findMany: jest.fn(async () => [{ name: '1_tax_rate', value: '15' }]),
            findUnique: jest.fn(async () => (tipRate === null ? null : { value: tipRate }))
        },
        auditLog: { create: jest.fn(async (_args: unknown) => ({})) }
    };
}

describe('OrderService.updatePricing', () => {
    it('caps the tip at the configured rate over the net subtotal and audits a manual discount', async () => {
        const tx = pricingTx('10');
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await OrderService.updatePricing(41, 1, { discount: 20, tipAmount: 500 }, 7);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 20, tax: 12, tipAmount: 8, total: 100 })
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                companyId: 1,
                entityType: 'Order',
                entityId: 41,
                action: 'PRICING_UPDATED',
                userId: 7,
                details: expect.objectContaining({
                    previousDiscount: 0, discount: 20, manualDiscount: true, tipAmount: 8, requestedTipAmount: 500
                })
            })
        });
    });

    it('rejects any tip when no tip rate is configured and skips audit when nothing changes', async () => {
        const tx = pricingTx(null);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await OrderService.updatePricing(41, 1, { discount: 0, tipAmount: 30 }, 7);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 0, tipAmount: 0, total: 115 })
        }));
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
});
