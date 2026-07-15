import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Landmark, Plus, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
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
} from '../../types/hr-payroll';
import './payroll.css';

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
  const [error, setError] = useState<string | null>(null);
  const requestedRuleId = searchParams.get('ruleId') || '';

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
      const requested = preferredId || requestedRuleId;
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
  }, [requestedRuleId]);

  useEffect(() => { void loadRules(); }, [loadRules]);

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
    if (!selectedRule) {
      setRevisions([]);
      return;
    }
    setSearchParams({ ruleId: String(selectedRule.id) }, { replace: true });
    void loadRevisions(selectedRule.id);
  }, [loadRevisions, selectedRule, setSearchParams]);

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
      showSuccess('Regla base creada. Ya puedes registrar INSS, INATEC e IR laboral.');
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
      await payrollClient.uploadRuleConfiguration(
        selectedRule.id,
        payload,
        createPayrollIdempotencyKey()
      );
      showSuccess('Configuración legal guardada como revisión inmutable.');
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
      await payrollClient.reviewRuleConfiguration(
        selectedRule.id,
        payload,
        createPayrollIdempotencyKey()
      );
      showSuccess(payload.decision === 'VALIDATED' ? 'Configuración legal validada.' : 'Configuración legal rechazada.');
      await refreshSelected(selectedRule.id);
    } catch (mutationError) {
      showError(getPayrollErrorMessage(mutationError, 'No fue posible registrar el dictamen.'));
    } finally {
      setSaving(false);
    }
  };

  const activeRevision = selectedRule
    ? revisions.find((revision) => revision.id === selectedRule.activeConfigurationRevisionId)
      ?? revisions.find((revision) => revision.status === 'VALIDATED')
      ?? revisions[0]
    : undefined;
  const statutory = activeRevision?.configuration.statutory;

  return (
    <div className="page-wrapper hr-payroll-page hr-legal-settings-page">
      <PageHeader
        title="IR laboral, INSS e INATEC"
        subtitle="Vista independiente para versionar tasas, tramos, fuentes y aplicabilidad legal de Nicaragua"
        icon={Landmark}
        actions={(
          <div className="hr-payroll-header-actions">
            <Button variant="ghost" onClick={() => void loadRules(selectedRuleId)} disabled={loading}>
              <RefreshCw size={16} /> Actualizar
            </Button>
            <Button onClick={() => setCreateOpen(true)} disabled={!online}>
              <Plus size={17} /> Nueva regla base
            </Button>
          </div>
        )}
      />

      <PayrollOnlineNotice online={online} />

      {loading && <LoadingSpinner text="Cargando configuración legal..." />}
      {!loading && error && (
        <div className="state-placeholder" role="alert">
          <AlertTriangle size={44} />
          <p className="state-error">{error}</p>
          <Button variant="ghost" onClick={() => void loadRules()}>Reintentar</Button>
        </div>
      )}

      {!loading && !error && rules.length === 0 && (
        <div className="hr-payroll-legal-empty hr-legal-empty-state">
          <Scale size={42} />
          <strong>No hay una regla base de nómina.</strong>
          <span>Crea la vigencia y su referencia normativa antes de cargar las tasas de INSS, INATEC y los tramos de IR laboral.</span>
          <Button onClick={() => setCreateOpen(true)} disabled={!online}>Crear regla base</Button>
        </div>
      )}

      {!loading && !error && selectedRule && (
        <>
          <section className="hr-legal-rule-toolbar" aria-label="Regla legal seleccionada">
            <label>
              Regla y vigencia
              <HrReactSelect
                value={selectedRuleId}
                onChange={(event) => setSelectedRuleId(event.target.value)}
                aria-label="Regla legal de nómina"
              >
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name} · v{rule.version} · {rule.status}
                  </option>
                ))}
              </HrReactSelect>
            </label>
            <div className="hr-legal-rule-meta">
              <PayrollStatusPill status={selectedRule.status} />
              <span>{selectedRule.effectiveFrom} – {selectedRule.effectiveTo ?? 'sin fecha fin'}</span>
              <small>Fuente: {selectedRule.sourceReference}</small>
            </div>
          </section>

          <div className="hr-legal-summary-grid">
            <article>
              <span>INSS</span>
              <strong>{statutory ? `${(Number(statutory.inss.employeeRate) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}% laboral` : 'Pendiente'}</strong>
              <small>{statutory ? `Régimen ${statutory.inss.regime}` : 'Sin revisión configurada'}</small>
            </article>
            <article>
              <span>INATEC</span>
              <strong>{statutory ? `${(Number(statutory.inatec.employerRate) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}% patronal` : 'Pendiente'}</strong>
              <small>{statutory?.inatec.applicability === 'DOES_NOT_APPLY' ? 'Excepción documentada' : 'Aplicación configurada'}</small>
            </article>
            <article>
              <span>IR laboral</span>
              <strong>{statutory ? `${statutory.incomeTax.brackets.length} tramos` : 'Pendiente'}</strong>
              <small>{statutory?.companyTaxRegime.incomeTaxApplicability === 'DOES_NOT_APPLY' ? 'No aplica por régimen' : 'Progresivo anual'}</small>
            </article>
            <article>
              <span>Control dual</span>
              <strong>{activeRevision?.status ?? 'Sin revisión'}</strong>
              <small>{activeRevision ? `Revisión ${activeRevision.revision}` : 'Requiere carga y validación'}</small>
            </article>
          </div>

          <section className="hr-legal-configuration-workspace">
            <div className="hr-legal-workspace-heading">
              <div>
                <ShieldCheck size={20} />
                <div><h2>Configuración paramétrica</h2><p>Los montos usan separadores de miles; tasas, fuentes y tramos quedan congelados por revisión.</p></div>
              </div>
            </div>
            <PayrollRuleConfigurationPanel
              key={`${selectedRule.id}-${selectedRule.revision}`}
              rule={selectedRule}
              revisions={revisions}
              loading={configurationLoading}
              saving={saving}
              online={online}
              onUpload={uploadConfiguration}
              onReview={reviewConfiguration}
            />
          </section>
        </>
      )}

      <Sidebar
        isOpen={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="Nueva regla legal de nómina"
        width="large"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <PayrollRuleForm
          online={online}
          saving={saving}
          onSubmit={saveRule}
          onCancel={() => setCreateOpen(false)}
        />
      </Sidebar>
    </div>
  );
}
