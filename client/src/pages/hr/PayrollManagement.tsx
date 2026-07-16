import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Calculator, Download, Eye, FilePlus2, FileSpreadsheet, Gift, Plus, Receipt, Scale, Search } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import Sidebar from '../../components/Sidebar';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
import HrReactSelect from '../../components/hr/HrReactSelect';
import { collectAllPages } from '../../components/hr/collectAllPages';
import PayrollComponentForm from '../../components/hr/PayrollComponentForm';
import PayrollOnlineNotice from '../../components/hr/PayrollOnlineNotice';
import PayrollOperationWorkspace from '../../components/hr/payroll-operation-workspace';
import PayrollRuleForm from '../../components/hr/PayrollRuleForm';
import PayrollRunForm from '../../components/hr/PayrollRunForm';
import PayrollStatusPill from '../../components/hr/PayrollStatusPill';
import PayrollTransitionForm from '../../components/hr/PayrollTransitionForm';
import usePayrollOnline from '../../components/hr/usePayrollOnline';
import { hrClient } from '../../components/hr/hrClient';
import { createPayrollIdempotencyKey, getPayrollErrorMessage, payrollClient } from '../../components/hr/payrollClient';
import { useConfirmDialog } from '../../context/ConfirmContext';
import { useAppToast } from '../../context/ToastContext';
import type { HrOrganizationCatalogs } from '../../types/hr';
import type {
  HrAguinaldoRunPayload,
  HrPayrollAction,
  HrPayrollComponentPayload,
  HrPayrollPaymentConceptDefinition,
  HrPayrollPeriod,
  HrPayrollPeriodPayload,
  HrPayrollRulePayload,
  HrPayrollRuleVersion,
  HrPayrollRun,
  HrPayrollRunDetail,
  HrPayrollRunKind,
  HrPayrollRunPayload,
  HrPayrollTransitionPayload,
} from '../../types/hr-payroll';
import './payroll.css';
import './payroll-operations.css';
import './admin-tables.css';
import '../Inventory.css';

const EMPTY_LOOKUPS: HrOrganizationCatalogs = { departments: [], positions: [], costCenters: [], branches: [], users: [] };
const PAGE_SIZE = 12;

const ACTION_LABELS: Record<HrPayrollAction, string> = {
  CALCULATE: 'Calcular nómina',
  RECALCULATE: 'Recalcular nómina',
  SUBMIT_REVIEW: 'Enviar a revisión',
  APPROVE: 'Aprobar nómina',
  MARK_PAID: 'Registrar pago y publicar colillas',
  VOID: 'Anular corrida',
};

const STATUS_LABELS: Record<HrPayrollRun['status'], string> = {
  DRAFT: 'Borrador',
  CALCULATED: 'Calculada',
  REVIEW: 'En revisión',
  APPROVED: 'Aprobada',
  PAID: 'Pagada',
  VOID: 'Anulada',
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(date);
}

function runPeriodLabel(run: HrPayrollRun) {
  if (run.kind === 'AGUINALDO') return `Aguinaldo ${run.year ?? ''}`.trim();
  return run.period?.code ?? `Periodo #${run.periodId ?? '—'}`;
}

type CreatePanel =
  | { kind: 'rule'; rule?: HrPayrollRuleVersion }
  | { kind: 'period' }
  | { kind: 'run'; runKind: HrPayrollRunKind }
  | { kind: 'component' }
  | null;

function periodDefaults(): HrPayrollPeriodPayload {
  const value = new Date();
  const date = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return { code: '', dateFrom: date, dateTo: date, payDate: date, reason: '' };
}

