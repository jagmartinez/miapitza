import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import Button from '../Button';
import { formatHrMoney } from '../../utils/hrFormat';
import type {
  HrPayrollAction,
  HrPayrollComponent,
  HrPayrollRunDetail,
  HrPayrollRunStatus,
} from '../../types/hr-payroll';
import PayrollReconciliationPanel from './PayrollReconciliationPanel';
import PayrollStatusPill from './PayrollStatusPill';

const FLOW: Array<{ status: HrPayrollRunStatus; label: string; help: string }> = [
  { status: 'DRAFT', label: 'Preparar', help: 'Periodo y colaboradores' },
  { status: 'CALCULATED', label: 'Calcular', help: 'Ingresos y deducciones' },
  { status: 'REVIEW', label: 'Revisar', help: 'Incidencias y control' },
  { status: 'APPROVED', label: 'Aprobar', help: 'Cierre de importes' },
  { status: 'PAID', label: 'Pagar y publicar', help: 'Colillas disponibles' },
];

const ACTION_LABELS: Record<HrPayrollAction, string> = {
  CALCULATE: 'Calcular nómina',
  RECALCULATE: 'Recalcular',
  SUBMIT_REVIEW: 'Enviar a revisión',
  APPROVE: 'Aprobar nómina',
  MARK_PAID: 'Registrar pago y publicar colillas',
  VOID: 'Anular corrida',
};

