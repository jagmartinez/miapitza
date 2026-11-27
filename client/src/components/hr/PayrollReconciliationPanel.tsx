import { Button, Field, Input } from '@/ui';
import { useState, useId } from 'react';
import { CheckCircle2, Scale, ShieldAlert, XCircle } from 'lucide-react';
import { getPayrollErrorMessage, payrollClient } from './payrollClient';
import type { HrPayrollReconciliationPayload, HrPayrollReconciliationReport, HrPayrollRun } from '../../types/hr-payroll';

const EMPTY: HrPayrollReconciliationPayload = {
  expectedGrossIncome: '', expectedTotalDeductions: '', expectedEmployerContributions: '', expectedNetPay: '', expectedEmployeeCount: 0,
  controlSource: '', evidenceReference: '',
};

export default function PayrollReconciliationPanel({ run }: { run: HrPayrollRun }) {
  const fid = useId();
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
        <Field label="Bruto externo" htmlFor={`${fid}-bruto-externo`}><Input id={`${fid}-bruto-externo`} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.expectedGrossIncome} onChange={event => set('expectedGrossIncome', event.target.value)} required /></Field>
        <Field label="Deducciones externas" htmlFor={`${fid}-deducciones-externas`}><Input id={`${fid}-deducciones-externas`} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.expectedTotalDeductions} onChange={event => set('expectedTotalDeductions', event.target.value)} required /></Field>
        <Field label="Aportes patronales externos" htmlFor={`${fid}-aportes-patronales-externos`}><Input id={`${fid}-aportes-patronales-externos`} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.expectedEmployerContributions} onChange={event => set('expectedEmployerContributions', event.target.value)} required /></Field>
        <Field label="Neto externo" htmlFor={`${fid}-neto-externo`}><Input id={`${fid}-neto-externo`} inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={form.expectedNetPay} onChange={event => set('expectedNetPay', event.target.value)} required /></Field>
        <Field label="Personas externas" htmlFor={`${fid}-personas-externas`}><Input id={`${fid}-personas-externas`} type="number" min={0} step={1} value={form.expectedEmployeeCount} onChange={event => set('expectedEmployeeCount', Number(event.target.value))} required /></Field>
        <Field label="Fuente del control" htmlFor={`${fid}-fuente-del-control`}><Input id={`${fid}-fuente-del-control`} value={form.controlSource} minLength={3} maxLength={160} onChange={event => set('controlSource', event.target.value)} placeholder="Hoja o sistema independiente" required /></Field>
        <Field label="Referencia de evidencia" htmlFor={`${fid}-referencia-de-evidencia`}><Input id={`${fid}-referencia-de-evidencia`} value={form.evidenceReference} minLength={3} maxLength={500} onChange={event => set('evidenceReference', event.target.value)} placeholder="Ruta/folio/hash del soporte" required /></Field>
        <Button loading={saving} variant="primary" type="submit" disabled={saving || ['DRAFT', 'VOID'].includes(run.status)}>Ejecutar conciliación</Button>
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
