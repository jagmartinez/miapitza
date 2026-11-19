import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { Promotion } from '@prisma/client';

import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';
import {
    calculatePromotionDiscount,
    parsePromotionDate,
    PromotionService,
    PromotionValidationError,
    PROMOTION_USAGE_RELEASED,
    PROMOTION_USAGE_RESERVED,
    reservePromotionUsageForOrder,
    returnPromotionUsageForOrder,
    withPromotionDateKeys,
} from '../../services/promotion.service';

type PromoRule = Parameters<typeof calculatePromotionDiscount>[0];
const NOW = new Date('2026-11-18T18:00:00.000Z');

function promo(overrides: Partial<Record<keyof PromoRule, unknown>> = {}): PromoRule {
    return {
        active: true,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: null,
        usageLimit: null,
        usageCount: 0,
        minOrderAmount: null,
        type: 'PERCENTAGE',
        value: 15,
        maxDiscount: null,
        ...overrides,
    } as unknown as PromoRule;
}

afterEach(() => { jest.restoreAllMocks(); });

describe('calculatePromotionDiscount — cents and caps', () => {
    it('rounds percentage discounts half-up in exact cents (float gave 0.22 for 15% of 1.50)', () => {
        expect(calculatePromotionDiscount(promo(), 1.5, NOW)).toBe(0.23);
        expect(calculatePromotionDiscount(promo(), 10.1, NOW)).toBe(1.52);
        expect(calculatePromotionDiscount(promo({ value: 10 }), 1.05, NOW)).toBe(0.11);
        expect(calculatePromotionDiscount(promo({ value: 12.5 }), 99.99, NOW)).toBe(12.5);
    });

    it('caps by maxDiscount and never exceeds the subtotal (no negative totals)', () => {
        expect(calculatePromotionDiscount(promo({ value: 90, maxDiscount: 25 }), 200, NOW)).toBe(25);
        expect(calculatePromotionDiscount(promo({ type: 'FIXED_AMOUNT', value: 50 }), 30.25, NOW)).toBe(30.25);
        expect(calculatePromotionDiscount(promo({ value: 100 }), 47.37, NOW)).toBe(47.37);
        expect(calculatePromotionDiscount(promo({ type: 'FIXED_AMOUNT', value: 10 }), 0, NOW)).toBe(0);
    });

    it('applies the discount to the pre-tax base; IVA 15% is then charged on the net', () => {
        const subtotal = 100;
        const discount = calculatePromotionDiscount(promo({ value: 10 }), subtotal, NOW);
        const tax = Math.round((subtotal - discount) * 0.15 * 100) / 100;
        expect(discount).toBe(10);
        expect(tax).toBe(13.5);
        expect(subtotal - discount + tax).toBe(103.5);
    });

    it('compares minimum order amount in cents', () => {
        expect(calculatePromotionDiscount(promo({ minOrderAmount: 100 }), 100, NOW)).toBe(15);
        expect(() => calculatePromotionDiscount(promo({ minOrderAmount: 100 }), 99.99, NOW)).toThrow(PromotionValidationError);
    });

    it('throws user-facing Spanish messages (surfaced verbatim by order writes)', () => {
        expect(() => calculatePromotionDiscount(promo({ minOrderAmount: 100 }), 50, NOW))
            .toThrow('El subtotal no alcanza el monto mínimo de la promoción');
        expect(() => calculatePromotionDiscount(promo({ active: false }), 50, NOW)).toThrow('Esta promoción ya no está activa');
        try {
            calculatePromotionDiscount(promo({ usageLimit: 1, usageCount: 1 }), 50, NOW);
        } catch (error) {
            expect((error as PromotionValidationError).code).toBe('USAGE_LIMIT');
        }
    });
});

