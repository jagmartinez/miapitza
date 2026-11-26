import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';
import { SettingsScopeService } from '../../services/settings-scope.service';
import { getBiTrend } from '../../services/bi/bi-trend.service';
import type { BiQuery } from '../../services/bi/bi-range';

const NOW = new Date('2026-11-20T18:00:00Z');
const q: BiQuery = { companyId: 1, branchIds: [], period: '7d', compare: 'previous' };

const order = (total: number, at: string) => ({
    closedAt: new Date(at), branchId: 1, total, discount: 0, channelCommission: 0, salesChannel: 'RESTAURANT',
    items: [],
});

function mockAll(orders: unknown[], monthlySales = 0) {
    jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
    jest.spyOn(SettingsScopeService, 'getNumber').mockImplementation((async (_c: number, _b: number | null, key: string) =>
        (key === 'goal.monthlySales' ? monthlySales : key === 'goal.avgTicket' ? 550 : 0)) as never);
    jest.spyOn(prisma.order, 'findMany').mockImplementation(((args: { where: { closedAt: { gte: Date; lt: Date } } }) =>
        Promise.resolve((orders as { closedAt: Date }[]).filter((o) =>
            o.closedAt >= args.where.closedAt.gte && o.closedAt < args.where.closedAt.lt))) as never);
    jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.payrollRun, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);
}

describe('getBiTrend', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('keeps empty buckets as 0 and aligns previous with current', async () => {
        mockAll([order(100, '2026-11-18T18:00:00Z'), order(50, '2026-11-12T18:00:00Z')]);
        const t = await getBiTrend(q, 'netSales', NOW);
        expect(t.buckets).toHaveLength(7);
        expect(t.current).toHaveLength(7);
        expect(t.previous).toHaveLength(t.current.length);
        expect(t.current.filter((v) => v === 0)).toHaveLength(6);
        expect(t.current[t.buckets.indexOf('2026-11-18')]).toBe(100);
        expect(t.previous.reduce((a, b) => a + b, 0)).toBe(50);
    });

    it('average ticket of a bucket without orders is 0', async () => {
        mockAll([order(300, '2026-11-18T18:00:00Z'), order(100, '2026-11-18T19:00:00Z')]);
        const t = await getBiTrend(q, 'avgTicket', NOW);
        expect(t.current[t.buckets.indexOf('2026-11-18')]).toBe(200);
        expect(t.current[t.buckets.indexOf('2026-11-19')]).toBe(0);
        expect(t.goal).toBe(550);
    });

    it('orders have no goal and sales goal is the prorated monthly goal', async () => {
        mockAll([], 30000);
        expect((await getBiTrend(q, 'orders', NOW)).goal).toBeNull();
        const sales = await getBiTrend(q, 'netSales', NOW);
        expect(sales.goal).toBe(1000); // 30,000 over a 30-day month, per day
    });

    it('hourly granularity for today and no goal when none is configured', async () => {
        mockAll([]);
        const t = await getBiTrend({ ...q, period: 'today' }, 'netSales', NOW);
        expect(t.buckets).toHaveLength(24);
        expect(t.goal).toBeNull();
    });
});
