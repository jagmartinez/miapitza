import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';
import { OrderService } from '../../services/order.service';
import { CreditNoteService } from '../../services/credit-note.service';
import { SplitBillService } from '../../services/split-bill.service';
import {
    allocateDiscountWithAttribution,
    calculatePromotionDiscount,
    evaluatePromotion,
    isWithinPromotionSchedule,
    PromotionService,
    PromotionValidationError,
    serializePromotion,
    type PromotionLine,
    type PromotionRule,
} from '../../services/promotion.service';

const TZ = 'America/Managua'; // UTC-6, no DST
const NOW = new Date('2026-11-18T18:00:00.000Z');

afterEach(() => { jest.restoreAllMocks(); });

function rule(overrides: Partial<Record<keyof PromotionRule, unknown>> = {}): PromotionRule {
    return {
        active: true,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: null,
        usageLimit: null,
        usageCount: 0,
        minOrderAmount: null,
        type: 'PERCENTAGE',
        value: 20,
        maxDiscount: null,
        scope: 'ORDER',
        weekdays: null,
        dailyStartTime: null,
        dailyEndTime: null,
        allBranches: true,
        buyQuantity: null,
        payQuantity: null,
        branches: [],
        targets: [],
        comboItems: [],
        ...overrides,
    } as unknown as PromotionRule;
}

// Hamburguesa (cat 1), cerveza (cat 2), refresco (cat 2), papas (cat 1).
const BURGER = 10, FRIES = 11, BEER = 20, SODA = 30;
function line(id: number, menuItemId: number, categoryId: number, quantity: number, unitPrice: number, extra: Partial<PromotionLine> = {}): PromotionLine {
    return { id, menuItemId, categoryId, quantity, unitPrice, subtotal: unitPrice * quantity, ...extra };
}
const subtotalOf = (lines: PromotionLine[]) => lines.reduce((sum, item) => sum + (item.subtotal ?? 0), 0);
const byLine = (result: { lineDiscounts: Array<{ lineId: number; discount: number }> }) =>
    Object.fromEntries(result.lineDiscounts.map((entry) => [entry.lineId, entry.discount]));

describe('happy hour (company time zone)', () => {
    const weekdays = rule({ weekdays: '1,2,3,4,5', dailyStartTime: '17:00', dailyEndTime: '19:00' });

    it('is active Lun–Vie 17:00–19:00 local, end exclusive', () => {
        // Friday 2026-11-20 18:00 Managua = 2026-11-21T00:00Z
        expect(isWithinPromotionSchedule(weekdays, new Date('2026-11-21T00:00:00.000Z'), TZ)).toBe(true);
        expect(isWithinPromotionSchedule(weekdays, new Date('2026-11-20T23:00:00.000Z'), TZ)).toBe(true); // 17:00
        expect(isWithinPromotionSchedule(weekdays, new Date('2026-11-21T01:00:00.000Z'), TZ)).toBe(false); // 19:00
        // Saturday 18:00 local
        expect(isWithinPromotionSchedule(weekdays, new Date('2026-11-22T00:00:00.000Z'), TZ)).toBe(false);
    });

    it('handles a window crossing midnight (Vie 22:00–02:00 belongs to Friday)', () => {
        const late = rule({ weekdays: '5', dailyStartTime: '22:00', dailyEndTime: '02:00' });
        expect(isWithinPromotionSchedule(late, new Date('2026-11-21T05:00:00.000Z'), TZ)).toBe(true); // Fri 23:00
        expect(isWithinPromotionSchedule(late, new Date('2026-11-21T07:30:00.000Z'), TZ)).toBe(true); // Sat 01:30
        expect(isWithinPromotionSchedule(late, new Date('2026-11-21T08:00:00.000Z'), TZ)).toBe(false); // Sat 02:00
        expect(isWithinPromotionSchedule(late, new Date('2026-11-20T07:30:00.000Z'), TZ)).toBe(false); // Fri 01:30 (Thu window)
        expect(isWithinPromotionSchedule(late, new Date('2026-11-22T05:00:00.000Z'), TZ)).toBe(false); // Sat 23:00
    });

    it('refuses to apply outside the window and only discounts lines ordered inside it', () => {
        const happy = rule({ type: 'PERCENTAGE', value: 50, weekdays: '1,2,3,4,5', dailyStartTime: '17:00', dailyEndTime: '19:00' });
        const fridayAt1830 = new Date('2026-11-21T00:30:00.000Z');
        const lines = [
            line(1, BEER, 2, 2, 50, { orderedAt: new Date('2026-11-20T22:50:00.000Z') }), // 16:50, before
            line(2, BEER, 2, 2, 50, { orderedAt: new Date('2026-11-20T23:10:00.000Z') }), // 17:10, inside
        ];
        const applied = evaluatePromotion(happy, { subtotal: 200, lines, timeZone: TZ, now: fridayAt1830 });
        expect(applied.discount).toBe(50);
        expect(byLine(applied)).toEqual({ 2: 50 });

        // 19:30: applying is refused …
        const after = new Date('2026-11-21T01:30:00.000Z');
        expect(() => evaluatePromotion(happy, { subtotal: 200, lines, timeZone: TZ, now: after }))
            .toThrow('Esta promoción no está vigente en este día u horario');
        // … but an order that already holds it keeps the discount for lines
        // ordered during happy hour; a beer added at 19:30 pays full price.
        const repriced = evaluatePromotion(happy, {
            subtotal: 300,
            lines: [...lines, line(3, BEER, 2, 2, 50, { orderedAt: after })],
            timeZone: TZ, now: after, mode: 'reprice'
        });
        expect(repriced.discount).toBe(50);
        expect(byLine(repriced)).toEqual({ 2: 50 });
    });
});

