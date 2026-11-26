import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Plus, RefreshCw } from 'lucide-react';
import {
  AppSelect, Badge, Button, Field, FormSection, FullScreenModal, Input, LoadErrorState, PageContent, PageHeader, SegmentedControl, Switch, Textarea,
} from '@/ui';
import { HrSettingRow, HrSettingsBlock, HrSettingsSection } from '../../components/hr/HrSettingsSection';
import form from '../../components/hr/hrForm.module.css';
import HrLoading from '../../components/hr/HrLoading';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
import PendingBiometricEnrollmentsPanel from '../../components/hr/PendingBiometricEnrollmentsPanel';
import { attendanceClient, getAttendanceErrorMessage } from '../../components/hr/attendanceClient';
import {
  MIN_LOCATION_ACCURACY_M,
  validateAttendanceDevice,
  validateAttendancePolicy,
  validateBiometricRevocation,
} from '../../components/hr/attendanceSettingsRules';
import useWorkforceOnline from '../../components/hr/useWorkforceOnline';
import { useAppToast } from '../../context/ToastContext';
import type {
  HrAttendanceDevice,
  HrAttendanceDeviceCredential,
  HrAttendancePolicy,
  HrAttendancePolicyPayload,
  HrAttendanceSettingsLookups,
  HrAttendanceViolationMode,
  HrBiometricMaintenanceResult,
  HrBiometricProviderHealth,
  HrBiometricStatus,
} from '../../types/hr-attendance';

const EMPTY_LOOKUPS: HrAttendanceSettingsLookups = { branches: [], users: [] };
const MODES: Array<{ value: HrAttendanceViolationMode; label: string }> = [
  { value: 'BLOCK', label: 'Bloquear' },
  { value: 'REVIEW', label: 'Enviar a revisión' },
  { value: 'WARN', label: 'Advertir' },
];

