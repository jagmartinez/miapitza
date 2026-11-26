import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Eye,
  Check,
  CircleDollarSign,
  Clock3,
  Download,
  FileSpreadsheet,
  Minus,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import {
  Badge, Button, DataTable, EmptyState, FullScreenModal, IconButton, Input, PageHeader, SegmentedControl, StatCard, TableToolbar, formatMoney, formatPercent,
} from '@/ui';
import type {
  HrPayrollAction,
  HrPayrollComponent,
  HrPayrollRunDetail,
} from '../../types/hr-payroll';
import PayrollReconciliationPanel from './PayrollReconciliationPanel';
import PayrollStatusPill from './PayrollStatusPill';
import form from './hrForm.module.css';


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

function oneDecimal(value: number): string {
  return value.toFixed(1);
}

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

function moneyOrND(currency: string, value: string | number | null | undefined): string {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return 'N/D';
  const symbol = currency === 'NIO' ? 'C$' : currency === 'USD' ? 'US$' : currency;
  return formatMoney(value, symbol);
}

function formatRunTotal(currency: string, value?: string | null) {
  if (value == null || value === '') return 'Pendiente de cálculo';
  return moneyOrND(currency, value);
}

function formatEmployeeMoney(currency: string, value: number | null) {
  if (value === null) return 'Pendiente de cálculo';
  return moneyOrND(currency, value);
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
  /** Previous comparable run (same kind, not voided) used for the net-pay variance indicator. */
  previous?: { code: string; netPay?: string | null } | null;
  /** Vuelve al registro de corridas (botón en la cabecera de la corrida). */
  onBack?: () => void;
  /** Avance de la corrida, se muestra bajo la cabecera como en el mockup de Nómina. */
  stepper?: ReactNode;
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
  previous,
  onBack,
  stepper,
}: PayrollOperationWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [onlyIncidents, setOnlyIncidents] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const currency = run.totals?.currency ?? 'NIO';
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
    const overtimeComponents = components.filter((item) => item.type === 'INCOME' && item.source === 'OVERTIME');
    const overtimePay = hasCalculation ? componentsTotal(overtimeComponents, 'INCOME') : null;
    const salary = hasCalculation
      ? componentsTotal(components.filter((item) => item.type === 'INCOME' && item.source !== 'OVERTIME'), 'INCOME')
      : null;
    return {
      userId: snapshot.userId,
      name: employeeName(snapshot),
      branch: snapshot.branch?.name,
      gross,
      deductions,
      inss: statutory ? moneyNumber(statutory.employeeInss) : null,
      incomeTax: statutory ? moneyNumber(statutory.currentIncomeTaxWithheld) : null,
      salary,
      overtimePay,
      net,
      overtimeMinutes: snapshot.approvedOvertimeMinutes,
      components,
      statutory,
      anomalies,
      receipt,
    };
  }), [run]);

  const indicators = useMemo(() => {
    const headcount = run.totals?.employeeCount ?? run.snapshot.length;
    const gross = moneyNumber(run.totals?.grossIncome);
    const net = moneyNumber(run.totals?.netPay);
    const deductions = moneyNumber(run.totals?.totalDeductions);
    const employer = moneyNumber(run.totals?.employerContributions) ?? 0;
    const previousNet = moneyNumber(previous?.netPay);
    let inssWithheld = 0;
    let incomeTax = 0;
    let overtimeMinutes = 0;
    for (const row of rows) {
      inssWithheld += row.inss ?? 0;
      incomeTax += row.incomeTax ?? 0;
      overtimeMinutes += row.overtimeMinutes ?? 0;
    }
    return {
      headcount,
      avgNet: net !== null && headcount > 0 ? net / headcount : null,
      companyCost: gross !== null ? gross + employer : null,
      deductionRate: gross && deductions !== null ? (deductions / gross) * 100 : null,
      variance: net !== null && previousNet ? ((net - previousNet) / previousNet) * 100 : null,
      inss: inssWithheld,
      incomeTax,
      overtimeHours: overtimeMinutes / 60,
    };
  }, [previous?.netPay, rows, run.snapshot.length, run.totals]);

  const filteredRows = rows.filter((row) => {
    const matchesQuery = row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesQuery && (!onlyIncidents || row.anomalies.length > 0);
  });
  const totalsKnown = filteredRows.every((row) => [row.gross, row.inss, row.incomeTax, row.deductions, row.net, row.salary, row.overtimePay].every((v) => v !== null));
  const receiptIds = run.receipts.filter((receipt) => receipt.status === 'PUBLISHED').map((receipt) => receipt.id);

  type PayrollRow = (typeof rows)[number];
  const detailRow = rows.find((row) => row.userId === expandedUserId) ?? null;
  const renderDetail = (row: PayrollRow) => (
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
        {row.components.filter((item) => item.type === 'INCOME').map((item) => <Line key={item.id} label={item.name} note={item.source} amount={moneyOrND(currency, item.amount)} />)}
        {!row.components.some((item) => item.type === 'INCOME') && <p className="payroll-operation-detail-empty">Sin ingresos calculados.</p>}
        <footer><span>Total ingresos</span><strong>{formatEmployeeMoney(currency, row.gross)}</strong></footer>
      </section>
      <section>
        <div className="payroll-operation-detail-heading"><Minus size={18} aria-hidden="true" /><div><h4>Deducciones</h4><small>{row.components.filter((item) => item.type === 'DEDUCTION').length} concepto(s)</small></div></div>
        {row.components.filter((item) => item.type === 'DEDUCTION').map((item) => <Line key={item.id} label={item.name} note={item.code} amount={moneyOrND(currency, item.amount)} />)}
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
        {row.receipt ? <><strong className="payroll-operation-payslip-net">Neto pagado: {moneyOrND(row.receipt.currency, row.receipt.netPay)}</strong><p>Disponible para el colaborador en Mi RH.</p><Button size="sm" variant="secondary" onClick={() => onDownloadReceipt(row.receipt!.id)} disabled={!online || busy}><Download size={14} /> Descargar colilla PDF</Button></> : <p>Se genera automáticamente cuando se registra el pago de la corrida.</p>}
      </section>
      {row.statutory && <details className="payroll-operation-statutory"><summary>Traza de INSS e IR</summary><div><Line label="Base INSS" note={`Configuración #${row.statutory.configurationRevisionId}`} amount={moneyOrND(currency, row.statutory.inssBase)} /><Line label="INSS laboral" note={`Método ${row.statutory.methodVersion}`} amount={moneyOrND(currency, row.statutory.employeeInss)} /><Line label="Proyección anual IR" note={`${row.statutory.elapsedFiscalMonths}/12 meses fiscales`} amount={moneyOrND(currency, row.statutory.annualProjection)} /><Line label="IR retenido" note={row.statutory.incomeTaxMethod} amount={moneyOrND(currency, row.statutory.currentIncomeTaxWithheld)} /><p>Tramo efectivo: {row.statutory.bracketSnapshot?.effective ? `${row.statutory.bracketSnapshot.effective.lowerBound} a ${row.statutory.bracketSnapshot.effective.upperBound ?? 'en adelante'} · tasa ${formatPercent(Number(row.statutory.bracketSnapshot.effective.rate) * 100)}` : 'sin retención aplicable'}.</p><small>Histórico {row.statutory.historyFingerprint} · cálculo {formatDateTime(row.statutory.createdAt)}</small><span className="sr-only">Compensación fija {row.statutory.fixedCompensationAmount}</span></div></details>}
    </div>
  );

  const kindLabel = run.kind === 'AGUINALDO' ? 'Aguinaldo' : 'Nómina ordinaria';
  const nextTitle = primaryAction ? ACTION_LABELS[primaryAction] : run.status === 'PAID' ? 'Pago completado' : 'No hay acciones disponibles';
  const nextHelp = run.blockingAnomalyCount > 0
    ? `${run.blockingAnomalyCount} incidencia(s) bloqueante(s) deben resolverse antes de continuar.`
    : run.status === 'PAID'
      ? 'Las colillas ya están publicadas y puedes descargarlas individualmente o todas juntas.'
      : primaryAction ? ACTION_HELP[primaryAction] : 'Actualiza la corrida para consultar su estado más reciente.';

  const periodText = run.kind === 'AGUINALDO'
    ? `Año ${run.year ?? '—'} · corte ${formatDate(run.cutoffDate)} · cálculo basado en ingresos históricos elegibles`
    : `${run.period?.code ?? `Periodo #${run.periodId ?? '—'}`} · ${formatDate(run.period?.dateFrom)} al ${formatDate(run.period?.dateTo)} · pago ${formatDate(run.period?.payDate)}`;
  const secondaryActions = run.allowedActions.filter((action) => action !== 'VOID' && action !== primaryAction);

  return (
    <div className={form.stack} aria-live="polite">
      <PageHeader
        breadcrumb={['Recursos humanos', 'Nómina', kindLabel]}
        title={run.code}
        description={<span className={form.actions}><PayrollStatusPill status={run.status} /><span>{periodText} · {indicators.headcount} colaborador(es)</span></span>}
        actions={(
          <>
            {onBack && <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>Volver a corridas</Button>}
            <Button variant="ghost" icon={RefreshCw} onClick={onRefresh} disabled={busy} aria-label="Actualizar corrida">Actualizar</Button>
            <span className={form.actions} role="group" aria-label="Reportes y colillas">
              <Button icon={Download} onClick={() => onDownloadReceiptBatch(receiptIds)} disabled={!online || busy || receiptIds.length === 0} title={run.status !== 'PAID' ? 'Las colillas estarán disponibles cuando registres el pago.' : undefined}>Colillas ({receiptIds.length})</Button>
              <Button icon={FileSpreadsheet} onClick={() => onExport('xlsx')} disabled={!online || busy || run.snapshot.length === 0}>Excel</Button>
              <Button variant="ghost" onClick={() => onExport('csv')} disabled={!online || busy || run.snapshot.length === 0}>CSV</Button>
            </span>
            {run.allowedActions.includes('VOID') && <Button variant="ghost" onClick={() => onAction('VOID')} disabled={!online || busy}>Anular</Button>}
            {secondaryActions.map((action) => <Button key={action} onClick={() => onAction(action)} disabled={!online || busy}>{ACTION_LABELS[action]}</Button>)}
            {primaryAction && <Button variant="primary" onClick={() => onAction(primaryAction)} disabled={!online || busy}>{ACTION_LABELS[primaryAction]}</Button>}
          </>
        )}
      />

      {stepper}

      {run.status === 'VOID' && (
        <div className={form.alertDanger} role="alert">Esta corrida fue anulada. Se conserva únicamente para consulta y auditoría.</div>
      )}

      <section className={form.kpis} aria-label="Indicadores de la corrida">
        <StatCard
          tone="primary"
          label="Neto a pagar"
          value={formatRunTotal(currency, run.totals?.netPay)}
          context={`${indicators.variance === null
            ? (previous ? `${previous.code}: neto ${formatRunTotal(currency, previous.netPay)}` : 'No hay una corrida anterior para comparar')
            : `${indicators.variance > 0 ? '▲ +' : indicators.variance < 0 ? '▼ ' : ''}${oneDecimal(indicators.variance)} % vs ${previous?.code ?? 'la corrida anterior'}`}${indicators.avgNet === null ? '' : ` · promedio ${moneyOrND(currency, indicators.avgNet)} por colaborador`}${indicators.overtimeHours > 0 ? ` · ${oneDecimal(indicators.overtimeHours)} h extra aprobadas` : ''}`}
        />
        <StatCard
          label="Costo total para la empresa"
          value={indicators.companyCost === null ? 'Pendiente de cálculo' : moneyOrND(currency, indicators.companyCost)}
          context={`Bruto ${formatRunTotal(currency, run.totals?.grossIncome)} + aportes patronales ${formatRunTotal(currency, run.totals?.employerContributions)} · retenciones INSS ${moneyOrND(currency, indicators.inss)} e IR ${moneyOrND(currency, indicators.incomeTax)}${indicators.deductionRate !== null ? ` (${oneDecimal(indicators.deductionRate)} % del bruto)` : ''}`}
        />
        <StatCard
          tone={run.blockingAnomalyCount > 0 ? 'danger' : run.status === 'PAID' ? 'success' : 'neutral'}
          label={run.blockingAnomalyCount > 0 ? 'Bloquean la aprobación' : 'Qué sigue'}
          value={run.blockingAnomalyCount > 0 ? `${run.blockingAnomalyCount} incidencia(s)` : nextTitle}
          context={nextHelp}
          action={run.blockingAnomalyCount > 0 && rows.some((row) => row.anomalies.length > 0)
            ? { label: 'Ver incidencias', onClick: () => setOnlyIncidents(true) }
            : undefined}
        />
      </section>

      {run.snapshot.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Aún no hay resultados por colaborador"
          description="Calcula la corrida para congelar asistencia, horas extra, permisos, préstamos y conceptos aplicables."
          action={run.allowedActions.includes('CALCULATE') ? <Button variant="primary" onClick={() => onAction('CALCULATE')} disabled={!online}>Calcular ahora</Button> : undefined}
        />
      ) : (
        <>
          <DataTable<PayrollRow>
            ariaLabel="Pago por colaborador"
            rows={filteredRows}
            rowKey={(row) => row.userId}
            pagination={{ mode: 'client' }}
            resetKey={`${query}|${onlyIncidents}`}
            footerLabel="Total de la vista"
            onRowClick={(row) => setExpandedUserId(row.userId)}
            toolbar={(
              <TableToolbar
                actions={(
                  <>
                    <span className={form.cellSub} aria-live="polite">{filteredRows.length} de {rows.length} colaborador(es)</span>
                    {run.status === 'CALCULATED' && <Button size="sm" icon={Plus} onClick={onAddComponent} disabled={!online || busy}>Agregar ingreso o deducción</Button>}
                  </>
                )}
              >
                <Input
                  id="payroll-employee-search"
                  type="search"
                  aria-label="Buscar colaborador"
                  placeholder="Buscar colaborador"
                  prefix={<Search size={14} aria-hidden="true" />}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                />
                <SegmentedControl<'ALL' | 'INCIDENTS'>
                  ariaLabel="Filtro"
                  options={[{ value: 'ALL', label: 'Todos' }, { value: 'INCIDENTS', label: 'Con incidencia' }]}
                  value={onlyIncidents ? 'INCIDENTS' : 'ALL'}
                  onChange={(next) => setOnlyIncidents(next === 'INCIDENTS')}
                />
              </TableToolbar>
            )}
            minWidth="72rem"
            rowTone={(row) => (row.anomalies.some((item) => item.blocking) ? 'danger' : undefined)}
            empty={<EmptyState title="No hay colaboradores que coincidan con los filtros." />}
            columns={[
              { key: 'name', header: 'Colaborador', width: '1.6fr', render: (row) => <span className={form.cellStack}><span className={form.cellTitle}>{row.name}</span><span className={form.cellSub}>{row.branch ?? `ID ${row.userId}`}</span></span> },
              { key: 'salary', header: 'Salario', width: '1fr', type: 'money', hideBelow: 'lg', total: totalsKnown, accessor: (row) => row.salary, render: (row) => formatEmployeeMoney(currency, row.salary) },
              {
                key: 'overtime', header: 'Horas extra', width: '1fr', type: 'money', hideBelow: 'lg', total: totalsKnown, accessor: (row) => row.overtimePay,
                render: (row) => <span className={form.cellStack}><span>{formatEmployeeMoney(currency, row.overtimePay)}</span>{row.overtimeMinutes > 0 && <span className={form.cellSub}>{row.overtimeMinutes} min</span>}</span>,
              },
              { key: 'gross', header: 'Ingresos', width: '1fr', type: 'money', total: totalsKnown, accessor: (row) => row.gross, render: (row) => formatEmployeeMoney(currency, row.gross) },
              { key: 'inss', header: 'INSS laboral', width: '1fr', type: 'money', total: totalsKnown, accessor: (row) => row.inss, render: (row) => formatEmployeeMoney(currency, row.inss) },
              { key: 'ir', header: 'IR laboral', width: '1fr', type: 'money', total: totalsKnown, accessor: (row) => row.incomeTax, render: (row) => formatEmployeeMoney(currency, row.incomeTax) },
              { key: 'deductions', header: 'Deducciones', width: '1fr', type: 'money', total: totalsKnown, accessor: (row) => row.deductions, render: (row) => formatEmployeeMoney(currency, row.deductions) },
              { key: 'net', header: 'Neto', width: '1fr', type: 'money', total: totalsKnown, accessor: (row) => row.net, render: (row) => <span className={form.cellTitle}>{formatEmployeeMoney(currency, row.net)}</span> },
              { key: 'incidents', header: 'Incidencias', width: '1fr', render: (row) => (row.anomalies.length ? <Badge tone={row.anomalies.some((item) => item.blocking) ? 'danger' : 'warning'}>{row.anomalies.length}</Badge> : <span className={form.cellSub}><Check size={14} aria-hidden="true" /> Sin incidencias</span>) },
              {
                key: 'actions',
                header: 'Acciones',
                width: '7rem',
                type: 'actions',
                render: (row) => (
                  <div className={form.rowActions}>
                    <IconButton icon={Eye} size="sm" aria-haspopup="dialog" aria-controls={`payroll-employee-detail-${row.userId}`} label={`Ver detalle de ${row.name}`} onClick={() => setExpandedUserId(row.userId)} />
                    {row.receipt && <IconButton icon={Download} size="sm" onClick={() => onDownloadReceipt(row.receipt!.id)} disabled={!online || busy} label={`Descargar colilla de ${row.name}`} />}
                  </div>
                ),
              },
            ]}
          />
          <FullScreenModal
            isOpen={Boolean(detailRow)}
            onClose={() => setExpandedUserId(null)}
            breadcrumb={['Nómina', run.code]}
            title={detailRow ? `Detalle de pago: ${detailRow.name}` : 'Detalle de pago'}
          >
            {detailRow && renderDetail(detailRow)}
          </FullScreenModal>
        </>
      )}

      <details className={form.disclosure}>
        <summary>Información técnica y auditoría <span className={form.cellSub}>· úsala sólo para soporte, conciliación o revisión de cambios</span></summary>
        <dl className={form.facts}>
          <div><dt>Calculó</dt><dd>{run.calculatedBy?.name ?? 'Pendiente'}</dd></div>
          <div><dt>Aprobó</dt><dd>{run.approvedBy?.name ?? 'Pendiente'}</dd></div>
          <div><dt>Registró el pago</dt><dd>{run.paidBy?.name ?? 'Pendiente'}</dd></div>
          <div><dt>Regla legal</dt><dd>#{run.ruleVersionId}</dd></div>
          <div><dt>Configuración</dt><dd>#{run.configurationRevisionId ?? 'pendiente'}</dd></div>
          <div><dt>Revisión de la corrida</dt><dd>{run.revision}</dd></div>
        </dl>
        <details className={form.disclosure}>
          <summary>Ver conciliación técnica de importes</summary>
          <PayrollReconciliationPanel key={`${run.kind}-${run.id}-${run.revision}`} run={run} />
        </details>
      </details>
    </div>
  );
}

function Line({ label, note, amount }: { label: string; note: string; amount: string }) {
  return <div className="payroll-operation-line"><div><strong>{label}</strong><small>{note}</small></div><span>{amount}</span></div>;
}
