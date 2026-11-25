import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';
import { SettingsScopeService } from '../../services/settings-scope.service';
import {
    branchInsights, channelInsight, costInsight, getBiBranches, getBiInsights, opportunityInsight, rankInsights,
    topVarianceSupply, trafficLight,
} from '../../services/bi/bi-insights.service';
import type { BiHeatmap } from '../../services/bi/bi-patterns.service';
import type { BiQuery } from '../../services/bi/bi-range';

const NOW = new Date('2026-11-20T18:00:00Z');
const q: BiQuery = { companyId: 1, branchIds: [], period: '7d', compare: 'previous' };

describe('trafficLight', () => {
    it('ok <= goal, warn <= goal + 2, bad above; unset goal never alarms', () => {
        expect(trafficLight(30, 30)).toBe('ok');
        expect(trafficLight(32, 30)).toBe('warn');
        expect(trafficLight(32.01, 30)).toBe('bad');
        expect(trafficLight(80, 0)).toBe('ok');
    });
});

describe('rule 1 - cost', () => {
    const base = { realPct: 36, theoreticalPct: 31, goalGapPts: 2, netSales: 10000, quality: 'complete' as const, topSupply: null };

    it('impact = gap x net sales and names the supply with the largest variance', () => {
        const real = new Map([[1, 500], [2, 900]]);
        const theo = new Map([[1, 480], [2, 600]]);
        const top = topVarianceSupply(real, theo, new Map([[1, 'Arroz'], [2, 'Pollo']]));
        expect(top).toEqual({ name: 'Pollo', diff: 300 });
        const i = costInsight({ ...base, topSupply: top })!;
        expect(i.kind).toBe('cost');
        expect(i.impactAmount).toBe(500);
        expect(i.message).toContain('Pollo');
        expect(i.action.route).toBe('/cost-report');
    });

    it('no insight at or under the goal, or when the theoretical cost is partial or N/D', () => {
        expect(costInsight({ ...base, realPct: 33 })).toBeNull();
        expect(costInsight({ ...base, quality: 'partial' })).toBeNull();
        expect(costInsight({ ...base, quality: 'unavailable' })).toBeNull();
        expect(costInsight({ ...base, netSales: 0 })).toBeNull();
    });
});

describe('rule 2 - branch', () => {
    it('flags a drop beyond 2 % with the lost sales as impact; ignores flat, growing and no-baseline branches', () => {
        const out = branchInsights([
            { branchId: 1, name: 'Centro', netSales: 900, prevNetSales: 1000, deltaPct: -10 },
            { branchId: 2, name: 'Norte', netSales: 990, prevNetSales: 1000, deltaPct: -1 },
            { branchId: 3, name: 'Sur', netSales: 1200, prevNetSales: 1000, deltaPct: 20 },
            { branchId: 4, name: 'Nueva', netSales: 50, prevNetSales: 0, deltaPct: null },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ id: 'branch-1', kind: 'branch', impactAmount: 100 });
    });
});

describe('rule 3 - opportunity', () => {
    const heatmap: BiHeatmap = {
        hours: [11, 12, 13, 14],
        days: [
            { weekday: 1, label: 'Lun', values: [100, 300, 300, 50] },
            { weekday: 2, label: 'Mar', values: [0, 0, 0, 0] },
        ],
        peak: { weekday: 1, hour: 12 }, valley: { weekday: 1, hour: 14 },
    };
    const occurrences = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4 } as const;

    it('reports a staffed slot under 40 % of the day average: (avg - slot) x occurrences x margin', () => {
        // day average = 750 / 4 = 187.5; threshold 75; slot 14h = 50 -> (187.5 - 50) x 4 x 0.5 = 275
        const i = opportunityInsight({ heatmap, occurrences: { ...occurrences }, staffed: new Set(['1-14']), grossMarginPct: 50 })!;
        expect(i.kind).toBe('opportunity');
        expect(i.impactAmount).toBe(275);
        expect(i.action.route).toBe('/rh/horarios');
    });

    it('requires scheduled staff on the slot and ignores days without sales', () => {
        expect(opportunityInsight({ heatmap, occurrences: { ...occurrences }, staffed: new Set(['2-11']), grossMarginPct: 50 })).toBeNull();
        expect(opportunityInsight({ heatmap, occurrences: { ...occurrences }, staffed: new Set(), grossMarginPct: 50 })).toBeNull();
    });
});

describe('rule 4 - channel', () => {
    it('delivery share up > 2 pts with a worse margin: delta x sales x margin gap', () => {
        const i = channelInsight({ curDeliverySharePct: 30, prevDeliverySharePct: 25, netSales: 10000, dineInMarginPct: 60, deliveryMarginPct: 40 })!;
        expect(i.impactAmount).toBe(100); // 0.05 x 10000 x 0.20
        expect(i.kind).toBe('channel');
    });

    it('no insight for a small rise, when delivery is not worse, or without margin data', () => {
        expect(channelInsight({ curDeliverySharePct: 27, prevDeliverySharePct: 25, netSales: 10000, dineInMarginPct: 60, deliveryMarginPct: 40 })).toBeNull();
        expect(channelInsight({ curDeliverySharePct: 40, prevDeliverySharePct: 25, netSales: 10000, dineInMarginPct: 40, deliveryMarginPct: 50 })).toBeNull();
        expect(channelInsight({ curDeliverySharePct: 40, prevDeliverySharePct: 25, netSales: 10000, dineInMarginPct: null, deliveryMarginPct: 50 })).toBeNull();
    });
});