function displayDateTime(value?: string | null): string {
  if (!value) return 'Nunca';
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function providerStatusLabel(status?: HrBiometricProviderHealth['status']): string {
  if (status === 'AVAILABLE') return 'Conexión disponible';
  if (status === 'UNAVAILABLE') return 'Conexión no disponible';
  return 'Sin verificar';
}

function policyPayload(policy: HrAttendancePolicy, branchId?: number): HrAttendancePolicyPayload {
  return {
    branchId: branchId ?? null,
    timezone: policy.timezone,
    requireBiometric: policy.requireBiometric,
    requireLiveness: policy.requireLiveness,
    requireGeolocation: policy.requireGeolocation,
    maxLocationAccuracyM: policy.maxLocationAccuracyM,
    earlyCheckInMinutes: policy.earlyCheckInMinutes,
    lateCheckInToleranceM: policy.lateCheckInToleranceM,
    earlyCheckOutToleranceM: policy.earlyCheckOutToleranceM,
    lateCheckOutMinutes: policy.lateCheckOutMinutes,
    scheduleViolationMode: policy.scheduleViolationMode,
    geofenceViolationMode: 'BLOCK',
    biometricViolationMode: 'BLOCK',
    allowUnscheduledPunch: policy.allowUnscheduledPunch,
    unscheduledViolationMode: policy.unscheduledViolationMode,
    allowManualFallback: policy.allowManualFallback,
    biometricConsentVersion: policy.biometricConsentVersion,
    biometricRetentionDays: policy.biometricRetentionDays,
    biometricRetentionNotice: policy.biometricRetentionNotice ?? null,
  };
}

export default function AttendanceSettings() {
  const online = useWorkforceOnline();
  const { success: showSuccess, error: showError } = useAppToast();
  const [scope, setScope] = useState('');
  const [scopeMode, setScopeMode] = useState<'COMPANY' | 'BRANCH'>('COMPANY');
  const [lookups, setLookups] = useState<HrAttendanceSettingsLookups>(EMPTY_LOOKUPS);
  const [policy, setPolicy] = useState<HrAttendancePolicy | null>(null);
  const [devices, setDevices] = useState<HrAttendanceDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [deviceForm, setDeviceForm] = useState({ branchId: '', name: '', code: '' });
  const [credential, setCredential] = useState<HrAttendanceDeviceCredential | null>(null);
  const [deviceToRevoke, setDeviceToRevoke] = useState<HrAttendanceDevice | null>(null);
  const [biometricUserId, setBiometricUserId] = useState('');
  const [biometricReason, setBiometricReason] = useState('');
  const [revokedStatus, setRevokedStatus] = useState<HrBiometricStatus | null>(null);
  const [maintenance, setMaintenance] = useState<HrBiometricMaintenanceResult | null>(null);
  const [providerHealth, setProviderHealth] = useState<HrBiometricProviderHealth | null>(null);
  const [providerHealthLoading, setProviderHealthLoading] = useState(false);

  const scopeBranchId = scope ? Number(scope) : undefined;
  const selectedBranch = lookups.branches.find((branch) => branch.id === scopeBranchId);
  const selectScopeMode = (nextMode: 'COMPANY' | 'BRANCH') => {
    setScopeMode(nextMode);
    if (nextMode === 'COMPANY') {
      setScope('');
      return;
    }
    setScope((current) => current || String(lookups.branches[0]?.id ?? ''));
  };
  const internalUsers = useMemo(
    () =>
      lookups.users.filter(
        (user) =>
          user.accountType === 'INTERNAL' || (user.accountType !== 'EXTERNAL' && user.employeeId)
      ),
    [lookups.users]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lookupResult, policyResult, deviceResult] = await Promise.all([
        attendanceClient.getSettingsLookups(),
        attendanceClient.getPolicy(scopeBranchId),
        attendanceClient.getDevices(scopeBranchId),
      ]);
      setLookups(lookupResult);
      setPolicy(policyResult);
      setDevices(deviceResult);
    } catch (loadError) {
      setPolicy(null);
      setDevices([]);
      setError(
        getAttendanceErrorMessage(
          loadError,
          'No fue posible cargar la configuración autoritativa de asistencia.'
        )
      );
    } finally {
      setLoading(false);
    }
  }, [scopeBranchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadProviderHealth = useCallback(async () => {
    setProviderHealthLoading(true);
    try {
      setProviderHealth(await attendanceClient.getBiometricProviderHealth());
    } catch (healthError) {
      setProviderHealth({ provider: 'unknown', model: 'unknown', status: 'UNAVAILABLE', checkedAt: new Date().toISOString(), detail: getAttendanceErrorMessage(healthError, 'No fue posible consultar el proveedor') });
    } finally {
      setProviderHealthLoading(false);
    }
  }, []);

  const updatePolicyField = <K extends keyof HrAttendancePolicy>(
    field: K,
    value: HrAttendancePolicy[K]
  ) => {
    setPolicy((current) => (current ? { ...current, [field]: value } : current));
  };

  const savePolicy = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!policy || !online) return;
    const payload = policyPayload(policy, scopeBranchId);
    const validationError = validateAttendancePolicy(payload);
    if (validationError) {
      setActionError(validationError);
      showError(validationError);
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const saved = await attendanceClient.updatePolicy(payload);
      setPolicy(saved);
      showSuccess(`Política v${saved.version} creada con trazabilidad.`);
    } catch (saveError) {
      const message = getAttendanceErrorMessage(saveError, 'No fue posible versionar la política.');
      setActionError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const openDevicePanel = () => {
    setDeviceForm({
      branchId: scopeBranchId ? String(scopeBranchId) : '',
      name: '',
      code: '',
    });
    setActionError(null);
    setDevicePanelOpen(true);
  };

  const createDevice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!online) return;
    const payload = {
      branchId: Number(deviceForm.branchId),
      name: deviceForm.name.trim(),
      code: deviceForm.code.trim(),
    };
    const validationError = validateAttendanceDevice(payload);
    if (validationError) {
      setActionError(validationError);
      showError(validationError);
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const created = await attendanceClient.createDevice(payload);
      setDevicePanelOpen(false);
      setCredential(created);
      setDevices(await attendanceClient.getDevices(scopeBranchId));
      showSuccess('Credencial creada. La clave se mostrará una sola vez.');
    } catch (createError) {
      const message = getAttendanceErrorMessage(
        createError,
        'No fue posible crear la credencial del dispositivo.'
      );
      setActionError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const revokeDevice = async () => {
    if (!deviceToRevoke || !online) return;
    setSaving(true);
    setActionError(null);
    try {
      await attendanceClient.revokeDevice(deviceToRevoke.id);
      setDevices(await attendanceClient.getDevices(scopeBranchId));
      setDeviceToRevoke(null);
      showSuccess('Dispositivo revocado. Su clave ya no debe aceptarse.');
    } catch (revokeError) {
      const message = getAttendanceErrorMessage(
        revokeError,
        'No fue posible revocar el dispositivo.'
      );
      setActionError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const revokeBiometrics = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!online) return;
    const userId = Number(biometricUserId);
    const validationError = validateBiometricRevocation(userId, biometricReason);
    if (validationError) {
      setActionError(validationError);
      showError(validationError);
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const profile = await attendanceClient.revokeUserBiometrics(userId, biometricReason.trim());
      setRevokedStatus(profile.status);
      setBiometricReason('');
      showSuccess('Revocación registrada y purga gestionada por el servidor.');
    } catch (revokeError) {
      const message = getAttendanceErrorMessage(
        revokeError,
        'No fue posible revocar el enrolamiento biométrico.'
      );
      setActionError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const runMaintenance = async () => {
    if (!online) return;
    setSaving(true);
    setActionError(null);
    try {
      const result = await attendanceClient.runBiometricMaintenance();
      setMaintenance(result);
      showSuccess('Mantenimiento de retención y purga ejecutado.');
    } catch (maintenanceError) {
      const message = getAttendanceErrorMessage(
        maintenanceError,
        'No fue posible ejecutar el mantenimiento biométrico.'
      );
      setActionError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const modeOptions = MODES.map((mode) => ({ value: String(mode.value), label: mode.label }));

  return (
    <PageContent>
      <PageHeader
        breadcrumb={['Recursos humanos', 'Asistencia']}
        title="Reglas para el marcaje"
        description="Decide qué debe comprobar cada empleado al marcar y qué hacer cuando algo falla"
        actions={<Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={loading}>Actualizar</Button>}
      />
      <OnlineOnlyNotice online={online} />

      <div className={form.scopeBar} role="group" aria-label="Alcance de configuración">
        <span className={form.cellSub}>Aplica a</span>
        <SegmentedControl<'COMPANY' | 'BRANCH'>
          ariaLabel="Tipo de alcance"
          options={[
            { value: 'COMPANY', label: 'Regla general' },
            ...(lookups.branches.length > 0 ? [{ value: 'BRANCH' as const, label: 'Por sucursal' }] : []),
          ]}
          value={scopeMode}
          onChange={selectScopeMode}
        />
        {scopeMode === 'BRANCH' && (
          <div className={form.scopeSelect}>
            <AppSelect<string>
              options={lookups.branches.map((branch) => ({ value: String(branch.id), label: branch.name }))}
              value={scope}
              onChange={(next) => setScope(next ?? '')}
              aria-label="Seleccionar sucursal para reglas de marcaje"
              isClearable={false}
            />
          </div>
        )}
        <span className={form.help}>
          {selectedBranch
            ? `Editando ${selectedBranch.name}. Al guardar se crea una versión exclusiva para esta sucursal.`
            : 'La regla general se hereda en todas las sucursales que no tengan una versión propia.'}
        </span>
      </div>

      {actionError && <div className={form.alertDanger} role="alert">{actionError}</div>}
      {loading && <HrLoading text="Cargando configuración de asistencia…" />}
      {!loading && error && <LoadErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && policy && (
        <>
          {scopeBranchId && policy.branchId !== scopeBranchId && (
            <div className={form.alertInfo} role="note">
              Esta sucursal hereda actualmente la política global. Guardar creará su primera versión específica.
            </div>
          )}

          <dl className={form.facts} aria-label="Resumen de política">
            <div><dt>Reglas vigentes</dt><dd>{policy.version === 0 ? 'Valores base' : `v${policy.version}`}</dd></div>
            <div><dt>Zona horaria</dt><dd>{policy.timezone}</dd></div>
            <div><dt>Aviso biométrico</dt><dd>{policy.biometricConsentVersion}</dd></div>
            <div><dt>Datos biométricos</dt><dd>{policy.biometricRetentionDays} días</dd></div>
          </dl>

          <form id="hr-attendance-policy-form" className={form.form} onSubmit={(event) => void savePolicy(event)}>
            <HrSettingsSection id="enforcement" group="Marcaje" title="Qué debe comprobar cada marcaje" description="Activa las comprobaciones y elige si una falla bloquea o se envía a revisión.">
              <HrSettingRow label="Reconocimiento facial requerido" description="Si el reconocimiento facial falla, se conserva el intento para que Recursos Humanos pueda revisarlo.">
                <Switch label={policy.requireBiometric ? 'Activo' : 'Inactivo'} checked={policy.requireBiometric} onChange={(checked) => updatePolicyField('requireBiometric', checked)} />
              </HrSettingRow>
              <HrSettingRow label="Prueba de vida requerida">
                <Switch label={policy.requireLiveness ? 'Activo' : 'Inactivo'} checked={policy.requireLiveness} onChange={(checked) => updatePolicyField('requireLiveness', checked)} />
              </HrSettingRow>
              <HrSettingRow label="Geolocalización requerida">
                <Switch label={policy.requireGeolocation ? 'Activo' : 'Inactivo'} checked={policy.requireGeolocation} onChange={(checked) => updatePolicyField('requireGeolocation', checked)} />
              </HrSettingRow>
              <HrSettingRow label="Permitir marcaje sin turno">
                <Switch label={policy.allowUnscheduledPunch ? 'Activo' : 'Inactivo'} checked={policy.allowUnscheduledPunch} onChange={(checked) => updatePolicyField('allowUnscheduledPunch', checked)} />
              </HrSettingRow>
              <HrSettingRow label="Permitir ajuste manual compensatorio">
                <Switch label={policy.allowManualFallback ? 'Activo' : 'Inactivo'} checked={policy.allowManualFallback} onChange={(checked) => updatePolicyField('allowManualFallback', checked)} />
              </HrSettingRow>
              <HrSettingRow label="Si marca fuera del horario" htmlFor="hr-policy-schedule-mode">
                <AppSelect<string>
                  inputId="hr-policy-schedule-mode"
                  options={modeOptions}
                  value={policy.scheduleViolationMode}
                  onChange={(next) => updatePolicyField('scheduleViolationMode', (next ?? '') as HrAttendanceViolationMode)}
                  isClearable={false}
                />
              </HrSettingRow>
              <HrSettingRow label="Marcaje sin turno" htmlFor="hr-policy-unscheduled-mode">
                <AppSelect<string>
                  inputId="hr-policy-unscheduled-mode"
                  options={modeOptions}
                  value={policy.unscheduledViolationMode}
                  onChange={(next) => updatePolicyField('unscheduledViolationMode', (next ?? '') as HrAttendanceViolationMode)}
                  isClearable={false}
                />
              </HrSettingRow>
              <HrSettingRow label="Si marca fuera del lugar permitido" description="Una ubicación fuera de geocerca requiere corrección auditada.">
                <span>Bloquear (obligatorio)</span>
              </HrSettingRow>
              <HrSettingRow label="Si no valida su identidad" description="Un rostro no coincidente nunca genera tiempo trabajado.">
                <span>Bloquear (obligatorio)</span>
              </HrSettingRow>
            </HrSettingsSection>

            <HrSettingsSection id="tolerances" group="Marcaje" title="Horarios permitidos y precisión GPS" description="Define cuántos minutos antes o después puede marcar y la precisión mínima de ubicación.">
              <HrSettingRow label="Entrada anticipada" htmlFor="hr-policy-early-in">
                <Input id="hr-policy-early-in" type="number" min={0} max={1440} step={1} suffix="min" className="ui-input--number" value={policy.earlyCheckInMinutes} onChange={(event) => updatePolicyField('earlyCheckInMinutes', Number(event.target.value))} required />
              </HrSettingRow>
              <HrSettingRow label="Tolerancia llegada tarde" htmlFor="hr-policy-late-in">
                <Input id="hr-policy-late-in" type="number" min={0} max={1440} step={1} suffix="min" className="ui-input--number" value={policy.lateCheckInToleranceM} onChange={(event) => updatePolicyField('lateCheckInToleranceM', Number(event.target.value))} required />
              </HrSettingRow>
              <HrSettingRow label="Salida anticipada" htmlFor="hr-policy-early-out">
                <Input id="hr-policy-early-out" type="number" min={0} max={1440} step={1} suffix="min" className="ui-input--number" value={policy.earlyCheckOutToleranceM} onChange={(event) => updatePolicyField('earlyCheckOutToleranceM', Number(event.target.value))} required />
              </HrSettingRow>
              <HrSettingRow label="Ventana posterior a la salida" htmlFor="hr-policy-late-out">
                <Input id="hr-policy-late-out" type="number" min={0} max={2880} step={1} suffix="min" className="ui-input--number" value={policy.lateCheckOutMinutes} onChange={(event) => updatePolicyField('lateCheckOutMinutes', Number(event.target.value))} required />
              </HrSettingRow>
              <HrSettingRow label="Precisión máxima GPS" htmlFor="hr-policy-gps">
                <Input id="hr-policy-gps" type="number" min={MIN_LOCATION_ACCURACY_M} max={5000} step={1} suffix="m" className="ui-input--number" value={policy.maxLocationAccuracyM} onChange={(event) => updatePolicyField('maxLocationAccuracyM', Number(event.target.value))} required />
              </HrSettingRow>
              <HrSettingRow label="Zona horaria" htmlFor="hr-policy-timezone" description={scopeBranchId ? 'Se administra en la sucursal.' : undefined}>
                <Input id="hr-policy-timezone" value={policy.timezone} maxLength={64} onChange={(event) => updatePolicyField('timezone', event.target.value)} disabled={Boolean(scopeBranchId)} required />
              </HrSettingRow>
            </HrSettingsSection>

            <HrSettingsSection id="retention" group="Biometría" title="Consentimiento y retención" description="Cambiar la versión obliga a que nuevos enrolamientos acepten ese texto.">
              <HrSettingRow label="Versión de consentimiento" htmlFor="hr-policy-consent" description={scopeBranchId ? 'El consentimiento es único por empresa; cámbielo en la regla general.' : undefined}>
                <Input id="hr-policy-consent" value={policy.biometricConsentVersion} maxLength={64} readOnly={Boolean(scopeBranchId)} onChange={(event) => updatePolicyField('biometricConsentVersion', event.target.value)} required />
              </HrSettingRow>
              <HrSettingRow label="Retención biométrica" htmlFor="hr-policy-retention">
                <Input id="hr-policy-retention" type="number" min={1} max={3650} step={1} suffix="días" className="ui-input--number" value={policy.biometricRetentionDays} onChange={(event) => updatePolicyField('biometricRetentionDays', Number(event.target.value))} required />
              </HrSettingRow>
              <HrSettingRow label="Aviso de retención" htmlFor="hr-policy-retention-notice">
                <Textarea id="hr-policy-retention-notice" rows={5} maxLength={5000} value={policy.biometricRetentionNotice ?? ''} onChange={(event) => updatePolicyField('biometricRetentionNotice', event.target.value || null)} />
              </HrSettingRow>
            </HrSettingsSection>

            <div className={form.saveBar} role="region" aria-label="Guardar reglas">
              <span className={form.help}>Al guardar, estas reglas quedan vigentes y la versión anterior se conserva en el historial.</span>
              <Button variant="primary" type="submit" loading={saving} disabled={!online}>Guardar y aplicar reglas</Button>
            </div>
          </form>

          <HrSettingsSection
            id="devices"
            group="Dispositivos"
            title="Credenciales de dispositivos"
            description="Inventario por sucursal; una revocación es irreversible para esa clave."
            actions={<Button variant="primary" size="sm" icon={Plus} onClick={openDevicePanel} disabled={!online}>Crear credencial</Button>}
          >
            <HrSettingsBlock>
              <div className={form.alertInfo} role="note">
                <strong>Kiosco no habilitado por esta credencial.</strong>{' '}
                Crear una clave no despliega ni activa un kiosco. Falta operar un cliente
                protegido, con almacenamiento seguro y canal administrado; el backend no expone un
                feature flag que permita afirmar que está activo.
              </div>
              {devices.length === 0 ? (
                <p className={form.help}>No hay dispositivos en este alcance.</p>
              ) : (
                <ul className={form.list}>
                  {devices.map((device) => (
                    <li key={device.id}>
                      <span className={form.cellStack}>
                        <span className={form.cellTitle}>{device.name}</span>
                        <span className={form.cellSub}>{device.code} · {device.branch?.name ?? `Sucursal #${device.branchId}`}</span>
                        <span className={form.cellSub}>
                          Última señal: {displayDateTime(device.lastSeenAt)}
                          {device.revokedAt ? ` · revocado ${displayDateTime(device.revokedAt)}` : ''}
                        </span>
                      </span>
                      <span className={form.actions}>
                        <Badge tone={device.status === 'ACTIVE' ? 'success' : 'neutral'} dot>{device.status === 'ACTIVE' ? 'Activo' : 'Revocado'}</Badge>
                        {device.status === 'ACTIVE' && (
                          <Button size="sm" variant="danger" icon={Ban} onClick={() => setDeviceToRevoke(device)} disabled={!online}>Revocar</Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </HrSettingsBlock>
          </HrSettingsSection>

          <PendingBiometricEnrollmentsPanel online={online} branchId={scopeBranchId} />

          <HrSettingsSection
            id="provider-health"
            group="Biometría"
            title="Conexión biométrica"
            description="Comprueba si el servicio facial configurado en el servidor responde."
            actions={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void loadProviderHealth()} disabled={!online || providerHealthLoading}>Verificar conexión</Button>}
          >
            <HrSettingsBlock>
              <p className={form.help} role="note">
                <strong>¿Qué es el proveedor biométrico?</strong>{' '}
                Es el servicio que compara de forma segura la captura facial durante el marcaje. No se elige ni se cambia desde esta pantalla: aquí solo se verifica la conexión configurada por el administrador del servidor.
              </p>
              <dl className={form.facts} aria-live="polite">
                <div><dt>Estado de conexión</dt><dd><Badge tone={providerHealth?.status === 'AVAILABLE' ? 'success' : providerHealth?.status === 'UNAVAILABLE' ? 'danger' : 'neutral'} dot>{providerHealthLoading ? 'Verificando…' : providerStatusLabel(providerHealth?.status)}</Badge></dd></div>
                <div><dt>Servicio configurado</dt><dd>{providerHealth ? `${providerHealth.provider} · ${providerHealth.model}` : '—'}</dd></div>
                <div><dt>Revisado</dt><dd>{providerHealth ? displayDateTime(providerHealth.checkedAt) : '—'}</dd></div>
              </dl>
              {providerHealth?.detail && <p className={form.help}>{providerHealth.detail}</p>}
            </HrSettingsBlock>
          </HrSettingsSection>

          <HrSettingsSection id="revoke-biometric" group="Biometría" title="Revocar biometría" description="La revocación elimina la referencia local y programa la purga del proveedor.">
            <form onSubmit={(event) => void revokeBiometrics(event)} aria-label="Revocar biometría">
              <HrSettingRow label="Usuario interno" htmlFor="hr-revoke-user">
                <AppSelect<string>
                  inputId="hr-revoke-user"
                  options={internalUsers.map((user) => ({ value: String(user.id), label: `${user.name} · ${user.username}` }))}
                  value={biometricUserId || null}
                  placeholder="Seleccionar…"
                  onChange={(next) => {
                    setBiometricUserId(next ?? '');
                    setRevokedStatus(null);
                  }}
                  isClearable={false}
                />
              </HrSettingRow>
              <HrSettingRow label="Razón obligatoria" htmlFor="hr-revoke-reason" description="Esta vista no consulta, recibe ni muestra plantillas, imágenes o referencias del proveedor biométrico.">
                <Textarea id="hr-revoke-reason" rows={4} minLength={3} maxLength={500} value={biometricReason} onChange={(event) => setBiometricReason(event.target.value)} required />
              </HrSettingRow>
              <HrSettingsBlock>
                {revokedStatus && (
                  <p className={form.alertSuccess} role="status">
                    Estado seguro devuelto por el servidor: <strong>{revokedStatus}</strong>
                  </p>
                )}
                <div className={form.actionsEnd}>
                  <Button type="submit" variant="danger" icon={Ban} disabled={!online || saving}>Revocar enrolamiento</Button>
                </div>
              </HrSettingsBlock>
            </form>
          </HrSettingsSection>

          <HrSettingsSection
            id="maintenance"
            group="Biometría"
            title="Retención y outbox de purga"
            description="Procesa vencimientos y reintentos pendientes hasta el límite del servidor."
            actions={<Button variant="primary" size="sm" icon={RefreshCw} onClick={() => void runMaintenance()} disabled={!online || saving}>Ejecutar mantenimiento</Button>}
          >
            <HrSettingsBlock>
              <p className={form.help}>
                La ejecución es auditable. Los fallos del proveedor permanecen pendientes para
                reintento; la pantalla no los presenta como purgas completadas.
              </p>
              {maintenance && (
                <dl className={form.facts} aria-live="polite">
                  <div><dt>Perfiles vencidos revocados</dt><dd>{maintenance.expiredProfilesRevoked}</dd></div>
                  <div><dt>Plantillas purgadas</dt><dd>{maintenance.providerTemplatesPurged}</dd></div>
                  <div><dt>Pendientes evaluados</dt><dd>{maintenance.pendingChecked}</dd></div>
                </dl>
              )}
            </HrSettingsBlock>
          </HrSettingsSection>
        </>
      )}

      <FullScreenModal
        isOpen={devicePanelOpen}
        onClose={() => !saving && setDevicePanelOpen(false)}
        breadcrumb={['Recursos humanos', 'Reglas para el marcaje']}
        title="Crear credencial de dispositivo"
      >
        <HrModalFormShell
          ariaLabel="Sección de credencial de dispositivo"
          tabLabel="Dispositivo"
          sectionTitle="Sucursal e identidad operativa"
          notice={<OnlineOnlyNotice online={online} compact />}
          onSubmit={(event) => void createDevice(event)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setDevicePanelOpen(false)}>Cancelar</Button>
              <Button variant="primary" type="submit" loading={saving} disabled={!online}>Crear y mostrar clave</Button>
            </>
          }
        >
          <div className={`${form.alertWarning} span-full`}>La credencial no habilita un kiosco ni sustituye un cliente protegido.</div>
          <Field label="Sucursal" htmlFor="hr-device-branch" required>
            <AppSelect<string>
              inputId="hr-device-branch"
              options={lookups.branches.map((branch) => ({ value: String(branch.id), label: branch.name }))}
              value={deviceForm.branchId || null}
              placeholder="Seleccionar…"
              onChange={(next) => setDeviceForm((current) => ({ ...current, branchId: next ?? '' }))}
              isClearable={false}
            />
          </Field>
          <Field label="Nombre descriptivo" htmlFor="hr-device-name" required>
            <Input id="hr-device-name" value={deviceForm.name} maxLength={100} onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Tablet acceso principal" required />
          </Field>
          <Field label="Código operativo" htmlFor="hr-device-code" required>
            <Input id="hr-device-code" value={deviceForm.code} maxLength={50} onChange={(event) => setDeviceForm((current) => ({ ...current, code: event.target.value }))} placeholder="ENTRADA-01" required />
          </Field>
        </HrModalFormShell>
      </FullScreenModal>
      <FullScreenModal
        isOpen={Boolean(credential)}
        onClose={() => setCredential(null)}
        title="Clave mostrada una sola vez"
        dirty
        dirtyMessage="La clave se muestra una sola vez y el servidor no volverá a entregarla. Si cierras sin guardarla tendrás que generar otra."
        footer={<Button variant="primary" onClick={() => setCredential(null)}>Ya guardé la clave; cerrar definitivamente</Button>}
      >
        {credential && (
          <div className="hr-attendance-sensitive-modal">
            <FormSection title="Custodia inmediata de la credencial">
              <div className={form.alertWarning}>
                Guarda la clave ahora en el mecanismo seguro del cliente administrado. Al cerrar se elimina de esta memoria de pantalla y el servidor no volverá a entregarla.
              </div>
              <dl className={form.facts}>
                <div><dt>Dispositivo</dt><dd>{credential.name}</dd></div>
                <div><dt>ID público</dt><dd>{credential.id}</dd></div>
                <div><dt>Código</dt><dd>{credential.code}</dd></div>
              </dl>
              <Field label="Clave secreta" htmlFor="hr-device-secret">
                <code id="hr-device-secret" className={form.secret}>{credential.key}</code>
              </Field>
              <p className={form.help}>La clave por sí sola no significa que el kiosco esté desplegado o habilitado.</p>
            </FormSection>
          </div>
        )}
      </FullScreenModal>
      <FullScreenModal
        isOpen={Boolean(deviceToRevoke)}
        onClose={() => !saving && setDeviceToRevoke(null)}
        title="Revocar dispositivo"
      >
        {deviceToRevoke && (
          <HrModalFormShell
            ariaLabel="Sección de revocación de dispositivo"
            tabLabel="Revocación"
            sectionTitle="Confirmación de seguridad"
            notice={<OnlineOnlyNotice online={online} compact />}
            onSubmit={(event) => { event.preventDefault(); void revokeDevice(); }}
            footer={
              <>
                <Button type="button" variant="ghost" onClick={() => setDeviceToRevoke(null)} disabled={saving}>Cancelar</Button>
                <Button type="submit" variant="danger" loading={saving} disabled={!online}>Confirmar revocación</Button>
              </>
            }
          >
            <div className={`${form.alertDanger} span-full`}>
              {deviceToRevoke.name} ({deviceToRevoke.code}) dejará de autenticar solicitudes.
            </div>
            <p className={`${form.help} span-full`}>
              Para volver a provisionar el equipo tendrás que crear otra credencial y custodiar su nueva clave.
            </p>
          </HrModalFormShell>
        )}
      </FullScreenModal>
    </PageContent>
  );
}
