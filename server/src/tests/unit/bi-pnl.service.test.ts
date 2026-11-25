import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';
import { SettingsScopeService } from '../../services/settings-scope.service';
import { getBiBridge, getBiChannels } from '../../services/bi/bi-pnl.service';
import type { BiQuery } from '../../services/bi/bi-range';

const NOW = new Date('2026-11-20T18:00:00Z');
const q: BiQuery = { companyId: 1, branchIds: [], period: '7d', compare: 'previous' };

const order = (total: number, at: string, channel = 'RESTAURANT', discount = 0, commission = 0) => ({
    closedAt: new Date(at), branchId: 1, total, discount, channelCommission: commission, salesChannel: channel, items: [],
});

function mockAll(orders: unknown[], opts: { movements?: unknown[]; cashOuts?: unknown[]; payroll?: unknown[]; fixed?: number } = {}) {
    jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
    jest.spyOn(SettingsScopeService, 'getNumber').mockImplementation((async (_c: number, _b: number | null, key: string) =>
        (key === 'finance.fixedMonthlyExpenses' ? (opts.fixed ?? 0) : 0)) as never);
    jest.spyOn(prisma.order, 'findMany').mockImplementation(((args: { where: { closedAt: { gte: Date; lt: Date } } }) =>
        Promise.resolve((orders as { closedAt: Date }[]).filter((o) =>
            o.closedAt >= args.where.closedAt.gte && o.closedAt < args.where.closedAt.lt))) as never);
    jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue((opts.movements ?? []) as never);
    jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue((opts.cashOuts ?? []) as never);
    jest.spyOn(prisma.payrollRun, 'findMany').mockResolvedValue((opts.payroll ?? []) as never);
    jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);
}

const consumption = (totalCost: number, at: string) => ({
    createdAt: new Date(at), productId: 5, type: 'OUT', quantity: 1, unitCost: totalCost, totalCost,
    origin: 'SALE', reason: null, reference: 'ORD-1', reversalOfId: null, reversalOf: null,
});

describe('getBiBridge', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('returns the 9 steps in mockup order and negative steps + operating rebuild net sales', async () => {
        mockAll(
            [order(1000, '2026-11-18T18:00:00Z', 'RESTAURANT', 100, 0), order(500, '2026-11-19T18:00:00Z', 'PEDIDOSYA', 0, 75)],
            {
                movements: [consumption(400, '2026-11-18T18:00:00Z')],
                cashOuts: [{ createdAt: new Date('2026-11-18T20:00:00Z'), amount: 50 }],
                payroll: [{
                    grossIncome: 700, employerContributions: 0,
                    period: { dateFrom: new Date('2026-11-14'), dateTo: new Date('2026-11-20') },
                }],
            },
        );
        const steps = await getBiBridge(q, NOW);
        expect(steps.map((s) => s.key)).toEqual(['gross', 'discounts', 'net', 'cogs', 'grossMargin', 'labor', 'opex', 'commissions', 'operating']);
        const by = Object.fromEntries(steps.map((s) => [s.key, s.amount]));
        expect(by.gross).toBe(1600);
        expect(by.net).toBe(1500);
        expect(by.gross - by.discounts).toBe(by.net);
        const negatives = steps.filter((s) => s.kind === 'negative' && s.key !== 'discounts').reduce((a, s) => a + s.amount, 0);
        expect(Math.round((negatives + by.operating) * 100) / 100).toBe(by.net);
        expect(by.grossMargin).toBe(1100);
        expect(by.operating).toBe(by.net - 400 - 700 - 50 - 75);
        expect(steps.find((s) => s.key === 'labor')?.quality).toBeUndefined();
    });

    it('flags labor as unavailable instead of presenting a real 0 when no payroll covers the range', async () => {
        mockAll([order(100, '2026-11-18T18:00:00Z')]);
        const labor = (await getBiBridge(q, NOW)).find((s) => s.key === 'labor')!;
        expect(labor.quality).toBe('unavailable');
    });

    it('a range without sales has all steps at 0 and no NaN', async () => {
        mockAll([]);
        const steps = await getBiBridge(q, NOW);
        expect(steps.every((s) => Number.isFinite(s.amount) && s.amount === 0)).toBe(true);
    });
});

describe('getBiChannels', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('shares add up to 100, margin is net of commission and absent channels are omitted', async () => {
        mockAll(
            [
                order(100, '2026-11-18T18:00:00Z', 'RESTAURANT'), order(100, '2026-11-18T19:00:00Z', 'RESTAURANT'),
                order(100, '2026-11-19T18:00:00Z', 'PEDIDOSYA', 0, 30),
            ],
            { movements: [consumption(60, '2026-11-18T18:00:00Z')] },
        );
        const rows = await getBiChannels(q, NOW);
        expect(rows.map((r) => r.channel)).toEqual(['RESTAURANT', 'PEDIDOSYA']);
        expect(Math.abs(rows.reduce((s, r) => s + r.sharePct, 0) - 100)).toBeLessThanOrEqual(0.01);
        const salon = rows[0];
        const py = rows[1];
        expect(salon.netSales).toBe(200);
        expect(salon.avgTicket).toBe(100);
        expect(salon.netMarginPct).toBe(80);       // (200 - 40) / 200
        expect(py.netMarginPct).toBe(50);          // (100 - 20 - 30) / 100
    });

    it('three equal channels still total 100', async () => {
        mockAll([
            order(100, '2026-11-18T18:00:00Z', 'RESTAURANT'),
            order(100, '2026-11-18T18:00:00Z', 'DELIVERY'),
            order(100, '2026-11-18T18:00:00Z', 'PEDIDOSYA'),
        ]);
        const rows = await getBiChannels(q, NOW);
        expect(Math.abs(rows.reduce((s, r) => s + r.sharePct, 0) - 100)).toBeLessThanOrEqual(0.01);
    });

    it('no sales gives an empty list', async () => {
        mockAll([]);
        expect(await getBiChannels(q, NOW)).toEqual([]);
    });
});
