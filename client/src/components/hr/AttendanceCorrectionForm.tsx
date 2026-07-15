import { useState } from 'react';
import Button from '../Button';
import type { HrNamedEntity, HrUserSummary } from '../../types/hr';
import type { HrAttendanceCorrectionPayload, HrCorrectionType } from '../../types/hr-workforce';
import type { HrAttendanceAction } from '../../types/hr-attendance';

const TYPE_OPTIONS: Array<{ value: HrCorrectionType; label: string }> = [
  { value: 'ADD_PUNCH', label: 'Agregar marcaje compensatorio' },
  { value: 'VOID_PUNCH', label: 'Invalidar marcaje' },
  { value: 'CHANGE_TIME', label: 'Corregir fecha/hora' },
  { value: 'ASSIGN_BRANCH', label: 'Corregir sucursal' },
  { value: 'OTHER', label: 'Otra corrección' },
];

interface AttendanceCorrectionFormProps {
  users?: HrUserSummary[];
  branches?: HrNamedEntity[];
  initialUserId?: number;
  dailySummaryId?: number;
  incidentId?: number;
  timezone?: string;
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrAttendanceCorrectionPayload) => Promise<void>;
  onCancel?: () => void;
}

export default function AttendanceCorrectionForm({
  users,
  branches,
  initialUserId,
  dailySummaryId,
  incidentId,
  timezone,
  online,
  saving,
  onSubmit,
  onCancel,
}: AttendanceCorrectionFormProps) {
  const [userId, setUserId] = useState(initialUserId ? String(initialUserId) : '');
  const [type, setType] = useState<HrCorrectionType>('ADD_PUNCH');
  const [requestedAction, setRequestedAction] = useState<HrAttendanceAction>('CHECK_IN');
  const [targetEventId, setTargetEventId] = useState('');
  const [requestedOccurredAt, setRequestedOccurredAt] = useState('');
  const [requestedBranchId, setRequestedBranchId] = useState('');
  const [reason, setReason] = useState('');
  const resolvedTimezone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({
      ...(userId ? { userId: Number(userId) } : {}),
      ...(dailySummaryId ? { dailySummaryId } : {}),
      ...(incidentId ? { incidentId } : {}),
      ...(targetEventId ? { targetEventId: Number(targetEventId) } : {}),
      type,
      ...(type === 'ADD_PUNCH' ? { requestedAction } : {}),
      ...(requestedOccurredAt ? { requestedOccurredAt, requestedTimezone: resolvedTimezone } : {}),
      ...(requestedBranchId ? { requestedBranchId: Number(requestedBranchId) } : {}),
      reason: reason.trim(),
    });
  };

  return (
    <form className="hr-workforce-form" onSubmit={(event) => void submit(event)}>
      {users && (
        <label>
          Usuario
          <select value={userId} onChange={(event) => setUserId(event.target.value)} required>
            <option value="">Seleccionar…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · @{user.username}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Tipo de corrección
        <select value={type} onChange={(event) => setType(event.target.value as HrCorrectionType)}>
          {TYPE_OPTIONS.filter(
            (option) => option.value !== 'ASSIGN_BRANCH' || branches !== undefined
          ).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {type === 'ADD_PUNCH' && (
        <label>
          Acción del marcaje
          <select
            value={requestedAction}
            onChange={(event) => setRequestedAction(event.target.value as HrAttendanceAction)}
          >
            <option value="CHECK_IN">Entrada</option>
            <option value="BREAK_START">Inicio de descanso</option>
            <option value="BREAK_END">Fin de descanso</option>
            <option value="CHECK_OUT">Salida</option>
          </select>
        </label>
      )}
      <label>
        ID de marcaje afectado (si aplica)
        <input
          type="number"
          min="1"
          value={targetEventId}
          onChange={(event) => setTargetEventId(event.target.value)}
        />
      </label>
      {(type === 'ADD_PUNCH' || type === 'CHANGE_TIME') && (
        <>
          <label>
            Fecha y hora local solicitada
            <input
              type="datetime-local"
              value={requestedOccurredAt}
              onChange={(event) => setRequestedOccurredAt(event.target.value)}
              required
            />
          </label>
          <p className="hr-form-help">Zona enviada al servidor: {resolvedTimezone}</p>
        </>
      )}
      {type === 'ASSIGN_BRANCH' && (
        <label>
          Sucursal solicitada
          <select
            value={requestedBranchId}
            onChange={(event) => setRequestedBranchId(event.target.value)}
            required
          >
            <option value="">Seleccionar…</option>
            {(branches ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="span-full">
        Razón y evidencia operativa
        <textarea
          rows={4}
          maxLength={700}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
      </label>
      <p className="hr-form-help span-full">
        La solicitud no reescribe historial: el servidor crea una corrección compensatoria con
        actor, versión y trazabilidad.
      </p>
      <div className="hr-form-actions span-full">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        )}
        <Button
          type="submit"
          disabled={!online || saving || !reason.trim() || Boolean(users && !userId)}
        >
          {saving ? 'Enviando…' : 'Solicitar corrección'}
        </Button>
      </div>
    </form>
  );
}
