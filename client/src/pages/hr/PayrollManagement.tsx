import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Calculator, Download, Eye, FilePlus2, FileSpreadsheet, Gift, Plus, Receipt, Scale, Search } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import { HrHero, HrPage, HrSection, HrTabs, HrToolbar, type HrFact } from '../../components/hr/layout/HrWorkspace';
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
import './layouts/nomina.css';

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
  const openedRunKey = useRef<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const runParam = searchParams.get('corrida');

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

  // The run detail is its own view, addressed by ?corrida=KIND-ID so the browser back button returns to the list.
  const allRuns = useMemo(() => [...regularRuns, ...aguinaldoRuns], [aguinaldoRuns, regularRuns]);
  const targetRun = useMemo(() => {
    if (!runParam) return null;
    const [kind, idText] = runParam.split('-');
    return allRuns.find((run) => run.kind === kind && run.id === Number(idText)) ?? null;
  }, [allRuns, runParam]);

  useEffect(() => {
    if (!runParam) {
      openedRunKey.current = null;
      setSelected(null);
      return;
    }
    if (loading || error || workspaceLoading || !targetRun) return;
    if (activeKind !== targetRun.kind) setActiveKind(targetRun.kind);
    if (openedRunKey.current === runParam) return;
    openedRunKey.current = runParam;
    void openWorkspace(targetRun);
  }, [activeKind, error, loading, openWorkspace, runParam, targetRun, workspaceLoading]);

  const openRun = (run: HrPayrollRun) => {
    setSearchParams((params) => { params.set('corrida', `${run.kind}-${run.id}`); return params; });
  };
  const closeRun = () => {
    setSearchParams((params) => { params.delete('corrida'); return params; });
  };

  const previousRun = useMemo(() => {
    if (!selected) return null;
    const pool = selected.kind === 'REGULAR' ? regularRuns : aguinaldoRuns;
    return pool
      .filter((run) => run.id !== selected.id && run.status !== 'VOID' && run.totals && new Date(run.createdAt) < new Date(selected.createdAt))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] ?? null;
  }, [aguinaldoRuns, regularRuns, selected]);

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
      await load();
      openRun(created);
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

  const heroFacts = useMemo<HrFact[]>(() => {
    const allRuns = [...regularRuns, ...aguinaldoRuns];
    const runPayDate = (run: HrPayrollRun) => (run.kind === 'AGUINALDO' ? run.cutoffDate : run.period?.payDate) ?? null;
    const openRuns = allRuns.filter((run) => run.status !== 'PAID' && run.status !== 'VOID');
    let blocking = 0;
    for (const run of openRuns) blocking += run.blockingAnomalyCount ?? 0;
    const lastPaid = allRuns
      .filter((run) => run.status === 'PAID')
      .sort((left, right) => new Date(runPayDate(right) ?? right.createdAt).getTime() - new Date(runPayDate(left) ?? left.createdAt).getTime())[0];
    const nextPayment = openRuns
      .filter((run) => runPayDate(run))
      .sort((left, right) => String(runPayDate(left)).localeCompare(String(runPayDate(right))))[0];
    return [
      {
        label: 'Costo empresa del último pago',
        value: lastPaid?.totals ? new Intl.NumberFormat('es-NI', { style: 'currency', currency: lastPaid.totals.currency }).format(Number(lastPaid.totals.grossIncome) + Number(lastPaid.totals.employerContributions ?? 0)) : '—',
        hint: lastPaid ? 'Bruto + aportes patronales' : 'Aún no hay corridas pagadas',
        tone: 'accent',
      },
      {
        label: 'Neto del último pago',
        value: lastPaid?.totals ? new Intl.NumberFormat('es-NI', { style: 'currency', currency: lastPaid.totals.currency }).format(Number(lastPaid.totals.netPay)) : '—',
        hint: lastPaid ? `${lastPaid.code} · ${formatDate(runPayDate(lastPaid))}` : 'Aún no hay corridas pagadas',
        tone: lastPaid ? 'success' : 'default',
      },
      { label: 'Próximo pago', value: nextPayment ? formatDate(runPayDate(nextPayment)) : '—', hint: nextPayment ? `${nextPayment.code} · ${STATUS_LABELS[nextPayment.status]}` : 'Sin corridas pendientes' },
      { label: 'Incidencias bloqueantes', value: loading ? '—' : blocking, hint: blocking > 0 ? 'Resuélvelas antes de aprobar' : 'Nada bloquea el flujo', tone: blocking > 0 ? 'danger' : 'default' },
    ];
  }, [aguinaldoRuns, loading, regularRuns]);

  return (
    <HrPage className="inventory-page hr-payroll-page payroll-operations-page hr-admin-catalog-page inventory-header-new nm-page">
      {runParam ? (
        <div className="nm-detail-view" id="payroll-run-detail">
          <nav className="nm-detail-bar" aria-label="Navegación de corrida">
            <Button variant="ghost" onClick={closeRun}><ArrowLeft size={16} /> Volver a corridas</Button>
            <span className="nm-detail-crumb">{(targetRun?.kind ?? selected?.kind) === 'AGUINALDO' ? 'Aguinaldo' : 'Nómina ordinaria'}{targetRun ? ` · ${targetRun.code}` : ''}</span>
          </nav>
          <PayrollOnlineNotice online={online} />
          {loading || workspaceLoading || (targetRun && !selected) ? <LoadingSpinner text="Abriendo la corrida…" /> : selected ? (
            <PayrollOperationWorkspace run={selected} previous={previousRun ? { code: previousRun.code, netPay: previousRun.totals?.netPay } : null} online={online} busy={saving || downloading} onAction={(action) => { transitionOperationKey.current = createPayrollIdempotencyKey(); setTransition({ run: selected, action }); }} onRefresh={() => void openWorkspace(selected)} onAddComponent={() => { componentOperationKey.current = createPayrollIdempotencyKey(); setCreatePanel({ kind: 'component' }); }} onExport={(format) => void exportRun(format)} onDownloadReceipt={(id) => void downloadReceipt(id)} onDownloadReceiptBatch={(ids) => void downloadReceiptBatch(ids)} />
          ) : (
            <HrSection className="nm-placeholder">
              <div className="nm-empty">
                <span className="nm-empty-icon" aria-hidden="true"><Calculator size={30} /></span>
                <h2>No encontramos esta corrida</h2>
                <p>Puede haber sido filtrada o ya no existe. Vuelve al registro para elegir otra.</p>
                <Button size="sm" variant="secondary" onClick={closeRun}>Volver a corridas</Button>
              </div>
            </HrSection>
          )}
        </div>
      ) : (<>
      <HrHero
        eyebrow="Recursos humanos"
        icon={Calculator}
        title="Nómina y aguinaldo"
        subtitle="Calcula, revisa, aprueba, paga y entrega colillas desde un flujo guiado. Configuración legal: IR, INSS e INATEC."
        actions={(
          <>
            <Button variant="secondary" onClick={() => navigate('/rh/nomina/configuracion-legal')}><Scale size={17} /> Configurar IR, INSS e INATEC</Button>
            <Button onClick={() => setCreatePanel({ kind: 'run', runKind: activeKind })} disabled={!online || !operationReady}><Plus size={16} /> {activeKind === 'AGUINALDO' ? 'Crear aguinaldo' : 'Crear corrida de nómina'}</Button>
          </>
        )}
        facts={heroFacts}
      />
      <PayrollOnlineNotice online={online} />

      {!operationReady && !loading && (
        <div className="nm-alert is-warning" role="status">
          <AlertTriangle size={20} aria-hidden="true" />
          <span>{activeRules.length === 0 ? 'Para crear corridas necesitas una regla legal activa.' : 'Primero crea el periodo que deseas pagar.'}</span>
          {activeRules.length === 0
            ? <Button size="sm" variant="secondary" onClick={() => rules.length ? navigate(`/rh/nomina/configuracion-legal?ruleId=${rules[0].id}`) : setCreatePanel({ kind: 'rule' })}>{rules.length ? 'Configurar regla' : 'Crear regla base'}</Button>
            : <Button size="sm" variant="secondary" onClick={() => setCreatePanel({ kind: 'period' })}>Crear periodo</Button>}
        </div>
      )}

      <HrTabs<HrPayrollRunKind>
        ariaLabel="Tipo de proceso"
        idPrefix="payroll"
        active={activeKind}
        onChange={(kind) => {
          if (kind === 'AGUINALDO') setActiveKind('AGUINALDO');
          else setActiveKind('REGULAR');
          setSelected(null);
        }}
        items={[
          { key: 'REGULAR', label: 'Nómina ordinaria', icon: Receipt },
          { key: 'AGUINALDO', label: 'Aguinaldo', icon: Gift },
        ]}
      />

      <HrToolbar className="nm-toolbar" ariaLabel="Filtros de corridas">
        <label className="is-wide" htmlFor="payroll-run-search">Buscar código o periodo
          <span className="nm-search"><Search size={15} aria-hidden="true" /><input id="payroll-run-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Ej. 2026-Q1" /></span>
        </label>
        <label>Estado<HrReactSelect value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos los estados</option>{(Object.keys(STATUS_LABELS) as HrPayrollRun['status'][]).map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</HrReactSelect></label>
        {activeKind === 'REGULAR' && <div className="hr-ws-toolbar-actions"><Button variant="secondary" onClick={() => setCreatePanel({ kind: 'period' })}><FilePlus2 size={15} /> Periodos</Button></div>}
      </HrToolbar>

      {loading && <LoadingSpinner text="Cargando corridas…" />}
      {!loading && error && <div className="state-placeholder" role="alert"><AlertTriangle size={42} /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void load()}>Reintentar</Button></div>}
      {!loading && !error && (
        <>
          <HrSection
            flush
            className="nm-runs"
            role="tabpanel"
            id={`payroll-panel-${activeKind.toLowerCase()}`}
            aria-labelledby={`payroll-tab-${activeKind.toLowerCase()}`}
            eyebrow="Registro de corridas"
            title={activeKind === 'REGULAR' ? 'Corridas de nómina' : 'Corridas de aguinaldo'}
            description="Consulta el periodo, los totales y el estado. Abre una corrida para revisarla, aprobarla y pagarla."
          >
            {filteredRuns.length === 0 ? (
              <div className="nm-empty">
                <span className="nm-empty-icon" aria-hidden="true"><Receipt size={28} /></span>
                <h3>No hay corridas que coincidan con los filtros.</h3>
                <p>{runs.length === 0 ? 'Crea una corrida para iniciar el cálculo, revisión y pago.' : 'Prueba otro código, periodo o estado.'}</p>
                {runs.length === 0 && <Button size="sm" onClick={() => setCreatePanel({ kind: 'run', runKind: activeKind })} disabled={!operationReady}>Crear primera corrida</Button>}
              </div>
            ) : (
              <div className="hr-ws-table-scroll">
                <table className="payroll-run-table inventory-table nm-runs-table">
                  <thead><tr><th scope="col">Corrida</th><th scope="col">Periodo</th><th scope="col">Estado</th><th scope="col">Empleados</th><th scope="col" className="hr-amount-cell">Ingresos</th><th scope="col" className="hr-amount-cell">Neto a pagar</th><th scope="col">Incidencias</th><th scope="col">Fecha de pago</th><th scope="col">Acciones</th></tr></thead>
                  <tbody>{pagedRuns.map((run) => {
                    return <tr key={`${run.kind}-${run.id}`} className="nm-run-row" onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) openRun(run); }}>
                      <th scope="row"><strong>{run.code}</strong><small>Creada {formatDate(run.createdAt)}</small></th>
                      <td>{runPeriodLabel(run)}</td>
                      <td><PayrollStatusPill status={run.status} /></td>
                      <td>{run.totals?.employeeCount ?? 0}</td>
                      <td className="hr-amount-cell">{run.totals ? new Intl.NumberFormat('es-NI', { style: 'currency', currency: run.totals.currency }).format(Number(run.totals.grossIncome)) : '—'}</td>
                      <td className="hr-amount-cell"><strong>{run.totals ? new Intl.NumberFormat('es-NI', { style: 'currency', currency: run.totals.currency }).format(Number(run.totals.netPay)) : '—'}</strong></td>
                      <td>{run.blockingAnomalyCount ? <span className="nm-chip is-danger"><AlertTriangle size={13} aria-hidden="true" /> {run.blockingAnomalyCount} por resolver</span> : run.anomalyCount ? <span className="nm-chip">{run.anomalyCount} informativa(s)</span> : <span className="nm-chip is-success">Sin incidencias</span>}</td>
                      <td>{formatDate(run.kind === 'AGUINALDO' ? run.cutoffDate : run.period?.payDate)}</td>
                      <td><div className="nm-row-actions table-actions">
                        <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openRun(run)} title={run.status === 'PAID' || run.status === 'VOID' ? 'Ver corrida' : 'Continuar corrida'} aria-label={`Abrir corrida ${run.code}`}><Eye size={16} /></Button>
                        <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => void exportSpecificRun(run, 'xlsx')} disabled={downloading || !run.totals} title="Descargar reporte Excel" aria-label={`Descargar reporte de ${run.code}`}><FileSpreadsheet size={16} /></Button>
                        <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => void downloadRunReceiptBatch(run)} disabled={downloading || run.status !== 'PAID'} title="Descargar colillas" aria-label={`Descargar colillas de ${run.code}`}><Download size={16} /></Button>
                      </div></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
            <div className="nm-pagination">
              <Pagination page={tablePage} totalPages={Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE))} totalItems={filteredRuns.length} pageSize={PAGE_SIZE} onPageChange={setTablePage} alwaysShow emptyLabel="Sin corridas" />
            </div>
          </HrSection>

        </>
      )}
      </>)}

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
    </HrPage>
  );
}
