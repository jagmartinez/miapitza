import HrReactSelect from '../../components/hr/HrReactSelect';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Clock3,
  DatabaseZap,
  KeyRound,
  LockKeyhole,
  MapPin,
  Plus,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  TabletSmartphone,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
import { attendanceClient, getAttendanceErrorMessage } from '../../components/hr/attendanceClient';
import {
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
import './attendance-settings.css';

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
    geofenceViolationMode: policy.geofenceViolationMode,
    biometricViolationMode: policy.biometricViolationMode,
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

  return (
    <div className="page-wrapper hr-attendance-settings-page">
      <PageHeader
        title="Reglas para el marcaje"
        subtitle="Decide qué debe comprobar cada empleado al marcar y qué hacer cuando algo falla"
        icon={ShieldCheck}
        actions={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={17} /> Actualizar
          </Button>
        }
      />
      <OnlineOnlyNotice online={online} />

      <section className="hr-settings-scope" aria-label="Alcance de configuración">
        <label>
          Aplicar estas reglas a
          <HrReactSelect value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">Toda la empresa</option>
            {lookups.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </HrReactSelect>
        </label>
        <p>
          {selectedBranch
            ? `Administrando ${selectedBranch.name}. La zona horaria procede de la sucursal.`
            : 'La política global es la base para sucursales sin una versión propia.'}
        </p>
      </section>

      {actionError && (
        <div className="hr-attendance-alert danger" role="alert">
          <AlertTriangle size={18} />
          <span>{actionError}</span>
        </div>
      )}
      {loading && <LoadingSpinner text="Cargando configuración de asistencia…" />}
      {!loading && error && (
        <div className="state-placeholder" role="alert">
          <AlertTriangle size={42} />
          <p className="state-error">{error}</p>
          <Button variant="ghost" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      )}

      {!loading && !error && policy && (
        <>
          {scopeBranchId && policy.branchId !== scopeBranchId && (
            <div className="hr-settings-inherited" role="note">
              <ShieldCheck size={18} />
              <span>
                Esta sucursal hereda actualmente la política global. Guardar creará su primera
                versión específica.
              </span>
            </div>
          )}

          <section className="hr-settings-summary" aria-label="Resumen de política">
            <article>
              <ShieldCheck size={20} />
              <span>Reglas vigentes</span>
              <strong>{policy.version === 0 ? 'Valores base' : `v${policy.version}`}</strong>
            </article>
            <article>
              <MapPin size={20} />
              <span>Zona horaria</span>
              <strong>{policy.timezone}</strong>
            </article>
            <article>
              <ScanFace size={20} />
              <span>Aviso biométrico</span>
              <strong>{policy.biometricConsentVersion}</strong>
            </article>
            <article>
              <Clock3 size={20} />
              <span>Datos biométricos</span>
              <strong>{policy.biometricRetentionDays} días</strong>
            </article>
          </section>

          <form className="hr-settings-policy" onSubmit={(event) => void savePolicy(event)}>
            <section className="hr-settings-card" aria-labelledby="enforcement-title">
              <header>
                <div>
                  <h2 id="enforcement-title">Qué debe comprobar cada marcaje</h2>
                  <p>Activa las comprobaciones y elige si una falla bloquea o se envía a revisión.</p>
                </div>
                <ScanFace size={22} />
              </header>
              <div className="hr-settings-check-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={policy.requireBiometric}
                    onChange={(event) =>
                      updatePolicyField('requireBiometric', event.target.checked)
                    }
                  />
                  Reconocimiento facial requerido
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={policy.requireLiveness}
                    onChange={(event) => updatePolicyField('requireLiveness', event.target.checked)}
                  />
                  Prueba de vida requerida
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={policy.requireGeolocation}
                    onChange={(event) =>
                      updatePolicyField('requireGeolocation', event.target.checked)
                    }
                  />
                  Geolocalización requerida
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={policy.allowUnscheduledPunch}
                    onChange={(event) =>
                      updatePolicyField('allowUnscheduledPunch', event.target.checked)
                    }
                  />
                  Permitir marcaje sin turno
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={policy.allowManualFallback}
                    onChange={(event) =>
                      updatePolicyField('allowManualFallback', event.target.checked)
                    }
                  />
                  Permitir ajuste manual compensatorio
                </label>
              </div>
              <div className="hr-settings-fields three-columns">
                <label>
                  Si marca fuera del horario
                  <HrReactSelect
                    value={policy.scheduleViolationMode}
                    onChange={(event) =>
                      updatePolicyField(
                        'scheduleViolationMode',
                        event.target.value as HrAttendanceViolationMode
                      )
                    }
                  >
                    {MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </HrReactSelect>
                </label>
                <label>
                  Si marca fuera del lugar permitido
                  <HrReactSelect
                    value={policy.geofenceViolationMode}
                    onChange={(event) =>
                      updatePolicyField(
                        'geofenceViolationMode',
                        event.target.value as HrAttendanceViolationMode
                      )
                    }
                  >
                    {MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </HrReactSelect>
                </label>
                <label>
                  Si no valida su identidad
                  <HrReactSelect
                    value={policy.biometricViolationMode}
                    onChange={(event) =>
                      updatePolicyField(
                        'biometricViolationMode',
                        event.target.value as HrAttendanceViolationMode
                      )
                    }
                  >
                    {MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </HrReactSelect>
                </label>
                <label>
                  Marcaje sin turno
                  <HrReactSelect
                    value={policy.unscheduledViolationMode}
                    onChange={(event) =>
                      updatePolicyField(
                        'unscheduledViolationMode',
                        event.target.value as HrAttendanceViolationMode
                      )
                    }
                  >
                    {MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </HrReactSelect>
                </label>
              </div>
              <p className="hr-form-help">
                Si el reconocimiento facial falla, se conserva el intento para que Recursos Humanos pueda revisarlo.
              </p>
            </section>

            <section className="hr-settings-card" aria-labelledby="tolerances-title">
              <header>
                <div>
                  <h2 id="tolerances-title">Horarios permitidos y precisión GPS</h2>
                  <p>Define cuántos minutos antes o después puede marcar y la precisión mínima de ubicación.</p>
                </div>
                <Clock3 size={22} />
              </header>
              <div className="hr-settings-fields three-columns">
                <label>
                  Entrada anticipada (min)
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    value={policy.earlyCheckInMinutes}
                    onChange={(event) =>
                      updatePolicyField('earlyCheckInMinutes', Number(event.target.value))
                    }
                    required
                  />
                </label>
                <label>
                  Tolerancia llegada tarde (min)
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    value={policy.lateCheckInToleranceM}
                    onChange={(event) =>
                      updatePolicyField('lateCheckInToleranceM', Number(event.target.value))
                    }
                    required
                  />
                </label>
                <label>
                  Salida anticipada (min)
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    value={policy.earlyCheckOutToleranceM}
                    onChange={(event) =>
                      updatePolicyField('earlyCheckOutToleranceM', Number(event.target.value))
                    }
                    required
                  />
                </label>
                <label>
                  Ventana posterior salida (min)
                  <input
                    type="number"
                    min={0}
                    max={2880}
                    step={1}
                    value={policy.lateCheckOutMinutes}
                    onChange={(event) =>
                      updatePolicyField('lateCheckOutMinutes', Number(event.target.value))
                    }
                    required
                  />
                </label>
                <label>
                  Precisión máxima GPS (m)
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    step={1}
                    value={policy.maxLocationAccuracyM}
                    onChange={(event) =>
                      updatePolicyField('maxLocationAccuracyM', Number(event.target.value))
                    }
                    required
                  />
                </label>
                <label>
                  Zona horaria
                  <input
                    value={policy.timezone}
                    maxLength={64}
                    onChange={(event) => updatePolicyField('timezone', event.target.value)}
                    disabled={Boolean(scopeBranchId)}
                    required
                  />
                  {scopeBranchId && <small>Se administra en la sucursal.</small>}
                </label>
              </div>
            </section>

            <section className="hr-settings-card" aria-labelledby="retention-title">
              <header>
                <div>
                  <h2 id="retention-title">Consentimiento y retención</h2>
                  <p>Cambiar la versión obliga a que nuevos enrolamientos acepten ese texto.</p>
                </div>
                <DatabaseZap size={22} />
              </header>
              <div className="hr-settings-fields two-columns">
                <label>
                  Versión de consentimiento
                  <input
                    value={policy.biometricConsentVersion}
                    maxLength={64}
                    onChange={(event) =>
                      updatePolicyField('biometricConsentVersion', event.target.value)
                    }
                    required
                  />
                </label>
                <label>
                  Retención biométrica (días)
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={policy.biometricRetentionDays}
                    onChange={(event) =>
                      updatePolicyField('biometricRetentionDays', Number(event.target.value))
                    }
                    required
                  />
                </label>
                <label className="span-full">
                  Aviso de retención
                  <textarea
                    rows={5}
                    maxLength={5000}
                    value={policy.biometricRetentionNotice ?? ''}
                    onChange={(event) =>
                      updatePolicyField('biometricRetentionNotice', event.target.value || null)
                    }
                  />
                </label>
              </div>
            </section>

            <div className="hr-settings-savebar">
              <p>Al guardar, estas reglas quedan vigentes y la versión anterior se conserva en el historial.</p>
              <Button type="submit" disabled={!online || saving}>
                {saving ? 'Guardando reglas…' : 'Guardar y aplicar reglas'}
              </Button>
            </div>
          </form>

          <section className="hr-settings-card hr-device-section" aria-labelledby="devices-title">
            <header>
              <div>
                <h2 id="devices-title">Credenciales de dispositivos</h2>
                <p>Inventario por sucursal; una revocación es irreversible para esa clave.</p>
              </div>
              <Button size="sm" onClick={openDevicePanel} disabled={!online}>
                <Plus size={16} /> Crear credencial
              </Button>
            </header>
            <div className="hr-kiosk-gate" role="note">
              <LockKeyhole size={20} />
              <div>
                <strong>Kiosco no habilitado por esta credencial</strong>
                <span>
                  Crear una clave no despliega ni activa un kiosco. Falta operar un cliente
                  protegido, con almacenamiento seguro y canal administrado; el backend no expone un
                  feature flag que permita afirmar que está activo.
                </span>
              </div>
            </div>
            {devices.length === 0 ? (
              <p className="hr-settings-empty">No hay dispositivos en este alcance.</p>
            ) : (
              <div className="hr-device-grid">
                {devices.map((device) => (
                  <article key={device.id} className={device.status.toLowerCase()}>
                    <div className="hr-device-icon">
                      <TabletSmartphone size={22} />
                    </div>
                    <div>
                      <strong>{device.name}</strong>
                      <span>
                        {device.code} · {device.branch?.name ?? `Sucursal #${device.branchId}`}
                      </span>
                      <small>
                        Última señal: {displayDateTime(device.lastSeenAt)}
                        {device.revokedAt ? ` · revocado ${displayDateTime(device.revokedAt)}` : ''}
                      </small>
                    </div>
                    <div className="hr-device-actions">
                      <span className={`hr-device-status ${device.status.toLowerCase()}`}>
                        {device.status === 'ACTIVE' ? 'Activo' : 'Revocado'}
                      </span>
                      {device.status === 'ACTIVE' && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeviceToRevoke(device)}
                          disabled={!online}
                        >
                          <Ban size={15} /> Revocar
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="hr-settings-columns">
            <section className="hr-settings-card hr-provider-card" aria-labelledby="provider-health-title">
              <header>
                <div>
                  <h2 id="provider-health-title">Conexión biométrica</h2>
                  <p>Comprueba si el servicio facial configurado en el servidor responde.</p>
                </div>
                <ScanFace size={22} />
              </header>
              <div className="hr-provider-explanation" role="note">
                <strong>¿Qué es el proveedor biométrico?</strong>
                <span>Es el servicio que compara de forma segura la captura facial durante el marcaje. No se elige ni se cambia desde esta pantalla: aquí solo se verifica la conexión configurada por el administrador del servidor.</span>
              </div>
              <dl className="hr-maintenance-result" aria-live="polite">
                <div><dt>Estado de conexión</dt><dd className={`hr-provider-status ${(providerHealth?.status ?? 'UNKNOWN').toLowerCase()}`}>{providerHealthLoading ? 'Verificando…' : providerStatusLabel(providerHealth?.status)}</dd></div>
                <div><dt>Servicio configurado</dt><dd>{providerHealth ? `${providerHealth.provider} · ${providerHealth.model}` : '—'}</dd></div>
                <div><dt>Revisado</dt><dd>{providerHealth ? displayDateTime(providerHealth.checkedAt) : '—'}</dd></div>
              </dl>
              {providerHealth?.detail && <p className="hr-form-help">{providerHealth.detail}</p>}
              <Button variant="ghost" onClick={() => void loadProviderHealth()} disabled={!online || providerHealthLoading}><RefreshCw size={15} /> Verificar conexión</Button>
            </section>
            <section className="hr-settings-card" aria-labelledby="revoke-biometric-title">
              <header>
                <div>
                  <h2 id="revoke-biometric-title">Revocar biometría</h2>
                  <p>
                    La revocación elimina la referencia local y programa la purga del proveedor.
                  </p>
                </div>
                <ScanFace size={22} />
              </header>
              <form
                className="hr-settings-action-form"
                onSubmit={(event) => void revokeBiometrics(event)}
              >
                <label>
                  Usuario interno
                  <HrReactSelect
                    value={biometricUserId}
                    onChange={(event) => {
                      setBiometricUserId(event.target.value);
                      setRevokedStatus(null);
                    }}
                    required
                  >
                    <option value="">Seleccionar…</option>
                    {internalUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} · {user.username}
                      </option>
                    ))}
                  </HrReactSelect>
                </label>
                <label>
                  Razón obligatoria
                  <textarea
                    rows={4}
                    minLength={3}
                    maxLength={500}
                    value={biometricReason}
                    onChange={(event) => setBiometricReason(event.target.value)}
                    required
                  />
                </label>
                {revokedStatus && (
                  <p className="hr-settings-result" role="status">
                    Estado seguro devuelto por el servidor: <strong>{revokedStatus}</strong>
                  </p>
                )}
                <p className="hr-form-help">
                  Esta vista no consulta, recibe ni muestra plantillas, imágenes o referencias del
                  proveedor biométrico.
                </p>
                <Button type="submit" variant="danger" disabled={!online || saving}>
                  <Ban size={16} /> Revocar enrolamiento
                </Button>
              </form>
            </section>

            <section className="hr-settings-card" aria-labelledby="maintenance-title">
              <header>
                <div>
                  <h2 id="maintenance-title">Retención y outbox de purga</h2>
                  <p>Procesa vencimientos y reintentos pendientes hasta el límite del servidor.</p>
                </div>
                <DatabaseZap size={22} />
              </header>
              <div className="hr-settings-action-form">
                <p className="hr-form-help">
                  La ejecución es auditable. Los fallos del proveedor permanecen pendientes para
                  reintento; la pantalla no los presenta como purgas completadas.
                </p>
                {maintenance && (
                  <dl className="hr-maintenance-result" aria-live="polite">
                    <div>
                      <dt>Perfiles vencidos revocados</dt>
                      <dd>{maintenance.expiredProfilesRevoked}</dd>
                    </div>
                    <div>
                      <dt>Plantillas purgadas</dt>
                      <dd>{maintenance.providerTemplatesPurged}</dd>
                    </div>
                    <div>
                      <dt>Pendientes evaluados</dt>
                      <dd>{maintenance.pendingChecked}</dd>
                    </div>
                  </dl>
                )}
                <Button onClick={() => void runMaintenance()} disabled={!online || saving}>
                  <RefreshCw size={16} /> Ejecutar mantenimiento
                </Button>
              </div>
            </section>
          </div>
        </>
      )}

      <Sidebar
        isOpen={devicePanelOpen}
        onClose={() => !saving && setDevicePanelOpen(false)}
        title="Crear credencial de dispositivo"
        width="large"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        <form className="hr-settings-sidebar-form" onSubmit={(event) => void createDevice(event)}>
          <OnlineOnlyNotice online={online} compact />
          <div className="hr-kiosk-gate">
            <AlertTriangle size={18} />
            <span>La credencial no habilita un kiosco ni sustituye un cliente protegido.</span>
          </div>
          <label>
            Sucursal
            <HrReactSelect
              value={deviceForm.branchId}
              onChange={(event) =>
                setDeviceForm((current) => ({ ...current, branchId: event.target.value }))
              }
              required
            >
              <option value="">Seleccionar…</option>
              {lookups.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </HrReactSelect>
          </label>
          <label>
            Nombre descriptivo
            <input
              value={deviceForm.name}
              maxLength={100}
              onChange={(event) =>
                setDeviceForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Tablet acceso principal"
              required
            />
          </label>
          <label>
            Código operativo
            <input
              value={deviceForm.code}
              maxLength={50}
              onChange={(event) =>
                setDeviceForm((current) => ({ ...current, code: event.target.value }))
              }
              placeholder="ENTRADA-01"
              required
            />
          </label>
          <div className="hr-settings-sidebar-actions">
            <Button type="button" variant="ghost" onClick={() => setDevicePanelOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!online || saving}>
              {saving ? 'Creando…' : 'Crear y mostrar clave'}
            </Button>
          </div>
        </form>
      </Sidebar>

      <Sidebar
        isOpen={Boolean(credential)}
        onClose={() => setCredential(null)}
        title="Clave mostrada una sola vez"
        width="large"
        closeOnBackdrop={false}
      >
        {credential && (
          <div className="hr-secret-panel">
            <div className="hr-attendance-alert warning">
              <KeyRound size={19} />
              <span>
                Guarda la clave ahora en el mecanismo seguro del cliente administrado. Al cerrar se
                elimina de esta memoria de pantalla y el servidor no volverá a entregarla.
              </span>
            </div>
            <dl>
              <div>
                <dt>Dispositivo</dt>
                <dd>{credential.name}</dd>
              </div>
              <div>
                <dt>ID público</dt>
                <dd>{credential.id}</dd>
              </div>
              <div>
                <dt>Código</dt>
                <dd>{credential.code}</dd>
              </div>
            </dl>
            <label>
              Clave secreta
              <code className="hr-device-secret">{credential.key}</code>
            </label>
            <div className="hr-kiosk-gate">
              <LockKeyhole size={18} />
              <span>
                La clave por sí sola no significa que el kiosco esté desplegado o habilitado.
              </span>
            </div>
            <Button fullWidth onClick={() => setCredential(null)}>
              Ya guardé la clave; cerrar definitivamente
            </Button>
          </div>
        )}
      </Sidebar>

      <Sidebar
        isOpen={Boolean(deviceToRevoke)}
        onClose={() => !saving && setDeviceToRevoke(null)}
        title="Revocar dispositivo"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
      >
        {deviceToRevoke && (
          <div className="hr-secret-panel">
            <div className="hr-attendance-alert danger">
              <Ban size={19} />
              <span>
                {deviceToRevoke.name} ({deviceToRevoke.code}) dejará de autenticar solicitudes.
              </span>
            </div>
            <p className="hr-form-help">
              Para volver a provisionar el equipo tendrás que crear otra credencial y custodiar su
              nueva clave.
            </p>
            <div className="hr-settings-sidebar-actions">
              <Button variant="ghost" onClick={() => setDeviceToRevoke(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => void revokeDevice()}
                disabled={!online || saving}
              >
                {saving ? 'Revocando…' : 'Confirmar revocación'}
              </Button>
            </div>
          </div>
        )}
      </Sidebar>
    </div>
  );
}
