import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';
import { SettingsScopeService } from '../../services/settings-scope.service';
import { getBiSummary } from '../../services/bi/bi-summary.service';
import type { BiQuery } from '../../services/bi/bi-range';

const NOW = new Date('2026-11-20T18:00:00Z');
const q: BiQuery = { companyId: 1, branchIds: [], period: 'custom', from: '2026-11-10', to: '2026-11-10', compare: 'previous' };
// 2026-11-10 in Managua (UTC-6): inside the current window; 2026-11-09 is the comparison window.
const CUR = new Date('2026-11-10T18:00:00Z');
const PREV = new Date('2026-11-09T18:00:00Z');

type Where = { closedAt?: { gte: Date }; issuedAt?: { gte: Date }; createdAt?: { gte: Date } };
const isCurrent = (w: Where, from = new Date('2026-11-10T06:00:00Z')) => {
    const gte = (w.closedAt ?? w.issuedAt ?? w.createdAt)!.gte;
    return gte.getTime() === from.getTime();
};

function mockAll(opts: { orders?: unknown[]; prevOrders?: unknown[]; credits?: unknown[]; movements?: unknown[]; recipeCost?: number } = {}) {
    jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
    jest.spyOn(SettingsScopeService, 'getNumber').mockImplementation((async (_c: number, _b: number | null, key: string) => ({
        'goal.monthlySales': 30000, 'goal.avgTicket': 550, 'goal.foodCostPct': 32, 'goal.foodCostGapPts': 1,
        'goal.grossMarginPct': 68, 'goal.laborCostMaxPct': 25, 'goal.operatingMarginPct': 25,
        'finance.fixedMonthlyExpenses': 0,
    } as Record<string, number>)[key] ?? 0) as never);
    jest.spyOn(prisma.order, 'findMany').mockImplementation(((args: { where: Where }) =>
        Promise.resolve(isCurrent(args.where) ? (opts.orders ?? []) : (opts.prevOrders ?? []))) as never);
    jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockImplementation(((args: { where: Where }) =>
        Promise.resolve(isCurrent(args.where) ? (opts.credits ?? []) : [])) as never);
    jest.spyOn(prisma.inventoryMovement, 'findMany').mockImplementation(((args: { where: Where }) =>
        Promise.resolve(isCurrent(args.where) ? (opts.movements ?? []) : [])) as never);
    jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.payrollRun, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue(
        [{ id: 7, recipes: [] }] as never,
    );
}

const order = (total: number, discount: number, at: Date) => ({
    closedAt: at, branchId: 1, total, discount, channelCommission: 0, salesChannel: 'RESTAURANT',
    items: [{ menuItemId: 7, quantity: 1, subtotal: total }],
});