describe('per-item promotions', () => {
    const lines = [line(1, BURGER, 1, 1, 180), line(2, BEER, 2, 3, 55), line(3, SODA, 2, 2, 40)];
    const subtotal = subtotalOf(lines); // 425

    it('applies a percentage per eligible line only (category)', () => {
        const promo = rule({ scope: 'ITEMS', value: 20, targets: [{ menuItemId: null, categoryId: 2 }] });
        const result = evaluatePromotion(promo, { subtotal, lines, now: NOW });
        // 20% of 165 = 33.00, 20% of 80 = 16.00; the burger is untouched.
        expect(result.discount).toBe(49);
        expect(byLine(result)).toEqual({ 2: 33, 3: 16 });
    });

    it('applies a fixed amount per eligible unit (product), never above the unit price', () => {
        const promo = rule({ scope: 'ITEMS', type: 'FIXED_AMOUNT', value: 10, targets: [{ menuItemId: SODA, categoryId: null }] });
        expect(byLine(evaluatePromotion(promo, { subtotal, lines, now: NOW }))).toEqual({ 3: 20 });
        const huge = rule({ scope: 'ITEMS', type: 'FIXED_AMOUNT', value: 100, targets: [{ menuItemId: SODA, categoryId: null }] });
        expect(byLine(evaluatePromotion(huge, { subtotal, lines, now: NOW }))).toEqual({ 3: 80 });
    });

    it('scales line discounts to maxDiscount in exact cents', () => {
        const promo = rule({ scope: 'ITEMS', value: 20, maxDiscount: 40, targets: [{ menuItemId: null, categoryId: 2 }] });
        const result = evaluatePromotion(promo, { subtotal, lines, now: NOW });
        expect(result.discount).toBe(40);
        expect(byLine(result)).toEqual({ 2: 26.94, 3: 13.06 });
    });

    it('rejects on apply but yields 0 on reprice when no eligible line remains', () => {
        const promo = rule({ scope: 'ITEMS', value: 20, targets: [{ menuItemId: FRIES, categoryId: null }] });
        expect(() => evaluatePromotion(promo, { subtotal, lines, now: NOW }))
            .toThrow('La orden no contiene productos elegibles para esta promoción');
        expect(evaluatePromotion(promo, { subtotal, lines, now: NOW, mode: 'reprice' })).toEqual({ discount: 0, lineDiscounts: [], lineBased: true });
    });

    it('N x M: 3x2 frees the cheapest unit of every group of three', () => {
        const threeForTwo = rule({ scope: 'ITEMS', type: 'BUY_X_GET_Y', value: 0, buyQuantity: 3, payQuantity: 2, targets: [{ menuItemId: null, categoryId: 2 }] });
        // Units 55,55,55 | 40,40,40 → one beer + one soda free … with 2 sodas: 55,55,55 | 40,40 → one beer free.
        expect(byLine(evaluatePromotion(threeForTwo, { subtotal, lines, now: NOW }))).toEqual({ 2: 55 });
        const more = [...lines.slice(0, 2), line(3, SODA, 2, 3, 40)];
        const result = evaluatePromotion(threeForTwo, { subtotal: subtotalOf(more), lines: more, now: NOW });
        expect(result.discount).toBe(95);
        expect(byLine(result)).toEqual({ 2: 55, 3: 40 });
        expect(() => evaluatePromotion(threeForTwo, { subtotal: 110, lines: [line(9, BEER, 2, 2, 55)], now: NOW }))
            .toThrow('La orden no alcanza la cantidad de productos requerida por la promoción');
    });
});

