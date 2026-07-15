import { useState } from 'react';
import { CheckCircle2, Scale, ShieldAlert, XCircle } from 'lucide-react';
import Button from '../Button';
import { getPayrollErrorMessage, payrollClient } from './payrollClient';
import type { HrPayrollReconciliationPayload, HrPayrollReconciliationReport, HrPayrollRun } from '../../types/hr-payroll';

const EMPTY: HrPayrollReconciliationPayload = {
  expectedGrossIncome: '', expectedTotalDeductions: '', expectedNetPay: '', expectedEmployeeCount: 0,
  controlSource: '', evidenceReference: '',
};

export default function PayrollReconciliationPanel({ run }: { run: HrPayrollRun }) {
  const [form, setForm] = useState(EMPTY);
  const [report, setReport] = useState<HrPayrollReconciliationReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof HrPayrollReconciliationPayload>(key: K, value: HrPayrollReconciliationPayload[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  return (
    <section className="hr-payroll-reconciliation">
      <div className="hr-payroll-subheading">
        <div><h3><Scale size={18} /> Conciliación paralela</h3><p>Capture totales obtenidos de un cálculo independiente. No se aplica tolerancia ni fallback.</p></div>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        setSaving(true); setError(null); setReport(null);
        void payrollClient.reconcileParallelControl(run.kind, run.id, form)
          .then(setReport)
          .catch(reason => setError(getPayrollErrorMessage(reason, 'No fue posible conciliar la corrida.')))
          .finally(() => setSaving(false));
      }}>
        <label>Bruto externo<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.expectedGrossIncome} onChange={event => set('expectedGrossIncome', event.target.value)} required /></label>
        <label>Deducciones externas<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.expectedTotalDeductions} onChange={event => set('expectedTotalDeductions', event.target.value)} required /></label>
        <label>Neto externo<input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.expectedNetPay} onChange={event => set('expectedNetPay', event.target.value)} required /></label>
        <label>Personas externas<input type="number" min={0} step={1} value={form.expectedEmployeeCount} onChange={event => set('expectedEmployeeCount', Number(event.target.value))} required /></label>
        <label>Fuente del control<input value={form.controlSource} minLength={3} maxLength={160} onChange={event => set('controlSource', event.target.value)} placeholder="Hoja o sistema independiente" required /></label>
        <label>Referencia de evidencia<input value={form.evidenceReference} minLength={3} maxLength={500} onChange={event => set('evidenceReference', event.target.value)} placeholder="Ruta/folio/hash del soporte" required /></label>
        <Button type="submit" disabled={saving || ['DRAFT', 'VOID'].includes(run.status)}>{saving ? 'Conciliando…' : 'Ejecutar conciliación'}</Button>
      </form>
      {error && <div className="hr-payroll-reconciliation-alert danger" role="alert"><ShieldAlert size={18} />{error}</div>}
      {report && (
        <div className={`hr-payroll-reconciliation-report ${report.readyForParallelSignoff ? 'success' : 'danger'}`}>
          <strong>{report.readyForParallelSignoff ? <CheckCircle2 size={18} /> : <XCircle size={18} />}{report.readyForParallelSignoff ? 'Checks técnicos conciliados' : 'Conciliación con diferencias'}</strong>
          <small>Hash {report.reconciliationHash} · revisión {report.run.revision}</small>
          <p>Este informe no afirma validación legal ni certificación productiva; requiere revisión y firma responsable.</p>
          <ul>{report.checks.map(check => <li key={check.code} className={check.passed ? 'passed' : 'failed'}>{check.passed ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<span><b>{check.label}</b><small>Esperado: {check.expected} · Actual: {check.actual}{check.detail ? ` · ${check.detail}` : ''}</small></span></li>)}</ul>
        </div>
      )}
    </section>
  );
}
