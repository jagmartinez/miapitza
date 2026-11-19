import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { toCSV } from '../../utils/csv';
import { ReportService, COLLECTED_PAYMENT_WHERE } from '../../services/report.service';
import { ReportExtendedService } from '../../services/report-extended.service';
import { ProductionReportService } from '../../services/production-report.service';
import { SettingService } from '../../services/setting.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('CSV formula injection', () => {
    it('neutralises cells that a spreadsheet would evaluate as formulas', () => {
        const csv = toCSV([
            { a: '=HYPERLINK("http://x","y")', b: '+1+1', c: '-2+3', d: '@SUM(A1)', e: '\tcmd' },
        ], ['a', 'b', 'c', 'd', 'e']);
        const row = csv.split('\n')[1];
        expect(row).toBe(`"'=HYPERLINK(""http://x"",""y"")",'+1+1,'-2+3,'@SUM(A1),'\tcmd`);
    });

    it('keeps genuine numbers and signed decimal strings untouched', () => {
        const csv = toCSV([{ a: -12.5, b: '-12.50', c: '+3', d: 'Normal' }], ['a', 'b', 'c', 'd']);
        expect(csv.split('\n')[1]).toBe('-12.5,-12.50,+3,Normal');
    });
});

describe('Payment reversal is not double-counted in sales reports', () => {
    it('getSalesReport only loads collected payments (ACTIVE or credit-note reversed)', async () => {
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
        const findMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);
        await ReportService.getSalesReport(1, { paymentMethodId: 4 });
        const args = findMany.mock.calls[0][0] as { where: Record<string, unknown>; include: { payments: { where: unknown } } };
        expect(args.include.payments.where).toEqual(COLLECTED_PAYMENT_WHERE);
        expect(args.where.payments).toEqual({ some: { paymentMethodId: 4, ...COLLECTED_PAYMENT_WHERE } });
        expect(COLLECTED_PAYMENT_WHERE).toEqual({
            OR: [{ status: 'ACTIVE' }, { fiscalCreditNoteRefunds: { some: {} } }]
        });
    });

    it('getSalesByPaymentMethod excludes ordinary reversals from the method breakdown', async () => {
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
        const findMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);
        await ReportExtendedService.getSalesByPaymentMethod(1, {});
        const args = findMany.mock.calls[0][0] as { include: { payments: { where: unknown } } };
        expect(args.include.payments.where).toEqual(COLLECTED_PAYMENT_WHERE);
    });
});

describe('Credit-note lines offset gross revenue on the same basis', () => {
    it('income breakdown subtracts grossSubtotal so a fully credited discounted item nets to zero', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua' as never);
        jest.spyOn(prisma.orderItem, 'groupBy').mockResolvedValue([
            { menuItemId: 7, _sum: { subtotal: 100 } }
        ] as never);
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([
            {
                issuedAt: new Date(), total: 90, order: { userId: 1 }, refunds: [],
                lines: [{ quantity: 1, grossSubtotal: 100, subtotal: 90, orderItem: { menuItemId: 7 } }]
            }
        ] as never);
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([
            { id: 7, category: { name: 'Platos' } }
        ] as never);

        const result = await ReportService.getIncomeBreakdown(1, undefined, 'month');
        expect(result).toEqual([expect.objectContaining({ name: 'Platos', value: 0 })]);
    });
});

describe('Branch scoping', () => {
    it('getMyStats for a branch-pinned cashier scopes company-level aggregates to that branch', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua' as never);
        const orderFind = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);
        const orderCount = jest.spyOn(prisma.order, 'count').mockResolvedValue(0 as never);
        const paymentFind = jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([] as never);
        const creditFind = jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({
            startAmount: 100, startDate: new Date(), cashRegister: { name: 'Caja 1' },
            movements: [{ type: 'IN', amount: 50 }, { type: 'OUT', amount: 20 }]
        } as never);

        const result = await ReportService.getMyStats(9, 1, 'CAJERO', 3) as { activeShift: { cashAccumulated: number } };

        expect((orderCount.mock.calls[0][0] as { where: { branchId?: number } }).where.branchId).toBe(3);
        expect((paymentFind.mock.calls[0][0] as { where: { order: unknown } }).where.order).toEqual({ companyId: 1, branchId: 3 });
        const creditWheres = creditFind.mock.calls.map((call) => (call[0] as { where: { branchId?: number; order?: unknown } }).where);
        expect(creditWheres.filter((where) => !where.order).every((where) => where.branchId === 3)).toBe(true);
        expect(orderFind).toHaveBeenCalled();
        // Refund/outflow movements reduce the cash shown as accumulated.
        expect(result.activeShift.cashAccumulated).toBe(30);
    });

    it('production traceability is restricted to the caller branch when pinned', async () => {
        const findFirst = jest.spyOn(prisma.productionOrder, 'findFirst').mockResolvedValue(null as never);
        await expect(ProductionReportService.getTraceability(1, 55, 4)).rejects.toThrow('no encontrada');
        expect((findFirst.mock.calls[0][0] as { where: unknown }).where).toEqual({ id: 55, companyId: 1, branchId: 4 });
    });
});