export default function PayrollManagement() {
  const navigate = useNavigate();
  const online = usePayrollOnline();
  const { confirm } = useConfirmDialog();
  const { success: showSuccess, error: showError } = useAppToast();
  const [lookups, setLookups] = useState<HrOrganizationCatalogs>(EMPTY_LOOKUPS);
  const [rules, setRules] = useState<HrPayrollRuleVersion[]>([]);
  const [periods, setPeriods] = useState<HrPayrollPeriod[]>([]);
  const [regularRuns, setRegularRuns] = useState<HrPayrollRun[]>([]);
  const [aguinaldoRuns, setAguinaldoRuns] = useState<HrPayrollRun[]>([]);
  const [activeKind, setActiveKind] = useState<HrPayrollRunKind>('REGULAR');
  const [status, setStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [selected, setSelected] = useState<HrPayrollRunDetail | null>(null);
  const [selectedPaymentConcepts, setSelectedPaymentConcepts] = useState<HrPayrollPaymentConceptDefinition[]>([]);
  const [selectedIncomeTaxApplicability, setSelectedIncomeTaxApplicability] = useState<'APPLIES' | 'DOES_NOT_APPLY' | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [createPanel, setCreatePanel] = useState<CreatePanel>(null);
  const [transition, setTransition] = useState<{ run: HrPayrollRun; action: HrPayrollAction } | null>(null);
  const [periodForm, setPeriodForm] = useState<HrPayrollPeriodPayload>(periodDefaults());
  const componentOperationKey = useRef<string | null>(null);
  const transitionOperationKey = useRef<string | null>(null);
  const autoOpenedRunKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = { status: status || undefined };
      const [organization, ruleResult, periodResult, runResult, aguinaldoResult] = await Promise.all([
        hrClient.getOrganization(),
        collectAllPages((page) => payrollClient.getRules({ page, limit: 100 })),
        collectAllPages((page) => payrollClient.getPeriods({ page, limit: 100 })),
        collectAllPages((page) => payrollClient.getRuns('REGULAR', { ...filters, page, limit: 100 })),
        collectAllPages((page) => payrollClient.getRuns('AGUINALDO', { ...filters, page, limit: 100 })),
      ]);
      setLookups(organization);
      setRules(ruleResult);
      setPeriods(periodResult);
      setRegularRuns(runResult);
      setAguinaldoRuns(aguinaldoResult);
      setSelected((current) => current && [...runResult, ...aguinaldoResult].some((run) => run.id === current.id && run.kind === current.kind) ? current : null);
    } catch (loadError) {
      setError(getPayrollErrorMessage(loadError, 'No fue posible cargar nómina y aguinaldo.'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setTablePage(1); }, [activeKind, searchQuery, status]);

  const openWorkspace = useCallback(async (run: HrPayrollRun) => {
    setWorkspaceLoading(true);
    try {
      const [workspace, revisions] = await Promise.all([
        payrollClient.getRunWorkspace(run.kind, run.id),
        payrollClient.getRuleConfigurations(run.ruleVersionId),
      ]);
      const configurationRevisionId = workspace.configurationRevisionId ?? workspace.ruleVersion?.activeConfigurationRevisionId;
      const configuration = revisions.find((revision) => revision.id === configurationRevisionId)?.configuration;
      setSelected(workspace);
      setSelectedPaymentConcepts(configuration?.statutory.paymentConceptCatalog ?? []);
      setSelectedIncomeTaxApplicability(configuration?.statutory.companyTaxRegime.incomeTaxApplicability ?? null);
    } catch (workspaceError) {
      showError(getPayrollErrorMessage(workspaceError, 'No fue posible cargar el detalle de la corrida.'));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (loading || error || workspaceLoading) return;
    const available = activeKind === 'REGULAR' ? regularRuns : aguinaldoRuns;
    if (available.length === 0) {
      if (selected?.kind === activeKind) setSelected(null);
      return;
    }
    if (selected?.kind === activeKind && available.some((run) => run.id === selected.id)) return;
    const latest = [...available].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
    const autoOpenKey = `${latest.kind}-${latest.id}`;
    if (autoOpenedRunKey.current === autoOpenKey) return;
    autoOpenedRunKey.current = autoOpenKey;
    void openWorkspace(latest);
  }, [activeKind, aguinaldoRuns, error, loading, openWorkspace, regularRuns, selected, workspaceLoading]);

  const refreshWorkspace = async (run: HrPayrollRun) => {
    await load();
    await openWorkspace(run);
  };

  const saveRule = async (payload: HrPayrollRulePayload) => {
    setSaving(true);
    try {
      const editing = createPanel?.kind === 'rule' ? createPanel.rule : undefined;
      if (editing) await payrollClient.updateRule(editing.id, payload, createPayrollIdempotencyKey());
      else await payrollClient.createRule(payload, createPayrollIdempotencyKey());
      showSuccess(editing ? 'Nueva revisión de regla guardada.' : 'Regla base creada. Ahora configura y valida sus parámetros legales.');
      setCreatePanel(null);
      await load();
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible guardar la regla.'));
    } finally { setSaving(false); }
  };

  const savePeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await payrollClient.createPeriod({ ...periodForm, reason: periodForm.reason.trim() }, createPayrollIdempotencyKey());
      showSuccess('Periodo creado. Ya puedes abrir una corrida de nómina.');
      setPeriodForm(periodDefaults());
      setCreatePanel({ kind: 'run', runKind: 'REGULAR' });
      await load();
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible crear el periodo.'));
    } finally { setSaving(false); }
  };

  const saveRun = async (kind: HrPayrollRunKind, payload: HrPayrollRunPayload | HrAguinaldoRunPayload) => {
    setSaving(true);
    try {
      const created = kind === 'AGUINALDO'
        ? await payrollClient.createAguinaldoRun(payload as HrAguinaldoRunPayload, createPayrollIdempotencyKey())
        : await payrollClient.createRun(payload as HrPayrollRunPayload, createPayrollIdempotencyKey());
      showSuccess(kind === 'AGUINALDO' ? 'Aguinaldo creado. El siguiente paso es calcularlo.' : 'Corrida creada. El siguiente paso es calcularla.');
      setCreatePanel(null);
      setActiveKind(kind);
      autoOpenedRunKey.current = `${created.kind}-${created.id}`;
      await load();
      await openWorkspace(created);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible crear la corrida.'));
    } finally { setSaving(false); }
  };

  const saveComponent = async (payload: HrPayrollComponentPayload) => {
    if (!selected) return;
    const idempotencyKey = componentOperationKey.current ?? createPayrollIdempotencyKey();
    componentOperationKey.current = idempotencyKey;
    setSaving(true);
    try {
      await payrollClient.addComponent(selected.kind, selected.id, payload, idempotencyKey);
      componentOperationKey.current = null;
      setCreatePanel(null);
      showSuccess('Concepto agregado y totales recalculados.');
      await refreshWorkspace(selected);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible agregar el concepto.'));
    } finally { setSaving(false); }
  };

  const saveTransition = async (payload: HrPayrollTransitionPayload) => {
    if (!transition) return;
    const accepted = await confirm(`Confirma: ${ACTION_LABELS[transition.action]} para ${transition.run.code}.`, {
      title: 'Confirmación final de nómina', confirmText: ACTION_LABELS[transition.action],
      variant: transition.action === 'VOID' || transition.action === 'MARK_PAID' ? 'danger' : 'warning',
    });
    if (!accepted) return;
    setSaving(true);
    try {
      const { run, action } = transition;
      const key = transitionOperationKey.current ?? createPayrollIdempotencyKey();
      transitionOperationKey.current = key;
      let updated: HrPayrollRun;
      if (action === 'CALCULATE') updated = await payrollClient.calculateRun(run.kind, run.id, payload, key);
      else if (action === 'RECALCULATE') updated = await payrollClient.recalculateRun(run.kind, run.id, payload, key);
      else if (action === 'SUBMIT_REVIEW') updated = await payrollClient.submitRunReview(run.kind, run.id, payload, key);
      else if (action === 'APPROVE') updated = await payrollClient.approveRun(run.kind, run.id, payload, key);
      else if (action === 'MARK_PAID') updated = await payrollClient.payRun(run.kind, run.id, payload, key);
      else updated = await payrollClient.voidRun(run.kind, run.id, payload, key);
      transitionOperationKey.current = null;
      setTransition(null);
      showSuccess(action === 'MARK_PAID' ? 'Pago registrado y colillas publicadas.' : `${ACTION_LABELS[action]} completado.`);
      await refreshWorkspace(updated);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible completar la acción.'));
    } finally { setSaving(false); }
  };

  const exportSpecificRun = async (run: HrPayrollRun, format: 'csv' | 'xlsx') => {
    setDownloading(true);
    try { await payrollClient.exportRun(run.kind, run.id, format); showSuccess(`Reporte de ${run.code} generado.`); }
    catch (downloadError) { showError(getPayrollErrorMessage(downloadError, 'No fue posible exportar la corrida.')); }
    finally { setDownloading(false); }
  };

  const exportRun = async (format: 'csv' | 'xlsx') => {
    if (!selected) return;
    setDownloading(true);
    try {
      await payrollClient.exportRun(selected.kind, selected.id, format);
      showSuccess(`Reporte de ${selected.code} generado.`);
    } catch (downloadError) {
      showError(getPayrollErrorMessage(downloadError, 'No fue posible exportar la corrida.'));
    } finally {
      setDownloading(false);
    }
  };

  const downloadReceipt = async (receiptId: number) => {
    if (!selected) return;
    setDownloading(true);
    try { await payrollClient.downloadRunReceipt(selected.kind, selected.id, receiptId); }
    catch (downloadError) { showError(getPayrollErrorMessage(downloadError, 'No fue posible descargar la colilla.')); }
    finally { setDownloading(false); }
  };

  const downloadReceiptBatch = async (receiptIds: number[]) => {
    if (!selected || receiptIds.length === 0) return;
    setDownloading(true);
    try {
      for (const receiptId of receiptIds) await payrollClient.downloadRunReceipt(selected.kind, selected.id, receiptId);
      showSuccess(`${receiptIds.length} colilla(s) descargadas.`);
    } catch (downloadError) {
      showError(getPayrollErrorMessage(downloadError, 'No fue posible completar la descarga de colillas.'));
    } finally { setDownloading(false); }
  };

  const downloadRunReceiptBatch = async (run: HrPayrollRun) => {
    setDownloading(true);
    try {
      const workspace = selected?.id === run.id && selected.kind === run.kind
        ? selected
        : await payrollClient.getRunWorkspace(run.kind, run.id);
      const ids = workspace.receipts.filter((receipt) => receipt.status === 'PUBLISHED').map((receipt) => receipt.id);
      if (ids.length === 0) {
        showError('Esta corrida todavía no tiene colillas publicadas.');
        return;
      }
      for (const receiptId of ids) await payrollClient.downloadRunReceipt(run.kind, run.id, receiptId);
      showSuccess(`${ids.length} colilla(s) de ${run.code} descargadas.`);
    } catch (downloadError) {
      showError(getPayrollErrorMessage(downloadError, 'No fue posible descargar las colillas de la corrida.'));
    } finally { setDownloading(false); }
  };

  const runs = activeKind === 'REGULAR' ? regularRuns : aguinaldoRuns;
  const filteredRuns = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return runs;
    return runs.filter((run) => [
      run.code,
      runPeriodLabel(run),
      run.period?.dateFrom,
      run.period?.dateTo,
      run.period?.payDate,
      run.cutoffDate,
      run.year != null ? String(run.year) : '',
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [runs, searchQuery]);
  const pagedRuns = filteredRuns.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE);
  useEffect(() => { setTablePage((page) => Math.min(page, Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE)))); }, [filteredRuns.length]);
  const activeRules = rules.filter((rule) => rule.status === 'ACTIVE');
  const operationReady = activeRules.length > 0 && (activeKind === 'AGUINALDO' || periods.some((period) => period.status !== 'VOID'));

  return (
    <div className="page-wrapper inventory-page hr-payroll-page payroll-operations-page hr-admin-catalog-page">
      <PageHeader className="inventory-header-new" title="Nómina y aguinaldo" subtitle="Calcula, revisa, aprueba, paga y entrega colillas desde un flujo guiado. Configuración legal: IR, INSS e INATEC." icon={Calculator}
        actions={<Button variant="secondary" onClick={() => navigate('/rh/nomina/configuracion-legal')}><Scale size={17} /> Configurar IR, INSS e INATEC</Button>} />
      <PayrollOnlineNotice online={online} />

      <div className="payroll-operation-switcher inventory-filters-row">
        <div className="payroll-operation-tabs inventory-status-filters" role="tablist" aria-label="Tipo de proceso">
          <button type="button" role="tab" id="payroll-tab-regular" aria-controls="payroll-panel-regular" aria-selected={activeKind === 'REGULAR'} className={activeKind === 'REGULAR' ? 'active' : ''} onClick={() => { setActiveKind('REGULAR'); setSelected(null); }}><Receipt size={17} /> Nómina ordinaria <small>{regularRuns.length}</small></button>
          <button type="button" role="tab" id="payroll-tab-aguinaldo" aria-controls="payroll-panel-aguinaldo" aria-selected={activeKind === 'AGUINALDO'} className={activeKind === 'AGUINALDO' ? 'active' : ''} onClick={() => { setActiveKind('AGUINALDO'); setSelected(null); }}><Gift size={17} /> Aguinaldo <small>{aguinaldoRuns.length}</small></button>
        </div>
        <Button onClick={() => setCreatePanel({ kind: 'run', runKind: activeKind })} disabled={!online || !operationReady}><Plus size={16} /> {activeKind === 'AGUINALDO' ? 'Crear aguinaldo' : 'Crear corrida de nómina'}</Button>
      </div>

      {!operationReady && !loading && (
        <div className="payroll-operation-alert" role="status">
          <AlertTriangle size={20} />
          <span>{activeRules.length === 0 ? 'Para crear corridas necesitas una regla legal activa.' : 'Primero crea el periodo que deseas pagar.'}</span>
          {activeRules.length === 0
            ? <Button size="sm" variant="secondary" onClick={() => rules.length ? navigate(`/rh/nomina/configuracion-legal?ruleId=${rules[0].id}`) : setCreatePanel({ kind: 'rule' })}>{rules.length ? 'Configurar regla' : 'Crear regla base'}</Button>
            : <Button size="sm" variant="secondary" onClick={() => setCreatePanel({ kind: 'period' })}>Crear periodo</Button>}
        </div>
      )}

      {loading && <LoadingSpinner text="Cargando corridas…" />}
      {!loading && error && <div className="state-placeholder" role="alert"><AlertTriangle size={42} /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void load()}>Reintentar</Button></div>}
      {!loading && !error && (
        <>
          <section className="payroll-run-register pr-table-card" role="tabpanel" id={`payroll-panel-${activeKind.toLowerCase()}`} aria-labelledby={`payroll-tab-${activeKind.toLowerCase()}`}>
            <header className="payroll-run-register-header">
              <div>
                <h2 id="payroll-run-register-title">{activeKind === 'REGULAR' ? 'Corridas de nómina' : 'Corridas de aguinaldo'}</h2>
                <p>Consulta el periodo, los totales y el estado. Abre una fila para continuar el proceso.</p>
              </div>
              <div className="payroll-run-register-tools">
                <label htmlFor="payroll-run-search">Buscar código o periodo<div className="payroll-run-search"><Search size={15} aria-hidden="true" /><input id="payroll-run-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Ej. 2026-Q1" /></div></label>
                <label>Estado<HrReactSelect value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos los estados</option>{(Object.keys(STATUS_LABELS) as HrPayrollRun['status'][]).map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</HrReactSelect></label>
                {activeKind === 'REGULAR' && <Button size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'period' })}><FilePlus2 size={15} /> Periodos</Button>}
              </div>
            </header>
            {filteredRuns.length === 0 ? <div className="payroll-operation-empty-list"><strong>No hay corridas que coincidan con los filtros.</strong><span>{runs.length === 0 ? 'Crea una corrida para iniciar el cálculo, revisión y pago.' : 'Prueba otro código, periodo o estado.'}</span>{runs.length === 0 && <Button size="sm" onClick={() => setCreatePanel({ kind: 'run', runKind: activeKind })} disabled={!operationReady}>Crear primera corrida</Button>}</div>
              : <div className="payroll-run-table-wrap"><table className="payroll-run-table inventory-table">
                <thead><tr><th scope="col">Corrida</th><th scope="col">Periodo</th><th scope="col">Estado</th><th scope="col">Empleados</th><th scope="col">Ingresos</th><th scope="col">Neto a pagar</th><th scope="col">Incidencias</th><th scope="col">Fecha de pago</th><th scope="col">Acciones</th></tr></thead>
                <tbody>{pagedRuns.map((run) => {
                  const isSelected = selected?.id === run.id && selected.kind === run.kind;
                  return <tr key={`${run.kind}-${run.id}`} className={isSelected ? 'selected' : undefined} aria-current={isSelected ? 'true' : undefined}>
                    <th scope="row"><strong>{run.code}</strong><small>Creada {formatDate(run.createdAt)}</small></th>
                    <td>{runPeriodLabel(run)}</td>
                    <td><PayrollStatusPill status={run.status} /></td>
                    <td>{run.totals?.employeeCount ?? 0}</td>
                    <td>{run.totals ? new Intl.NumberFormat('es-NI', { style: 'currency', currency: run.totals.currency }).format(Number(run.totals.grossIncome)) : '—'}</td>
                    <td><strong>{run.totals ? new Intl.NumberFormat('es-NI', { style: 'currency', currency: run.totals.currency }).format(Number(run.totals.netPay)) : '—'}</strong></td>
                    <td>{run.blockingAnomalyCount ? <span className="payroll-run-blocker"><AlertTriangle size={14} /> {run.blockingAnomalyCount} por resolver</span> : run.anomalyCount ? `${run.anomalyCount} informativa(s)` : <span className="payroll-run-clear">Sin incidencias</span>}</td>
                    <td>{formatDate(run.kind === 'AGUINALDO' ? run.cutoffDate : run.period?.payDate)}</td>
                    <td><div className="payroll-run-actions table-actions">
                      <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => void openWorkspace(run)} disabled={workspaceLoading} title={isSelected ? 'Corrida abierta' : run.status === 'PAID' || run.status === 'VOID' ? 'Ver corrida' : 'Continuar corrida'} aria-label={`${isSelected ? 'Corrida abierta' : 'Abrir corrida'} ${run.code}`}><Eye size={16} /></Button>
                      <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => void exportSpecificRun(run, 'xlsx')} disabled={downloading || !run.totals} title="Descargar reporte Excel" aria-label={`Descargar reporte de ${run.code}`}><FileSpreadsheet size={16} /></Button>
                      <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => void downloadRunReceiptBatch(run)} disabled={downloading || run.status !== 'PAID'} title="Descargar colillas" aria-label={`Descargar colillas de ${run.code}`}><Download size={16} /></Button>
                    </div></td>
                  </tr>;
                })}</tbody>
              </table></div>}
            <Pagination page={tablePage} totalPages={Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE))} totalItems={filteredRuns.length} pageSize={PAGE_SIZE} onPageChange={setTablePage} alwaysShow emptyLabel="Sin corridas" />
          </section>

          <div className="payroll-operation-detail-area">
            {workspaceLoading ? <LoadingSpinner text="Abriendo la corrida…" /> : selected ? (
            <PayrollOperationWorkspace run={selected} online={online} busy={saving || downloading} onAction={(action) => { transitionOperationKey.current = createPayrollIdempotencyKey(); setTransition({ run: selected, action }); }} onRefresh={() => void openWorkspace(selected)} onAddComponent={() => { componentOperationKey.current = createPayrollIdempotencyKey(); setCreatePanel({ kind: 'component' }); }} onExport={(format) => void exportRun(format)} onDownloadReceipt={(id) => void downloadReceipt(id)} onDownloadReceiptBatch={(ids) => void downloadReceiptBatch(ids)} />
            ) : <div className="payroll-operation-placeholder"><div><Calculator size={44} /><h2>No hay una corrida abierta</h2><p>Crea una corrida o cambia los filtros para administrar sus pagos.</p></div></div>}
          </div>
        </>
      )}

      <Sidebar isOpen={Boolean(createPanel)} onClose={() => { if (!saving) { if (createPanel?.kind === 'component') componentOperationKey.current = null; setCreatePanel(null); } }} title={createPanel?.kind === 'rule' ? 'Nueva regla base' : createPanel?.kind === 'period' ? 'Nuevo periodo de nómina' : createPanel?.kind === 'component' ? 'Ingreso o deducción' : createPanel?.runKind === 'AGUINALDO' ? 'Crear aguinaldo' : 'Crear corrida de nómina'} width="large" closeOnBackdrop={!saving} closeOnEscape={!saving}>
        {createPanel?.kind === 'component' && selected && <PayrollComponentForm users={lookups.users ?? []} concepts={selectedPaymentConcepts} incomeTaxApplicability={selectedIncomeTaxApplicability} online={online} saving={saving} onSubmit={saveComponent} onCancel={() => { componentOperationKey.current = null; setCreatePanel(null); }} />}
        {createPanel?.kind === 'rule' && <PayrollRuleForm initial={createPanel.rule} online={online} saving={saving} notice={<PayrollOnlineNotice online={online} compact />} onSubmit={saveRule} onCancel={() => setCreatePanel(null)} />}
        {createPanel?.kind === 'period' && (
          <HrModalFormShell ariaLabel="Crear periodo de nómina" tabLabel="1. Periodo" sectionTitle="Define las fechas que se pagarán" icon={<FilePlus2 size={18} />} formClassName="hr-payroll-form" notice={<PayrollOnlineNotice online={online} compact />} onSubmit={(event) => void savePeriod(event)} footer={<><Button type="button" variant="ghost" onClick={() => setCreatePanel(null)}>Cancelar</Button><Button type="submit" disabled={!online || saving || !periodForm.code.trim() || !periodForm.reason.trim()}>{saving ? 'Creando…' : 'Crear y continuar'}</Button></>}>
            <label>Código<input value={periodForm.code} onChange={(event) => setPeriodForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="2026-Q15" required /></label>
            <label>Desde<input type="date" value={periodForm.dateFrom} onChange={(event) => setPeriodForm((current) => ({ ...current, dateFrom: event.target.value }))} required /></label>
            <label>Hasta<input type="date" min={periodForm.dateFrom} value={periodForm.dateTo} onChange={(event) => setPeriodForm((current) => ({ ...current, dateTo: event.target.value }))} required /></label>
            <label>Fecha de pago<input type="date" min={periodForm.dateTo} value={periodForm.payDate} onChange={(event) => setPeriodForm((current) => ({ ...current, payDate: event.target.value }))} required /></label>
            <label className="span-full">Motivo de apertura<textarea rows={4} value={periodForm.reason} onChange={(event) => setPeriodForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Ej. Nómina ordinaria de la segunda quincena" required /></label>
          </HrModalFormShell>
        )}
        {createPanel?.kind === 'run' && <PayrollRunForm kind={createPanel.runKind} periods={periods} rules={rules} online={online} saving={saving} notice={<PayrollOnlineNotice online={online} compact />} onSubmit={(payload) => saveRun(createPanel.runKind, payload)} onCancel={() => setCreatePanel(null)} />}
      </Sidebar>

      <Sidebar isOpen={Boolean(transition)} onClose={() => { if (!saving) { transitionOperationKey.current = null; setTransition(null); } }} title={transition ? ACTION_LABELS[transition.action] : 'Acción de nómina'} width="large" closeOnBackdrop={!saving} closeOnEscape={!saving}>
        {transition && <PayrollTransitionForm run={transition.run} action={transition.action} online={online} saving={saving} onSubmit={saveTransition} onCancel={() => { transitionOperationKey.current = null; setTransition(null); }} />}
      </Sidebar>
    </div>
  );
}
