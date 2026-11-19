import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { PaymentService } from '../../services/payment.service';
import {
    claimPromotionUsageAtSettlement,
    releasePromotionReservationForOrder,
    reservePromotionUsageForOrder,
} from '../../services/promotion.service';
import { isRetryableTransactionError, transactionWithP2034Retry } from '../../utils/transaction-retry';

afterEach(() => {
    jest.restoreAllMocks();
});

function promoTx(opts: { latestMarker?: { action: string; details: unknown } | null; claimCount?: number } = {}) {
    return {
        promotion: {
            findFirst: jest.fn(async () => ({ id: 4, usageLimit: 1 })),
            updateMany: jest.fn(async (_args: unknown) => ({ count: opts.claimCount ?? 1 })),
        },
        auditLog: {
            findFirst: jest.fn(async (_args: unknown) => opts.latestMarker ?? null),
            create: jest.fn(async (_args: unknown) => ({})),
        },
    };
}

describe('promotion usage reservation at prefactura', () => {
    it('claims one use atomically under the limit and records the reservation', async () => {
        const tx = promoTx();
        await expect(reservePromotionUsageForOrder(tx as never, {
            companyId: 1, orderId: 9, discountCode: 'promo', userId: 7,
        })).resolves.toBe(true);
        expect(tx.promotion.updateMany).toHaveBeenCalledWith({
            where: { id: 4, usageLimit: 1, usageCount: { lt: 1 } },
            data: { usageCount: { increment: 1 } },
        });
        expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            entityType: 'Order', entityId: 9, action: 'PROMOTION_USAGE_RESERVED',
            details: { promotionId: 4, code: 'PROMO' },
        }) });
    });

    it('fails the prefactura when the limit is already consumed', async () => {
        const tx = promoTx({ claimCount: 0 });
        await expect(reservePromotionUsageForOrder(tx as never, {
            companyId: 1, orderId: 9, discountCode: 'PROMO', userId: 7,
        })).rejects.toThrow(/límite de uso/);
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('is idempotent for an order that already holds the reservation', async () => {
        const tx = promoTx({ latestMarker: { action: 'PROMOTION_USAGE_RESERVED', details: { promotionId: 4, code: 'PROMO' } } });
        await expect(reservePromotionUsageForOrder(tx as never, {
            companyId: 1, orderId: 9, discountCode: 'PROMO', userId: 7,
        })).resolves.toBe(false);
        expect(tx.promotion.updateMany).not.toHaveBeenCalled();
    });

    it('final settlement honors the reservation instead of claiming twice', async () => {
        const tx = promoTx({ latestMarker: { action: 'PROMOTION_USAGE_RESERVED', details: { promotionId: 4, code: 'PROMO' } } });
        await claimPromotionUsageAtSettlement(tx as never, { companyId: 1, orderId: 9, discountCode: 'PROMO' });
        expect(tx.promotion.updateMany).not.toHaveBeenCalled();
    });

    it('final settlement still claims for unreserved (legacy) orders and enforces the limit', async () => {
        const tx = promoTx({ claimCount: 0 });
        await expect(claimPromotionUsageAtSettlement(tx as never, { companyId: 1, orderId: 9, discountCode: 'PROMO' }))
            .rejects.toThrow('La promoción alcanzó su límite de uso');
    });

    it('releases an active reservation exactly once', async () => {
        const reserved = promoTx({ latestMarker: { action: 'PROMOTION_USAGE_RESERVED', details: { promotionId: 4, code: 'PROMO' } } });
        await expect(releasePromotionReservationForOrder(reserved as never, {
            companyId: 1, orderId: 9, userId: 7, reason: 'Prefactura revertida',
        })).resolves.toBe(true);
        expect(reserved.promotion.updateMany).toHaveBeenCalledWith({
            where: { id: 4, companyId: 1, usageCount: { gt: 0 } },
            data: { usageCount: { decrement: 1 } },
        });
        expect(reserved.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PROMOTION_USAGE_RELEASED' }) });

        const released = promoTx({ latestMarker: { action: 'PROMOTION_USAGE_RELEASED', details: { promotionId: 4 } } });
        await expect(releasePromotionReservationForOrder(released as never, {
            companyId: 1, orderId: 9, userId: 7, reason: 'again',
        })).resolves.toBe(false);
        expect(released.promotion.updateMany).not.toHaveBeenCalled();
    });
});

describe('payment lock order and reservation-aware reversal', () => {
    beforeEach(() => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({ tableId: 3 } as never);
    });

    it('locks Table before Order when paying a table order', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, branchId: 2, tableId: 3, total: 10,
                    financialStatus: 'UNPAID', status: 'READY', cashRegisterId: null, discountCode: null,
                    preInvoicedAt: new Date(), invoiceNumber: null, invoiceFiscalStatus: null, payments: [],
                })),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            user: { findFirst: jest.fn(async () => ({ id: 7 })) },
            paymentMethod: { findFirst: jest.fn(async () => ({ id: 3, type: 'CARD' })) },
            payment: { create: jest.fn(async () => ({ id: 1 })) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (db: typeof tx) => unknown) => cb(tx)) as never);
        jest.spyOn(OrderService, 'reconcileTableAccount').mockResolvedValue(true as never);

        await PaymentService.create(1, { orderId: 9, paymentMethodId: 3, amount: 10 }, 7);

        const sql = tx.$queryRaw.mock.calls.map((call) => ((call as unknown[])[0] as string[]).join('?'));
        expect(sql[0]).toContain('`Table`');
        expect(sql[1]).toContain('`Order`');
    });

    it('keeps a prefactura reservation when a full payment is reversed', async () => {
        jest.spyOn(prisma.payment, 'findFirst').mockResolvedValue({ orderId: 7, order: { tableId: null } } as never);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            payment: {
                findFirst: jest.fn(async () => ({
                    id: 11, orderId: 7, amount: 100, methodType: 'CARD', fiscalCreditNoteRefunds: [],
                    order: {
                        id: 7, branchId: 2, invoiceNumber: null, invoiceFiscalStatus: null, total: 100,
                        tableId: null, discountCode: 'PROMO', payments: [{ id: 11, amount: 100 }],
                    },
                })),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            order: { update: jest.fn(async (_args: unknown) => ({})) },
            promotion: { findFirst: jest.fn(), update: jest.fn() },
            auditLog: {
                create: jest.fn(async (_args: unknown) => ({})),
                findFirst: jest.fn(async () => ({ action: 'PROMOTION_USAGE_RESERVED', details: { promotionId: 4, code: 'PROMO' } })),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (db: typeof tx) => unknown) => cb(tx)) as never);

        await PaymentService.delete(11, 1, 9, 'Refund');

        expect(tx.promotion.update).not.toHaveBeenCalled();
    });
});

