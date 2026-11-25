import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Copy,
  Eye,
  Landmark,
  LockKeyhole,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
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
  HrPayrollCompanyTaxProfile,
  HrPayrollRuleConfigurationRevision,
  HrPayrollRulePayload,
  HrPayrollRuleVersion,
  HrPayrollTransitionPayload,
} from '../../types/hr-payroll';
import './payroll.css';
import './payroll-legal.css';
import './admin-tables.css';
import '../Inventory.css';

function formatLegalDate(value?: string | null) {
  if (!value) return 'Sin fecha fin';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export default function PayrollLegalSettings() {
  const online = usePayrollOnline();
  const { success: showSuccess, error: showError } = useAppToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rules, setRules] = useState<HrPayrollRuleVersion[]>([]);
  const [companyTaxProfile, setCompanyTaxProfile] = useState<HrPayrollCompanyTaxProfile | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [revisions, setRevisions] = useState<HrPayrollRuleConfigurationRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<HrPayrollRuleVersion | null>(null);
  const [activationReason, setActivationReason] = useState('Activación de parámetros legales verificados');
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedRuleId = searchParams.get('ruleId') || '';
  const initialRequestedRuleId = useRef(requestedRuleId);

  const selectedRule = useMemo(
    () => rules.find((rule) => String(rule.id) === selectedRuleId) ?? null,
    [rules, selectedRuleId]
  );
  const activeRule = useMemo(() => rules.find((rule) => rule.status === 'ACTIVE') ?? null, [rules]);

  const loadRules = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [result, profile] = await Promise.all([
        payrollClient.getRules({ limit: 100 }),
        payrollClient.getCompanyTaxProfile(),
      ]);
      setRules(result.items);
      setCompanyTaxProfile(profile);
      const requested = preferredId || '';
      const next = result.items.find((rule) => String(rule.id) === requested)
        ?? result.items.find((rule) => rule.status === 'ACTIVE')
        ?? result.items[0]
        ?? null;
      setSelectedRuleId(next ? String(next.id) : '');
    } catch (loadError) {
      setRules([]);
      setCompanyTaxProfile(null);
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
      const created = cloneSource
        ? await payrollClient.cloneRule(cloneSource.id, { ...payload, expectedRevision: cloneSource.revision }, createPayrollIdempotencyKey())
        : await payrollClient.createRule(payload, createPayrollIdempotencyKey());
      showSuccess(cloneSource
        ? 'Borrador clonado. Revisa los cambios, guarda una nueva revisión y envíala a validación.'
        : 'Regla base creada. Ya puedes configurar INSS, INATEC e IR laboral.');
      setCreateOpen(false);
      setCloneSource(null);
      await loadRules(String(created.id));
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, cloneSource ? 'No fue posible clonar la versión.' : 'No fue posible crear la regla base.'));
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
  const selectedProfileIsCurrent = !statutory || (
    statutory.companyTaxRegime.code === companyTaxProfile?.taxRegime &&
    statutory.companyTaxRegime.incomeTaxApplicability === (companyTaxProfile?.incomeTaxWithholding ? 'APPLIES' : 'DOES_NOT_APPLY') &&
    statutory.companyTaxRegime.sourceReference === companyTaxProfile?.sourceReference
  );

  return (
    <div className="page-wrapper hr-payroll-page hr-legal-settings-page">
      <PageHeader
        title="IR laboral, INSS e INATEC"
        subtitle="Configura qué se retiene al empleado, qué aporta la empresa y desde cuándo se aplican esas reglas"
        icon={Landmark}
        actions={<div className="hr-payroll-header-actions"><Button variant="ghost" onClick={() => void loadRules(selectedRuleId)} disabled={loading}><RefreshCw size={16} /> Actualizar</Button><Button onClick={() => { setCloneSource(null); setCreateOpen(true); }} disabled={!online || !companyTaxProfile?.ready}><Plus size={17} /> Nueva versión</Button></div>}
      />

      {!online && <PayrollOnlineNotice online={online} />}

      {loading && <LoadingSpinner text="Cargando configuración legal…" />}
      {!loading && error && <div className="state-placeholder" role="alert"><AlertTriangle size={44} /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void loadRules()}>Reintentar</Button></div>}
      {!loading && !error && rules.length === 0 && <div className="hr-payroll-legal-empty hr-legal-empty-state"><Scale size={42} /><strong>No hay una versión legal de nómina.</strong><span>Crea una vigencia para luego configurar tasas de INSS, INATEC y tramos de IR laboral.</span><Button onClick={() => { setCloneSource(null); setCreateOpen(true); }} disabled={!online || !companyTaxProfile?.ready}>Crear primera versión</Button></div>}

      {!loading && !error && companyTaxProfile && <section className="hr-legal-command-center" aria-label="Centro de control legal de nómina">
        <div className="hr-legal-command-intro"><span className="hr-legal-command-icon"><Landmark size={24} aria-hidden="true" /></span><div><span className="hr-legal-eyebrow">Centro de control legal</span><h2>{companyTaxProfile.companyName}</h2><p>Administra en un solo flujo el perfil fiscal, las vigencias y los parámetros congelados que utiliza cada nómina.</p></div><Link className="btn btn-secondary btn-sm" to="/companies">Editar perfil fiscal</Link></div>
        <dl className="hr-legal-command-facts">
          <div><dt>Régimen DGI</dt><dd>{companyTaxProfile.taxRegime === 'GENERAL' ? 'General' : companyTaxProfile.taxRegime === 'SIMPLIFIED_FIXED_QUOTA' ? 'Cuota fija / simplificado' : companyTaxProfile.taxRegime === 'SPECIAL' ? 'Especial' : companyTaxProfile.taxRegime === 'EXEMPT' ? 'Exento' : 'Otro'}</dd><small>{companyTaxProfile.incomeTaxWithholding ? 'Retiene IR laboral' : 'No retiene IR laboral'}</small></div>
          <div><dt>Perfil maestro</dt><dd>{companyTaxProfile.ready ? 'Confirmado' : 'Pendiente'}</dd><small>Fuente para nuevas versiones</small></div>
          <div><dt>Versiones registradas</dt><dd>{rules.length}</dd><small>Histórico legal inmutable</small></div>
          <div><dt>Versión activa</dt><dd>{activeRule ? `v${activeRule.version}` : 'Sin activar'}</dd><small>{activeRule?.name ?? 'Requiere configuración validada'}</small></div>
        </dl>
      </section>}

      {!loading && !error && companyTaxProfile && !companyTaxProfile.ready && <div className="hr-legal-profile-warning" role="alert"><AlertTriangle size={20} /><div><strong>El perfil fiscal de la empresa está pendiente.</strong><p>Confirma régimen, retención de IR y respaldo en Empresas. Hasta entonces no se pueden validar reglas ni iniciar nuevas corridas.</p></div><Link className="btn btn-primary btn-sm" to="/companies">Completar perfil</Link></div>}

      {!loading && !error && selectedRule && companyTaxProfile && <>
        <section className="hr-legal-version-list pr-table-card" aria-labelledby="legal-version-list-title">
          <div className="hr-legal-version-table-toolbar">
            <div><span className="hr-legal-eyebrow">Registro legal</span><h2 id="legal-version-list-title">Versiones legales</h2><small>Abre una fila para consultar. Para modificar una versión activa, clónala como borrador.</small></div>
            <span className="hr-legal-version-count">{rules.length} versión(es)</span>
          </div>
          <div className="hr-legal-readonly-table-wrap hr-admin-table-wrap"><table className="hr-admin-table inventory-table"><thead><tr><th scope="col">Versión</th><th scope="col">Vigencia</th><th scope="col">Estado</th><th scope="col">Configuración</th><th scope="col" className="hr-admin-actions-col">Acciones</th></tr></thead><tbody>{rules.map((rule) => {
            const isSelected = String(rule.id) === selectedRuleId;
            return <tr key={rule.id} className={isSelected ? 'is-selected' : undefined} aria-current={isSelected ? 'true' : undefined}>
              <th scope="row" className="hr-legal-version-cell"><span className="hr-legal-version-number"><small>Versión</small><strong>{rule.version}</strong></span><strong className="hr-legal-version-name">{rule.name}</strong></th>
              <td><div className="hr-legal-date-range"><CalendarDays size={16} aria-hidden="true" /><div><strong>{formatLegalDate(rule.effectiveFrom)}</strong><small>Hasta {formatLegalDate(rule.effectiveTo).toLocaleLowerCase()}</small></div></div></td>
              <td><PayrollStatusPill status={rule.status} /></td>
              <td><strong>{rule.configurationSummary ? 'Configurada' : 'Pendiente'}</strong><small>{rule.configurationSummary || 'Sin revisión validada'}</small></td>
              <td className="hr-admin-actions-col"><div className="hr-legal-row-actions"><Button className="hr-legal-table-action" type="button" size="sm" variant={isSelected ? 'secondary' : 'ghost'} aria-label={`Abrir ${rule.name}`} onClick={() => { setSelectedRuleId(String(rule.id)); setSearchParams({ ruleId: String(rule.id) }, { replace: true }); }}><Eye size={15} aria-hidden="true" /> {isSelected ? 'Abierta' : 'Abrir'}</Button>{rule.activeConfigurationRevisionId && <Button className="hr-legal-table-action" type="button" size="sm" variant="ghost" aria-label={`Clonar ${rule.name} para editar`} disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(rule); setCreateOpen(true); }}><Copy size={15} aria-hidden="true" /> Clonar</Button>}</div></td>
            </tr>;
          })}</tbody></table></div>
        </section>

        <section className="hr-legal-selected-shell" aria-label="Espacio de trabajo de la versión abierta">
          <aside className="hr-legal-selected-aside">
        <section className="hr-legal-rule-toolbar" aria-label="Versión legal seleccionada"><div className="hr-legal-rule-title"><span className="hr-legal-eyebrow">Versión abierta</span><strong>{selectedRule.name} · v{selectedRule.version}</strong><small>Contexto vigente para todos los parámetros mostrados.</small></div><div className="hr-legal-rule-meta"><PayrollStatusPill status={selectedRule.status} /><span><CalendarDays size={15} aria-hidden="true" /> {formatLegalDate(selectedRule.effectiveFrom)} – {formatLegalDate(selectedRule.effectiveTo).toLocaleLowerCase()}</span><small>Fuente: {selectedRule.sourceReference}</small>{selectedRule.activeConfigurationRevisionId && <Button type="button" size="sm" variant="ghost" disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(selectedRule); setCreateOpen(true); }}><Copy size={15} /> Clonar para editar</Button>}</div></section>

        {!selectedProfileIsCurrent && <div className="hr-legal-profile-warning" role="alert"><AlertTriangle size={20} /><div><strong>El perfil fiscal de Empresa cambió después de validar esta versión.</strong><p>La versión activa conserva su copia histórica. Clónala para crear un borrador con el régimen y la retención vigentes.</p></div><Button type="button" size="sm" disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(selectedRule); setCreateOpen(true); }}><Copy size={15} /> Clonar ahora</Button></div>}

        <section className="hr-legal-lifecycle" aria-labelledby="legal-lifecycle-title">
          <div className="hr-legal-lifecycle-current">
            <span className="hr-legal-section-icon"><LockKeyhole size={20} aria-hidden="true" /></span>
            <div><span className="hr-legal-eyebrow">Estado de la versión</span><h2 id="legal-lifecycle-title">{selectedRule.status === 'ACTIVE' ? 'Activa en nómina' : selectedRule.status === 'RETIRED' ? 'Retirada' : validatedRevision ? 'Validada, lista para activar' : pendingRevision ? 'Esperando revisión independiente' : 'Borrador editable'}</h2><p>{selectedRule.status === 'ACTIVE' ? 'Participa en los cálculos cuya fecha cae dentro de su vigencia.' : validatedRevision ? 'Los parámetros ya están congelados. Confirma la vigencia para activarla.' : pendingRevision ? 'Otra persona debe aprobar o rechazar la revisión cargada.' : 'Configura tasas, tramos y conceptos; luego envíalos a revisión.'}</p></div>
          </div>
          <dl className="hr-legal-lifecycle-facts">
            <div><dt>Estado</dt><dd><PayrollStatusPill status={selectedRule.status} /></dd></div>
            <div><dt>Revisión</dt><dd>{activeRevision ? `v${activeRevision.revision} · ${activeRevision.status === 'VALIDATED' ? 'validada' : activeRevision.status === 'UPLOADED' ? 'pendiente' : 'rechazada'}` : 'Sin revisión'}</dd></div>
            <div><dt>Siguiente acción</dt><dd>{selectedRule.status === 'ACTIVE' ? 'Consultar o clonar' : validatedRevision ? 'Activar versión' : pendingRevision ? 'Emitir dictamen' : 'Guardar para revisión'}</dd></div>
          </dl>
        </section>

        <div className="hr-legal-summary-grid">
          <article><span>INSS</span><strong>{statutory ? `${(Number(statutory.inss.employeeRate) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}% laboral` : 'Pendiente'}</strong><small>{statutory ? `${statutory.inss.regime} · patronal ${(Number(statutory.inss.employerRateBelowThreshold) * 100).toLocaleString('es-NI')}% / ${(Number(statutory.inss.employerRateAtOrAboveThreshold) * 100).toLocaleString('es-NI')}%` : 'Sin revisión configurada'}</small></article>
          <article><span>INATEC</span><strong>{statutory ? `${(Number(statutory.inatec.employerRate) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}% patronal` : 'Pendiente'}</strong><small>{statutory?.inatec.applicability === 'DOES_NOT_APPLY' ? 'Excepción documentada' : 'Costo de la empresa; no deduce al empleado'}</small></article>
          <article><span>IR laboral</span><strong>{statutory ? `${statutory.incomeTax.brackets.length} tramos` : 'Pendiente'}</strong><small>{statutory?.companyTaxRegime.incomeTaxApplicability === 'DOES_NOT_APPLY' ? 'No aplica por régimen' : `Régimen ${statutory?.companyTaxRegime.code ?? 'pendiente'}`}</small></article>
          <article><span>Uso en nómina</span><strong>{selectedRule.status === 'ACTIVE' ? 'En uso' : selectedRule.status === 'RETIRED' ? 'Retirada' : validatedRevision ? 'Lista para activar' : 'Aún no'}</strong><small>{activeRevision ? `Revisión ${activeRevision.revision} · ${activeRevision.status === 'VALIDATED' ? 'validada' : activeRevision.status === 'UPLOADED' ? 'en validación' : 'rechazada'}` : 'Requiere carga y validación'}</small></article>
        </div>
          </aside>
          <div className="hr-legal-selected-main">

        {selectedRule.status === 'DRAFT' && validatedRevision && <section className="hr-legal-activation" aria-labelledby="legal-activation-title"><div><span className="hr-legal-section-icon"><LockKeyhole size={20} aria-hidden="true" /></span><div><span className="hr-legal-eyebrow">Paso final</span><h2 id="legal-activation-title">Activar esta versión</h2><p>Al activarla, las nuevas corridas con fecha dentro de <strong>{selectedRule.effectiveFrom} – {selectedRule.effectiveTo ?? 'sin fecha fin'}</strong> podrán usar estos parámetros.</p></div></div><label>Motivo de activación<input value={activationReason} onChange={(event) => setActivationReason(event.target.value)} maxLength={900} /></label><label className="hr-payroll-confirm"><input type="checkbox" checked={activationConfirmed} onChange={(event) => setActivationConfirmed(event.target.checked)} /><span>Confirmo la vigencia y que esta versión debe quedar disponible para calcular nómina.</span></label><Button onClick={() => void activateRule()} disabled={!online || saving || !activationConfirmed || activationReason.trim().length < 3}>{saving ? 'Activando…' : 'Activar versión legal'}</Button></section>}

        <section className="hr-legal-configuration-workspace"><div className="hr-legal-workspace-heading"><div><ShieldCheck size={20} aria-hidden="true" /><div><h2>Parámetros de la versión</h2><p>Las tasas se muestran como porcentajes. Montos, fuentes y tramos quedan congelados después de validar.</p></div></div></div><PayrollRuleConfigurationPanel key={`${selectedRule.id}-${selectedRule.revision}-${revisions[0]?.id ?? 'new'}`} rule={selectedRule} revisions={revisions} loading={configurationLoading} saving={saving} online={online} companyTaxProfile={companyTaxProfile} onUpload={uploadConfiguration} onReview={reviewConfiguration} /></section>
          </div>
        </section>
      </>}

      <Sidebar isOpen={createOpen} onClose={() => { if (!saving) { setCreateOpen(false); setCloneSource(null); } }} title={cloneSource ? 'Clonar como nuevo borrador' : 'Nueva versión legal de nómina'} width="large" closeOnBackdrop={!saving} closeOnEscape={!saving}><PayrollRuleForm key={cloneSource?.id ?? 'new'} initial={cloneSource ? { ...cloneSource, effectiveFrom: '', effectiveTo: null } : null} online={online} saving={saving} onSubmit={saveRule} onCancel={() => { setCreateOpen(false); setCloneSource(null); }} notice={cloneSource ? <div className="hr-payroll-info"><Copy size={18} /><span>Se copiarán tasas, tramos y conceptos. Define la nueva vigencia; el perfil fiscal se actualizará desde Empresa y la copia deberá validarse antes de activarse.</span></div> : undefined} /></Sidebar>
    </div>
  );
}
