import { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Calculator, Download, Eye, FilePlus2, Plus, Scale, Search } from 'lucide-react';
import { AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, formatMoney, formatNumber, FullScreenModal, IconButton, Input, LoadErrorState, PageContent, PageHeader, TableToolbar, Tabs, Textarea } from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import HrModalFormShell, { HrModalFooterSlot } from '../../components/hr/HrModalFormShell';
import { collectAllPages } from '../../components/hr/collectAllPages';
import PayrollComponentForm from '../../components/hr/PayrollComponentForm';
import PayrollOnlineNotice from '../../components/hr/PayrollOnlineNotice';
import PayrollOperationWorkspace from '../../components/hr/payroll-operation-workspace';
import PayrollRuleForm from '../../components/hr/PayrollRuleForm';
import PayrollRunForm from '../../components/hr/PayrollRunForm';
import PayrollRunStepper from '../../components/hr/PayrollRunStepper';
import { isRunCalculated } from '../../components/hr/payrollKpis';
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
import form from '../../components/hr/hrForm.module.css';

const EMPTY_LOOKUPS: HrOrganizationCatalogs = { departments: [], positions: [], costCenters: [], branches: [], users: [] };

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

function currencySymbol(currency: string): string {
  if (currency === 'NIO') return 'C$';
  if (currency === 'USD') return 'US$';
  return `${currency} `.trimEnd();
}

