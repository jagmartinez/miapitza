import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Download,
  FilePlus2,
  Gift,
  Plus,
  Receipt,
  RefreshCw,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import PayrollComponentForm from '../../components/hr/PayrollComponentForm';
import PayrollOnlineNotice from '../../components/hr/PayrollOnlineNotice';
import PayrollReconciliationPanel from '../../components/hr/PayrollReconciliationPanel';
import PayrollRuleConfigurationPanel from '../../components/hr/PayrollRuleConfigurationPanel';
import PayrollRuleForm from '../../components/hr/PayrollRuleForm';
import PayrollRunForm from '../../components/hr/PayrollRunForm';
import PayrollStatusPill from '../../components/hr/PayrollStatusPill';
import PayrollTransitionForm from '../../components/hr/PayrollTransitionForm';
import usePayrollOnline from '../../components/hr/usePayrollOnline';
import { hrClient } from '../../components/hr/hrClient';
import {
  createPayrollIdempotencyKey,
  getPayrollErrorMessage,
  payrollClient,
} from '../../components/hr/payrollClient';
import { useConfirmDialog } from '../../context/ConfirmContext';
import { useAppToast } from '../../context/ToastContext';
import type { HrOrganizationCatalogs } from '../../types/hr';
import type {
  HrAguinaldoRunPayload,
  HrPayrollAction,
  HrPayrollComponentPayload,
  HrPayrollConfigurationReviewPayload,
  HrPayrollConfigurationUploadPayload,
  HrPayrollPeriod,
  HrPayrollPeriodPayload,
  HrPayrollRulePayload,
  HrPayrollRuleConfigurationRevision,
  HrPayrollRuleVersion,
  HrPayrollRun,
  HrPayrollRunDetail,
  HrPayrollRunKind,
  HrPayrollRunPayload,
  HrPayrollTransitionPayload,
} from '../../types/hr-payroll';
import './payroll.css';

const EMPTY_LOOKUPS: HrOrganizationCatalogs = {
  departments: [],
  positions: [],
  costCenters: [],
  branches: [],
  users: [],
};

const ACTION_LABELS: Record<HrPayrollAction, string> = {
  CALCULATE: 'Calcular',
  RECALCULATE: 'Recalcular',
  SUBMIT_REVIEW: 'Enviar a revisión',
  APPROVE: 'Aprobar',
  MARK_PAID: 'Marcar pagada',
  VOID: 'Anular',
};

type CreatePanel =
  | { kind: 'rule'; rule?: HrPayrollRuleVersion }
  | { kind: 'period' }
  | { kind: 'run'; runKind: HrPayrollRunKind }
  | { kind: 'component' }
  | null;

type RuleAction = { rule: HrPayrollRuleVersion; action: 'activate' | 'retire' } | null;

function periodDefaults(): HrPayrollPeriodPayload {
  const value = new Date();
  const date = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return { code: '', dateFrom: date, dateTo: date, payDate: date, reason: '' };
}