describe('combos', () => {
    const combo = rule({
        type: 'COMBO', scope: 'ITEMS', value: 250,
        comboItems: [{ menuItemId: BURGER, quantity: 1 }, { menuItemId: FRIES, quantity: 1 }, { menuItemId: SODA, quantity: 1 }]
    });

    it('charges the combo price per complete set and attributes the difference to its lines', () => {
        // 180 + 80 + 40 = 300 → combo 250 → 50 off per set; only one soda = one set.
        const lines = [line(1, BURGER, 1, 2, 180), line(2, FRIES, 1, 2, 80), line(3, SODA, 2, 1, 40)];
        const one = evaluatePromotion(combo, { subtotal: subtotalOf(lines), lines, now: NOW });
        expect(one.discount).toBe(50);
        expect(byLine(one)).toEqual({ 1: 30, 2: 13.33, 3: 6.67 });

        const two = [...lines.slice(0, 2), line(3, SODA, 2, 2, 40)];
        const result = evaluatePromotion(combo, { subtotal: subtotalOf(two), lines: two, now: NOW });
        expect(result.discount).toBe(100);
        expect(byLine(result)).toEqual({ 1: 60, 2: 26.66, 3: 13.34 });
    });

    it('keeps modifier extras charged (combo prices the base product)', () => {
        const lines = [line(1, BURGER, 1, 1, 200, { modifierUnitPrice: 20 }), line(2, FRIES, 1, 1, 80), line(3, SODA, 2, 1, 40)];
        const result = evaluatePromotion(combo, { subtotal: 320, lines, now: NOW });
        expect(result.discount).toBe(50); // pays 250 + 20 extra cheese
    });

    it('requires every component', () => {
        const lines = [line(1, BURGER, 1, 1, 180), line(2, FRIES, 1, 1, 80)];
        expect(() => evaluatePromotion(combo, { subtotal: 260, lines, now: NOW }))
            .toThrow('La orden no contiene todos los productos del combo');
    });
});

describe('branch-specific promotions and backward compatibility', () => {
    it('applies only in the selected branches', () => {
        const promo = rule({ allBranches: false, branches: [{ branchId: 2 }] });
        expect(() => evaluatePromotion(promo, { subtotal: 100, branchId: 1, now: NOW }))
            .toThrow('Esta promoción no aplica en esta sucursal');
        expect(evaluatePromotion(promo, { subtotal: 100, branchId: 2, now: NOW }).discount).toBe(20);
    });

    it('legacy ORDER promotions return exactly calculatePromotionDiscount with no line attribution', () => {
        const promo = rule({ value: 15 });
        for (const subtotal of [1.5, 10.1, 99.99, 200]) {
            expect(evaluatePromotion(promo, { subtotal, now: NOW })).toEqual({
                discount: calculatePromotionDiscount(promo, subtotal, NOW), lineDiscounts: [], lineBased: false
            });
        }
    });

    it('splits a discount keeping line attribution and spreading only the remainder', () => {
        expect(allocateDiscountWithAttribution(4900, [18000, 16500, 8000], [0, 3300, 1600], [1, 2, 3])).toEqual([0, 3300, 1600]);
        expect(allocateDiscountWithAttribution(5000, [10000, 10000], [1000, 0], [1, 2])).toEqual([2895, 2105]);
        expect(allocateDiscountWithAttribution(4900, [18000, 16500, 8000], [0, 0, 0], [1, 2, 3])).toBeNull();
        expect(allocateDiscountWithAttribution(100, [18000], [200], [1])).toBeNull();
    });
});