describe('rankInsights', () => {
    it('orders by |impact| descending and keeps at most 5', () => {
        const mk = (n: number) => ({ id: String(n), kind: 'cost', severity: 'warning', impactAmount: n, message: '', action: { label: '', route: '' } }) as never;
        const out = rankInsights([10, 500, 50, 300, 20, 700, 5].map(mk));
        expect(out.map((i) => i.impactAmount)).toEqual([700, 500, 300, 50, 20]);
    });
});

function mockAll(opts: { orders?: unknown[]; branches?: { id: number; name: string }[]; goals?: Record<string, number> } = {}) {
    jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
    jest.spyOn(SettingsScopeService, 'getNumber').mockImplementation((async (_c: number, b: number | null, key: string) => {
        const k = `${b ?? 'company'}:${key}`;
        return opts.goals?.[k] ?? opts.goals?.[key] ?? 0;
    }) as never);
    jest.spyOn(prisma.branch, 'findMany').mockResolvedValue((opts.branches ?? []) as never);
    jest.spyOn(prisma.order, 'findMany').mockImplementation(((args: { where: { closedAt: { gte: Date; lt: Date }; branchId?: { in: number[] } } }) =>
        Promise.resolve(((opts.orders ?? []) as { closedAt: Date; branchId: number }[]).filter((o) =>
            o.closedAt >= args.where.closedAt.gte && o.closedAt < args.where.closedAt.lt
            && (!args.where.branchId || args.where.branchId.in.includes(o.branchId))))) as never);
    jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.payrollRun, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.scheduledShift, 'findMany').mockResolvedValue([] as never);
}

const order = (branchId: number, total: number, at: string, channel = 'RESTAURANT') => ({
    closedAt: new Date(at), branchId, total, discount: 0, channelCommission: 0, salesChannel: channel, items: [],
});

describe('getBiBranches', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('uses each branch goal for the semaphore, not the company goal', async () => {
        const cost = (productId: number, total: number) => ({
            createdAt: new Date('2026-11-18T18:00:00Z'), productId, type: 'OUT', quantity: 1, unitCost: total, totalCost: total,
            origin: 'SALE', reason: null, reference: 'ORD-1', reversalOfId: null, reversalOf: null,
        });
        mockAll({
            branches: [{ id: 1, name: 'Centro' }, { id: 2, name: 'Norte' }],
            orders: [order(1, 1000, '2026-11-18T18:00:00Z'), order(2, 1000, '2026-11-18T18:00:00Z')],
            goals: { 'company:goal.foodCostPct': 30, '1:goal.foodCostPct': 30, '2:goal.foodCostPct': 40 },
        });
        // Each branch sees 35 % food cost: bad for the 30 % goal of Centro, ok for the 40 % goal of Norte.
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([cost(5, 350)] as never);
        const rows = await getBiBranches(q, NOW);
        const centro = rows.find((r) => r.branchId === 1)!;
        const norte = rows.find((r) => r.branchId === 2)!;
        expect(centro.status.foodCost).toBe('bad');
        expect(norte.status.foodCost).toBe('ok');
        expect(centro.salesPerSqm).toBeNull();
        expect(centro.spark).toHaveLength(7);
    });

    it('labor without approved payroll is N/D, not 0', async () => {
        mockAll({ branches: [{ id: 1, name: 'Centro' }], orders: [order(1, 1000, '2026-11-18T18:00:00Z')] });
        const [row] = await getBiBranches(q, NOW);
        expect(row.laborCostPct).toBeNull();
        expect(row.operatingMarginPct).toBeNull();
        expect(row.laborQuality).toBe('unavailable');
        expect(row.status.labor).toBe('nd');
    });

    it('a branch without sales has finite values and a null delta', async () => {
        mockAll({ branches: [{ id: 1, name: 'Nueva' }] });
        const [row] = await getBiBranches(q, NOW);
        expect(row.netSales).toBe(0);
        expect(row.deltaPct).toBeNull();
        expect(row.foodCostPct).toBe(0);
    });
});

describe('getBiInsights', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns an empty array without data', async () => {
        mockAll({ branches: [{ id: 1, name: 'Centro' }] });
        expect(await getBiInsights(q, NOW)).toEqual([]);
    });

    it('detects a sales drop in a branch end to end', async () => {
        mockAll({
            branches: [{ id: 1, name: 'Centro' }],
            // previous 7 days: 1000; current 7 days: 500
            orders: [order(1, 1000, '2026-11-10T18:00:00Z'), order(1, 500, '2026-11-18T18:00:00Z')],
        });
        const out = await getBiInsights(q, NOW);
        expect(out.map((i) => i.id)).toContain('branch-1');
        expect(out.find((i) => i.id === 'branch-1')!.impactAmount).toBe(500);
    });
});
