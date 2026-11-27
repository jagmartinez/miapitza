import { AppSelect, Button, Field, Input, Textarea } from '@/ui';
import { useState, type ReactNode, useId } from 'react';
import { Pencil } from 'lucide-react';
import HrModalFormShell from './HrModalFormShell';
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
  notice?: ReactNode;
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
  notice,
}: AttendanceCorrectionFormProps) {
  const fid = useId();
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
    <HrModalFormShell
      ariaLabel="Sección de corrección de asistencia"
      tabLabel="Corrección"
      sectionTitle="Marcaje, cambio solicitado y evidencia"
      icon={<Pencil size={18} aria-hidden="true" />}
      formClassName="hr-workforce-form"
      notice={notice}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>}
          <Button loading={saving} variant="primary" type="submit" disabled={!online || saving || !reason.trim() || Boolean(users && !userId)}>Solicitar corrección</Button>
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
      <Field label="Tipo de corrección" htmlFor={`${fid}-tipo-de-correccion`}>
        <AppSelect<string> inputId={`${fid}-tipo-de-correccion`}
          options={[
            ...TYPE_OPTIONS.filter(
              (option) => option.value !== 'ASSIGN_BRANCH' || branches !== undefined
            ).map((option) => ({ value: String(option.value), label: option.label })),
          ]}
          value={type}
          onChange={(next) => setType((next ?? '') as HrCorrectionType)}
          isClearable={false}
        />
      </Field>
      {type === 'ADD_PUNCH' && (
        <Field label="Acción del marcaje" htmlFor={`${fid}-accion-del-marcaje`}>
          <AppSelect<string> inputId={`${fid}-accion-del-marcaje`}
            options={[
              { value: 'CHECK_IN', label: 'Entrada' },
              { value: 'BREAK_START', label: 'Inicio de descanso' },
              { value: 'BREAK_END', label: 'Fin de descanso' },
              { value: 'CHECK_OUT', label: 'Salida' },
            ]}
            value={requestedAction}
            onChange={(next) => setRequestedAction((next ?? '') as HrAttendanceAction)}
            isClearable={false}
          />
        </Field>
      )}
      <Field label="ID de marcaje afectado (si aplica)" htmlFor={`${fid}-id-de-marcaje-afectado`}>
        <Input id={`${fid}-id-de-marcaje-afectado`}
          type="number"
          min="1"
          value={targetEventId}
          onChange={(event) => setTargetEventId(event.target.value)}
        />
      </Field>
      {(type === 'ADD_PUNCH' || type === 'CHANGE_TIME') && (
        <>
          <Field label="Fecha y hora local solicitada" htmlFor={`${fid}-fecha-y-hora-local`}>
            <Input id={`${fid}-fecha-y-hora-local`}
              type="datetime-local"
              value={requestedOccurredAt}
              onChange={(event) => setRequestedOccurredAt(event.target.value)}
              required
            />
          </Field>
          <p className="hr-form-help">Zona enviada al servidor: {resolvedTimezone}</p>
        </>
      )}
      {type === 'ASSIGN_BRANCH' && (
        <Field label="Sucursal solicitada" htmlFor={`${fid}-sucursal-solicitada`}>
          <AppSelect<string> inputId={`${fid}-sucursal-solicitada`}
            options={[
              { value: '', label: 'Seleccionar…' },
              ...(branches ?? []).map((branch) => ({
                value: String(branch.id),
                label: branch.name,
              })),
            ]}
            value={requestedBranchId}
            onChange={(next) => setRequestedBranchId(next ?? '')}
            isClearable={false}
          />
        </Field>
      )}
      <div className="span-full">
        <Field label="Razón y evidencia operativa" htmlFor={`${fid}-razon-y-evidencia-operativa`}>
          <Textarea id={`${fid}-razon-y-evidencia-operativa`}
            rows={4}
            maxLength={700}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Field>
      </div>
      <p className="hr-form-help span-full">
        La solicitud no reescribe historial: el servidor crea una corrección compensatoria con
        actor, versión y trazabilidad.
      </p>
    </HrModalFormShell>
  );
}