describe('promotion windows in the company time zone', () => {
    const tz = 'America/Managua'; // UTC-6, no DST

    it('maps date-only bounds to the whole local day', () => {
        expect(parsePromotionDate('2026-11-18', 'start', tz).toISOString()).toBe('2026-11-18T06:00:00.000Z');
        expect(parsePromotionDate('2026-11-18', 'end', tz).toISOString()).toBe('2026-11-19T05:59:59.999Z');
        expect(parsePromotionDate('2026-11-18T10:00:00.000Z', 'end', tz).toISOString()).toBe('2026-11-18T10:00:00.000Z');
    });

    it('keeps a promotion "valid until the 18th" valid at 20:00 local on the 18th', () => {
        const validTo = parsePromotionDate('2026-11-18', 'end', tz);
        const at2000Local = new Date('2026-11-19T02:00:00.000Z');
        expect(calculatePromotionDiscount(promo({ validTo }), 100, at2000Local)).toBe(15);
        // The old UTC-midnight interpretation had already expired it at 18:00 on the 17th.
        expect(() => calculatePromotionDiscount(promo({ validTo: new Date('2026-11-18') }), 100, at2000Local)).toThrow('Esta promoción ha expirado');
    });

    it('create() stores local day bounds from date-only input', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue(tz);
        const create = jest.fn(async (args: { data: unknown }) => ({ id: 9, ...(args.data as object) }));
        const tx = {
            promotion: { create, findUniqueOrThrow: jest.fn(async () => ({ id: 9 })) },
            ...ruleRelationDoubles(),
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: (client: typeof tx) => unknown) => fn(tx)) as never);
        await PromotionService.create(1, {
            code: 'nov', name: 'Noviembre', type: 'PERCENTAGE', value: 10,
            validFrom: '2026-11-01', validTo: '2026-11-30',
        });
        const data = (create.mock.calls[0][0] as { data: Partial<Promotion> }).data;
        expect(data.code).toBe('NOV');
        expect((data.validFrom as Date).toISOString()).toBe('2026-11-01T06:00:00.000Z');
        expect((data.validTo as Date).toISOString()).toBe('2026-12-01T05:59:59.999Z');
    });

    function ruleRelationDoubles() {
        const relation = () => ({ deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async () => ({ count: 0 })) });
        return { promotionBranch: relation(), promotionTarget: relation(), promotionComboItem: relation() };
    }

    function mockUpdateTransaction(storedCode: string, referencingOrders: number) {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue(tz);
        const stored = {
            id: 3, companyId: 1, code: storedCode, type: 'PERCENTAGE', value: 10,
            validFrom: new Date('2026-01-01'), validTo: null,
        };
        jest.spyOn(prisma.promotion, 'findFirst').mockResolvedValue(stored as never);
        const tx = {
            $queryRaw: jest.fn(async () => [{ id: 3 }]),
            promotion: {
                findFirst: jest.fn(async () => ({ code: storedCode })),
                update: jest.fn(async ({ data }: { data: unknown }) => ({ ...stored, ...(data as object) })),
                findUniqueOrThrow: jest.fn(async () => stored),
            },
            order: { count: jest.fn(async () => referencingOrders) },
            ...ruleRelationDoubles(),
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: (client: typeof tx) => unknown) => fn(tx)) as never);
        return tx;
    }

    it('update() refuses to rename a code already applied to orders, under the row lock', async () => {
        const tx = mockUpdateTransaction('OLD', 2);
        await expect(PromotionService.update(3, 1, { code: 'NEW' })).rejects.toThrow(/ya fue aplicado a órdenes/);
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
        expect(String((tx.$queryRaw.mock.calls[0] as unknown[])[0])).toContain('FOR UPDATE');
        expect(tx.promotion.update).not.toHaveBeenCalled();
    });

    it('update() does not treat re-saving a legacy padded code as a rename', async () => {
        const tx = mockUpdateTransaction(' old ', 5);
        await PromotionService.update(3, 1, { code: 'old', name: 'Renombrada' });
        expect(tx.order.count).not.toHaveBeenCalled();
        const data = (tx.promotion.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
        expect(data).not.toHaveProperty('code');
        expect(data.name).toBe('Renombrada');
    });

    it('maps date-only bounds on a day without local midnight (DST) instead of throwing', () => {
        expect(parsePromotionDate('2026-09-06', 'start', 'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z');
        expect(parsePromotionDate('2026-09-05', 'end', 'America/Santiago').toISOString()).toBe('2026-09-06T03:59:59.999Z');
        expect(parsePromotionDate('2026-03-08', 'start', 'America/Havana').toISOString()).toBe('2026-03-08T05:00:00.000Z');
        expect(parsePromotionDate('2026-03-29', 'start', 'Asia/Beirut').toISOString()).toBe('2026-03-28T22:00:00.000Z');
    });

    it('returns the window as company-zone calendar dates that round-trip through a save', () => {
        const validFrom = parsePromotionDate('2026-11-01', 'start', tz);
        const validTo = parsePromotionDate('2026-11-30', 'end', tz);
        const keyed = withPromotionDateKeys({ id: 1, validFrom, validTo }, tz);
        expect(keyed.validFromDate).toBe('2026-11-01');
        expect(keyed.validToDate).toBe('2026-11-30');
        expect(parsePromotionDate(keyed.validToDate!, 'end', tz).getTime()).toBe(validTo.getTime());
        // An intra-day start (created "now") keeps its company-zone day.
        expect(withPromotionDateKeys({ validFrom: new Date('2026-11-18T20:37:00.000Z'), validTo: null }, tz))
            .toMatchObject({ validFromDate: '2026-11-18', validToDate: null });
    });
});

