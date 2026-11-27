import {
  Badge, Button, Checkbox, DataTable, EmptyState, Field, FormSection, FullScreenModal, IconButton, Input, LoadErrorState, PageContent, PageHeader, formatPercent} from '@/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Copy,
  Eye,
  LockKeyhole,
  Plus,
  RefreshCw,
  Scale,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import HrLoading from '../../components/hr/HrLoading';
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
import { HrModalFooterSlot } from '../../components/hr/HrModalFormShell';
import form from '../../components/hr/hrForm.module.css';

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
  const navigate = useNavigate();
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
  const lifecycleTitle = selectedRule
    ? selectedRule.status === 'ACTIVE' ? 'Activa en nómina' : selectedRule.status === 'RETIRED' ? 'Retirada' : validatedRevision ? 'Validada, lista para activar' : pendingRevision ? 'Esperando revisión independiente' : 'Borrador editable'
    : '';
  const lifecycleHelp = selectedRule
    ? selectedRule.status === 'ACTIVE' ? 'Participa en los cálculos cuya fecha cae dentro de su vigencia.' : validatedRevision ? 'Los parámetros ya están congelados. Confirma la vigencia para activarla.' : pendingRevision ? 'Otra persona debe aprobar o rechazar la revisión cargada.' : 'Configura tasas, tramos y conceptos; luego envíalos a revisión.'
    : '';

  return (
    <PageContent>
      <PageHeader
        breadcrumb={['Recursos humanos', 'Nómina']}
        title="IR laboral, INSS e INATEC"
        description="Configura qué se retiene al empleado, qué aporta la empresa y desde cuándo se aplican esas reglas"
        actions={(
          <>
            <Button variant="ghost" icon={RefreshCw} onClick={() => void loadRules(selectedRuleId)} disabled={loading}>Actualizar</Button>
            <Button variant="primary" icon={Plus} onClick={() => { setCloneSource(null); setCreateOpen(true); }} disabled={!online || !companyTaxProfile?.ready}>Nueva versión</Button>
          </>
        )}
      />

      {!online && <PayrollOnlineNotice online={online} />}

      {showCommandCenter && companyTaxProfile && (
        <section className={form.panel} aria-label="Centro de control legal de nómina">
          <div className={form.panelHead}>
            <div className={form.cellStack}>
              <span className={form.cellSub}>Centro de control legal · {companyTaxProfile.companyName}</span>
              <p className={form.help}>Administra en un solo flujo el perfil fiscal, las vigencias y los parámetros congelados que utiliza cada nómina.</p>
            </div>
            <Button onClick={() => navigate('/companies')}>Editar perfil fiscal</Button>
          </div>
          <dl className={form.facts}>
            <div><dt>Régimen DGI</dt><dd>{regimeLabel}</dd><dd className={form.cellSub}>{companyTaxProfile.incomeTaxWithholding ? 'Retiene IR laboral' : 'No retiene IR laboral'}</dd></div>
            <div><dt>Perfil maestro</dt><dd><Badge tone={companyTaxProfile.ready ? 'success' : 'warning'} dot>{companyTaxProfile.ready ? 'Confirmado' : 'Pendiente'}</Badge></dd><dd className={form.cellSub}>Fuente para nuevas versiones</dd></div>
            <div><dt>Versión activa</dt><dd>{activeRule ? `v${activeRule.version}` : 'Sin activar'}</dd><dd className={form.cellSub}>{activeRule?.name ?? 'Requiere configuración validada'}</dd></div>
          </dl>
        </section>
      )}

      {loading && <HrLoading text="Cargando configuración legal…" />}
      {!loading && error && <LoadErrorState message={error} onRetry={() => void loadRules()} />}
      {!loading && !error && rules.length === 0 && (
        <EmptyState
          icon={Scale}
          title="No hay una versión legal de nómina."
          description="Crea una vigencia para luego configurar tasas de INSS, INATEC y tramos de IR laboral."
          action={<Button variant="primary" onClick={() => { setCloneSource(null); setCreateOpen(true); }} disabled={!online || !companyTaxProfile?.ready}>Crear primera versión</Button>}
        />
      )}

      {!loading && !error && companyTaxProfile && !companyTaxProfile.ready && (
        <div className={`${form.alertWarning} ${form.actions}`} role="alert">
          <span><strong>El perfil fiscal de la empresa está pendiente.</strong> Confirma régimen, retención de IR y respaldo en Empresas. Hasta entonces no se pueden validar reglas ni iniciar nuevas corridas.</span>
          <Button variant="primary" onClick={() => navigate('/companies')}>Completar perfil</Button>
        </div>
      )}

      {!loading && !error && selectedRule && companyTaxProfile && <>
        <FormSection title={`Versiones legales (${rules.length})`} description="Abre una fila para consultar. Para modificar una versión activa, clónala como borrador.">
          <DataTable
            ariaLabel="Versiones legales"
            rows={rules}
            rowKey={(rule) => rule.id}
            pagination={{ mode: 'client' }}
            minWidth="40rem"
            rowTone={(rule) => (String(rule.id) === selectedRuleId ? 'primary' : undefined)}
            onRowClick={(rule) => { setSelectedRuleId(String(rule.id)); setSearchParams({ ruleId: String(rule.id) }, { replace: true }); }}
            empty={<EmptyState title="Sin versiones" />}
            columns={[
              { key: 'version', header: 'Versión', render: (rule) => <span className={form.cellStack}><span className={form.cellSub}>Versión {rule.version}</span><span className={form.cellTitle}>{rule.name}</span></span> },
              { key: 'validity', header: 'Vigencia', render: (rule) => <span className={form.cellStack}><span className={form.cellTitle}>{formatLegalDate(rule.effectiveFrom)}</span><span className={form.cellSub}>Hasta {formatLegalDate(rule.effectiveTo).toLocaleLowerCase()}</span></span> },
              { key: 'status', header: 'Estado', render: (rule) => <PayrollStatusPill status={rule.status} /> },
              { key: 'configuration', header: 'Configuración', render: (rule) => <span className={form.cellStack}><span className={form.cellTitle}>{rule.configurationSummary ? 'Configurada' : 'Pendiente'}</span><span className={form.cellSub}>{rule.configurationSummary || 'Sin revisión validada'}</span></span> },
              {
                key: 'actions',
                header: 'Acciones',
                width: '100px',
                type: 'actions',
                render: (rule) => {
                  const isSelected = String(rule.id) === selectedRuleId;
                  return <div className={form.rowActions}><IconButton size="sm" icon={Eye} tone={isSelected ? 'primary' : 'default'} tooltip={isSelected ? 'Abierta' : 'Abrir'} label={`Abrir ${rule.name}`} aria-pressed={isSelected} onClick={() => { setSelectedRuleId(String(rule.id)); setSearchParams({ ruleId: String(rule.id) }, { replace: true }); }} />{rule.activeConfigurationRevisionId && <IconButton size="sm" icon={Copy} tooltip="Duplicar" label={`Clonar ${rule.name} para editar`} disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(rule); setCreateOpen(true); }} />}</div>;
                },
              },
            ]}
          />
        </FormSection>

        <section className={form.split} aria-label="Espacio de trabajo de la versión abierta">
          <div className={form.stack}>
            {selectedRule.status === 'DRAFT' && validatedRevision && (
              <section className={form.panel} aria-labelledby="legal-activation-title">
                <FormSection title="Activar esta versión" description={`Al activarla, las nuevas corridas con fecha dentro de ${selectedRule.effectiveFrom} – ${selectedRule.effectiveTo ?? 'sin fecha fin'} podrán usar estos parámetros.`}>
                  <span id="legal-activation-title" className="sr-only">Activar esta versión</span>
                  <Field label="Motivo de activación" htmlFor="legal-activation-reason" required>
                    <Input id="legal-activation-reason" value={activationReason} onChange={(event) => setActivationReason(event.target.value)} maxLength={900} />
                  </Field>
                  <Checkbox checked={activationConfirmed} onChange={(event) => setActivationConfirmed(event.target.checked)} label={<span>Confirmo la vigencia y que esta versión debe quedar disponible para calcular nómina.</span>} />
                  <div className={form.actionsEnd}>
                    <Button variant="primary" icon={LockKeyhole} loading={saving} onClick={() => void activateRule()} disabled={!online || !activationConfirmed || activationReason.trim().length < 3}>Activar versión legal</Button>
                  </div>
                </FormSection>
              </section>
            )}

            <section aria-label="Parámetros de la versión">
              <FormSection title="Parámetros de la versión" description="Las tasas se muestran como porcentajes. Montos, fuentes y tramos quedan congelados después de validar.">
                <PayrollRuleConfigurationPanel key={`${selectedRule.id}-${selectedRule.revision}-${revisions[0]?.id ?? 'new'}`} rule={selectedRule} revisions={revisions} loading={configurationLoading} saving={saving} online={online} companyTaxProfile={companyTaxProfile} onUpload={uploadConfiguration} onReview={reviewConfiguration} />
              </FormSection>
            </section>
          </div>

          <aside className={form.panel} aria-label="Versión legal seleccionada">
            <div className={form.stack}>
              <span className={form.cellSub}>Versión abierta</span>
              <h2 className={form.panelTitle}>{selectedRule.name} · v{selectedRule.version}</h2>
              <span className={form.actions}>
                <PayrollStatusPill status={selectedRule.status} />
                <span className={form.cellSub}><CalendarDays size={14} aria-hidden="true" /> {formatLegalDate(selectedRule.effectiveFrom)} – {formatLegalDate(selectedRule.effectiveTo).toLocaleLowerCase()}</span>
              </span>
              <span className={form.cellSub}>Fuente: {selectedRule.sourceReference}</span>
              {selectedRule.activeConfigurationRevisionId && <div><Button type="button" icon={Copy} disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(selectedRule); setCreateOpen(true); }}>Clonar para editar</Button></div>}
            </div>

            {!selectedProfileIsCurrent && (
              <div className={form.alertWarning} role="alert">
                <strong>El perfil fiscal de Empresa cambió después de validar esta versión.</strong> La versión activa conserva su copia histórica. Clónala para crear un borrador con el régimen y la retención vigentes.
                <div className={form.actions}>
                  <Button variant="primary" type="button" icon={Copy} disabled={!companyTaxProfile.ready} onClick={() => { setCloneSource(selectedRule); setCreateOpen(true); }}>Clonar ahora</Button>
                </div>
              </div>
            )}

            <FormSection title={lifecycleTitle} description={lifecycleHelp}>
              <dl className={form.facts}>
                <div><dt>Revisión</dt><dd>{activeRevision ? `v${activeRevision.revision} · ${activeRevision.status === 'VALIDATED' ? 'validada' : activeRevision.status === 'UPLOADED' ? 'pendiente' : 'rechazada'}` : 'Sin revisión'}</dd></div>
                <div><dt>Siguiente acción</dt><dd>{selectedRule.status === 'ACTIVE' ? 'Consultar o clonar' : validatedRevision ? 'Activar versión' : pendingRevision ? 'Emitir dictamen' : 'Guardar para revisión'}</dd></div>
              </dl>
            </FormSection>

            <FormSection title="Obligaciones configuradas">
              <dl className={form.facts}>
                <div><dt>INSS</dt><dd>{statutory ? `${formatPercent(Number(statutory.inss.employeeRate) * 100)} laboral` : 'Pendiente'}</dd><dd className={form.cellSub}>{statutory ? `${statutory.inss.regime} · patronal ${formatPercent(Number(statutory.inss.employerRateBelowThreshold) * 100)} / ${formatPercent(Number(statutory.inss.employerRateAtOrAboveThreshold) * 100)}` : 'Sin revisión configurada'}</dd></div>
                <div><dt>INATEC</dt><dd>{statutory ? `${formatPercent(Number(statutory.inatec.employerRate) * 100)} patronal` : 'Pendiente'}</dd><dd className={form.cellSub}>{statutory?.inatec.applicability === 'DOES_NOT_APPLY' ? 'Excepción documentada' : 'Costo de la empresa; no deduce al empleado'}</dd></div>
                <div><dt>IR laboral</dt><dd>{statutory ? `${statutory.incomeTax.brackets.length} tramos` : 'Pendiente'}</dd><dd className={form.cellSub}>{statutory?.companyTaxRegime.incomeTaxApplicability === 'DOES_NOT_APPLY' ? 'No aplica por régimen' : `Régimen ${statutory?.companyTaxRegime.code ?? 'pendiente'}`}</dd></div>
                <div><dt>Uso en nómina</dt><dd>{selectedRule.status === 'ACTIVE' ? 'En uso' : selectedRule.status === 'RETIRED' ? 'Retirada' : validatedRevision ? 'Lista para activar' : 'Aún no'}</dd><dd className={form.cellSub}>{activeRevision ? `Revisión ${activeRevision.revision} · ${activeRevision.status === 'VALIDATED' ? 'validada' : activeRevision.status === 'UPLOADED' ? 'en validación' : 'rechazada'}` : 'Requiere carga y validación'}</dd></div>
              </dl>
            </FormSection>
          </aside>
        </section>
      </>}

      <FullScreenModal footer={<HrModalFooterSlot />} isOpen={createOpen} onClose={() => { if (!saving) { setCreateOpen(false); setCloneSource(null); } }} breadcrumb={['Recursos humanos', 'Nómina', 'Configuración legal']} title={cloneSource ? 'Clonar como nuevo borrador' : 'Nueva versión legal de nómina'}><PayrollRuleForm key={cloneSource?.id ?? 'new'} initial={cloneSource ? { ...cloneSource, effectiveFrom: '', effectiveTo: null } : null} online={online} saving={saving} onSubmit={saveRule} onCancel={() => { setCreateOpen(false); setCloneSource(null); }} notice={cloneSource ? <div className={form.alertInfo}>Se copiarán tasas, tramos y conceptos. Define la nueva vigencia; el perfil fiscal se actualizará desde Empresa y la copia deberá validarse antes de activarse.</div> : undefined} /></FullScreenModal>
    </PageContent>
  );
}
