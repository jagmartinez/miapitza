import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  FileSpreadsheet,
  Info,
  Minus,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
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

const ACTION_HELP: Partial<Record<HrPayrollAction, string>> = {
  CALCULATE: 'Toma los empleados y conceptos del periodo y calcula sus importes.',
  RECALCULATE: 'Actualiza los importes después de resolver incidencias o agregar conceptos.',
  SUBMIT_REVIEW: 'Bloquea la preparación y la envía a la persona que debe revisarla.',
  APPROVE: 'Confirma los importes que serán pagados a los empleados.',
  MARK_PAID: 'Registra el pago y publica las colillas para cada empleado.',
};

function moneyNumber(value?: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function employeeName(item: { userId: number; user?: { name?: string | null; username?: string | null } | null }) {
  return item.user?.name || item.user?.username || `Colaborador #${item.userId}`;
}

function componentsTotal(components: HrPayrollComponent[], type: 'INCOME' | 'DEDUCTION'): number | null {
  let total = 0;
  for (const item of components) {
    if (item.type !== type) continue;
    const amount = moneyNumber(item.amount);
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

function formatRunTotal(currency: string, value?: string | null) {
  if (value == null || value === '') return 'Pendiente de cálculo';
  return formatHrMoney(currency, value);
}

function formatEmployeeMoney(currency: string, value: number | null) {
  if (value === null) return 'Pendiente de cálculo';
  return formatHrMoney(currency, value);
}

function authoritativeMoney(receiptValue: string | undefined | null, fallback: number | null) {
  const receiptAmount = moneyNumber(receiptValue);
  if (receiptAmount !== null) return receiptAmount;
  return fallback;
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
  const primaryAction = run.allowedActions.find((action) => action !== 'VOID');

  const rows = useMemo(() => run.snapshot.map((snapshot) => {
    const components = run.components.filter((item) => item.userId === snapshot.userId);
    const statutory = run.statutoryCalculations.find((item) => item.userId === snapshot.userId);
    const anomalies = run.anomalies.filter((item) => item.userId === snapshot.userId || item.employeeId === snapshot.userId);
    const receipt = run.receipts.find((item) => item.userId === snapshot.userId);
    // Prefer immutable receipt totals when published; otherwise sum server components (never invent statutory).
    // A lifecycle status alone does not prove that the per-employee calculation
    // payload arrived. With no components, show an explicit pending value instead
    // of fabricating a fully reconciled C$0.00 row.
    const hasCalculation = run.status !== 'DRAFT' && components.length > 0;
    const componentGross = hasCalculation ? componentsTotal(components, 'INCOME') : null;
    const componentDeductions = hasCalculation ? componentsTotal(components, 'DEDUCTION') : null;
    const gross = authoritativeMoney(receipt?.grossIncome, componentGross);
    const deductions = authoritativeMoney(receipt?.totalDeductions, componentDeductions);
    const componentNet = componentGross === null || componentDeductions === null
      ? null
      : componentGross - componentDeductions;
    const net = authoritativeMoney(receipt?.netPay, componentNet);
    return {
      userId: snapshot.userId,
      name: employeeName(snapshot),
      branch: snapshot.branch?.name,
      gross,
      deductions,
      inss: statutory ? moneyNumber(statutory.employeeInss) : null,
      incomeTax: statutory ? moneyNumber(statutory.currentIncomeTaxWithheld) : null,
      net,
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
              ? `Año ${run.year ?? '—'} · corte ${formatDate(run.cutoffDate)} · cálculo basado en ingresos históricos elegibles.`
              : `${run.period?.code ?? `Periodo #${run.periodId ?? '—'}`} · ${formatDate(run.period?.dateFrom)} al ${formatDate(run.period?.dateTo)} · pago ${formatDate(run.period?.payDate)}.`}
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
        <ol className="payroll-operation-stepper" aria-label="Etapas de la corrida">
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
          <span className="payroll-operation-eyebrow">Qué sigue</span>
          <strong>{primaryAction ? ACTION_LABELS[primaryAction] : run.status === 'PAID' ? 'Pago completado' : 'No hay acciones disponibles'}</strong>
          <span>
            {run.blockingAnomalyCount > 0
              ? `${run.blockingAnomalyCount} incidencia(s) bloqueante(s) deben resolverse antes de continuar.`
              : run.status === 'PAID'
                ? 'Las colillas ya están publicadas y puedes descargarlas individualmente o todas juntas.'
                : primaryAction ? ACTION_HELP[primaryAction] : 'Actualiza la corrida para consultar su estado más reciente.'}
          </span>
        </div>
        <div className="payroll-operation-actions">
          {primaryAction && <Button onClick={() => onAction(primaryAction)} disabled={!online || busy}>{ACTION_LABELS[primaryAction]}</Button>}
          {run.allowedActions.filter((action) => action !== 'VOID' && action !== primaryAction).map((action) => <Button key={action} size="sm" variant="secondary" onClick={() => onAction(action)} disabled={!online || busy}>{ACTION_LABELS[action]}</Button>)}
          {run.allowedActions.includes('VOID') && (
            <Button size="sm" variant="ghost" onClick={() => onAction('VOID')} disabled={!online || busy}>Anular</Button>
          )}
        </div>
      </div>

      <dl className="payroll-operation-totals" aria-label="Resumen total de la nómina">
        <div><dt>Colaboradores</dt><dd>{run.totals?.employeeCount ?? run.snapshot.length}</dd></div>
        <div><dt>Ingresos brutos</dt><dd>{formatRunTotal(currency, run.totals?.grossIncome)}</dd></div>
        <div><dt>Deducciones</dt><dd>{formatRunTotal(currency, run.totals?.totalDeductions)}</dd></div>
        <div><dt>Aportes patronales</dt><dd>{formatRunTotal(currency, run.totals?.employerContributions)}</dd></div>
        <div className="net"><dt>Neto a pagar</dt><dd>{formatRunTotal(currency, run.totals?.netPay)}</dd></div>
      </dl>

      <section className="payroll-operation-reporting" aria-labelledby="payroll-deliverables-title">
        <div>
          <h3 id="payroll-deliverables-title">Reportes y colillas</h3>
          <p>El reporte resume toda la nómina. Las colillas muestran el detalle individual entregado a cada empleado.</p>
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => onExport('xlsx')} disabled={!online || busy || run.snapshot.length === 0}><FileSpreadsheet size={15} /> Descargar reporte Excel</Button>
          <Button size="sm" variant="ghost" onClick={() => onExport('csv')} disabled={!online || busy || run.snapshot.length === 0}>Exportar CSV</Button>
          <Button size="sm" onClick={() => onDownloadReceiptBatch(receiptIds)} disabled={!online || busy || receiptIds.length === 0}><Download size={15} /> Descargar todas las colillas ({receiptIds.length})</Button>
        </div>
        {run.status !== 'PAID' && <p className="payroll-operation-report-note"><Info size={15} /> Las colillas estarán disponibles cuando registres el pago.</p>}
      </section>

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
            <div className="payroll-operation-employee-search">
              <label htmlFor="payroll-employee-search">Buscar colaborador</label>
              <div className="payroll-operation-search-control">
                <Search size={17} aria-hidden="true" />
                <input
                  id="payroll-employee-search"
                  type="search"
                  placeholder="Nombre del colaborador"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                />
                {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpiar búsqueda"><X size={15} /></button>}
              </div>
              <small aria-live="polite">{filteredRows.length} de {rows.length} colaborador(es)</small>
            </div>
            <label className="payroll-operation-check"><input type="checkbox" checked={onlyIncidents} onChange={(event) => setOnlyIncidents(event.target.checked)} /> Solo con incidencias</label>
          </div>
          <div className="payroll-operation-table-wrap">
            <table className="payroll-operation-table">
              <thead><tr><th scope="col">Colaborador</th><th scope="col">Ingresos</th><th scope="col">INSS laboral</th><th scope="col">IR laboral</th><th scope="col">Deducciones</th><th scope="col">Neto</th><th scope="col">Incidencias</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                {filteredRows.map((row) => {
                  const expanded = expandedUserId === row.userId;
                  return (
                    <FragmentRow key={row.userId}>
                      <tr className={row.anomalies.some((item) => item.blocking) ? 'has-blocker' : ''}>
                        <th scope="row"><strong>{row.name}</strong><small>{row.branch ?? `ID ${row.userId}`}</small></th>
                        <td data-label="Ingresos">{formatEmployeeMoney(currency, row.gross)}</td>
                        <td data-label="INSS laboral">{formatEmployeeMoney(currency, row.inss)}</td>
                        <td data-label="IR laboral">{formatEmployeeMoney(currency, row.incomeTax)}</td>
                        <td data-label="Deducciones">{formatEmployeeMoney(currency, row.deductions)}</td>
                        <td data-label="Neto"><strong>{formatEmployeeMoney(currency, row.net)}</strong></td>
                        <td data-label="Incidencias">{row.anomalies.length ? <span className="payroll-operation-incident">{row.anomalies.length}</span> : <span className="payroll-operation-ok"><Check size={14} /> Sin incidencias</span>}</td>
                        <td><div className="payroll-employee-actions"><Button className="payroll-operation-detail-trigger" size="sm" variant="ghost" aria-expanded={expanded} aria-controls={`payroll-employee-detail-${row.userId}`} aria-label={`${expanded ? 'Cerrar' : 'Ver'} detalle de ${row.name}`} onClick={() => setExpandedUserId(expanded ? null : row.userId)}>Detalle <ChevronDown className={expanded ? 'is-open' : undefined} size={15} /></Button>{row.receipt && <Button size="sm" variant="ghost" onClick={() => onDownloadReceipt(row.receipt!.id)} disabled={!online || busy} title={`Descargar colilla de ${row.name}`}><Download size={14} /><span className="sr-only">Descargar colilla de {row.name}</span></Button>}</div></td>
                      </tr>
                      {expanded && (
                        <tr className="payroll-operation-detail-row"><td colSpan={8}>
                          <div id={`payroll-employee-detail-${row.userId}`} className="payroll-operation-employee-detail">
                            <header className="payroll-operation-employee-summary">
                              <div className="payroll-operation-employee-avatar" aria-hidden="true"><UserRound size={22} /></div>
                              <div><span className="payroll-operation-eyebrow">Detalle individual</span><h4>{row.name}</h4><p>{row.branch ?? 'Sucursal no asignada'} · colaborador #{row.userId}</p></div>
                              <dl>
                                <div><dt>Ingresos</dt><dd>{formatEmployeeMoney(currency, row.gross)}</dd></div>
                                <div><dt>Deducciones</dt><dd>{formatEmployeeMoney(currency, row.deductions)}</dd></div>
                                <div className="net"><dt>Neto</dt><dd>{formatEmployeeMoney(currency, row.net)}</dd></div>
                              </dl>
                            </header>
                            <section>
                              <div className="payroll-operation-detail-heading"><CircleDollarSign size={18} aria-hidden="true" /><div><h4>Ingresos</h4><small>{row.components.filter((item) => item.type === 'INCOME').length} concepto(s)</small></div></div>
                              {row.components.filter((item) => item.type === 'INCOME').map((item) => <Line key={item.id} label={item.name} note={item.source} amount={formatHrMoney(currency, item.amount)} />)}
                              {!row.components.some((item) => item.type === 'INCOME') && <p className="payroll-operation-detail-empty">Sin ingresos calculados.</p>}
                              <footer><span>Total ingresos</span><strong>{formatEmployeeMoney(currency, row.gross)}</strong></footer>
                            </section>
                            <section>
                              <div className="payroll-operation-detail-heading"><Minus size={18} aria-hidden="true" /><div><h4>Deducciones</h4><small>{row.components.filter((item) => item.type === 'DEDUCTION').length} concepto(s)</small></div></div>
                              {row.components.filter((item) => item.type === 'DEDUCTION').map((item) => <Line key={item.id} label={item.name} note={item.code} amount={formatHrMoney(currency, item.amount)} />)}
                              {!row.components.some((item) => item.type === 'DEDUCTION') && <p className="payroll-operation-detail-empty">Sin deducciones.</p>}
                              <footer><span>Total deducciones</span><strong>{formatEmployeeMoney(currency, row.deductions)}</strong></footer>
                            </section>
                            <section>
                              <div className="payroll-operation-detail-heading"><Clock3 size={18} aria-hidden="true" /><div><h4>Control e incidencias</h4><small>{row.overtimeMinutes} min extra aprobados</small></div></div>
                              {row.anomalies.map((item) => <div key={item.id} className={`payroll-operation-anomaly ${item.blocking ? 'blocking' : ''}`}><strong>{item.code}</strong><span>{item.message}</span></div>)}
                              {row.anomalies.length === 0 && <div className="payroll-operation-detail-ok"><ShieldCheck size={17} /><span>Sin incidencias para este colaborador.</span></div>}
                            </section>
                            <section className="payroll-operation-payslip">
                              <div className="payroll-operation-detail-heading"><Receipt size={18} aria-hidden="true" /><div><h4>Colilla de pago</h4><small>{row.receipt ? 'Documento publicado' : 'Pendiente de publicación'}</small></div></div>
                              {row.receipt ? <><strong className="payroll-operation-payslip-net">Neto pagado: {formatHrMoney(row.receipt.currency, row.receipt.netPay)}</strong><p>Disponible para el colaborador en Mi RH.</p><Button size="sm" variant="secondary" onClick={() => onDownloadReceipt(row.receipt!.id)} disabled={!online || busy}><Download size={14} /> Descargar colilla PDF</Button></> : <p>Se genera automáticamente cuando se registra el pago de la corrida.</p>}
                            </section>
                            {row.statutory && <details className="payroll-operation-statutory"><summary>Traza de INSS e IR</summary><div><Line label="Base INSS" note={`Configuración #${row.statutory.configurationRevisionId}`} amount={formatHrMoney(currency, row.statutory.inssBase)} /><Line label="INSS laboral" note={`Método ${row.statutory.methodVersion}`} amount={formatHrMoney(currency, row.statutory.employeeInss)} /><Line label="Proyección anual IR" note={`${row.statutory.elapsedFiscalMonths}/12 meses fiscales`} amount={formatHrMoney(currency, row.statutory.annualProjection)} /><Line label="IR retenido" note={row.statutory.incomeTaxMethod} amount={formatHrMoney(currency, row.statutory.currentIncomeTaxWithheld)} /><p>Tramo efectivo: {row.statutory.bracketSnapshot?.effective ? `${row.statutory.bracketSnapshot.effective.lowerBound} a ${row.statutory.bracketSnapshot.effective.upperBound ?? 'en adelante'} · tasa ${(Number(row.statutory.bracketSnapshot.effective.rate) * 100).toFixed(2)}%` : 'sin retención aplicable'}.</p><small>Histórico {row.statutory.historyFingerprint} · cálculo {formatDateTime(row.statutory.createdAt)}</small><span className="sr-only">Compensación fija {row.statutory.fixedCompensationAmount}</span></div></details>}
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

      <details className="payroll-operation-audit">
        <summary><span>Información técnica y auditoría</span><small>Úsala sólo para soporte, conciliación o revisión de cambios.</small></summary>
        <div className="payroll-operation-audit-grid">
          <div><strong>Quién hizo cada paso</strong><span>Calculó: {run.calculatedBy?.name ?? 'Pendiente'}</span><span>Aprobó: {run.approvedBy?.name ?? 'Pendiente'}</span><span>Registró el pago: {run.paidBy?.name ?? 'Pendiente'}</span></div>
          <div><strong>Versiones usadas para el cálculo</strong><span>Regla legal #{run.ruleVersionId}</span><span>Configuración #{run.configurationRevisionId ?? 'pendiente'}</span><span>Revisión de esta corrida: {run.revision}</span></div>
        </div>
        <details className="payroll-operation-reconciliation"><summary>Ver conciliación técnica de importes</summary><PayrollReconciliationPanel key={`${run.kind}-${run.id}-${run.revision}`} run={run} /></details>
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
