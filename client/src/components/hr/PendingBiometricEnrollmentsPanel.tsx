import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';
import { Button, Field, Textarea } from '@/ui';
import { HrSettingsBlock, HrSettingsSection } from './HrSettingsSection';
import form from './hrForm.module.css';
import { attendanceClient, getAttendanceErrorMessage } from './attendanceClient';
import { validateBiometricRevocation } from './attendanceSettingsRules';
import { useAppToast } from '../../context/ToastContext';
import type { HrPendingBiometricEnrollment } from '../../types/hr-attendance';

interface PendingBiometricEnrollmentsPanelProps {
  online: boolean;
  /** Branch selected in the settings scope; undefined = whole company. */
  branchId?: number;
}

function displayDateTime(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

/**
 * HR approval queue for first facial enrollments. The first enrollment of an
 * employee stays PENDING (cannot punch) until HR approves it here; later
 * re-enrollments of an approved employee do not appear in this queue.
 */
export default function PendingBiometricEnrollmentsPanel({ online, branchId }: PendingBiometricEnrollmentsPanelProps) {
  const { success: showSuccess, error: showError } = useAppToast();
  const [items, setItems] = useState<HrPendingBiometricEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [rejectingUserId, setRejectingUserId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setItems(await attendanceClient.getPendingBiometricEnrollments(branchId));
    } catch (error) {
      setItems([]);
      setLoadError(getAttendanceErrorMessage(error, 'No fue posible cargar los registros faciales pendientes.'));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeItem = (userId: number) => setItems((current) => current.filter((item) => item.userId !== userId));

  const approve = async (item: HrPendingBiometricEnrollment) => {
    if (!online) return;
    setBusyUserId(item.userId);
    try {
      await attendanceClient.approveBiometricEnrollment(item.userId);
      removeItem(item.userId);
      showSuccess(`Registro facial de ${item.employeeName} aprobado. Ya puede marcar asistencia.`);
    } catch (error) {
      showError(getAttendanceErrorMessage(error, 'No fue posible aprobar el registro facial.'));
      void load();
    } finally {
      setBusyUserId(null);
    }
  };

  const startReject = (userId: number) => {
    setRejectingUserId(userId);
    setRejectReason('');
  };

  const reject = async (event: React.FormEvent, item: HrPendingBiometricEnrollment) => {
    event.preventDefault();
    if (!online) return;
    const validationError = validateBiometricRevocation(item.userId, rejectReason);
    if (validationError) {
      showError(validationError);
      return;
    }
    setBusyUserId(item.userId);
    try {
      await attendanceClient.rejectBiometricEnrollment(item.userId, rejectReason.trim());
      removeItem(item.userId);
      setRejectingUserId(null);
      setRejectReason('');
      showSuccess(`Registro facial de ${item.employeeName} rechazado. Deberá enrolarse de nuevo.`);
    } catch (error) {
      showError(getAttendanceErrorMessage(error, 'No fue posible rechazar el registro facial.'));
      void load();
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <HrSettingsSection
      id="pending-enrollments"
      group="Biometría"
      title="Registros faciales pendientes de aprobación"
      description="El primer registro facial de cada empleado lo aprueba RRHH. Después de aprobado, el empleado puede volver a enrolarse y marcar sin nueva aprobación."
      actions={<Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={loading}>Actualizar pendientes</Button>}
    >
      <HrSettingsBlock>
        {loading && <p className={form.help} role="status">Cargando registros pendientes…</p>}
        {!loading && loadError && <p className={form.alertDanger} role="alert">{loadError}</p>}
        {!loading && !loadError && items.length === 0 && (
          <p className={form.help} role="status">No hay registros faciales pendientes de aprobación.</p>
        )}
        {!loading && items.length > 0 && (
          <ul className={form.list}>
            {items.map((item) => {
              const busy = busyUserId === item.userId;
              const rejecting = rejectingUserId === item.userId;
              return (
                <li key={item.profileId}>
                  <span className={form.cellStack}>
                    <span className={form.cellTitle}>{item.employeeName}</span>
                    <span className={form.cellSub}>
                      {item.employeeCode ? `${item.employeeCode} · ` : ''}{item.username} · Registrado {displayDateTime(item.enrolledAt)}
                    </span>
                  </span>
                  {!rejecting && (
                    <span className={form.actions}>
                      <Button variant="primary" size="sm" icon={Check} loading={busy} onClick={() => void approve(item)} disabled={!online}>
                        Aprobar
                      </Button>
                      <Button size="sm" variant="danger" icon={X} onClick={() => startReject(item.userId)} disabled={!online || busy}>
                        Rechazar
                      </Button>
                    </span>
                  )}
                  {rejecting && (
                    <form className={`${form.stack} ${form.fullRow}`} onSubmit={(event) => void reject(event, item)}>
                      <Field label="Motivo del rechazo (obligatorio)" htmlFor={`hr-reject-${item.userId}`} required>
                        <Textarea
                          id={`hr-reject-${item.userId}`}
                          rows={2}
                          minLength={3}
                          maxLength={500}
                          value={rejectReason}
                          onChange={(event) => setRejectReason(event.target.value)}
                          placeholder="Ej.: la captura no corresponde al empleado o está borrosa"
                          required
                          autoFocus
                        />
                      </Field>
                      <div className={form.actionsEnd}>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setRejectingUserId(null)} disabled={busy}>
                          Cancelar
                        </Button>
                        <Button size="sm" variant="danger" type="submit" loading={busy} disabled={!online || rejectReason.trim().length < 3}>
                          Confirmar rechazo
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </HrSettingsBlock>
    </HrSettingsSection>
  );
}
