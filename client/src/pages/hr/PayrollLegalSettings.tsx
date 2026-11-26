import { DataTable, FullScreenModal, Button } from '@/ui';
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
import HrLoading from '../../components/hr/HrLoading';
import { HrHero, HrPage, HrSection, HrSplit, type HrFact } from '../../components/hr/layout/HrWorkspace';
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
import './layouts/nomina.css';

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

  const regimeLabel = companyTaxProfile
    ? companyTaxProfile.taxRegime === 'GENERAL' ? 'General' : companyTaxProfile.taxRegime === 'SIMPLIFIED_FIXED_QUOTA' ? 'Cuota fija / simplificado' : companyTaxProfile.taxRegime === 'SPECIAL' ? 'Especial' : companyTaxProfile.taxRegime === 'EXEMPT' ? 'Exento' : 'Otro'
    : '';
  const showCommandCenter = !loading && !error && Boolean(companyTaxProfile);
  const heroFacts: HrFact[] | undefined = showCommandCenter && companyTaxProfile ? [
    { label: 'Régimen DGI', value: regimeLabel, hint: companyTaxProfile.incomeTaxWithholding ? 'Retiene IR laboral' : 'No retiene IR laboral' },
    { label: 'Perfil maestro', value: companyTaxProfile.ready ? 'Confirmado' : 'Pendiente', hint: 'Fuente para nuevas versiones', tone: companyTaxProfile.ready ? 'success' : 'warning' },
    { label: 'Versiones registradas', value: rules.length, hint: 'Histórico legal inmutable' },
    { label: 'Versión activa', value: activeRule ? `v${activeRule.version}` : 'Sin activar', hint: activeRule?.name ?? 'Requiere configuración validada', tone: activeRule ? 'accent' : 'warning' },
  ] : undefined;
  const lifecycleTitle = selectedRule
    ? selectedRule.status === 'ACTIVE' ? 'Activa en nómina' : selectedRule.status === 'RETIRED' ? 'Retirada' : validatedRevision ? 'Validada, lista para activar' : pendingRevision ? 'Esperando revisión independiente' : 'Borrador editable'
    : '';
  const lifecycleHelp = selectedRule
    ? selectedRule.status === 'ACTIVE' ? 'Participa en los cálculos cuya fecha cae dentro de su vigencia.' : validatedRevision ? 'Los parámetros ya están congelados. Confirma la vigencia para activarla.' : pendingRevision ? 'Otra persona debe aprobar o rechazar la revisión cargada.' : 'Configura tasas, tramos y conceptos; luego envíalos a revisión.'
    : '';

  return (
    <HrPage className="hr-payroll-page hr-legal-settings-page nm-page nm-legal">
      <HrHero
        eyebrow="Recursos humanos"
        icon={Landmark}
        title="IR laboral, INSS e INATEC"
        subtitle="Configura qué se retiene al empleado, qué aporta la empresa y desde cuándo se aplican esas reglas"
        actions={(
          <>
            <Button variant="ghost" onClick={() => void loadRules(selectedRuleId)} disabled={loading}><RefreshCw size={16} /> Actualizar</Button>
            <Button variant="primary" onClick={() => { setCloneSource(null); setCreateOpen(true); }} disabled={!online || !companyTaxProfile?.ready}><Plus size={17} /> Nueva versión</Button>
          </>
        )}
        aside={showCommandCenter && companyTaxProfile ? (
          <section className="hr-legal-command-center nm-legal-company" aria-label="Centro de control legal de nómina">
            <span className="hr-ws-eyebrow">Centro de control legal</span>
            <strong>{companyTaxProfile.companyName}</strong>
            <p>Administra en un solo flujo el perfil fiscal, las vigencias y los parámetros congelados que utiliza cada nómina.</p>
            <Link className="ui-button ui-button--secondary ui-button--sm" to="/companies">Editar perfil fiscal</Link>
          </section>
        ) : undefined}
        facts={heroFacts}
      />

      {!online && <PayrollOnlineNotice online={online} />}

      {loading && <HrLoading text="Cargando configuración legal…" />}
      {!loading && error && <div className="state-placeholder" role="alert"><AlertTriangle size={44} /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void loadRules()}>Reintentar</Button></div>}
      {!loading && !error && rules.length === 0 && (
        <HrSection className="nm-legal-empty">
          <div className="nm-empty">
            <span className="nm-empty-icon" aria-hidden="true"><Scale size={30} /></span>
            <h3>No hay una versión legal de nómina.</h3>
            <p>Crea una vigencia para luego configurar tasas de INSS, INATEC y tramos de IR laboral.</p>
            <Button variant="primary" onClick={() => { setCloneSource(null); setCreateOpen(true); }} disabled={!online || !companyTaxProfile?.ready}>Crear primera versión</Button>
          </div>
        </HrSection>
      )}

      {!loading && !error && companyTaxProfile && !companyTaxProfile.ready && <div className="nm-alert is-warning" role="alert"><AlertTriangle size={20} aria-hidden="true" /><div><strong>El perfil fiscal de la empresa está pendiente.</strong><p>Confirma régimen, retención de IR y respaldo en Empresas. Hasta entonces no se pueden validar reglas ni iniciar nuevas corridas.</p></div><Link className="ui-button ui-button--primary ui-button--sm" to="/companies">Completar perfil</Link></div>}

      {!loading && !error && selectedRule && companyTaxProfile && <>
        <HrSection
          flush
          className="hr-legal-version-list nm-legal-versions"
          aria-labelledby="legal-version-list-title"
          eyebrow="Registro legal"
          title={<span id="legal-version-list-title">Versiones legales</span>}
          count={rules.length}
          description="Abre una fila para consultar. Para modificar una versión activa, clónala como borrador."
        >
          <DataTable
            ariaLabel="Versiones legales"
            rows={rules}
            rowKey={(rule) => rule.id}
            pagination={{ mode: 'client' }}
            minWidth="40rem"
            rowTone={(rule) => (String(rule.id) === selectedRuleId ? 'primary' : undefined)}
            empty="Sin registros"
            columns={[
              { key: 'version', header: 'Versión', render: (rule) => <div className="nm-legal-version-cell"><span className="hr-legal-version-number"><small>Versión</small><strong>{rule.version}</strong></span><strong className="hr-legal-version-name">{rule.name}</strong></div> },
              { key: 'validity', header: 'Vigencia', render: (rule) => <div className="nm-date-range"><CalendarDays size={16} aria-hidden="true" /><div><strong>{formatLegalDate(rule.effectiveFrom)}</strong><small>Hasta {formatLegalDate(rule.effectiveTo).toLocaleLowerCase()}</small></div></div> },
              { key: 'status', header: 'Estado', render: (rule) => <PayrollStatusPill status={rule.status} /> },
              { key: 'configuration', header: 'Configuración', render: (rule) => <><strong>{rule.configurationSummary ? 'Configurada' : 'Pendiente'}</strong><small>{rule.configurationSummary || 'Sin revisión validada'}</small></> },
              {
                key: 'actions',
                header: 'Acciones',
                width: '12rem',
                type: 'actions',
                render: (rule) => {
                  const isSelected = String(rule.id) === selectedRuleId;
                  return <div className="nm-row-actions"><Button className="hr-legal-table-action" type="button" size="sm" variant={isSelected ? 'secondary' : 'ghost'} aria-label={`Abrir ${rule.name}`} onClick={() => { setSelectedRuleId(String(rule.id)); setSearchParams({ ruleId: String(rule.id) }, { replace: true }); }}><Eye size={15} aria-hidden="true" /> {isSelected ? 'Abierta' : 'Abrir'}</Button>{rule.activeConfigurationRevisionId && <Button className="hr-legal-table-action" type="button" size="sm" variant="ghost" aria-label={`Clonar ${rule.name} para editar`} disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(rule); setCreateOpen(true); }}><Copy size={15} aria-hidden="true" /> Clonar</Button>}</div>;
                },
              },
            ]}
          />
        </HrSection>

        <section className="hr-legal-selected-shell nm-legal-shell" aria-label="Espacio de trabajo de la versión abierta">
          <HrSplit
            main={(
              <div className="hr-legal-selected-main nm-legal-main">
                {selectedRule.status === 'DRAFT' && validatedRevision && (
                  <HrSection
                    className="nm-legal-activation"
                    aria-labelledby="legal-activation-title"
                    eyebrow="Paso final"
                    title={<span id="legal-activation-title">Activar esta versión</span>}
                    description={<>Al activarla, las nuevas corridas con fecha dentro de <strong>{selectedRule.effectiveFrom} – {selectedRule.effectiveTo ?? 'sin fecha fin'}</strong> podrán usar estos parámetros.</>}
                  >
                    <div className="nm-legal-activation-form">
                      <label className="nm-field">Motivo de activación<input value={activationReason} onChange={(event) => setActivationReason(event.target.value)} maxLength={900} /></label>
                      <label className="hr-payroll-confirm"><input type="checkbox" checked={activationConfirmed} onChange={(event) => setActivationConfirmed(event.target.checked)} /><span>Confirmo la vigencia y que esta versión debe quedar disponible para calcular nómina.</span></label>
                      <Button variant="primary" onClick={() => void activateRule()} disabled={!online || saving || !activationConfirmed || activationReason.trim().length < 3}><LockKeyhole size={16} aria-hidden="true" /> {saving ? 'Activando…' : 'Activar versión legal'}</Button>
                    </div>
                  </HrSection>
                )}

                <HrSection
                  className="nm-legal-parameters"
                  eyebrow={<><ShieldCheck size={13} aria-hidden="true" /> Parámetros</>}
                  title="Parámetros de la versión"
                  description="Las tasas se muestran como porcentajes. Montos, fuentes y tramos quedan congelados después de validar."
                >
                  <PayrollRuleConfigurationPanel key={`${selectedRule.id}-${selectedRule.revision}-${revisions[0]?.id ?? 'new'}`} rule={selectedRule} revisions={revisions} loading={configurationLoading} saving={saving} online={online} companyTaxProfile={companyTaxProfile} onUpload={uploadConfiguration} onReview={reviewConfiguration} />
                </HrSection>
              </div>
            )}
            aside={(
              <div className="hr-legal-selected-aside nm-legal-aside">
                <HrSection
                  className="hr-legal-rule-toolbar nm-legal-identity"
                  aria-label="Versión legal seleccionada"
                  eyebrow="Versión abierta"
                  title={`${selectedRule.name} · v${selectedRule.version}`}
                  description="Contexto vigente para todos los parámetros mostrados."
                >
                  <div className="nm-legal-identity-body">
                    <PayrollStatusPill status={selectedRule.status} />
                    <span className="nm-legal-dates"><CalendarDays size={15} aria-hidden="true" /> {formatLegalDate(selectedRule.effectiveFrom)} – {formatLegalDate(selectedRule.effectiveTo).toLocaleLowerCase()}</span>
                    <small>Fuente: {selectedRule.sourceReference}</small>
                    {selectedRule.activeConfigurationRevisionId && <Button type="button" size="sm" variant="secondary" disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(selectedRule); setCreateOpen(true); }}><Copy size={15} /> Clonar para editar</Button>}
                  </div>
                </HrSection>

                {!selectedProfileIsCurrent && <div className="nm-alert is-warning is-stacked" role="alert"><AlertTriangle size={20} aria-hidden="true" /><div><strong>El perfil fiscal de Empresa cambió después de validar esta versión.</strong><p>La versión activa conserva su copia histórica. Clónala para crear un borrador con el régimen y la retención vigentes.</p></div><Button variant="primary" type="button" size="sm" disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(selectedRule); setCreateOpen(true); }}><Copy size={15} /> Clonar ahora</Button></div>}

                <HrSection
                  className="nm-legal-lifecycle"
                  aria-labelledby="legal-lifecycle-title"
                  eyebrow="Estado de la versión"
                  title={<span id="legal-lifecycle-title">{lifecycleTitle}</span>}
                  description={lifecycleHelp}
                >
                  <dl className="nm-mini-facts">
                    <div><dt>Estado</dt><dd><PayrollStatusPill status={selectedRule.status} /></dd></div>
                    <div><dt>Revisión</dt><dd>{activeRevision ? `v${activeRevision.revision} · ${activeRevision.status === 'VALIDATED' ? 'validada' : activeRevision.status === 'UPLOADED' ? 'pendiente' : 'rechazada'}` : 'Sin revisión'}</dd></div>
                    <div><dt>Siguiente acción</dt><dd>{selectedRule.status === 'ACTIVE' ? 'Consultar o clonar' : validatedRevision ? 'Activar versión' : pendingRevision ? 'Emitir dictamen' : 'Guardar para revisión'}</dd></div>
                  </dl>
                </HrSection>

                <HrSection className="nm-legal-obligations" eyebrow="Resumen legal" title="Obligaciones configuradas">
                  <div className="nm-legal-summary">
                    <article><span>INSS</span><strong>{statutory ? `${(Number(statutory.inss.employeeRate) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}% laboral` : 'Pendiente'}</strong><small>{statutory ? `${statutory.inss.regime} · patronal ${(Number(statutory.inss.employerRateBelowThreshold) * 100).toLocaleString('es-NI')}% / ${(Number(statutory.inss.employerRateAtOrAboveThreshold) * 100).toLocaleString('es-NI')}%` : 'Sin revisión configurada'}</small></article>
                    <article><span>INATEC</span><strong>{statutory ? `${(Number(statutory.inatec.employerRate) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}% patronal` : 'Pendiente'}</strong><small>{statutory?.inatec.applicability === 'DOES_NOT_APPLY' ? 'Excepción documentada' : 'Costo de la empresa; no deduce al empleado'}</small></article>
                    <article><span>IR laboral</span><strong>{statutory ? `${statutory.incomeTax.brackets.length} tramos` : 'Pendiente'}</strong><small>{statutory?.companyTaxRegime.incomeTaxApplicability === 'DOES_NOT_APPLY' ? 'No aplica por régimen' : `Régimen ${statutory?.companyTaxRegime.code ?? 'pendiente'}`}</small></article>
                    <article><span>Uso en nómina</span><strong>{selectedRule.status === 'ACTIVE' ? 'En uso' : selectedRule.status === 'RETIRED' ? 'Retirada' : validatedRevision ? 'Lista para activar' : 'Aún no'}</strong><small>{activeRevision ? `Revisión ${activeRevision.revision} · ${activeRevision.status === 'VALIDATED' ? 'validada' : activeRevision.status === 'UPLOADED' ? 'en validación' : 'rechazada'}` : 'Requiere carga y validación'}</small></article>
                  </div>
                </HrSection>
              </div>
            )}
          />
        </section>
      </>}

      <FullScreenModal isOpen={createOpen} onClose={() => { if (!saving) { setCreateOpen(false); setCloneSource(null); } }} title={cloneSource ? 'Clonar como nuevo borrador' : 'Nueva versión legal de nómina'}><PayrollRuleForm key={cloneSource?.id ?? 'new'} initial={cloneSource ? { ...cloneSource, effectiveFrom: '', effectiveTo: null } : null} online={online} saving={saving} onSubmit={saveRule} onCancel={() => { setCreateOpen(false); setCloneSource(null); }} notice={cloneSource ? <div className="hr-payroll-info"><Copy size={18} /><span>Se copiarán tasas, tramos y conceptos. Define la nueva vigencia; el perfil fiscal se actualizará desde Empresa y la copia deberá validarse antes de activarse.</span></div> : undefined} /></FullScreenModal>
    </HrPage>
  );
}
