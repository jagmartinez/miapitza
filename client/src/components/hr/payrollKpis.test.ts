import { describe, expect, it } from 'vitest';
import type { HrPayrollRun } from '../../types/hr-payroll';
import { payrollKpis } from './payrollKpis';

function run(id: number, payDate: string, net: string, extra: Partial<HrPayrollRun> = {}): HrPayrollRun {
  return {
    id,
    kind: 'REGULAR',
    code: `N-${id}`,
    status: 'PAID',
    period: { id, code: `P${id}`, dateFrom: payDate, dateTo: payDate, payDate, timezone: 'America/Managua', status: 'CLOSED', revision: 1, createdAt: payDate },
    ruleVersionId: 1,
    revision: 1,
    allowedActions: [],
    totals: { currency: 'NIO', grossIncome: '1000', totalDeductions: '100', employerContributions: '215', netPay: net, employeeCount: 3 },
    anomalyCount: 0,
    blockingAnomalyCount: 0,
    createdAt: payDate,
    ...extra,
  } as HrPayrollRun;
}

describe('payrollKpis', () => {
  it('compara el neto de la corrida más reciente contra la anterior de la misma moneda', () => {
    const k = payrollKpis([run(1, '2026-10-15', '800'), run(2, '2026-10-30', '900')]);
    expect(k.latest?.id).toBe(2);
    expect(k.previous?.id).toBe(1);
    expect(k.netDelta).toEqual({ amount: 100, percent: 12.5, currency: 'NIO' });
  });

  it('no compara contra una corrida de otra moneda ni inventa porcentaje con base cero', () => {
    const usd = run(1, '2026-10-15', '800', { totals: { currency: 'USD', grossIncome: '1', totalDeductions: '0', employerContributions: null, netPay: '800', employeeCount: 1 } });
    expect(payrollKpis([usd, run(2, '2026-10-30', '900')]).netDelta).toBeNull();
    expect(payrollKpis([run(1, '2026-10-15', '0'), run(2, '2026-10-30', '900')]).netDelta?.percent).toBeNull();
  });

  it('el costo empresa suma ingresos más aportes patronales y es N/D si faltan los aportes', () => {
    expect(payrollKpis([run(1, '2026-10-15', '800')]).companyCost).toEqual({ amount: 1215, currency: 'NIO' });
    const missing = run(1, '2026-10-15', '800', { totals: { currency: 'NIO', grossIncome: '1000', totalDeductions: '100', employerContributions: null, netPay: '800', employeeCount: 3 } });
    expect(payrollKpis([missing]).companyCost).toBeNull();
  });

  it('ignora corridas anuladas y cuenta bloqueos solo en corridas abiertas', () => {
    const voided = run(3, '2026-11-15', '5000', { status: 'VOID', blockingAnomalyCount: 4 });
    const open = run(2, '2026-10-30', '900', { status: 'REVIEW', blockingAnomalyCount: 2 });
    const paid = run(1, '2026-10-15', '800', { blockingAnomalyCount: 7 });
    const k = payrollKpis([voided, open, paid]);
    expect(k.latest?.id).toBe(2);
    expect(k.blocking).toEqual({ count: 2, runs: [open] });
  });

  it('sin corridas con totales no hay tarjetas de monto', () => {
    const k = payrollKpis([run(1, '2026-10-15', '800', { totals: null, status: 'DRAFT' })]);
    expect(k.latest).toBeNull();
    expect(k.companyCost).toBeNull();
    expect(k.netDelta).toBeNull();
  });
});
