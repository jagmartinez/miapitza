import { AppSelect, Button, DateInput, Input, Textarea } from '@/ui';
import { useState, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import HrModalFormShell from './HrModalFormShell';
import type { HrUserSummary } from '../../types/hr';
import type { HrLeaveFraction, HrLeaveRequestPayload, HrLeaveType } from '../../types/hr-workforce';

interface LeaveRequestFormProps {
  users?: HrUserSummary[];
  leaveTypes: HrLeaveType[];
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrLeaveRequestPayload) => Promise<void>;
  onCancel?: () => void;
  notice?: ReactNode;
}

export default function LeaveRequestForm({
  users,
  leaveTypes,
  online,
  saving,
  onSubmit,
  onCancel,
  notice,
}: LeaveRequestFormProps) {
  const [userId, setUserId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fraction, setFraction] = useState<HrLeaveFraction>('FULL_DAY');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const minuteOfDay = (value: string) => {
    const [hour, minute] = value.split(':').map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  };
  const halfDayDurationInvalid =
    fraction === 'HALF_DAY' &&
    Boolean(startTime && endTime) &&
    minuteOfDay(endTime)! - minuteOfDay(startTime)! !== 240;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({
      ...(userId ? { userId: Number(userId) } : {}),
      leaveTypeId: Number(leaveTypeId),
      startDate,
      endDate,
      fraction,
      ...(['HOURS', 'HALF_DAY'].includes(fraction) ? { startTime, endTime } : {}),
      reason: reason.trim(),
    });
  };

  return (
    <HrModalFormShell
      ariaLabel="Sección de solicitud de ausencia"
      tabLabel="Solicitud"
      sectionTitle="Persona, ausencia y vigencia"
      icon={<CalendarDays size={18} aria-hidden="true" />}
      formClassName="hr-workforce-form"
      notice={notice}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancelar
            </Button>
          )}
          <Button variant="primary"
            type="submit"
            disabled={
              !online ||
              saving ||
              !leaveTypeId ||
              !startDate ||
              !endDate ||
              !reason.trim() ||
              Boolean(users && !userId) ||
              (['HOURS', 'HALF_DAY'].includes(fraction) && (!startTime || !endTime)) ||
              halfDayDurationInvalid
            }
          >
            {saving ? 'Guardando…' : 'Crear borrador'}
          </Button>
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
        Tipo de ausencia
        <AppSelect<string>
          options={[
            { value: '', label: 'Seleccionar…' },
            ...leaveTypes
              .filter((type) => type.active)
              .map((type) => ({
                value: String(type.id),
                label: `${type.name} ${type.paid ? ' · remunerada' : ''}`,
              })),
          ]}
          value={leaveTypeId}
          onChange={(next) => setLeaveTypeId(next ?? '')}
          isClearable={false}
        />
      </label>
      <label>
        Desde
        <DateInput
         
          value={startDate}
          onChange={(event) => {
            setStartDate(event.target.value);
            if (!endDate) setEndDate(event.target.value);
          }}
          required
        />
      </label>
      <label>
        Hasta
        <DateInput
         
          min={startDate || undefined}
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          required
        />
      </label>
      <label>
        Fracción
        <AppSelect<string>
          options={[
            { value: 'FULL_DAY', label: 'Día completo' },
            { value: 'HALF_DAY', label: 'Medio día' },
            { value: 'HOURS', label: 'Rango de horas' },
          ]}
          value={fraction}
          onChange={(next) => setFraction((next ?? '') as HrLeaveFraction)}
          isClearable={false}
        />
      </label>
      {(fraction === 'HOURS' || fraction === 'HALF_DAY') && (
        <>
          <label>
            Hora inicial del permiso
            <Input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </label>
          <label>
            Hora final del permiso
            <Input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </label>
        </>
      )}
      {halfDayDurationInvalid && (
        <p className="hr-form-help span-full">Medio día debe cubrir exactamente 4 horas.</p>
      )}
      <label className="span-full">
        Motivo
        <Textarea
          rows={4}
          maxLength={700}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
      </label>
      <p className="hr-form-help span-full">
        La duración, elegibilidad y afectación del saldo las determina el servidor según el tipo y
        la política vigente.
      </p>
    </HrModalFormShell>
  );
}