describe('order integration (per-line attribution persisted)', () => {
    function pricingTx() {
        const lines = [
            { id: 1, menuItemId: BURGER, quantity: 1, price: 180, subtotal: 180, createdAt: NOW, menuItem: { categoryId: 1 }, modifiers: [] },
            { id: 2, menuItemId: BEER, quantity: 3, price: 55, subtotal: 165, createdAt: NOW, menuItem: { categoryId: 2 }, modifiers: [] },
            { id: 3, menuItemId: SODA, quantity: 2, price: 40, subtotal: 80, createdAt: NOW, menuItem: { categoryId: 2 }, modifiers: [] },
        ];
        const stored = new Map<number, number>([[1, 5], [2, 0], [3, 0]]);
        return {
            stored,
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41, branchId: 1, status: 'OPEN', discount: 0, discountCode: null, tax: 0, tipAmount: 0,
                    invoiceNumber: null, preInvoicedAt: null, payments: []
                })),
                update: jest.fn(async (args: unknown) => args)
            },
            orderItem: {
                findMany: jest.fn(async (args: { select?: Record<string, unknown> }) => {
                    if (args.select?.promotionDiscount) return lines.map((item) => ({ id: item.id, promotionDiscount: stored.get(item.id) }));
                    if (args.select?.menuItemId) return lines;
                    return lines.map((item) => ({ subtotal: item.subtotal }));
                }),
                update: jest.fn(async ({ where, data }: { where: { id: number }; data: { promotionDiscount: number } }) => {
                    stored.set(where.id, data.promotionDiscount);
                    return {};
                })
            },
            promotion: {
                findFirst: jest.fn(async () => ({
                    ...rule({ scope: 'ITEMS', value: 20, targets: [{ menuItemId: null, categoryId: 2 }] }),
                    id: 5, code: 'BEBIDAS20'
                }))
            },
            setting: {
                findMany: jest.fn(async () => [{ name: '1_tax_rate', value: '15' }]),
                findUnique: jest.fn(async () => null)
            },
            auditLog: { create: jest.fn(async (_args: unknown) => ({})) }
        };
    }

    it('updatePricing computes the per-item discount server-side and stores it per line', async () => {
        const tx = pricingTx();
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        // The client-sent discount is ignored for promotion codes.
        await OrderService.updatePricing(41, 1, { discount: 999, discountCode: 'bebidas20' }, 7);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            // 425 - 49 = 376; IVA 15% = 56.40
            data: expect.objectContaining({ discount: 49, discountCode: 'BEBIDAS20', tax: 56.4, total: 432.4 })
        }));
        expect(Object.fromEntries(tx.stored)).toEqual({ 1: 0, 2: 33, 3: 16 });
    });
});

describe('credit notes and split bills follow the line attribution', () => {
    it('a credit note for the burger returns no promotion discount; the drinks return theirs', () => {
        const build = (CreditNoteService as unknown as {
            buildInvoiceAllocations: (invoice: unknown, items: unknown[]) => Array<{ orderItemId: number; discountCents: number; taxCents: number }>;
        }).buildInvoiceAllocations.bind(CreditNoteService);
        const invoice = {
            items: [
                { orderItemId: 1, name: 'Hamburguesa', quantity: 1, price: 180, subtotal: 180 },
                { orderItemId: 2, name: 'Cerveza', quantity: 3, price: 55, subtotal: 165, discount: 33 },
                { orderItemId: 3, name: 'Refresco', quantity: 2, price: 40, subtotal: 80, discount: 16 },
            ],
            grossSubtotal: 425, discount: 49, subtotal: 376, tax: 56.4, tipAmount: 0, total: 432.4
        };
        const allocations = build(invoice, [
            { id: 1, quantity: 1, price: 180, subtotal: 180 },
            { id: 2, quantity: 3, price: 55, subtotal: 165 },
            { id: 3, quantity: 2, price: 40, subtotal: 80 },
        ]);
        expect(allocations.map((entry) => entry.discountCents)).toEqual([0, 3300, 1600]);
        expect(allocations.map((entry) => entry.taxCents)).toEqual([2700, 1980, 960]);

        // Legacy invoices (no line attribution) keep the proportional split.
        const legacy = build({ ...invoice, items: invoice.items.map(({ discount: _discount, ...item }) => item) }, [
            { id: 1, quantity: 1, price: 180, subtotal: 180 },
            { id: 2, quantity: 3, price: 55, subtotal: 165 },
            { id: 3, quantity: 2, price: 40, subtotal: 80 },
        ]);
        expect(legacy.map((entry) => entry.discountCents)).toEqual([2075, 1902, 923]);
    });

    it('split by items charges each diner the promotion of the lines they take', async () => {
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 41, total: 432.4, discount: 49, tax: 56.4, tipAmount: 0, payments: [],
            items: [
                { id: 1, subtotal: 180, quantity: 1, price: 180, promotionDiscount: 0, menuItem: { name: 'Hamburguesa' }, modifiers: [] },
                { id: 2, subtotal: 165, quantity: 3, price: 55, promotionDiscount: 33, menuItem: { name: 'Cerveza' }, modifiers: [] },
                { id: 3, subtotal: 80, quantity: 2, price: 40, promotionDiscount: 16, menuItem: { name: 'Refresco' }, modifiers: [] },
            ]
        } as never);
        const result = await SplitBillService.splitByItems(41, 1, [
            { personName: 'Ana', itemIds: [1] },
            { personName: 'Beto', itemIds: [2, 3] }
        ]);
        expect(result.splits.map((split) => ({ discount: split.discount, tax: split.tax, total: split.total }))).toEqual([
            { discount: 0, tax: 27, total: 207 },
            { discount: 49, tax: 29.4, total: 225.4 },
        ]);
    });
});