/** Minimal tx double: one promotion row + append-only audit log. */
function promotionTx(initial: { usageCount: number; usageLimit: number | null }) {
    const promotion = { id: 7, companyId: 1, code: 'VIP', ...initial };
    const audit: Array<{ id: number; entityId: number; action: string; details: unknown }> = [];
    const tx = {
        promotion: {
            findFirst: jest.fn(async () => ({ id: promotion.id, usageLimit: promotion.usageLimit })),
            updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: { usageCount: { increment?: number; decrement?: number } } }) => {
                const lt = (where.usageCount as { lt?: number } | undefined)?.lt;
                const gt = (where.usageCount as { gt?: number } | undefined)?.gt;
                if (lt !== undefined && !(promotion.usageCount < lt)) return { count: 0 };
                if (gt !== undefined && !(promotion.usageCount > gt)) return { count: 0 };
                promotion.usageCount += (data.usageCount.increment ?? 0) - (data.usageCount.decrement ?? 0);
                return { count: 1 };
            }),
        },
        auditLog: {
            findFirst: jest.fn(async ({ where }: { where: { entityId: number } }) =>
                [...audit].reverse().find((row) => row.entityId === where.entityId) ?? null),
            create: jest.fn(async ({ data }: { data: { entityId: number; action: string; details: unknown } }) => {
                audit.push({ id: audit.length + 1, ...data });
                return {};
            }),
        },
    };
    return { tx: tx as never, promotion, audit };
}

describe('returnPromotionUsageForOrder — exactly once on final credit note', () => {
    it('releases a prefactura reservation through its marker, once', async () => {
        const { tx, promotion, audit } = promotionTx({ usageCount: 0, usageLimit: 1 });
        await reservePromotionUsageForOrder(tx, { companyId: 1, orderId: 50, discountCode: 'vip', userId: 2 });
        expect(promotion.usageCount).toBe(1);

        await expect(returnPromotionUsageForOrder(tx, {
            companyId: 1, orderId: 50, discountCode: 'VIP', userId: 2, reason: 'NC final',
        })).resolves.toBe('RELEASED');
        expect(promotion.usageCount).toBe(0);
        expect(audit.map((row) => row.action)).toEqual([PROMOTION_USAGE_RESERVED, PROMOTION_USAGE_RELEASED]);
    });

    it('decrements an unreserved settlement claim and never goes below zero', async () => {
        const { tx, promotion } = promotionTx({ usageCount: 1, usageLimit: null });
        await expect(returnPromotionUsageForOrder(tx, {
            companyId: 1, orderId: 51, discountCode: 'VIP', userId: 2, reason: 'NC final',
        })).resolves.toBe('DECREMENTED');
        expect(promotion.usageCount).toBe(0);
        await expect(returnPromotionUsageForOrder(tx, {
            companyId: 1, orderId: 51, discountCode: 'VIP', userId: 2, reason: 'NC final',
        })).resolves.toBe('NONE');
        expect(promotion.usageCount).toBe(0);
    });

    it('is a no-op for orders without a code', async () => {
        const { tx, promotion } = promotionTx({ usageCount: 3, usageLimit: null });
        await expect(returnPromotionUsageForOrder(tx, {
            companyId: 1, orderId: 52, discountCode: null, userId: 2, reason: 'x',
        })).resolves.toBe('NONE');
        expect(promotion.usageCount).toBe(3);
    });
});
