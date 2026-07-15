import HrReactSelect from './HrReactSelect';
import { useState } from 'react';
import Button from '../Button';
import type { HrUserSummary } from '../../types/hr';
import type { HrLeaveFraction, HrLeaveRequestPayload, HrLeaveType } from '../../types/hr-workforce';

interface LeaveRequestFormProps {
  users?: HrUserSummary[];
  leaveTypes: HrLeaveType[];
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrLeaveRequestPayload) => Promise<void>;
  onCancel?: () => void;
}

export default function LeaveRequestForm({
  users,
  leaveTypes,
  online,
  saving,
  onSubmit,
  onCancel,
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
  const halfDayDurationInvalid = fraction === 'HALF_DAY' && Boolean(startTime && endTime)
    && minuteOfDay(endTime)! - minuteOfDay(startTime)! !== 240;

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
    <form className="hr-workforce-form" onSubmit={(event) => void submit(event)}>
      {users && (
        <label>
          Usuario
          <HrReactSelect value={userId} onChange={(event) => setUserId(event.target.value)} required>
            <option value="">Seleccionar…</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · @{user.username}
              </option>
            ))}
          </HrReactSelect>
        </label>
      )}
      <label>
        Tipo de ausencia
        <HrReactSelect
          value={leaveTypeId}
          onChange={(event) => setLeaveTypeId(event.target.value)}
          required
        >
          <option value="">Seleccionar…</option>
          {leaveTypes
            .filter((type) => type.active)
            .map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
                {type.paid ? ' · remunerada' : ''}
              </option>
            ))}
        </HrReactSelect>
      </label>
      <label>
        Desde
        <input
          type="date"
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
        <input
          type="date"
          min={startDate || undefined}
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          required
        />
      </label>
      <label>
        Fracción
        <HrReactSelect
          value={fraction}
          onChange={(event) => setFraction(event.target.value as HrLeaveFraction)}
        >
          <option value="FULL_DAY">Día completo</option>
          <option value="HALF_DAY">Medio día</option>
          <option value="HOURS">Rango de horas</option>
        </HrReactSelect>
      </label>
      {(fraction === 'HOURS' || fraction === 'HALF_DAY') && (
        <>
          <label>
            Hora inicial del permiso
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </label>
          <label>
            Hora final del permiso
            <input
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
        <textarea
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
      </div>
    </form>
  );
}
