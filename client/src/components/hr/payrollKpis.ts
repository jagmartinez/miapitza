import type { HrPayrollRun } from '../../types/hr-payroll';

export interface PayrollKpis {
  /** Corrida más reciente con totales (no anulada). */
  latest: HrPayrollRun | null;
  /** Corrida inmediata anterior con totales. */
  previous: HrPayrollRun | null;
  /** Variación del neto contra la anterior; null si no hay base comparable (otra moneda o sin anterior). */
  netDelta: { amount: number; percent: number | null; currency: string } | null;
  /** Ingresos + aportes patronales; null si el servidor no entregó los aportes (N/D). */
  companyCost: { amount: number; currency: string } | null;
  /** Anomalías bloqueantes de corridas aún no pagadas ni anuladas. */
  blocking: { count: number; runs: HrPayrollRun[] };
}

const CALCULATED_STATUSES = new Set(['CALCULATED', 'REVIEW', 'APPROVED', 'PAID']);

/** El servidor siempre entrega totales (en cero para borradores); solo cuentan corridas ya calculadas. */
export function isRunCalculated(run: HrPayrollRun): boolean {
  return Boolean(run.totals) && (CALCULATED_STATUSES.has(run.status) || Boolean(run.calculatedAt));
}

function runDate(run: HrPayrollRun): string {
  return run.period?.payDate ?? run.cutoffDate ?? run.createdAt;
}

export function payrollKpis(runs: HrPayrollRun[]): PayrollKpis {
  const withTotals = runs
    .filter((run) => run.status !== 'VOID' && isRunCalculated(run))
    .sort((a, b) => runDate(b).localeCompare(runDate(a)) || b.id - a.id);
  const latest = withTotals[0] ?? null;
  const previous = withTotals[1] ?? null;

  let netDelta: PayrollKpis['netDelta'] = null;
  if (latest?.totals && previous?.totals && latest.totals.currency === previous.totals.currency) {
    const now = Number(latest.totals.netPay);
    const before = Number(previous.totals.netPay);
    if (Number.isFinite(now) && Number.isFinite(before)) {
      netDelta = {
        amount: now - before,
        percent: before > 0 ? ((now - before) / before) * 100 : null,
        currency: latest.totals.currency,
      };
    }
  }

  let companyCost: PayrollKpis['companyCost'] = null;
  if (latest?.totals && latest.totals.employerContributions != null) {
    const amount = Number(latest.totals.grossIncome) + Number(latest.totals.employerContributions);
    if (Number.isFinite(amount)) companyCost = { amount, currency: latest.totals.currency };
  }

  const openBlocked = runs.filter((run) => run.status !== 'PAID' && run.status !== 'VOID' && run.blockingAnomalyCount > 0);
  return {
    latest,
    previous,
    netDelta,
    companyCost,
    blocking: { count: openBlocked.reduce((sum, run) => sum + run.blockingAnomalyCount, 0), runs: openBlocked },
  };
}
