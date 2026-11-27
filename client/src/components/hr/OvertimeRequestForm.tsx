import { AppSelect, Button, DateInput, Field, Input, Textarea } from '@/ui';
import { useState, type ReactNode, useId } from 'react';
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
  const fid = useId();
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
          <Button loading={saving} variant="primary" type="submit" disabled={!online || saving || !date || Number(requestedMinutes) <= 0 || !reason.trim() || Boolean(users && !userId)}>Solicitar horas extra</Button>
        </>
      }
    >
      {users && (
        <Field label="Usuario" htmlFor={`${fid}-usuario`}>
          <AppSelect<string> inputId={`${fid}-usuario`}
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
        </Field>
      )}
      <Field label="Fecha" htmlFor={`${fid}-fecha`}>
        <DateInput id={`${fid}-fecha`}
         
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </Field>
      <Field label="Minutos solicitados" htmlFor={`${fid}-minutos-solicitados`}>
        <Input id={`${fid}-minutos-solicitados`}
          type="number"
          min="1"
          step="1"
          value={requestedMinutes}
          onChange={(event) => setRequestedMinutes(event.target.value)}
          required
        />
      </Field>
      <div className="span-full">
        <Field label="Razón" htmlFor={`${fid}-razon`}>
          <Textarea id={`${fid}-razon`}
            rows={4}
            maxLength={700}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Field>
      </div>
      {candidateMinutes != null && (
        <p className="hr-form-help span-full">
          El servidor reportó {candidateMinutes} min como candidato. Este dato no equivale a
          aprobación ni cálculo legal.
        </p>
      )}
    </HrModalFormShell>
  );
}