function numberOf(value?: string | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function employeeName(item: { userId: number; user?: { name?: string | null; username?: string | null } | null }) {
  return item.user?.name || item.user?.username || `Colaborador #${item.userId}`;
}

function componentsTotal(components: HrPayrollComponent[], type: 'INCOME' | 'DEDUCTION') {
  let total = 0;
  for (const item of components) if (item.type === type) total += numberOf(item.amount);
  return total;
}

interface PayrollOperationWorkspaceProps {
  run: HrPayrollRunDetail;
  online: boolean;
  busy: boolean;
  onAction: (action: HrPayrollAction) => void;
  onRefresh: () => void;
  onAddComponent: () => void;
  onExport: (format: 'csv' | 'xlsx') => void;
  onDownloadReceipt: (receiptId: number) => void;
  onDownloadReceiptBatch: (receiptIds: number[]) => void;
}

export default function PayrollOperationWorkspace({
  run,
  online,
  busy,
  onAction,
  onRefresh,
  onAddComponent,
  onExport,
  onDownloadReceipt,
  onDownloadReceiptBatch,
}: PayrollOperationWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [onlyIncidents, setOnlyIncidents] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const currency = run.totals?.currency ?? 'NIO';
  const currentStep = run.status === 'VOID' ? -1 : FLOW.findIndex((step) => step.status === run.status);

  const rows = useMemo(() => run.snapshot.map((snapshot) => {
    const components = run.components.filter((item) => item.userId === snapshot.userId);
    const statutory = run.statutoryCalculations.find((item) => item.userId === snapshot.userId);
    const anomalies = run.anomalies.filter((item) => item.userId === snapshot.userId || item.employeeId === snapshot.userId);
    const receipt = run.receipts.find((item) => item.userId === snapshot.userId);
    const gross = componentsTotal(components, 'INCOME');
    const deductions = componentsTotal(components, 'DEDUCTION');
    return {
      userId: snapshot.userId,
      name: employeeName(snapshot),
      branch: snapshot.branch?.name,
      gross,
      deductions,
      inss: numberOf(statutory?.employeeInss),
      incomeTax: numberOf(statutory?.currentIncomeTaxWithheld),
      net: gross - deductions,
      overtimeMinutes: snapshot.approvedOvertimeMinutes,
      components,
      statutory,
      anomalies,
      receipt,
    };
  }), [run]);

  const filteredRows = rows.filter((row) => {
    const matchesQuery = row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesQuery && (!onlyIncidents || row.anomalies.length > 0);
  });
  const receiptIds = run.receipts.filter((receipt) => receipt.status === 'PUBLISHED').map((receipt) => receipt.id);

  return (
    <section className="payroll-operation-workspace" aria-live="polite">
      <header className="payroll-operation-header">
        <div>
          <span className="payroll-operation-eyebrow">{run.kind === 'AGUINALDO' ? 'Aguinaldo' : 'Nómina ordinaria'}</span>
          <div className="payroll-operation-title-row">
            <h2>{run.code}</h2>
            <PayrollStatusPill status={run.status} />
          </div>
          <p>
            {run.kind === 'AGUINALDO'
              ? `Año ${run.year ?? '—'} · corte ${run.cutoffDate ?? '—'} · cálculo basado en ingresos históricos elegibles.`
              : `${run.period?.code ?? `Periodo #${run.periodId ?? '—'}`} · ${run.period?.dateFrom ?? '—'} a ${run.period?.dateTo ?? '—'} · pago ${run.period?.payDate ?? '—'}.`}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={busy} aria-label="Actualizar corrida">
          <RefreshCw size={16} /> Actualizar
        </Button>
      </header>

      {run.status === 'VOID' ? (
        <div className="payroll-operation-alert danger" role="alert">
          <AlertTriangle size={20} /> Esta corrida fue anulada. Se conserva únicamente para consulta y auditoría.
        </div>
      ) : (
        <ol className="payroll-operation-stepper" aria-label="Progreso de la corrida">
          {FLOW.map((step, index) => (
            <li key={step.status} className={index < currentStep ? 'complete' : index === currentStep ? 'current' : ''} aria-current={index === currentStep ? 'step' : undefined}>
              <span>{index < currentStep ? <Check size={15} /> : index + 1}</span>
              <div><strong>{step.label}</strong><small>{step.help}</small></div>
            </li>
          ))}
        </ol>
      )}

      <div className="payroll-operation-next-action">
        <div>
          <strong>{run.allowedActions.length ? 'Siguiente acción' : run.status === 'PAID' ? 'Proceso completado' : 'Sin acciones disponibles'}</strong>
          <span>
            {run.blockingAnomalyCount > 0
              ? `${run.blockingAnomalyCount} incidencia(s) bloqueante(s) deben resolverse antes de continuar.`
              : run.status === 'PAID'
                ? 'El pago quedó registrado y las colillas están publicadas para los colaboradores.'
                : 'Los pasos disponibles provienen del estado validado por el servidor.'}
          </span>
        </div>
        <div className="payroll-operation-actions">
          {run.allowedActions.filter((action) => action !== 'VOID').map((action, index) => (
            <Button key={action} size="sm" variant={index === 0 ? 'primary' : 'secondary'} onClick={() => onAction(action)} disabled={!online || busy}>
              {ACTION_LABELS[action]}
            </Button>
          ))}
          {run.allowedActions.includes('VOID') && (
            <Button size="sm" variant="ghost" onClick={() => onAction('VOID')} disabled={!online || busy}>Anular</Button>
          )}
        </div>
      </div>

      <dl className="payroll-operation-totals" aria-label="Resumen total de la nómina">
        <div><dt>Colaboradores</dt><dd>{run.totals?.employeeCount ?? run.snapshot.length}</dd></div>
        <div><dt>Ingresos brutos</dt><dd>{formatHrMoney(currency, run.totals?.grossIncome ?? '0')}</dd></div>
        <div><dt>Deducciones</dt><dd>{formatHrMoney(currency, run.totals?.totalDeductions ?? '0')}</dd></div>
        <div><dt>Aportes patronales</dt><dd>{formatHrMoney(currency, run.totals?.employerContributions ?? '0')}</dd></div>
        <div className="net"><dt>Neto a pagar</dt><dd>{formatHrMoney(currency, run.totals?.netPay ?? '0')}</dd></div>
      </dl>

      {run.snapshot.length === 0 ? (
        <div className="payroll-operation-empty">
          <UsersRound size={38} />
          <h3>Aún no hay resultados por colaborador</h3>
          <p>Calcula la corrida para congelar asistencia, horas extra, permisos, préstamos y conceptos aplicables.</p>
          {run.allowedActions.includes('CALCULATE') && <Button onClick={() => onAction('CALCULATE')} disabled={!online}>Calcular ahora</Button>}
        </div>
      ) : (
        <section className="payroll-operation-employees" aria-labelledby="payroll-employees-title">
          <div className="payroll-operation-section-heading">
            <div><h3 id="payroll-employees-title">Pago por colaborador</h3><p>Abre una fila para revisar el detalle de ingresos, deducciones, horas extra e incidencias.</p></div>
            {run.status === 'CALCULATED' && <Button size="sm" variant="secondary" onClick={onAddComponent} disabled={!online || busy}><Plus size={15} /> Agregar ingreso o deducción</Button>}
          </div>
          <div className="payroll-operation-table-tools">
            <label>
              <span className="sr-only">Buscar colaborador</span>
              <input type="search" placeholder="Buscar colaborador…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="payroll-operation-check"><input type="checkbox" checked={onlyIncidents} onChange={(event) => setOnlyIncidents(event.target.checked)} /> Solo con incidencias</label>
          </div>
          <div className="payroll-operation-table-wrap">
            <table className="payroll-operation-table">
              <thead><tr><th>Colaborador</th><th>Ingresos</th><th>INSS laboral</th><th>IR laboral</th><th>Deducciones</th><th>Neto</th><th>Incidencias</th><th><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {filteredRows.map((row) => {
                  const expanded = expandedUserId === row.userId;
                  return (
                    <FragmentRow key={row.userId}>
                      <tr className={row.anomalies.some((item) => item.blocking) ? 'has-blocker' : ''}>
                        <th scope="row"><strong>{row.name}</strong><small>{row.branch ?? `ID ${row.userId}`}</small></th>
                        <td data-label="Ingresos">{formatHrMoney(currency, row.gross)}</td>
                        <td data-label="INSS laboral">{formatHrMoney(currency, row.inss)}</td>
                        <td data-label="IR laboral">{formatHrMoney(currency, row.incomeTax)}</td>
                        <td data-label="Deducciones">{formatHrMoney(currency, row.deductions)}</td>
                        <td data-label="Neto"><strong>{formatHrMoney(currency, row.net)}</strong></td>
                        <td data-label="Incidencias">{row.anomalies.length ? <span className="payroll-operation-incident">{row.anomalies.length}</span> : <span className="payroll-operation-ok"><Check size={14} /> Sin incidencias</span>}</td>
                        <td><Button size="sm" variant="ghost" aria-expanded={expanded} aria-label={`${expanded ? 'Cerrar' : 'Ver'} detalle de ${row.name}`} onClick={() => setExpandedUserId(expanded ? null : row.userId)}>Detalle <ChevronDown size={15} /></Button></td>
                      </tr>
                      {expanded && (
                        <tr className="payroll-operation-detail-row"><td colSpan={8}>
                          <div className="payroll-operation-employee-detail">
                            <section><h4>Ingresos</h4>{row.components.filter((item) => item.type === 'INCOME').map((item) => <Line key={item.id} label={item.name} note={item.source} amount={formatHrMoney(currency, item.amount)} />)}{!row.components.some((item) => item.type === 'INCOME') && <p>Sin ingresos calculados.</p>}</section>
                            <section><h4>Deducciones</h4>{row.components.filter((item) => item.type === 'DEDUCTION').map((item) => <Line key={item.id} label={item.name} note={item.code} amount={formatHrMoney(currency, item.amount)} />)}{!row.components.some((item) => item.type === 'DEDUCTION') && <p>Sin deducciones.</p>}</section>
                            <section><h4>Control e incidencias</h4><p>{row.overtimeMinutes} min de horas extra aprobadas.</p>{row.anomalies.map((item) => <div key={item.id} className={`payroll-operation-anomaly ${item.blocking ? 'blocking' : ''}`}><strong>{item.code}</strong><span>{item.message}</span></div>)}{row.anomalies.length === 0 && <p>Sin incidencias para este colaborador.</p>}</section>
                            <section><h4>Colilla de pago</h4>{row.receipt ? <><p>Publicada · neto {formatHrMoney(row.receipt.currency, row.receipt.netPay)}</p><Button size="sm" variant="secondary" onClick={() => onDownloadReceipt(row.receipt!.id)} disabled={!online || busy}><Download size={14} /> Descargar PDF</Button></> : <p>Se genera y publica al registrar el pago de la corrida.</p>}</section>
                            {row.statutory && <section className="payroll-operation-statutory"><h4>Traza de INSS e IR</h4><Line label="Base INSS" note={`Configuración #${row.statutory.configurationRevisionId}`} amount={formatHrMoney(currency, row.statutory.inssBase)} /><Line label="INSS laboral" note={`Método ${row.statutory.methodVersion}`} amount={formatHrMoney(currency, row.statutory.employeeInss)} /><Line label="Proyección anual IR" note={`${row.statutory.elapsedFiscalMonths}/12 meses fiscales`} amount={formatHrMoney(currency, row.statutory.annualProjection)} /><Line label="IR retenido" note={row.statutory.incomeTaxMethod} amount={formatHrMoney(currency, row.statutory.currentIncomeTaxWithheld)} /><p>Tramo efectivo: {row.statutory.bracketSnapshot?.effective ? `${row.statutory.bracketSnapshot.effective.lowerBound} a ${row.statutory.bracketSnapshot.effective.upperBound ?? 'en adelante'} · tasa ${(Number(row.statutory.bracketSnapshot.effective.rate) * 100).toFixed(2)}%` : 'sin retención aplicable'}.</p><small>Histórico {row.statutory.historyFingerprint} · cálculo {row.statutory.createdAt}</small><span className="sr-only">Compensación fija {row.statutory.fixedCompensationAmount}</span></section>}
                          </div>
                        </td></tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredRows.length === 0 && <p className="payroll-operation-no-results">No hay colaboradores que coincidan con los filtros.</p>}
        </section>
      )}

      <section className="payroll-operation-reporting">
        <div><h3>Reportes y colillas</h3><p>Exporta el reporte completo o descarga las colillas publicadas después del pago.</p></div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => onExport('xlsx')} disabled={!online || busy || run.snapshot.length === 0}><FileSpreadsheet size={15} /> Reporte Excel</Button>
          <Button size="sm" variant="ghost" onClick={() => onExport('csv')} disabled={!online || busy || run.snapshot.length === 0}>CSV</Button>
          <Button size="sm" onClick={() => onDownloadReceiptBatch(receiptIds)} disabled={!online || busy || receiptIds.length === 0}><Download size={15} /> Descargar {receiptIds.length ? `${receiptIds.length} colillas` : 'colillas'}</Button>
        </div>
      </section>

      <details className="payroll-operation-audit">
        <summary>Controles y trazabilidad de la corrida</summary>
        <div className="payroll-operation-audit-grid">
          <div><strong>Responsables</strong><span>Calculó: {run.calculatedBy?.name ?? 'Pendiente'}</span><span>Aprobó: {run.approvedBy?.name ?? 'Pendiente'}</span><span>Pagó: {run.paidBy?.name ?? 'Pendiente'}</span></div>
          <div><strong>Configuración congelada</strong><span>Regla #{run.ruleVersionId}</span><span>Configuración #{run.configurationRevisionId ?? 'pendiente'}</span><span>Revisión de corrida {run.revision}</span></div>
        </div>
        <PayrollReconciliationPanel key={`${run.kind}-${run.id}-${run.revision}`} run={run} />
      </details>
    </section>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Line({ label, note, amount }: { label: string; note: string; amount: string }) {
  return <div className="payroll-operation-line"><div><strong>{label}</strong><small>{note}</small></div><span>{amount}</span></div>;
}