export default function PayrollManagement() {
  const online = usePayrollOnline();
  const { confirm } = useConfirmDialog();
  const { success: showSuccess, error: showError } = useAppToast();
  const [lookups, setLookups] = useState<HrOrganizationCatalogs>(EMPTY_LOOKUPS);
  const [rules, setRules] = useState<HrPayrollRuleVersion[]>([]);
  const [periods, setPeriods] = useState<HrPayrollPeriod[]>([]);
  const [regularRuns, setRegularRuns] = useState<HrPayrollRun[]>([]);
  const [aguinaldoRuns, setAguinaldoRuns] = useState<HrPayrollRun[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<HrPayrollRunDetail | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [createPanel, setCreatePanel] = useState<CreatePanel>(null);
  const componentOperationKey = useRef<string | null>(null);
  const transitionOperationKey = useRef<string | null>(null);
  const [transition, setTransition] = useState<{
    run: HrPayrollRun;
    action: HrPayrollAction;
  } | null>(null);
  const [ruleAction, setRuleAction] = useState<RuleAction>(null);
  const [configurationRule, setConfigurationRule] = useState<HrPayrollRuleVersion | null>(null);
  const [configurationRevisions, setConfigurationRevisions] = useState<HrPayrollRuleConfigurationRevision[]>([]);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [ruleReason, setRuleReason] = useState('');
  const [ruleConfirmed, setRuleConfirmed] = useState(false);
  const [periodForm, setPeriodForm] = useState<HrPayrollPeriodPayload>(periodDefaults());
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = { status: status || undefined, limit: 100 };
      const [organization, ruleResult, periodResult, runResult, aguinaldoResult] =
        await Promise.all([
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
    } catch (loadError) {
      setRules([]);
      setPeriods([]);
      setRegularRuns([]);
      setAguinaldoRuns([]);
      setError(getPayrollErrorMessage(loadError, 'No fue posible cargar nómina y aguinaldo.'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openWorkspace = async (run: HrPayrollRun) => {
    setWorkspaceLoading(true);
    try {
      setSelected(await payrollClient.getRunWorkspace(run.kind, run.id));
    } catch (workspaceError) {
      showError(
        getPayrollErrorMessage(workspaceError, 'No fue posible cargar el detalle de la corrida.')
      );
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
      if (editing)
        await payrollClient.updateRule(editing.id, payload, createPayrollIdempotencyKey());
      else await payrollClient.createRule(payload, createPayrollIdempotencyKey());
      showSuccess(editing ? 'Nueva revisión de regla guardada.' : 'Regla creada como borrador.');
      setCreatePanel(null);
      await load();
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible guardar la regla.'));
    } finally {
      setSaving(false);
    }
  };

  const savePeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await payrollClient.createPeriod(
        { ...periodForm, reason: periodForm.reason.trim() },
        createPayrollIdempotencyKey()
      );
      showSuccess('Periodo de nómina creado.');
      setCreatePanel(null);
      await load();
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible crear el periodo.'));
    } finally {
      setSaving(false);
    }
  };

  const saveRun = async (
    kind: HrPayrollRunKind,
    payload: HrPayrollRunPayload | HrAguinaldoRunPayload
  ) => {
    setSaving(true);
    try {
      if (kind === 'AGUINALDO') {
        await payrollClient.createAguinaldoRun(
          payload as HrAguinaldoRunPayload,
          createPayrollIdempotencyKey()
        );
      } else {
        await payrollClient.createRun(
          payload as HrPayrollRunPayload,
          createPayrollIdempotencyKey()
        );
      }
      showSuccess(
        kind === 'AGUINALDO' ? 'Corrida de aguinaldo creada.' : 'Corrida de nómina creada.'
      );
      setCreatePanel(null);
      await load();
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible crear la corrida.'));
    } finally {
      setSaving(false);
    }
  };

  const saveComponent = async (payload: HrPayrollComponentPayload) => {
    if (!selected) return;
    const idempotencyKey = componentOperationKey.current ?? createPayrollIdempotencyKey();
    componentOperationKey.current = idempotencyKey;
    setSaving(true);
    try {
      await payrollClient.addComponent(
        selected.kind,
        selected.id,
        payload,
        idempotencyKey
      );
      showSuccess('Componente agregado; INSS, INATEC, IR y totales fueron recalculados.');
      componentOperationKey.current = null;
      setCreatePanel(null);
      await refreshWorkspace(selected);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible agregar el componente.'));
    } finally {
      setSaving(false);
    }
  };

  const saveTransition = async (payload: HrPayrollTransitionPayload) => {
    if (!transition) return;
    const accepted = await confirm(
      `Confirma ${ACTION_LABELS[transition.action].toLowerCase()} la corrida ${transition.run.code}. Esta operación quedará auditada.`,
      {
        title: 'Confirmación final de nómina',
        confirmText: ACTION_LABELS[transition.action],
        variant:
          transition.action === 'VOID' || transition.action === 'MARK_PAID' ? 'danger' : 'warning',
      }
    );
    if (!accepted) return;
    setSaving(true);
    try {
      const { run, action } = transition;
      const key = transitionOperationKey.current ?? createPayrollIdempotencyKey();
      transitionOperationKey.current = key;
      let updated: HrPayrollRun;
      if (action === 'CALCULATE')
        updated = await payrollClient.calculateRun(run.kind, run.id, payload, key);
      else if (action === 'RECALCULATE')
        updated = await payrollClient.recalculateRun(run.kind, run.id, payload, key);
      else if (action === 'SUBMIT_REVIEW')
        updated = await payrollClient.submitRunReview(run.kind, run.id, payload, key);
      else if (action === 'APPROVE')
        updated = await payrollClient.approveRun(run.kind, run.id, payload, key);
      else if (action === 'MARK_PAID')
        updated = await payrollClient.payRun(run.kind, run.id, payload, key);
      else updated = await payrollClient.voidRun(run.kind, run.id, payload, key);
      showSuccess('Transición de nómina registrada.');
      transitionOperationKey.current = null;
      setTransition(null);
      await refreshWorkspace(updated);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible completar la transición.'));
    } finally {
      setSaving(false);
    }
  };

  const saveRuleAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ruleAction || !ruleConfirmed || !ruleReason.trim()) return;
    const accepted = await confirm(
      `${ruleAction.action === 'activate' ? 'Activar' : 'Retirar'} la regla ${ruleAction.rule.name} v${ruleAction.rule.version}.`,
      { title: 'Confirmar versión', confirmText: 'Confirmar', variant: 'warning' }
    );
    if (!accepted) return;
    setSaving(true);
    try {
      const payload: HrPayrollTransitionPayload = {
        reason: ruleReason.trim(),
        confirmed: true,
        expectedRevision: ruleAction.rule.revision,
      };
      if (ruleAction.action === 'activate') {
        await payrollClient.activateRule(
          ruleAction.rule.id,
          payload,
          createPayrollIdempotencyKey()
        );
      } else {
        await payrollClient.retireRule(ruleAction.rule.id, payload, createPayrollIdempotencyKey());
      }
      showSuccess('Estado de regla actualizado con trazabilidad.');
      setRuleAction(null);
      await load();
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible actualizar la regla.'));
    } finally {
      setSaving(false);
    }
  };

  const openRuleConfiguration = async (rule: HrPayrollRuleVersion) => {
    setConfigurationRule(rule);
    setConfigurationRevisions([]);
    setConfigurationLoading(true);
    try {
      setConfigurationRevisions(await payrollClient.getRuleConfigurations(rule.id));
    } catch (loadError) {
      showError(getPayrollErrorMessage(loadError, 'No fue posible cargar el control legal.'));
    } finally {
      setConfigurationLoading(false);
    }
  };

  const reloadRuleConfiguration = async (ruleId: number) => {
    const [ruleResult, revisions] = await Promise.all([
      payrollClient.getRules({ limit: 100 }),
      payrollClient.getRuleConfigurations(ruleId),
    ]);
    setRules(ruleResult.items);
    setConfigurationRevisions(revisions);
    setConfigurationRule(ruleResult.items.find((rule) => rule.id === ruleId) ?? null);
  };

  const uploadRuleConfiguration = async (payload: HrPayrollConfigurationUploadPayload) => {
    if (!configurationRule) return;
    setSaving(true);
    try {
      await payrollClient.uploadRuleConfiguration(
        configurationRule.id,
        payload,
        createPayrollIdempotencyKey()
      );
      showSuccess('Configuración congelada; requiere revisión por una identidad distinta.');
      await reloadRuleConfiguration(configurationRule.id);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible cargar la configuración.'));
    } finally {
      setSaving(false);
    }
  };

  const reviewRuleConfiguration = async (payload: HrPayrollConfigurationReviewPayload) => {
    if (!configurationRule) return;
    setSaving(true);
    try {
      await payrollClient.reviewRuleConfiguration(
        configurationRule.id,
        payload,
        createPayrollIdempotencyKey()
      );
      showSuccess(payload.decision === 'VALIDATED' ? 'Configuración validada.' : 'Configuración rechazada.');
      await reloadRuleConfiguration(configurationRule.id);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible registrar el dictamen.'));
    } finally {
      setSaving(false);
    }
  };

  const exportRun = async (format: 'csv' | 'xlsx') => {
    if (!selected) return;
    setDownloading(true);
    try {
      await payrollClient.exportRun(selected.kind, selected.id, format);
      showSuccess('Exportación preparada.');
    } catch (downloadError) {
      showError(getPayrollErrorMessage(downloadError, 'No fue posible exportar la corrida.'));
    } finally {
      setDownloading(false);
    }
  };

  const downloadReceipt = async (receiptId: number) => {
    if (!selected) return;
    setDownloading(true);
    try {
      await payrollClient.downloadRunReceipt(selected.kind, selected.id, receiptId);
    } catch (downloadError) {
      showError(getPayrollErrorMessage(downloadError, 'No fue posible descargar el recibo.'));
    } finally {
      setDownloading(false);
    }
  };

  const renderRuns = (
    title: string,
    icon: React.ReactNode,
    runs: HrPayrollRun[],
    kind: HrPayrollRunKind
  ) => (
    <section className="hr-payroll-section">
      <div className="hr-payroll-section-heading">
        <div>
          <h2>
            {icon}
            {title}
          </h2>
          <p>
            {kind === 'AGUINALDO'
              ? 'Proceso independiente, versionado y auditable.'
              : 'Ciclo DRAFT → CALCULATED → REVIEW → APPROVED → PAID.'}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreatePanel({ kind: 'run', runKind: kind })}
          disabled={!online}
        >
          <Plus size={15} /> Nueva
        </Button>
      </div>
      {runs.length === 0 ? (
        <p className="hr-payroll-empty">Sin corridas.</p>
      ) : (
        <div className="hr-payroll-run-list">
          {runs.map((run) => (
            <article
              key={`${run.kind}-${run.id}`}
              className={selected?.id === run.id && selected.kind === run.kind ? 'selected' : ''}
            >
              <button
                type="button"
                onClick={() => void openWorkspace(run)}
                disabled={workspaceLoading}
              >
                <div>
                  <strong>{run.code}</strong>
                  <span>
                    {run.kind === 'AGUINALDO'
                      ? `Aguinaldo ${run.year ?? ''}`
                      : (run.period?.code ?? `Periodo #${run.periodId ?? '—'}`)}
                  </span>
                </div>
                <div>
                  <PayrollStatusPill status={run.status} />
                  <small>{run.blockingAnomalyCount} bloqueos</small>
                </div>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="page-wrapper hr-payroll-page">
      <PageHeader
        title="Nómina y aguinaldo"
        subtitle="Reglas versionadas, corridas, doble control, recibos y trazabilidad"
        icon={Calculator}
        actions={
          <div className="hr-payroll-header-actions">
            <Button
              variant="secondary"
              onClick={() => setCreatePanel({ kind: 'period' })}
              disabled={!online}
            >
              <FilePlus2 size={17} /> Periodo
            </Button>
            <Button onClick={() => setCreatePanel({ kind: 'rule' })} disabled={!online}>
              <Scale size={17} /> Regla
            </Button>
          </div>
        }
      />
      <PayrollOnlineNotice online={online} />
      <div className="hr-payroll-filterbar">
        <label>
          Estado
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            {['DRAFT', 'CALCULATED', 'REVIEW', 'APPROVED', 'PAID', 'VOID'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw size={16} /> Actualizar
        </Button>
      </div>

      {loading && <LoadingSpinner text="Cargando nómina…" />}
      {!loading && error && (
        <div className="state-placeholder" role="alert">
          <AlertTriangle size={42} />
          <p className="state-error">{error}</p>
          <Button variant="ghost" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      )}
      {!loading && !error && (
        <>
          <div className="hr-payroll-columns">
            {renderRuns('Nómina ordinaria', <Receipt size={20} />, regularRuns, 'REGULAR')}
            {renderRuns('Aguinaldo', <Gift size={20} />, aguinaldoRuns, 'AGUINALDO')}
          </div>

          <div className="hr-payroll-columns">
            <section className="hr-payroll-section">
              <div className="hr-payroll-section-heading">
                <div>
                  <h2>
                    <Scale size={20} /> Reglas y vigencias
                  </h2>
                  <p>Metadatos y parámetros versionados; el cálculo autoritativo permanece en servidor.</p>
                </div>
              </div>
              <div className="hr-payroll-records">
                {rules.map((rule) => (
                  <article key={rule.id}>
                    <div>
                      <strong>
                        {rule.name} · v{rule.version}
                      </strong>
                      <span>
                        {rule.effectiveFrom} – {rule.effectiveTo ?? 'sin fin'} ·{' '}
                        {rule.sourceReference}
                      </span>
                      <small>Revisión {rule.revision}</small>
                      {rule.configurationSummary && <small>{rule.configurationSummary}</small>}
                    </div>
                    <div>
                      <PayrollStatusPill status={rule.status} />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void openRuleConfiguration(rule)}
                      >
                        Parámetros
                      </Button>
                      {rule.status === 'DRAFT' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCreatePanel({ kind: 'rule', rule })}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setRuleReason('');
                              setRuleConfirmed(false);
                              setRuleAction({ rule, action: 'activate' });
                            }}
                            disabled={!online || !rule.activeConfigurationRevisionId}
                            title={!rule.activeConfigurationRevisionId ? 'Requiere configuración VALIDATED por segundo actor' : undefined}
                          >
                            Activar
                          </Button>
                        </>
                      )}
                      {rule.status === 'ACTIVE' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRuleReason('');
                            setRuleConfirmed(false);
                            setRuleAction({ rule, action: 'retire' });
                          }}
                          disabled={!online}
                        >
                          Retirar
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <section className="hr-payroll-section">
              <div className="hr-payroll-section-heading">
                <div>
                  <h2>Periodos</h2>
                  <p>Alcance temporal y fecha de pago; sin importes.</p>
                </div>
              </div>
              <div className="hr-payroll-records">
                {periods.map((period) => (
                  <article key={period.id}>
                    <div>
                      <strong>{period.code}</strong>
                      <span>
                        {period.dateFrom} – {period.dateTo} · pago {period.payDate}
                      </span>
                      <small>
                        {period.timezone} · revisión {period.revision}
                      </small>
                    </div>
                    <PayrollStatusPill status={period.status} />
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="hr-payroll-section hr-payroll-workspace" aria-live="polite">
            {!selected ? (
              <div className="hr-payroll-empty-workspace">
                <ShieldCheck size={42} />
                <h2>Selecciona una corrida</h2>
                <p>
                  Consulta snapshot, anomalías, componentes, actores y recibos antes de ejecutar una
                  transición.
                </p>
              </div>
            ) : (
              <>
                <div className="hr-payroll-workspace-header">
                  <div>
                    <span>{selected.kind === 'AGUINALDO' ? 'Aguinaldo' : 'Nómina'}</span>
                    <h2>{selected.code}</h2>
                    <div>
                      <PayrollStatusPill status={selected.status} />
                      <small>Revisión {selected.revision}</small>
                    </div>
                  </div>
                  <div className="hr-payroll-workspace-actions">
                    {selected.allowedActions.map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant={
                          action === 'VOID' || action === 'MARK_PAID' ? 'danger' : 'secondary'
                        }
                        onClick={() => {
                          transitionOperationKey.current = createPayrollIdempotencyKey();
                          setTransition({ run: selected, action });
                        }}
                        disabled={!online}
                      >
                        {ACTION_LABELS[action]}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => void openWorkspace(selected)}>
                      <RefreshCw size={15} />
                    </Button>
                  </div>
                </div>
                {selected.totals && (
                  <dl className="hr-payroll-totals">
                    <div>
                      <dt>Ingresos brutos</dt>
                      <dd>
                        {selected.totals.currency} {selected.totals.grossIncome}
                      </dd>
                    </div>
                    <div>
                      <dt>Deducciones</dt>
                      <dd>
                        {selected.totals.currency} {selected.totals.totalDeductions}
                      </dd>
                    </div>
                    <div className="net">
                      <dt>Neto</dt>
                      <dd>
                        {selected.totals.currency} {selected.totals.netPay}
                      </dd>
                    </div>
                    <div>
                      <dt>Personas</dt>
                      <dd>{selected.totals.employeeCount}</dd>
                    </div>
                  </dl>
                )}
                <div className="hr-payroll-dual-control">
                  <ShieldCheck size={19} />
                  <div>
                    <strong>Segregación de funciones</strong>
                    <span>
                      Calculó: {selected.calculatedBy?.name ?? '—'} · aprobó:{' '}
                      {selected.approvedBy?.name ?? '—'} · pagó: {selected.paidBy?.name ?? '—'}
                    </span>
                    <small>
                      Los botones reflejan allowedActions del servidor; el backend bloquea actores
                      incompatibles.
                    </small>
                  </div>
                </div>
                <PayrollReconciliationPanel key={`${selected.kind}-${selected.id}-${selected.revision}`} run={selected} />

                <div className="hr-payroll-workspace-grid">
                  <section>
                    <div className="hr-payroll-subheading">
                      <h3>Anomalías</h3>
                      <span>{selected.blockingAnomalyCount} bloqueantes</span>
                    </div>
                    {selected.anomalies.length === 0 ? (
                      <p>Sin anomalías.</p>
                    ) : (
                      <div className="hr-payroll-records">
                        {selected.anomalies.map((item) => (
                          <article key={item.id}>
                            <div>
                              <strong>{item.user?.name ?? item.code}</strong>
                              <span>{item.message}</span>
                              <small>{item.code}</small>
                            </div>
                            <PayrollStatusPill status={item.severity} />
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                  <section>
                    <div className="hr-payroll-subheading">
                      <h3>Traza INSS, INATEC e IR</h3>
                      <span>Revisión {selected.revision}</span>
                    </div>
                    {selected.statutoryCalculations.length === 0 ? <p>Sin cálculo estatutario para esta corrida.</p> : (
                      <div className="hr-payroll-records">
                        {selected.statutoryCalculations.map((item) => <article key={item.id}>
                          <div>
                            <strong>{item.user?.name ?? `Usuario #${item.userId}`} · {item.companyTaxRegime}</strong>
                            <span>INSS laboral {item.employeeInss} · IR retenido {item.currentIncomeTaxWithheld} · devolución IR {item.incomeTaxRefund}</span>
                            <small>Base INSS {item.inssBase} · otras deducciones IR {item.otherIncomeTaxDeductions} · renta neta acumulada {item.accumulatedIncomeTaxNet} · proyección anual {item.annualProjection} · período {item.elapsedPeriods}/{item.annualPeriods}</small>
                          </div>
                        </article>)}
                      </div>
                    )}
                    {selected.employerContributions.length > 0 && <div className="hr-payroll-records">
                      {selected.employerContributions.map((item) => <article key={item.id}>
                        <div><strong>{item.name} · {item.user?.name ?? `Usuario #${item.userId}`}</strong><small>Base {item.baseAmount} · tasa {(Number(item.rate) * 100).toFixed(2)}% · {item.traceReference}</small></div>
                        <strong>{item.amount}</strong>
                      </article>)}
                    </div>}
                  </section>
                  <section>
                    <div className="hr-payroll-subheading">
                      <h3>Snapshot de fuentes</h3>
                      <span>{selected.snapshot.length} personas</span>
                    </div>
                    {selected.snapshot.length === 0 ? (
                      <p>Sin snapshot; calcula la corrida.</p>
                    ) : (
                      <div className="hr-payroll-records">
                        {selected.snapshot.map((line) => (
                          <article key={line.id}>
                            <div>
                              <strong>{line.user?.name ?? `Usuario #${line.userId}`}</strong>
                              <span>
                                {line.ordinaryMinutes} min ordinarios ·{' '}
                                {line.approvedOvertimeMinutes} min extra aprobado
                              </span>
                              <small>
                                Fuente rev. {line.sourceRevision ?? '—'} · {line.capturedAt}
                              </small>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                  <section>
                    <div className="hr-payroll-subheading">
                      <h3>Componentes</h3>
                      {selected.status === 'CALCULATED' && (
                        <Button
                          size="sm"
                          onClick={() => {
                            componentOperationKey.current = createPayrollIdempotencyKey();
                            setCreatePanel({ kind: 'component' });
                          }}
                          disabled={!online}
                        >
                          <Plus size={14} /> Entrada
                        </Button>
                      )}
                    </div>
                    {selected.components.length === 0 ? (
                      <p>Sin componentes.</p>
                    ) : (
                      <div className="hr-payroll-records">
                        {selected.components.map((item) => (
                          <article key={item.id}>
                            <div>
                              <strong>
                                {item.name} · {item.code}
                              </strong>
                              <span>
                                {item.user?.name ?? `Usuario #${item.userId}`} · {item.source}
                              </span>
                              <small>{item.traceReference ?? 'Sin referencia adicional'}</small>
                            </div>
                            <strong>{item.amount}</strong>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                  <section>
                    <div className="hr-payroll-subheading">
                      <h3>Recibos y exportación</h3>
                      <div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void exportRun('csv')}
                          disabled={!online || downloading}
                        >
                          <Download size={14} /> CSV
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void exportRun('xlsx')}
                          disabled={!online || downloading}
                        >
                          XLSX
                        </Button>
                      </div>
                    </div>
                    {selected.receipts.length === 0 ? (
                      <p>Sin recibos publicados.</p>
                    ) : (
                      <div className="hr-payroll-records">
                        {selected.receipts.map((receipt) => (
                          <article key={receipt.id}>
                            <div>
                              <strong>{receipt.periodLabel}</strong>
                              <span>
                                {receipt.currency} {receipt.netPay} neto
                              </span>
                              <small>{receipt.status}</small>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void downloadReceipt(receipt.id)}
                              disabled={!online || downloading}
                            >
                              PDF
                            </Button>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <Sidebar
        isOpen={Boolean(createPanel)}
        onClose={() => {
          if (!saving) {
            if (createPanel?.kind === 'component') componentOperationKey.current = null;
            setCreatePanel(null);
          }
        }}
        title={
          createPanel?.kind === 'rule'
            ? 'Versión de regla'
            : createPanel?.kind === 'period'
              ? 'Nuevo periodo'
              : createPanel?.kind === 'component'
                ? 'Componente manual'
                : createPanel?.runKind === 'AGUINALDO'
                  ? 'Nueva corrida de aguinaldo'
                  : 'Nueva corrida de nómina'
        }
        width="wide"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <div className="hr-payroll-sidebar">
          <PayrollOnlineNotice online={online} compact />
          {createPanel?.kind === 'rule' && (
            <PayrollRuleForm
              initial={createPanel.rule}
              online={online}
              saving={saving}
              onSubmit={saveRule}
              onCancel={() => setCreatePanel(null)}
            />
          )}
          {createPanel?.kind === 'period' && (
            <form className="hr-payroll-form" onSubmit={(event) => void savePeriod(event)}>
              <label>
                Código
                <input
                  value={periodForm.code}
                  onChange={(event) =>
                    setPeriodForm((current) => ({
                      ...current,
                      code: event.target.value.toUpperCase(),
                    }))
                  }
                  required
                />
              </label>
              <label>
                Desde
                <input
                  type="date"
                  value={periodForm.dateFrom}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, dateFrom: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  min={periodForm.dateFrom}
                  value={periodForm.dateTo}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, dateTo: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Fecha de pago
                <input
                  type="date"
                  value={periodForm.payDate}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, payDate: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="span-full">
                Razón
                <textarea
                  rows={4}
                  value={periodForm.reason}
                  onChange={(event) =>
                    setPeriodForm((current) => ({ ...current, reason: event.target.value }))
                  }
                  required
                />
              </label>
              <p className="hr-payroll-help span-full">
                El periodo no recibe totales ni valores legales desde la UI.
              </p>
              <div className="hr-payroll-form-actions span-full">
                <Button type="button" variant="ghost" onClick={() => setCreatePanel(null)}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={!online || saving || !periodForm.code || !periodForm.reason.trim()}
                >
                  {saving ? 'Creando…' : 'Crear periodo'}
                </Button>
              </div>
            </form>
          )}
          {createPanel?.kind === 'run' && (
            <PayrollRunForm
              kind={createPanel.runKind}
              periods={periods}
              rules={rules}
              online={online}
              saving={saving}
              onSubmit={(payload) => saveRun(createPanel.runKind, payload)}
              onCancel={() => setCreatePanel(null)}
            />
          )}
          {createPanel?.kind === 'component' && selected && (
            <PayrollComponentForm
              users={lookups.users ?? []}
              online={online}
              saving={saving}
              onSubmit={saveComponent}
              onCancel={() => {
                componentOperationKey.current = null;
                setCreatePanel(null);
              }}
            />
          )}
        </div>
      </Sidebar>

      <Sidebar
        isOpen={Boolean(transition)}
        onClose={() => {
          if (!saving) {
            transitionOperationKey.current = null;
            setTransition(null);
          }
        }}
        title={transition ? ACTION_LABELS[transition.action] : 'Transición'}
        width="wide"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        {transition && (
          <div className="hr-payroll-sidebar">
            <PayrollOnlineNotice online={online} compact />
            <PayrollTransitionForm
              run={transition.run}
              action={transition.action}
              online={online}
              saving={saving}
              onSubmit={saveTransition}
              onCancel={() => {
                transitionOperationKey.current = null;
                setTransition(null);
              }}
            />
          </div>
        )}
      </Sidebar>

      <Sidebar
        isOpen={Boolean(ruleAction)}
        onClose={() => !saving && setRuleAction(null)}
        title={ruleAction?.action === 'activate' ? 'Activar regla' : 'Retirar regla'}
        width="wide"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <form
          className="hr-payroll-form hr-payroll-sidebar"
          onSubmit={(event) => void saveRuleAction(event)}
        >
          <PayrollOnlineNotice online={online} compact />
          <div className="hr-payroll-warning span-full">
            <AlertTriangle size={19} />
            <span>La vigencia y exclusividad de versiones activas se valida en servidor.</span>
          </div>
          <label className="span-full">
            Motivo
            <textarea
              rows={5}
              value={ruleReason}
              onChange={(event) => setRuleReason(event.target.value)}
              required
            />
          </label>
          <label className="hr-payroll-confirm span-full">
            <input
              type="checkbox"
              checked={ruleConfirmed}
              onChange={(event) => setRuleConfirmed(event.target.checked)}
            />
            <span>Confirmo el cambio de estado de esta versión.</span>
          </label>
          <div className="hr-payroll-form-actions span-full">
            <Button type="button" variant="ghost" onClick={() => setRuleAction(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!online || saving || !ruleConfirmed || !ruleReason.trim()}
            >
              Confirmar
            </Button>
          </div>
        </form>
      </Sidebar>

      <Sidebar
        isOpen={Boolean(configurationRule)}
        onClose={() => {
          if (!saving) {
            setConfigurationRule(null);
            setConfigurationRevisions([]);
          }
        }}
        title={configurationRule ? `Control legal · ${configurationRule.name} v${configurationRule.version}` : 'Control legal'}
        width="wide"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        {configurationRule && (
          <div className="hr-payroll-sidebar">
            <PayrollOnlineNotice online={online} compact />
            <PayrollRuleConfigurationPanel
              rule={configurationRule}
              revisions={configurationRevisions}
              loading={configurationLoading}
              saving={saving}
              online={online}
              onUpload={uploadRuleConfiguration}
              onReview={reviewRuleConfiguration}
            />
          </div>
        )}
      </Sidebar>
    </div>
  );
}