describe('getBiSummary', () => {
    beforeEach(() => { jest.restoreAllMocks(); });
    afterEach(() => { jest.restoreAllMocks(); });

    it('computes net/gross sales, discounts and average ticket net of credit notes', async () => {
        mockAll({
            orders: [order(1000, 0, CUR), order(500, 50, CUR)],
            credits: [{ issuedAt: CUR, branchId: 1, total: 100 }],
        });
        const s = await getBiSummary(q, NOW);
        expect(s.netSales.current).toBe(1400);
        expect(s.grossSales.current).toBe(1450);
        expect(s.discounts.current).toBe(50);
        expect(s.orders.current).toBe(2);
        expect(s.avgTicket.current).toBe(700);
    });

    it('deltaPct is null when the previous period has no data', async () => {
        mockAll({ orders: [order(1000, 0, CUR)] });
        const s = await getBiSummary(q, NOW);
        expect(s.netSales.previous).toBe(0);
        expect(s.netSales.deltaPct).toBeNull();
    });

    it('computes deltaPct against the previous period', async () => {
        mockAll({ orders: [order(1500, 0, CUR)], prevOrders: [order(1000, 0, PREV)] });
        const s = await getBiSummary(q, NOW);
        expect(s.netSales.deltaPct).toBe(50);
    });

    it('food cost gap is real cost minus theoretical cost', async () => {
        mockAll({
            orders: [order(1000, 0, CUR)],
            movements: [{
                createdAt: CUR, quantity: 1, unitCost: null, totalCost: 480, origin: null, reason: 'Consumo por orden',
                reference: 'ORD-1', reversalOfId: null, reversalOf: null,
            }],
        });
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([{
            id: 7,
            recipes: [{ quantity: 1, unit: 'kg', product: { id: 1, name: 'Carne', unit: 'kg', currentAverageCost: 420, cost: 420 } }],
        }] as never);
        const { UnitConversionService } = await import('../../services/unit-conversion.service');
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({ baseQuantity: 1 } as never);
        const s = await getBiSummary(q, NOW);
        expect(s.foodCostGapAmount).toBe(60);
        expect(s.foodCostRealPct.current).toBe(48);
        expect(s.foodCostTheoreticalPct.current).toBe(42);
    });

    it('excludes recipes without a valid unit conversion and warns instead of showing 0', async () => {
        mockAll({ orders: [order(1000, 0, CUR)] });
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([{
            id: 7,
            recipes: [{ quantity: 1, unit: 'xx', product: { id: 1, name: 'Carne', unit: 'kg', currentAverageCost: 420, cost: 420 } }],
        }] as never);
        const { UnitConversionService } = await import('../../services/unit-conversion.service');
        jest.spyOn(UnitConversionService, 'convert').mockRejectedValue(new Error('sin conversión'));
        const s = await getBiSummary(q, NOW);
        expect(s.warnings.some((w) => w.includes('Costo teórico no disponible'))).toBe(true);
        expect(s.dataQuality.theoreticalCost).toBe('unavailable');
        expect(s.foodCostGapAmount).toBeNull();
        expect(s.spark.foodCostGapPts).toEqual([null]);
        expect(s.foodCostTheoreticalPct.current).toBe(0);
    });

    it('excludes N/D dishes from the theoretical sales basis and marks the gap partial', async () => {
        mockAll({
            orders: [
                order(1000, 0, CUR),
                { ...order(500, 0, CUR), items: [{ menuItemId: 8, quantity: 1, subtotal: 500 }] },
            ],
        });
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([
            { id: 7, recipes: [{ quantity: 1, unit: 'kg', product: { id: 1, name: 'Carne', unit: 'kg', currentAverageCost: 420, cost: 420 } }] },
            { id: 8, recipes: [{ quantity: 1, unit: 'xx', product: { id: 2, name: 'Raro', unit: 'kg', currentAverageCost: 10, cost: 10 } }] },
        ] as never);
        const { UnitConversionService } = await import('../../services/unit-conversion.service');
        jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (id: number) => {
            if (id === 2) throw new Error('sin conversión');
            return { baseQuantity: 1 };
        }) as never);
        const s = await getBiSummary(q, NOW);
        // 420 / (1500 - 500) = 42%, not 420 / 1500
        expect(s.foodCostTheoreticalPct.current).toBe(42);
        expect(s.dataQuality.theoreticalCost).toBe('partial');
        expect(s.foodCostGapAmount).toBeNull();
    });

    it('subtracts stock returned to inventory by an order (IN with ORD- reference)', async () => {
        mockAll({
            orders: [order(1000, 0, CUR)],
            movements: [
                { createdAt: CUR, type: 'OUT', quantity: 1, unitCost: null, totalCost: 480, origin: null, reason: 'Consumo por orden', reference: 'ORD-1', reversalOfId: null, reversalOf: null },
                { createdAt: CUR, type: 'IN', quantity: 1, unitCost: null, totalCost: 180, origin: 'REVERSAL', reason: 'Devolución', reference: 'ORD-1', reversalOfId: null, reversalOf: null },
            ],
        });
        const s = await getBiSummary(q, NOW);
        expect(s.foodCostRealPct.current).toBe(30);
        const where = (prisma.inventoryMovement.findMany as jest.Mock).mock.calls[0][0] as { where: { OR: unknown[] } };
        expect(where.where.OR).toEqual(expect.arrayContaining([{ type: 'IN', reference: { startsWith: 'ORD-' } }]));
    });

    it('flags unavailable and partial payroll coverage instead of showing it as complete', async () => {
        mockAll({ orders: [order(1000, 0, CUR)] });
        let s = await getBiSummary(q, NOW);
        expect(s.dataQuality.labor).toBe('unavailable');
        expect(s.warnings.some((w) => w.includes('No hay nómina aprobada'))).toBe(true);

        jest.spyOn(prisma.payrollRun, 'findMany').mockResolvedValue([{
            grossIncome: 1000, employerContributions: 0,
            period: { dateFrom: new Date('2026-11-01T00:00:00Z'), dateTo: new Date('2026-11-10T00:00:00Z') },
        }] as never);
        const wide: BiQuery = { ...q, to: '2026-11-20' };
        s = await getBiSummary(wide, NOW);
        expect(s.dataQuality.labor).toBe('partial');
        expect(s.dataQuality.laborCoverage).toBeGreaterThan(0);
        expect(s.dataQuality.laborCoverage).toBeLessThan(1);
        expect(s.warnings.some((w) => w.includes('cubre solo'))).toBe(true);
    });

    it('an empty period yields zeros without NaN', async () => {
        mockAll();
        const s = await getBiSummary(q, NOW);
        for (const m of [s.netSales, s.avgTicket, s.grossMarginPct, s.foodCostRealPct, s.foodCostTheoreticalPct,
            s.laborCostPct, s.operatingProfit, s.operatingMarginPct]) {
            expect(m.current).toBe(0);
            expect(Number.isNaN(m.current)).toBe(false);
            expect(m.deltaPct).toBeNull();
        }
        expect(s.foodCostGapAmount).toBe(0);
        expect(s.spark.netSales).toHaveLength(1);
    });

    it('an empty period with fixed monthly expenses shows a negative operating profit (decision: fixed costs accrue without sales)', async () => {
        mockAll();
        jest.spyOn(SettingsScopeService, 'getNumber').mockImplementation((async (_c: number, _b: number | null, key: string) =>
            (key === 'finance.fixedMonthlyExpenses' ? 3000 : 0)) as never);
        const s = await getBiSummary(q, NOW);
        expect(s.operatingProfit.current).toBe(-100);
        expect(s.operatingMarginPct.current).toBe(0);
    });

    it('prorates payroll and fixed expenses into the operating profit', async () => {
        mockAll({ orders: [order(1000, 0, CUR)] });
        jest.spyOn(SettingsScopeService, 'getNumber').mockImplementation((async (_c: number, _b: number | null, key: string) =>
            (key === 'finance.fixedMonthlyExpenses' ? 3000 : 0)) as never);
        jest.spyOn(prisma.payrollRun, 'findMany').mockResolvedValue([{
            grossIncome: 3000, employerContributions: 0,
            period: { dateFrom: new Date('2026-11-01T00:00:00Z'), dateTo: new Date('2026-11-30T00:00:00Z') },
        }] as never);
        const s = await getBiSummary(q, NOW);
        // 1 day of a 30-day month: payroll 100, fixed expenses 100
        expect(s.laborCostPct.current).toBe(10);
        expect(s.operatingProfit.current).toBe(800);
        expect(s.operatingMarginPct.current).toBe(80);
    });
});
