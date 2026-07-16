import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Calculator, FilePlus2, Gift, Plus, Receipt, Scale } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
import HrReactSelect from '../../components/hr/HrReactSelect';
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

const EMPTY_LOOKUPS: HrOrganizationCatalogs = { departments: [], positions: [], costCenters: [], branches: [], users: [] };

const ACTION_LABELS: Record<HrPayrollAction, string> = {
  CALCULATE: 'Calcular nómina',
  RECALCULATE: 'Recalcular nómina',
  SUBMIT_REVIEW: 'Enviar a revisión',
  APPROVE: 'Aprobar nómina',
  MARK_PAID: 'Registrar pago y publicar colillas',
  VOID: 'Anular corrida',
};

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = { status: status || undefined, limit: 100 };
      const [organization, ruleResult, periodResult, runResult, aguinaldoResult] = await Promise.all([
        hrClient.getOrganization(),
        payrollClient.getRules({ limit: 100 }),
        payrollClient.getPeriods({ limit: 100 }),
        payrollClient.getRuns('REGULAR', filters),
        payrollClient.getRuns('AGUINALDO', filters),
      ]);
      setLookups(organization);
      setRules(ruleResult.items);
      setPeriods(periodResult.items);
      setRegularRuns(runResult.items);
      setAguinaldoRuns(aguinaldoResult.items);
      setSelected((current) => current && [...runResult.items, ...aguinaldoResult.items].some((run) => run.id === current.id && run.kind === current.kind) ? current : null);
    } catch (loadError) {
      setError(getPayrollErrorMessage(loadError, 'No fue posible cargar nómina y aguinaldo.'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const openWorkspace = async (run: HrPayrollRun) => {
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
  };

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

  const exportRun = async (format: 'csv' | 'xlsx') => {
    if (!selected) return;
    setDownloading(true);
    try { await payrollClient.exportRun(selected.kind, selected.id, format); showSuccess('Reporte generado.'); }
    catch (downloadError) { showError(getPayrollErrorMessage(downloadError, 'No fue posible exportar la corrida.')); }
    finally { setDownloading(false); }
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

  const runs = activeKind === 'REGULAR' ? regularRuns : aguinaldoRuns;
  const activeRules = rules.filter((rule) => rule.status === 'ACTIVE');
  const operationReady = activeRules.length > 0 && (activeKind === 'AGUINALDO' || periods.some((period) => period.status !== 'VOID'));

  return (
    <div className="page-wrapper hr-payroll-page payroll-operations-page">
      <PageHeader title="Nómina y aguinaldo" subtitle="Calcula, revisa, aprueba, paga y entrega colillas desde un flujo guiado. Configuración legal: IR, INSS e INATEC." icon={Calculator}
        actions={<Button variant="secondary" onClick={() => navigate('/rh/nomina/configuracion-legal')}><Scale size={17} /> Configurar IR, INSS e INATEC</Button>} />
      <PayrollOnlineNotice online={online} />

      <div className="payroll-operation-switcher">
        <div className="payroll-operation-tabs" role="tablist" aria-label="Tipo de proceso">
          <button type="button" role="tab" aria-selected={activeKind === 'REGULAR'} className={activeKind === 'REGULAR' ? 'active' : ''} onClick={() => { setActiveKind('REGULAR'); setSelected(null); }}><Receipt size={17} /> Nómina ordinaria <small>{regularRuns.length}</small></button>
          <button type="button" role="tab" aria-selected={activeKind === 'AGUINALDO'} className={activeKind === 'AGUINALDO' ? 'active' : ''} onClick={() => { setActiveKind('AGUINALDO'); setSelected(null); }}><Gift size={17} /> Aguinaldo <small>{aguinaldoRuns.length}</small></button>
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

      <div className="hr-payroll-filterbar">
        <label>Estado<HrReactSelect value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option>{['DRAFT', 'CALCULATED', 'REVIEW', 'APPROVED', 'PAID', 'VOID'].map((value) => <option key={value} value={value}>{value}</option>)}</HrReactSelect></label>
        {activeKind === 'REGULAR' && <Button size="sm" variant="ghost" onClick={() => setCreatePanel({ kind: 'period' })}><FilePlus2 size={15} /> Gestionar periodos</Button>}
      </div>

      {loading && <LoadingSpinner text="Cargando corridas…" />}
      {!loading && error && <div className="state-placeholder" role="alert"><AlertTriangle size={42} /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void load()}>Reintentar</Button></div>}
      {!loading && !error && (
        <div className="payroll-operation-list-layout">
          <aside className="payroll-operation-runs" aria-label={activeKind === 'REGULAR' ? 'Corridas de nómina ordinaria' : 'Corridas de aguinaldo'}>
            <header><h2>{activeKind === 'REGULAR' ? 'Corridas de nómina' : 'Corridas de aguinaldo'}</h2><p>Selecciona una corrida para continuarla o consultar su pago.</p></header>
            {runs.length === 0 ? <div className="payroll-operation-empty-list"><strong>No hay corridas en este estado.</strong><span>Crea una para iniciar el flujo de cálculo y pago.</span><Button size="sm" onClick={() => setCreatePanel({ kind: 'run', runKind: activeKind })} disabled={!operationReady}>Crear primera corrida</Button></div>
              : <div className="payroll-operation-run-list">{runs.map((run) => <button type="button" key={`${run.kind}-${run.id}`} className={`payroll-operation-run-card ${selected?.id === run.id && selected.kind === run.kind ? 'selected' : ''}`} onClick={() => void openWorkspace(run)} disabled={workspaceLoading}><div><strong>{run.code}</strong><PayrollStatusPill status={run.status} /></div><span>{run.kind === 'AGUINALDO' ? `Aguinaldo ${run.year ?? ''} · corte ${run.cutoffDate ?? '—'}` : `${run.period?.code ?? `Periodo #${run.periodId ?? '—'}`} · pago ${run.period?.payDate ?? '—'}`}</span><div><small>{run.totals?.employeeCount ?? 0} colaboradores</small><small className={run.blockingAnomalyCount ? 'danger' : ''}>{run.blockingAnomalyCount ? `${run.blockingAnomalyCount} bloqueos` : 'Sin bloqueos'}</small></div></button>)}</div>}
          </aside>

          {workspaceLoading ? <LoadingSpinner text="Preparando detalle por colaborador…" /> : selected ? (
            <PayrollOperationWorkspace run={selected} online={online} busy={saving || downloading} onAction={(action) => { transitionOperationKey.current = createPayrollIdempotencyKey(); setTransition({ run: selected, action }); }} onRefresh={() => void openWorkspace(selected)} onAddComponent={() => { componentOperationKey.current = createPayrollIdempotencyKey(); setCreatePanel({ kind: 'component' }); }} onExport={(format) => void exportRun(format)} onDownloadReceipt={(id) => void downloadReceipt(id)} onDownloadReceiptBatch={(ids) => void downloadReceiptBatch(ids)} />
          ) : <div className="payroll-operation-placeholder"><div><Calculator size={44} /><h2>Selecciona una corrida</h2><p>Aquí verás el avance, resumen total, pago por colaborador, incidencias, reportes y colillas.</p></div></div>}
        </div>
      )}

      <Sidebar isOpen={Boolean(createPanel)} onClose={() => { if (!saving) { if (createPanel?.kind === 'component') componentOperationKey.current = null; setCreatePanel(null); } }} title={createPanel?.kind === 'rule' ? 'Nueva regla base' : createPanel?.kind === 'period' ? 'Nuevo periodo de nómina' : createPanel?.kind === 'component' ? 'Ingreso o deducción' : createPanel?.runKind === 'AGUINALDO' ? 'Crear aguinaldo' : 'Crear corrida de nómina'} width="large" closeOnBackdrop={!saving} closeOnEscape={!saving}>
        {createPanel?.kind === 'component' && selected && <div className="hr-payroll-sidebar"><PayrollOnlineNotice online={online} compact /><PayrollComponentForm users={lookups.users ?? []} concepts={selectedPaymentConcepts} incomeTaxApplicability={selectedIncomeTaxApplicability} online={online} saving={saving} onSubmit={saveComponent} onCancel={() => { componentOperationKey.current = null; setCreatePanel(null); }} /></div>}
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
        {transition && <div className="hr-payroll-sidebar"><PayrollOnlineNotice online={online} compact /><PayrollTransitionForm run={transition.run} action={transition.action} online={online} saving={saving} onSubmit={saveTransition} onCancel={() => { transitionOperationKey.current = null; setTransition(null); }} /></div>}
      </Sidebar>
    </div>
  );
}
