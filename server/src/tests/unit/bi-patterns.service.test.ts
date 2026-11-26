import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';
import { SettingsScopeService } from '../../services/settings-scope.service';
import { buildPareto, getBiHeatmap, getBiPareto } from '../../services/bi/bi-patterns.service';
import type { BiQuery } from '../../services/bi/bi-range';
import type { BiFacts } from '../../services/bi/bi-common';

const NOW = new Date('2026-11-20T18:00:00Z');
const q: BiQuery = { companyId: 1, branchIds: [], period: 'custom', from: '2026-11-02', to: '2026-11-15', compare: 'previous' };

const order = (total: number, at: string, items: { menuItemId: number; quantity: number; subtotal: number }[] = []) => ({
    closedAt: new Date(at), branchId: 1, total, discount: 0, channelCommission: 0, salesChannel: 'RESTAURANT', items,
});

function mockAll(orders: unknown[]) {
    jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
    jest.spyOn(SettingsScopeService, 'getNumber').mockResolvedValue(0 as never);
    jest.spyOn(prisma.order, 'findMany').mockImplementation(((args: { where: { closedAt: { gte: Date; lt: Date } } }) =>
        Promise.resolve((orders as { closedAt: Date }[]).filter((o) =>
            o.closedAt >= args.where.closedAt.gte && o.closedAt < args.where.closedAt.lt))) as never);
    jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.payrollRun, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);
}

describe('getBiHeatmap', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('averages per occurrence of the weekday: two Mondays with 100 and 300 at 13h give 200', async () => {
        // 13:00 Managua = 19:00Z. 2026-11-02 and 2026-11-09 are Mondays.
        mockAll([order(100, '2026-11-02T19:10:00Z'), order(300, '2026-11-09T19:30:00Z')]);
        const h = await getBiHeatmap(q, NOW);
        const monday = h.days.find((d) => d.weekday === 1)!;
        expect(monday.label).toBe('Lun');
        expect(monday.values[h.hours.indexOf(13)]).toBe(200);
        expect(h.peak).toEqual({ weekday: 1, hour: 13 });
        expect(h.hours[0]).toBe(11);
        expect(h.hours[h.hours.length - 1]).toBe(22);
        expect(h.days).toHaveLength(7);
    });

    it('extends the hours with late sales and puts a post-midnight sale on the local day', async () => {
        // 2026-11-02T06:30Z = Monday 2026-11-02 00:30 Managua (a late close, not Sunday 01 Nov).
        mockAll([order(80, '2026-11-02T06:30:00Z')]);
        const h = await getBiHeatmap(q, NOW);
        expect(h.hours).toContain(0);
        const monday = h.days.find((d) => d.weekday === 1)!;
        expect(monday.values[h.hours.indexOf(0)]).toBe(40); // 80 over two Mondays
    });

    it('without sales: default window, zero values, no NaN', async () => {
        mockAll([]);
        const h = await getBiHeatmap(q, NOW);
        expect(h.hours).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
        expect(h.days.every((d) => d.values.every((v) => v === 0))).toBe(true);
        expect(h.peak).toEqual(h.valley);
    });
});

describe('getBiPareto', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns an empty pareto without sales', async () => {
        mockAll([]);
        const p = await getBiPareto(q, 10, NOW);
        expect(p).toMatchObject({ items: [], itemsFor80Pct: 0, totalItems: 0 });
    });

    const facts = (lines: { id: number; qty: number; subtotal: number }[], costs: Record<number, number | null>): BiFacts => ({
        orders: [{
            at: new Date('2026-11-05T18:00:00Z'), branchId: 1, total: 0, discount: 0, commission: 0, channel: 'RESTAURANT',
            items: lines.map((l) => ({ menuItemId: l.id, quantity: l.qty, subtotal: l.subtotal })),
        }],
        credits: [], costs: [], cashOuts: [], payroll: [], movementsWithoutCost: 0,
        recipeCost: new Map(Object.entries(costs).map(([k, v]) => [Number(k), v])),
    });
    const from = new Date('2026-11-01T06:00:00Z');
    const to = new Date('2026-11-30T06:00:00Z');

    it('cumulative pct is non-decreasing, ends at most at 100 and 80% counts the whole menu, not the top', () => {
        // margins: 1 -> 500, 2 -> 300, 3 -> 100, 4 -> 60, 5 -> 40 (total 1000)
        const f = facts(
            [1, 2, 3, 4, 5].map((id, i) => ({ id, qty: 1, subtotal: [510, 310, 110, 70, 50][i] })),
            { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 },
        );
        const p = buildPareto(f, from, to, new Map([[1, 'A'], [2, 'B']]), 2);
        expect(p.items).toHaveLength(2);
        expect(p.items.map((i) => i.cumulativePct)).toEqual([50, 80]);
        expect(p.items[0].name).toBe('A');
        expect(p.itemsFor80Pct).toBe(2);
        expect(p.totalItems).toBe(5);
        const full = buildPareto(f, from, to, new Map(), 10).items.map((i) => i.cumulativePct);
        for (let i = 1; i < full.length; i += 1) expect(full[i]).toBeGreaterThanOrEqual(full[i - 1]);
        expect(full[full.length - 1]).toBeLessThanOrEqual(100);
    });

    it('a dish losing money adds nothing to the cumulative and N/D recipes are excluded and reported', () => {
        const f = facts(
            [{ id: 1, qty: 1, subtotal: 100 }, { id: 2, qty: 1, subtotal: 10 }, { id: 3, qty: 4, subtotal: 400 }],
            { 1: 0, 2: 50, 3: null },
        );
        const p = buildPareto(f, from, to, new Map(), 10);
        expect(p.items.map((i) => i.menuItemId)).toEqual([1, 2]);
        expect(p.items[1].margin).toBe(-40);
        expect(p.items[1].cumulativePct).toBe(100);
        expect(p.unavailableItems).toBe(1);
        expect(p.totalItems).toBe(2);
    });
});
