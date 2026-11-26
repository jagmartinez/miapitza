import { useCallback, useEffect, useState } from 'react';
import { Check, RefreshCw, UserCheck, X } from 'lucide-react';
import { Button, Textarea } from '@/ui';
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
    <section className="hr-settings-card hr-pending-enrollments" aria-labelledby="pending-enrollments-title">
      <header>
        <div>
          <h2 id="pending-enrollments-title">Registros faciales pendientes de aprobación</h2>
          <p>
            El primer registro facial de cada empleado lo aprueba RRHH. Después de aprobado, el empleado
            puede volver a enrolarse y marcar sin nueva aprobación.
          </p>
        </div>
        <UserCheck size={22} />
      </header>
      <div className="hr-settings-action-form">
        {loading && <p className="hr-form-help" role="status">Cargando registros pendientes…</p>}
        {!loading && loadError && <p className="hr-form-help" role="alert">{loadError}</p>}
        {!loading && !loadError && items.length === 0 && (
          <p className="hr-form-help" role="status">No hay registros faciales pendientes de aprobación.</p>
        )}
        {!loading && items.length > 0 && (
          <ul className="hr-pending-enrollments__list">
            {items.map((item) => {
              const busy = busyUserId === item.userId;
              const rejecting = rejectingUserId === item.userId;
              return (
                <li key={item.profileId} className="hr-pending-enrollments__item">
                  <div className="hr-pending-enrollments__identity">
                    <strong>{item.employeeName}</strong>
                    <span>
                      {item.employeeCode ? `${item.employeeCode} · ` : ''}{item.username} · Registrado {displayDateTime(item.enrolledAt)}
                    </span>
                  </div>
                  {!rejecting && (
                    <div className="hr-pending-enrollments__actions">
                      <Button variant="primary" size="sm" onClick={() => void approve(item)} disabled={!online || busy}>
                        <Check size={15} /> {busy ? 'Aprobando…' : 'Aprobar'}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => startReject(item.userId)} disabled={!online || busy}>
                        <X size={15} /> Rechazar
                      </Button>
                    </div>
                  )}
                  {rejecting && (
                    <form className="hr-pending-enrollments__reject" onSubmit={(event) => void reject(event, item)}>
                      <label>
                        Motivo del rechazo (obligatorio)
                        <Textarea
                          rows={2}
                          minLength={3}
                          maxLength={500}
                          value={rejectReason}
                          onChange={(event) => setRejectReason(event.target.value)}
                          placeholder="Ej.: la captura no corresponde al empleado o está borrosa"
                          required
                          autoFocus
                        />
                      </label>
                      <div className="hr-pending-enrollments__actions">
                        <Button size="sm" variant="ghost" type="button" onClick={() => setRejectingUserId(null)} disabled={busy}>
                          Cancelar
                        </Button>
                        <Button size="sm" variant="danger" type="submit" disabled={!online || busy || rejectReason.trim().length < 3}>
                          {busy ? 'Rechazando…' : 'Confirmar rechazo'}
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Button variant="ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} /> Actualizar pendientes
        </Button>
      </div>
    </section>
  );
}
