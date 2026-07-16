import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CircleDot,
  FileCheck2,
  Landmark,
  LockKeyhole,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import HrReactSelect from '../../components/hr/HrReactSelect';
import PayrollOnlineNotice from '../../components/hr/PayrollOnlineNotice';
import PayrollRuleConfigurationPanel from '../../components/hr/PayrollRuleConfigurationPanel';
import PayrollRuleForm from '../../components/hr/PayrollRuleForm';
import PayrollStatusPill from '../../components/hr/PayrollStatusPill';
import usePayrollOnline from '../../components/hr/usePayrollOnline';
import {
  createPayrollIdempotencyKey,
  getPayrollErrorMessage,
  payrollClient,
} from '../../components/hr/payrollClient';
import { useAppToast } from '../../context/ToastContext';
import type {
  HrPayrollConfigurationReviewPayload,
  HrPayrollConfigurationUploadPayload,
  HrPayrollRuleConfigurationRevision,
  HrPayrollRulePayload,
  HrPayrollRuleVersion,
  HrPayrollTransitionPayload,
} from '../../types/hr-payroll';
import './payroll.css';
import './payroll-legal.css';

const ruleStatusLabel = (status: HrPayrollRuleVersion['status']) =>
  status === 'DRAFT' ? 'Borrador' : status === 'ACTIVE' ? 'Activa' : 'Retirada';

