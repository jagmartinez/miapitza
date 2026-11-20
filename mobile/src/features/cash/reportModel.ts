import type { CountLine, ShiftReport, ShiftSummary } from '../../data/cashTypes';

export type SalesByMethod = NonNullable<ShiftSummary['summary']['salesByMethod']>;

export interface ReportView {
    register: string;
    shiftNo: number | null;
    cashier: string;
    start: string | null;
    end: string | null;
    startAmount: number;
    cashSales: number;
    moneyIn: number;
    moneyOut: number;
    refunds: number;
    expected: number | null;
    counted: number | null;
    difference: number | null;
    status: 'CUADRADO' | 'SOBRANTE' | 'FALTANTE' | null;
    rate: number | null;
    bills: CountLine[];
    coins: CountLine[];
    usdBills: CountLine[];
    nioCounted: number;
    usd: number;
    usdInNio: number;
    notes: string;
    sales: SalesByMethod | null;
    salesTotal: number | null;
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const cents = (v: number) => Math.round(v * 100);
const sumLines = (rows: CountLine[]) => rows.reduce((t, r) => t + n(r.denomination) * n(r.count), 0);
const byDenom = (rows: CountLine[] | undefined) =>
    (rows ?? []).filter((r) => n(r.count) > 0).map((r) => ({ denomination: n(r.denomination), count: n(r.count) })).sort((a, b) => b.denomination - a.denomination);

/** One reading of the server report, shared by the screen and the ticket so both always agree. Amounts are the server's; nothing is recomputed except the denomination subtotals. */
export function reportView(report: ShiftReport, sales: SalesByMethod | null = null): ReportView {
    const a = report.amounts ?? {};
    const bills = byDenom(report.counts?.bills);
    const coins = byDenom(report.counts?.coins);
    const usdBills = byDenom(report.counts?.usdBills);
    const rate = typeof report.shift.closingExchangeRate === 'number' ? report.shift.closingExchangeRate : null;
    const counted = a.actualEndAmount == null ? null : n(a.actualEndAmount);
    const expected = a.expectedEndAmount == null ? null : n(a.expectedEndAmount);
    const difference = a.difference == null ? null : n(a.difference);
    const nioCents = cents(sumLines(bills) + sumLines(coins));
    const usd = sumLines(usdBills);
    // Like the count screen: the part of the counted total that is not córdobas is the dollars at the day's rate.
    const usdInNio = counted == null ? 0 : (cents(counted) - nioCents) / 100;
    return {
        register: report.shift.cashRegister ?? 'Caja',
        shiftNo: typeof report.shift.id === 'number' ? report.shift.id : null,
        cashier: report.shift.user ?? '',
        start: report.shift.startDate ?? null,
        end: report.shift.endDate ?? null,
        startAmount: n(a.startAmount),
        cashSales: n(a.totalSalesCash),
        moneyIn: n(a.otherIncome),
        moneyOut: n(a.otherOutflows),
        refunds: n(a.cashRefunds),
        expected,
        counted,
        difference,
        status: difference == null ? null : difference > 0 ? 'SOBRANTE' : difference < 0 ? 'FALTANTE' : 'CUADRADO',
        rate,
        bills,
        coins,
        usdBills,
        nioCounted: nioCents / 100,
        usd,
        usdInNio,
        notes: typeof report.shift.notes === 'string' ? report.shift.notes.trim() : '',
        sales,
        salesTotal: sales ? (cents(sales.cash) + cents(sales.card) + cents(sales.transfer)) / 100 : null,
    };
}