describe('transaction retry on raw-query lock conflicts', () => {
    it('classifies MySQL deadlock / lock-wait raw errors as retryable, others not', () => {
        expect(isRetryableTransactionError({ code: 'P2010', meta: { code: '1213' } })).toBe(true);
        expect(isRetryableTransactionError({ code: 'P2010', meta: { code: 1205 } })).toBe(true);
        expect(isRetryableTransactionError({ code: 'P2010', message: 'Raw query failed. Deadlock found when trying to get lock' })).toBe(true);
        expect(isRetryableTransactionError({ code: 'P2010', meta: { code: '1062', message: 'Duplicate entry' } })).toBe(false);
        expect(isRetryableTransactionError(new Error('Order not found'))).toBe(false);
    });

    it('replays the transaction after a P2010 deadlock and stops at the bound', async () => {
        const deadlock = Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '1213' } });
        const transaction = jest.spyOn(prisma, '$transaction')
            .mockRejectedValueOnce(deadlock as never)
            .mockResolvedValueOnce('ok' as never);
        await expect(transactionWithP2034Retry(async () => 'ok')).resolves.toBe('ok');
        expect(transaction).toHaveBeenCalledTimes(2);

        transaction.mockReset();
        transaction.mockRejectedValue(deadlock as never);
        await expect(transactionWithP2034Retry(async () => 'never', undefined, 2)).rejects.toBe(deadlock);
        expect(transaction).toHaveBeenCalledTimes(2);
    });
});

describe('manual discount cap for waiters', () => {
    function pricingTx(maxPercent: string | null) {
        return {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41, status: 'OPEN', discount: 0, discountCode: null, tax: 0, tipAmount: 0,
                    invoiceNumber: null, preInvoicedAt: null, payments: [],
                })),
                update: jest.fn(async (args: unknown) => args),
            },
            orderItem: { findMany: jest.fn(async () => [{ subtotal: 100 }]) },
            setting: {
                findMany: jest.fn(async () => [{ name: '1_tax_rate', value: '15' }]),
                findUnique: jest.fn(async (args: { where: { companyId_name: { name: string } } }) => (
                    args.where.companyId_name.name === '1_maxManualDiscountPercent' && maxPercent !== null
                        ? { value: maxPercent }
                        : null
                )),
            },
            auditLog: { create: jest.fn(async (_args: unknown) => ({})) },
        };
    }

    it('rejects a MESERO manual discount above the configured percent', async () => {
        const tx = pricingTx('10');
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (db: typeof tx) => unknown) => cb(tx)) as never);
        await expect(OrderService.updatePricing(41, 1, { discount: 20 }, 7, { role: 'MESERO', roles: ['MESERO'] }))
            .rejects.toThrow(/máximo permitido/);
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('allows the same discount for ADMIN and for MESERO when the setting is absent', async () => {
        const capped = pricingTx('10');
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (db: typeof capped) => unknown) => cb(capped)) as never);
        await OrderService.updatePricing(41, 1, { discount: 20 }, 7, { role: 'ADMIN', roles: ['ADMIN'] });
        expect(capped.order.update).toHaveBeenCalled();

        jest.restoreAllMocks();
        const open = pricingTx(null);
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (db: typeof open) => unknown) => cb(open)) as never);
        await OrderService.updatePricing(41, 1, { discount: 20 }, 7, { role: 'MESERO', roles: ['MESERO'] });
        expect(open.order.update).toHaveBeenCalled();
    });
});