describe('PromotionService rule validation', () => {
    it('rejects branches that do not belong to the company', async () => {
        jest.spyOn(prisma.branch, 'count').mockResolvedValue(1 as never);
        await expect(PromotionService.create(1, {
            code: 'SUC', name: 'Sucursal', type: 'PERCENTAGE', value: 10, allBranches: false, branchIds: [1, 99]
        })).rejects.toThrow('Una o más sucursales no pertenecen a la empresa');
    });

    it('validates combos, N x M and happy-hour windows', async () => {
        await expect(PromotionService.create(1, {
            code: 'C1', name: 'Combo', type: 'COMBO', value: 250, comboItems: [{ menuItemId: BURGER, quantity: 1 }]
        })).rejects.toThrow('El combo debe incluir al menos dos productos');
        await expect(PromotionService.create(1, {
            code: 'NM', name: '2x2', type: 'BUY_X_GET_Y', buyQuantity: 2, payQuantity: 2, targetCategoryIds: [2]
        })).rejects.toThrow(/N x M/);
        await expect(PromotionService.create(1, {
            code: 'HH', name: 'Happy', type: 'PERCENTAGE', value: 10, dailyStartTime: '17:00', dailyEndTime: '17:00'
        })).rejects.toThrow('La hora inicial y la hora final no pueden ser iguales');
        await expect(PromotionService.create(1, {
            code: 'IT', name: 'Items', type: 'PERCENTAGE', value: 10, scope: 'ITEMS'
        })).rejects.toThrow('Seleccione al menos un producto o categoría para la promoción');
    });

    it('stores rules and relation rows, and serializes them for the UI', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue(TZ);
        jest.spyOn(prisma.branch, 'count').mockResolvedValue(1 as never);
        jest.spyOn(prisma.menuItem, 'count').mockResolvedValue(3 as never);
        const relation = () => ({ deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async (_args: unknown) => ({ count: 0 })) });
        const tx = {
            promotion: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 9, ...args.data })),
                findUniqueOrThrow: jest.fn(async () => ({ id: 9 }))
            },
            promotionBranch: relation(), promotionTarget: relation(), promotionComboItem: relation()
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: (client: typeof tx) => unknown) => fn(tx)) as never);
        await PromotionService.create(1, {
            code: 'combo1', name: 'Combo clásico', type: 'COMBO', value: 250,
            comboItems: [{ menuItemId: BURGER }, { menuItemId: FRIES }, { menuItemId: SODA }],
            weekdays: [5, 1, 2, 3, 4], dailyStartTime: '22:00', dailyEndTime: '02:00',
            allBranches: false, branchIds: [2]
        });
        expect(tx.promotion.create.mock.calls[0][0].data).toMatchObject({
            code: 'COMBO1', type: 'COMBO', scope: 'ITEMS', value: 250,
            weekdays: '1,2,3,4,5', dailyStartTime: '22:00', dailyEndTime: '02:00', allBranches: false
        });
        expect(tx.promotionBranch.createMany).toHaveBeenCalledWith({ data: [{ promotionId: 9, branchId: 2 }] });
        expect(tx.promotionComboItem.createMany).toHaveBeenCalledWith({ data: [
            { promotionId: 9, menuItemId: BURGER, quantity: 1 },
            { promotionId: 9, menuItemId: FRIES, quantity: 1 },
            { promotionId: 9, menuItemId: SODA, quantity: 1 },
        ] });

        const serialized = serializePromotion({
            ...(rule({ weekdays: '1,2,3,4,5', dailyStartTime: '17:00', dailyEndTime: '19:00', allBranches: false }) as object),
            id: 1, companyId: 1, code: 'HH', name: 'HH', description: null, createdAt: NOW, updatedAt: NOW,
            branches: [{ branchId: 2 }], targets: [{ menuItemId: null, categoryId: 4 }], comboItems: []
        } as never, TZ, new Date('2026-11-21T00:00:00.000Z'));
        expect(serialized).toMatchObject({
            weekdays: [1, 2, 3, 4, 5], branchIds: [2], targetCategoryIds: [4], targetMenuItemIds: [], scheduleActiveNow: true
        });
    });

    it('validate preview evaluates per-item rules for the POS cart and branch', async () => {
        jest.spyOn(prisma.promotion, 'findFirst').mockResolvedValue({
            ...rule({ scope: 'ITEMS', value: 20, targets: [{ menuItemId: null, categoryId: 2 }], allBranches: false, branches: [{ branchId: 2 }] }),
            id: 5, companyId: 1, code: 'BEBIDAS20'
        } as never);
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([{ id: BURGER, categoryId: 1 }, { id: BEER, categoryId: 2 }] as never);
        jest.spyOn(prisma.setting, 'findMany').mockResolvedValue([] as never);
        const items = [{ menuItemId: BURGER, quantity: 1, unitPrice: 180 }, { menuItemId: BEER, quantity: 3, unitPrice: 55 }];

        const ok = await PromotionService.validateAndApply('bebidas20', 345, 1, { branchId: 2, items });
        expect(ok).toMatchObject({ valid: true, discount: 33, lineDiscounts: [{ lineId: 1, discount: 33 }] });

        const otherBranch = await PromotionService.validateAndApply('bebidas20', 345, 1, { branchId: 1, items });
        expect(otherBranch).toMatchObject({ valid: false, message: 'Esta promoción no aplica en esta sucursal' });
    });
});

