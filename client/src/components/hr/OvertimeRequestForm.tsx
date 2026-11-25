import { AppSelect, Button } from '@/ui';
import { useState, type ReactNode } from 'react';
import { Clock3 } from 'lucide-react';
import HrModalFormShell from './HrModalFormShell';
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
  notice?: ReactNode;
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
  notice,
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
    <HrModalFormShell
      ariaLabel="Sección de solicitud de horas extra"
      tabLabel="Horas extra"
      sectionTitle="Fecha, minutos y justificación"
      icon={<Clock3 size={18} aria-hidden="true" />}
      formClassName="hr-workforce-form"
      notice={notice}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>}
          <Button variant="primary" type="submit" disabled={!online || saving || !date || Number(requestedMinutes) <= 0 || !reason.trim() || Boolean(users && !userId)}>{saving ? 'Enviando…' : 'Solicitar horas extra'}</Button>
        </>
      }
    >
      {users && (
        <label>
          Usuario
          <AppSelect<string>
            options={[
              { value: '', label: 'Seleccionar…' },
              ...users.map((user) => ({
                value: String(user.id),
                label: `${user.name} · @${user.username}`,
              })),
            ]}
            value={userId}
            onChange={(next) => setUserId(next ?? '')}
            isClearable={false}
          />
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
    </HrModalFormShell>
  );
}