export default function PayrollLegalSettings() {
  const online = usePayrollOnline();
  const { success: showSuccess, error: showError } = useAppToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rules, setRules] = useState<HrPayrollRuleVersion[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [revisions, setRevisions] = useState<HrPayrollRuleConfigurationRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [activationReason, setActivationReason] = useState('Activación de parámetros legales verificados');
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedRuleId = searchParams.get('ruleId') || '';
  const initialRequestedRuleId = useRef(requestedRuleId);

  const selectedRule = useMemo(
    () => rules.find((rule) => String(rule.id) === selectedRuleId) ?? null,
    [rules, selectedRuleId]
  );

  const loadRules = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await payrollClient.getRules({ limit: 100 });
      setRules(result.items);
      const requested = preferredId || '';
      const next = result.items.find((rule) => String(rule.id) === requested)
        ?? result.items.find((rule) => rule.status === 'ACTIVE')
        ?? result.items[0]
        ?? null;
      setSelectedRuleId(next ? String(next.id) : '');
    } catch (loadError) {
      setRules([]);
      setSelectedRuleId('');
      setError(getPayrollErrorMessage(loadError, 'No fue posible cargar las reglas legales de nómina.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRules(initialRequestedRuleId.current); }, [loadRules]);

  const loadRevisions = useCallback(async (ruleId: number) => {
    setConfigurationLoading(true);
    try {
      setRevisions(await payrollClient.getRuleConfigurations(ruleId));
    } catch (loadError) {
      setRevisions([]);
      showError(getPayrollErrorMessage(loadError, 'No fue posible cargar las revisiones legales.'));
    } finally {
      setConfigurationLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    if (selectedRuleId && !requestedRuleId) setSearchParams({ ruleId: selectedRuleId }, { replace: true });
  }, [requestedRuleId, selectedRuleId, setSearchParams]);

  useEffect(() => {
    if (requestedRuleId && requestedRuleId !== selectedRuleId && rules.some((rule) => String(rule.id) === requestedRuleId)) {
      setSelectedRuleId(requestedRuleId);
    }
  }, [requestedRuleId, rules, selectedRuleId]);

  useEffect(() => {
    const ruleId = Number(selectedRuleId);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      setRevisions([]);
      return;
    }
    void loadRevisions(ruleId);
  }, [loadRevisions, selectedRuleId]);

  const refreshSelected = async (ruleId: number) => {
    const [ruleResult, configurationResult] = await Promise.all([
      payrollClient.getRules({ limit: 100 }),
      payrollClient.getRuleConfigurations(ruleId),
    ]);
    setRules(ruleResult.items);
    setSelectedRuleId(String(ruleId));
    setRevisions(configurationResult);
  };

  const saveRule = async (payload: HrPayrollRulePayload) => {
    setSaving(true);
    try {
      const created = await payrollClient.createRule(payload, createPayrollIdempotencyKey());
      showSuccess('Regla base creada. Ya puedes configurar INSS, INATEC e IR laboral.');
      setCreateOpen(false);
      await loadRules(String(created.id));
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible crear la regla base.'));
    } finally {
      setSaving(false);
    }
  };

  const uploadConfiguration = async (payload: HrPayrollConfigurationUploadPayload) => {
    if (!selectedRule) return;
    setSaving(true);
    try {
      await payrollClient.uploadRuleConfiguration(selectedRule.id, payload, createPayrollIdempotencyKey());
      showSuccess('Configuración guardada y enviada a validación independiente.');
      await refreshSelected(selectedRule.id);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible guardar la configuración legal.'));
    } finally {
      setSaving(false);
    }
  };

  const reviewConfiguration = async (payload: HrPayrollConfigurationReviewPayload) => {
    if (!selectedRule) return;
    setSaving(true);
    try {
      await payrollClient.reviewRuleConfiguration(selectedRule.id, payload, createPayrollIdempotencyKey());
      showSuccess(payload.decision === 'VALIDATED' ? 'Configuración validada. Ya puede activarse.' : 'Configuración rechazada. Puedes corregirla en una nueva revisión.');
      await refreshSelected(selectedRule.id);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible registrar el dictamen.'));
    } finally {
      setSaving(false);
    }
  };

  const activateRule = async () => {
    if (!selectedRule || !activationConfirmed || activationReason.trim().length < 3) return;
    setSaving(true);
    try {
      const payload: HrPayrollTransitionPayload = { reason: activationReason.trim(), confirmed: true, expectedRevision: selectedRule.revision };
      await payrollClient.activateRule(selectedRule.id, payload, createPayrollIdempotencyKey());
      showSuccess('Regla activada. Se aplicará a las nóminas dentro de su vigencia.');
      setActivationConfirmed(false);
      await refreshSelected(selectedRule.id);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible activar la regla legal.'));
    } finally {
      setSaving(false);
    }
  };

  const activeRevision = selectedRule
    ? revisions.find((revision) => revision.id === selectedRule.activeConfigurationRevisionId)
      ?? revisions.find((revision) => revision.status === 'VALIDATED')
      ?? revisions[0]
    : undefined;
  const validatedRevision = revisions.find((revision) => revision.status === 'VALIDATED');
  const pendingRevision = revisions.find((revision) => revision.status === 'UPLOADED');
  const statutory = activeRevision?.configuration.statutory;

  return (
    <div className="page-wrapper hr-payroll-page hr-legal-settings-page">
      <PageHeader
        title="IR laboral, INSS e INATEC"
        subtitle="Configura qué se retiene al empleado, qué aporta la empresa y desde cuándo se aplican esas reglas"
        icon={Landmark}
        actions={<div className="hr-payroll-header-actions"><Button variant="ghost" onClick={() => void loadRules(selectedRuleId)} disabled={loading}><RefreshCw size={16} /> Actualizar</Button><Button onClick={() => setCreateOpen(true)} disabled={!online}><Plus size={17} /> Nueva versión legal</Button></div>}
      />

      <PayrollOnlineNotice online={online} />

      {loading && <LoadingSpinner text="Cargando configuración legal…" />}
      {!loading && error && <div className="state-placeholder" role="alert"><AlertTriangle size={44} /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void loadRules()}>Reintentar</Button></div>}
      {!loading && !error && rules.length === 0 && <div className="hr-payroll-legal-empty hr-legal-empty-state"><Scale size={42} /><strong>No hay una versión legal de nómina.</strong><span>Crea una vigencia para luego configurar tasas de INSS, INATEC y tramos de IR laboral.</span><Button onClick={() => setCreateOpen(true)} disabled={!online}>Crear primera versión</Button></div>}

      {!loading && !error && selectedRule && <>
        <section className="hr-legal-purpose" aria-labelledby="legal-purpose-title"><div className="hr-legal-purpose-icon"><ShieldCheck size={24} aria-hidden="true" /></div><div><span className="hr-legal-eyebrow">Qué controla esta pantalla</span><h2 id="legal-purpose-title">Una versión legal es la receta que usa cada nómina</h2><p>Guarda el régimen de la empresa, tasas, bases, tramos y qué ingresos están sujetos a cada obligación. Una versión solo afecta cálculos cuando queda <strong>validada</strong>, <strong>activa</strong> y dentro de su vigencia.</p></div></section>

        <section className="hr-legal-rule-toolbar" aria-label="Versión legal seleccionada"><label>Versión y vigencia<HrReactSelect value={selectedRuleId} onChange={(event) => { setSelectedRuleId(event.target.value); setSearchParams({ ruleId: event.target.value }, { replace: true }); }} aria-label="Versión legal de nómina">{rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · v{rule.version} · {ruleStatusLabel(rule.status)}</option>)}</HrReactSelect></label><div className="hr-legal-rule-meta"><PayrollStatusPill status={selectedRule.status} /><span>{selectedRule.effectiveFrom} – {selectedRule.effectiveTo ?? 'sin fecha fin'}</span><small>Fuente: {selectedRule.sourceReference}</small></div></section>

        <section className="hr-legal-lifecycle" aria-labelledby="legal-lifecycle-title">
          <div className="hr-legal-lifecycle-heading"><div><span className="hr-legal-eyebrow">Flujo de publicación</span><h2 id="legal-lifecycle-title">Estado de esta versión</h2></div><p>{selectedRule.status === 'ACTIVE' ? 'Esta versión ya participa en los cálculos según su vigencia.' : validatedRevision ? 'La revisión legal está aprobada; falta activar la versión.' : pendingRevision ? 'Una segunda persona debe revisar los parámetros.' : 'Completa y guarda los parámetros para iniciar la validación.'}</p></div>
          <ol>
            <li className="is-complete"><span><Check size={16} aria-hidden="true" /></span><div><strong>1. Borrador</strong><small>Se editan tasas y tramos</small></div></li>
            <li className={pendingRevision || validatedRevision || selectedRule.status !== 'DRAFT' ? 'is-complete' : 'is-current'}><span>{pendingRevision || validatedRevision || selectedRule.status !== 'DRAFT' ? <Check size={16} aria-hidden="true" /> : <CircleDot size={16} aria-hidden="true" />}</span><div><strong>2. En validación</strong><small>Revisión por otra persona</small></div></li>
            <li className={validatedRevision || selectedRule.status !== 'DRAFT' ? 'is-complete' : pendingRevision ? 'is-current' : ''}><span>{validatedRevision || selectedRule.status !== 'DRAFT' ? <Check size={16} aria-hidden="true" /> : <FileCheck2 size={16} aria-hidden="true" />}</span><div><strong>3. Validada</strong><small>Parámetros congelados</small></div></li>
            <li className={selectedRule.status === 'ACTIVE' ? 'is-complete is-current' : selectedRule.status === 'RETIRED' ? 'is-complete' : validatedRevision ? 'is-current' : ''}><span>{selectedRule.status === 'ACTIVE' || selectedRule.status === 'RETIRED' ? <Check size={16} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}</span><div><strong>4. Activa</strong><small>Disponible para nómina</small></div></li>
          </ol>
        </section>

        <div className="hr-legal-summary-grid">
          <article><span>INSS</span><strong>{statutory ? `${(Number(statutory.inss.employeeRate) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}% laboral` : 'Pendiente'}</strong><small>{statutory ? `${statutory.inss.regime} · patronal ${(Number(statutory.inss.employerRateBelowThreshold) * 100).toLocaleString('es-NI')}% / ${(Number(statutory.inss.employerRateAtOrAboveThreshold) * 100).toLocaleString('es-NI')}%` : 'Sin revisión configurada'}</small></article>
          <article><span>INATEC</span><strong>{statutory ? `${(Number(statutory.inatec.employerRate) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}% patronal` : 'Pendiente'}</strong><small>{statutory?.inatec.applicability === 'DOES_NOT_APPLY' ? 'Excepción documentada' : 'Costo de la empresa; no deduce al empleado'}</small></article>
          <article><span>IR laboral</span><strong>{statutory ? `${statutory.incomeTax.brackets.length} tramos` : 'Pendiente'}</strong><small>{statutory?.companyTaxRegime.incomeTaxApplicability === 'DOES_NOT_APPLY' ? 'No aplica por régimen' : `Régimen ${statutory?.companyTaxRegime.code ?? 'pendiente'}`}</small></article>
          <article><span>Uso en nómina</span><strong>{selectedRule.status === 'ACTIVE' ? 'En uso' : selectedRule.status === 'RETIRED' ? 'Retirada' : validatedRevision ? 'Lista para activar' : 'Aún no'}</strong><small>{activeRevision ? `Revisión ${activeRevision.revision} · ${activeRevision.status === 'VALIDATED' ? 'validada' : activeRevision.status === 'UPLOADED' ? 'en validación' : 'rechazada'}` : 'Requiere carga y validación'}</small></article>
        </div>

        {selectedRule.status === 'DRAFT' && validatedRevision && <section className="hr-legal-activation" aria-labelledby="legal-activation-title"><div><span className="hr-legal-section-icon"><LockKeyhole size={20} aria-hidden="true" /></span><div><span className="hr-legal-eyebrow">Paso final</span><h2 id="legal-activation-title">Activar esta versión</h2><p>Al activarla, las nuevas corridas con fecha dentro de <strong>{selectedRule.effectiveFrom} – {selectedRule.effectiveTo ?? 'sin fecha fin'}</strong> podrán usar estos parámetros.</p></div></div><label>Motivo de activación<input value={activationReason} onChange={(event) => setActivationReason(event.target.value)} maxLength={900} /></label><label className="hr-payroll-confirm"><input type="checkbox" checked={activationConfirmed} onChange={(event) => setActivationConfirmed(event.target.checked)} /><span>Confirmo la vigencia y que esta versión debe quedar disponible para calcular nómina.</span></label><Button onClick={() => void activateRule()} disabled={!online || saving || !activationConfirmed || activationReason.trim().length < 3}>{saving ? 'Activando…' : 'Activar versión legal'}</Button></section>}

        <section className="hr-legal-configuration-workspace"><div className="hr-legal-workspace-heading"><div><ShieldCheck size={20} aria-hidden="true" /><div><h2>Parámetros de la versión</h2><p>Las tasas se muestran como porcentajes. Montos, fuentes y tramos quedan congelados después de validar.</p></div></div></div><PayrollRuleConfigurationPanel key={`${selectedRule.id}-${selectedRule.revision}-${revisions[0]?.id ?? 'new'}`} rule={selectedRule} revisions={revisions} loading={configurationLoading} saving={saving} online={online} onUpload={uploadConfiguration} onReview={reviewConfiguration} /></section>
      </>}

      <Sidebar isOpen={createOpen} onClose={() => !saving && setCreateOpen(false)} title="Nueva versión legal de nómina" width="large" closeOnBackdrop={!saving} closeOnEscape={!saving}><PayrollRuleForm online={online} saving={saving} onSubmit={saveRule} onCancel={() => setCreateOpen(false)} /></Sidebar>
    </div>
  );
}