describe('PromotionValidationError codes stay user-facing Spanish', () => {
    it('exposes the new codes', () => {
        expect(new PromotionValidationError('COMBO_INCOMPLETE').message).toMatch(/combo/);
        expect(new PromotionValidationError('OUTSIDE_SCHEDULE').code).toBe('OUTSIDE_SCHEDULE');
    });
});

describe('credit notes skip kitchen-voided rows that the invoice no longer lists', () => {
    it('matches invoice lines when the order keeps a quantity-0 voided row', () => {
        const build = (CreditNoteService as unknown as {
            buildInvoiceAllocations: (invoice: unknown, items: unknown[]) => Array<{ orderItemId: number; discountCents: number; taxCents: number }>;
        }).buildInvoiceAllocations.bind(CreditNoteService);
        const invoice = {
            items: [
                { orderItemId: 1, name: 'Hamburguesa', quantity: 1, price: 180, subtotal: 180 },
                { orderItemId: 3, name: 'Refresco', quantity: 2, price: 40, subtotal: 80, discount: 16 },
            ],
            grossSubtotal: 260, discount: 16, subtotal: 244, tax: 36.6, tipAmount: 0, total: 280.6
        };
        const allocations = build(invoice, [
            { id: 1, quantity: 1, price: 180, subtotal: 180 },
            { id: 2, quantity: 0, price: 55, subtotal: 0 },
            { id: 3, quantity: 2, price: 40, subtotal: 80 },
        ]);
        expect(allocations.map((entry) => entry.orderItemId)).toEqual([1, 3]);
        expect(allocations.map((entry) => entry.discountCents)).toEqual([0, 1600]);
    });
});