function runMoney(currency: string, value: string | number): string {
  return formatMoney(value, currencySymbol(currency));
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
  const fid = useId();
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
      const [organization, ruleResult, periodResult, runResult, aguinaldoResult] = await Promise.all([
        hrClient.getOrganization(),
        collectAllPages((page) => payrollClient.getRules({ page, limit: 100 })),
        collectAllPages((page) => payrollClient.getPeriods({ page, limit: 100 })),
        collectAllPages((page) => payrollClient.getRuns('REGULAR', { page, limit: 100 })),
        collectAllPages((page) => payrollClient.getRuns('AGUINALDO', { page, limit: 100 })),
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
  }, []);

  useEffect(() => { void load(); }, [load]);

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
    const byStatus = status ? runs.filter((run) => run.status === status) : runs;
    if (!query) return byStatus;
    return byStatus.filter((run) => [
      run.code,
      runPeriodLabel(run),
      run.period?.dateFrom,
      run.period?.dateTo,
      run.period?.payDate,
      run.cutoffDate,
      run.year != null ? String(run.year) : '',
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [runs, searchQuery, status]);
  const activeRules = rules.filter((rule) => rule.status === 'ACTIVE');
  const operationReady = activeRules.length > 0 && (activeKind === 'AGUINALDO' || periods.some((period) => period.status !== 'VOID'));

  return (
    <PageContent>
      {runParam ? (
        <div id="payroll-run-detail" className={form.stack}>
          <PayrollOnlineNotice online={online} />
          {loading || workspaceLoading || (targetRun && !selected) ? <HrLoading text="Abriendo la corrida…" /> : selected ? (
            <PayrollOperationWorkspace
              run={selected}
              previous={previousRun ? { code: previousRun.code, netPay: previousRun.totals?.netPay } : null}
              online={online}
              busy={saving || downloading}
              onBack={closeRun}
              stepper={<PayrollRunStepper status={selected.status} />}
              onAction={(action) => { transitionOperationKey.current = createPayrollIdempotencyKey(); setTransition({ run: selected, action }); }}
              onRefresh={() => void openWorkspace(selected)}
              onAddComponent={() => { componentOperationKey.current = createPayrollIdempotencyKey(); setCreatePanel({ kind: 'component' }); }}
              onExport={(format) => void exportRun(format)}
              onDownloadReceipt={(id) => void downloadReceipt(id)}
              onDownloadReceiptBatch={(ids) => void downloadReceiptBatch(ids)}
            />
          ) : (
            <EmptyState
              icon={Calculator}
              title="No encontramos esta corrida"
              description="Puede haber sido filtrada o ya no existe. Vuelve al registro para elegir otra."
              action={<Button variant="secondary" icon={ArrowLeft} onClick={closeRun}>Volver a corridas</Button>}
            />
          )}
        </div>
      ) : (<>
      <PageHeader
        breadcrumb={['Recursos humanos', 'Nómina']}
        title="Nómina y aguinaldo"
        description="Calcula, revisa, aprueba, paga y entrega colillas desde un flujo guiado. Configuración legal: IR, INSS e INATEC."
        actions={(
          <>
            <Button icon={Scale} onClick={() => navigate('/rh/nomina/configuracion-legal')}>Configurar IR, INSS e INATEC</Button>
            <Button variant="primary" icon={Plus} onClick={() => setCreatePanel({ kind: 'run', runKind: activeKind })} disabled={!online || !operationReady}>{activeKind === 'AGUINALDO' ? 'Crear aguinaldo' : 'Crear corrida de nómina'}</Button>
          </>
        )}
      />
      <PayrollOnlineNotice online={online} />

      <Tabs
        ariaLabel="Tipo de proceso"
        active={activeKind}
        onChange={(id) => {
          if (id === 'AGUINALDO') setActiveKind('AGUINALDO');
          else setActiveKind('REGULAR');
          setSelected(null);
        }}
        tabs={[
          { id: 'REGULAR', label: 'Nómina ordinaria', badge: regularRuns.length },
          { id: 'AGUINALDO', label: 'Aguinaldo', badge: aguinaldoRuns.length },
        ]}
      />

      {!operationReady && !loading && (
        <div className={`${form.alertWarning} ${form.actions}`} role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{activeRules.length === 0 ? 'Para crear corridas necesitas una regla legal activa.' : 'Primero crea el periodo que deseas pagar.'}</span>
          {activeRules.length === 0
            ? <Button variant="secondary" onClick={() => rules.length ? navigate(`/rh/nomina/configuracion-legal?ruleId=${rules[0].id}`) : setCreatePanel({ kind: 'rule' })}>{rules.length ? 'Configurar regla' : 'Crear regla base'}</Button>
            : <Button variant="secondary" onClick={() => setCreatePanel({ kind: 'period' })}>Crear periodo</Button>}
        </div>
      )}

      {!loading && error ? <LoadErrorState message={error} onRetry={() => void load()} /> : (
        <div role="tabpanel" id={`payroll-panel-${activeKind.toLowerCase()}`} aria-label={activeKind === 'REGULAR' ? 'Corridas de nómina' : 'Corridas de aguinaldo'}>
          <DataTable<HrPayrollRun>
            ariaLabel={activeKind === 'REGULAR' ? 'Corridas de nómina' : 'Corridas de aguinaldo'}
            rows={filteredRuns}
            rowKey={(run) => `${run.kind}-${run.id}`}
            loading={loading}
            pagination={{ mode: 'client' }}
            resetKey={`${activeKind}|${searchQuery}|${status}`}
            onRowClick={openRun}
            toolbar={(
              <TableToolbar actions={activeKind === 'REGULAR' ? <Button variant="ghost" icon={FilePlus2} onClick={() => setCreatePanel({ kind: 'period' })}>Periodos</Button> : undefined}>
                <Input id="payroll-run-search" type="search" aria-label="Buscar código o periodo" prefix={<Search size={14} aria-hidden="true" />} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Buscar código o periodo (ej. 2026-Q1)" />
                {/* Excepción documentada: las pestañas segmentan por tipo de corrida; el estado queda como filtro secundario. */}
                <AppSelect<string>
                  aria-label="Estado"
                  options={[
                    { value: '', label: 'Todos los estados' },
                    ...(Object.keys(STATUS_LABELS) as HrPayrollRun['status'][]).map((value) => ({ value: String(value), label: STATUS_LABELS[value] })),
                  ]}
                  value={status}
                  onChange={(next) => setStatus(next ?? '')}
                  isClearable={false}
                />
              </TableToolbar>
            )}
            empty={(
              <EmptyState
                title="No hay corridas que coincidan con los filtros."
                description={runs.length === 0 ? 'Crea una corrida para iniciar el cálculo, revisión y pago.' : 'Prueba otro código, periodo o estado.'}
                action={runs.length === 0 ? <Button variant="primary" onClick={() => setCreatePanel({ kind: 'run', runKind: activeKind })} disabled={!operationReady}>Crear primera corrida</Button> : undefined}
              />
            )}
            columns={[
              { key: 'code', header: 'Corrida', render: (run) => <span className={form.cellStack}><span className={form.cellTitle}>{run.code}</span><span className={form.cellSub}>Creada {formatDate(run.createdAt)}</span></span> },
              { key: 'period', header: 'Periodo', type: 'date', render: (run) => runPeriodLabel(run) },
              { key: 'status', header: 'Estado', type: 'status', render: (run) => <PayrollStatusPill status={run.status} /> },
              { key: 'employees', header: 'Empleados', type: 'number', render: (run) => (isRunCalculated(run) && run.totals ? formatNumber(run.totals.employeeCount, 0) : 'N/D') },
              { key: 'gross', header: 'Ingresos', type: 'money', render: (run) => (isRunCalculated(run) && run.totals ? runMoney(run.totals.currency, run.totals.grossIncome) : 'N/D') },
              { key: 'net', header: 'Neto a pagar', type: 'money', render: (run) => <span className={form.cellTitle}>{isRunCalculated(run) && run.totals ? runMoney(run.totals.currency, run.totals.netPay) : 'N/D'}</span> },
              { key: 'anomalies', header: 'Incidencias', type: 'status', render: (run) => (run.blockingAnomalyCount ? <Badge tone="danger">{run.blockingAnomalyCount} por resolver</Badge> : run.anomalyCount ? `${run.anomalyCount} informativa(s)` : <span className={form.cellSub}>Sin incidencias</span>) },
              { key: 'payDate', header: 'Pago', type: 'date', render: (run) => formatDate(run.kind === 'AGUINALDO' ? run.cutoffDate : run.period?.payDate) },
              {
                key: 'actions',
                header: 'Acciones',
                width: '8rem',
                type: 'actions',
                render: (run) => {
                  const isSelected = selected?.id === run.id && selected.kind === run.kind;
                  return (
                    <div className={form.rowActions}>
                      <IconButton size="sm" onClick={() => openRun(run)} disabled={workspaceLoading} tooltip={isSelected ? 'Abierta' : run.status === 'PAID' || run.status === 'VOID' ? 'Ver detalle' : 'Continuar'} label={`${isSelected ? 'Corrida abierta' : 'Abrir corrida'} ${run.code}`} icon={Eye} />
                      <IconButton size="sm" onClick={() => void exportSpecificRun(run, 'xlsx')} disabled={downloading || !run.totals} tooltip="Descargar reporte" label={`Descargar reporte de ${run.code}`} icon={Download} />
                      <IconButton size="sm" onClick={() => void downloadRunReceiptBatch(run)} disabled={downloading || run.status !== 'PAID'} tooltip="Descargar colillas" label={`Descargar colillas de ${run.code}`} icon={Download} />
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      )}
      </>)}

      <FullScreenModal
        footer={<HrModalFooterSlot />}
        isOpen={Boolean(createPanel)}
        onClose={() => { if (!saving) { if (createPanel?.kind === 'component') componentOperationKey.current = null; setCreatePanel(null); } }}
        title={createPanel?.kind === 'rule' ? 'Nueva regla base' : createPanel?.kind === 'period' ? 'Nuevo periodo de nómina' : createPanel?.kind === 'component' ? 'Ingreso o deducción' : createPanel?.runKind === 'AGUINALDO' ? 'Crear aguinaldo' : 'Crear corrida de nómina'}
      >
        {createPanel?.kind === 'component' && selected && <PayrollComponentForm users={lookups.users ?? []} concepts={selectedPaymentConcepts} incomeTaxApplicability={selectedIncomeTaxApplicability} online={online} saving={saving} onSubmit={saveComponent} onCancel={() => { componentOperationKey.current = null; setCreatePanel(null); }} />}
        {createPanel?.kind === 'rule' && <PayrollRuleForm initial={createPanel.rule} online={online} saving={saving} notice={<PayrollOnlineNotice online={online} compact />} onSubmit={saveRule} onCancel={() => setCreatePanel(null)} />}
        {createPanel?.kind === 'period' && (
          <HrModalFormShell ariaLabel="Crear periodo de nómina" tabLabel="1. Periodo" sectionTitle="Define las fechas que se pagarán" icon={<FilePlus2 size={18} />} notice={<PayrollOnlineNotice online={online} compact />} onSubmit={(event) => void savePeriod(event)} footer={<><Button type="button" variant="ghost" onClick={() => setCreatePanel(null)}>Cancelar</Button><Button loading={saving} variant="primary" type="submit" disabled={!online || saving || !periodForm.code.trim() || !periodForm.reason.trim()}>Crear y continuar</Button></>}>
            <Field label="Código" htmlFor={`${fid}-codigo`}><Input id={`${fid}-codigo`} value={periodForm.code} onChange={(event) => setPeriodForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="2026-Q15" required /></Field>
            <Field label="Desde" htmlFor={`${fid}-desde`}><DateInput id={`${fid}-desde`} value={periodForm.dateFrom} onChange={(event) => setPeriodForm((current) => ({ ...current, dateFrom: event.target.value }))} required /></Field>
            <Field label="Hasta" htmlFor={`${fid}-hasta`}><DateInput id={`${fid}-hasta`} min={periodForm.dateFrom} value={periodForm.dateTo} onChange={(event) => setPeriodForm((current) => ({ ...current, dateTo: event.target.value }))} required /></Field>
            <Field label="Fecha de pago" htmlFor={`${fid}-fecha-de-pago`}><DateInput id={`${fid}-fecha-de-pago`} min={periodForm.dateTo} value={periodForm.payDate} onChange={(event) => setPeriodForm((current) => ({ ...current, payDate: event.target.value }))} required /></Field>
            <div className="span-full"><Field label="Motivo de apertura" htmlFor={`${fid}-motivo-de-apertura`}><Textarea id={`${fid}-motivo-de-apertura`} rows={4} value={periodForm.reason} onChange={(event) => setPeriodForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Ej. Nómina ordinaria de la segunda quincena" required /></Field></div>
          </HrModalFormShell>
        )}
        {createPanel?.kind === 'run' && <PayrollRunForm kind={createPanel.runKind} periods={periods} rules={rules} online={online} saving={saving} notice={<PayrollOnlineNotice online={online} compact />} onSubmit={(payload) => saveRun(createPanel.runKind, payload)} onCancel={() => setCreatePanel(null)} />}
      </FullScreenModal>

      <FullScreenModal
        footer={<HrModalFooterSlot />}
        isOpen={Boolean(transition)}
        onClose={() => { if (!saving) { transitionOperationKey.current = null; setTransition(null); } }}
        title={transition ? ACTION_LABELS[transition.action] : 'Acción de nómina'}
      >
        {transition && <PayrollTransitionForm run={transition.run} action={transition.action} online={online} saving={saving} onSubmit={saveTransition} onCancel={() => { transitionOperationKey.current = null; setTransition(null); }} />}
      </FullScreenModal>
    </PageContent>
  );
}
