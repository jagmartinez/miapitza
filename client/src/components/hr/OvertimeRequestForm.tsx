import { useState } from 'react';
import Button from '../Button';
import type { HrUserSummary } from '../../types/hr';
import type { HrOvertimeRequestPayload } from '../../types/hr-workforce';

interface OvertimeRequestFormProps {
  users?: HrUserSummary[];
  initialUserId?: number;
  initialDate?: string;
  dailySummaryId?: number;
  candidateMinutes?: number | null;
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrOvertimeRequestPayload) => Promise<void>;
  onCancel?: () => void;
}

export default function OvertimeRequestForm({
  users,
  initialUserId,
  initialDate = '',
  dailySummaryId,
  candidateMinutes,
  online,
  saving,
  onSubmit,
  onCancel,
}: OvertimeRequestFormProps) {
  const [userId, setUserId] = useState(initialUserId ? String(initialUserId) : '');
  const [date, setDate] = useState(initialDate);
  const [requestedMinutes, setRequestedMinutes] = useState(
    candidateMinutes != null ? String(candidateMinutes) : ''
  );
  const [reason, setReason] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({
      ...(userId ? { userId: Number(userId) } : {}),
      ...(dailySummaryId ? { dailySummaryId } : {}),
      date,
      requestedMinutes: Number(requestedMinutes),
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
        Fecha
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
      <label>
        Minutos solicitados
        <input
          type="number"
          min="1"
          step="1"
          value={requestedMinutes}
          onChange={(event) => setRequestedMinutes(event.target.value)}
          required
        />
      </label>
      <label className="span-full">
        Razón
        <textarea
          rows={4}
          maxLength={700}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
      </label>
      {candidateMinutes != null && (
        <p className="hr-form-help span-full">
          El servidor reportó {candidateMinutes} min como candidato. Este dato no equivale a
          aprobación ni cálculo legal.
        </p>
      )}
      <div className="hr-form-actions span-full">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        )}
        <Button
          type="submit"
          disabled={
            !online ||
            saving ||
            !date ||
            Number(requestedMinutes) <= 0 ||
            !reason.trim() ||
            Boolean(users && !userId)
          }
        >
          {saving ? 'Enviando…' : 'Solicitar horas extra'}
        </Button>
      </div>
    </form>
  );
}
