import { AppSelect, Button, Checkbox, DateInput, Field, Input, Textarea } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import { useState, useId } from 'react';
import { AlertTriangle, BadgeMinus } from 'lucide-react';
import HrModalFormShell from './HrModalFormShell';
import type { HrUserSummary } from '../../types/hr';
import type { HrDeductionFrequency, HrDeductionPayload } from '../../types/hr-benefits';

interface DeductionFormProps {
  users: HrUserSummary[];
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrDeductionPayload) => Promise<void>;
  onCancel: () => void;
}

const today = new Date().toISOString().slice(0, 10);

export default function DeductionForm({
  users,
  online,
  saving,
  onSubmit,
  onCancel,
}: DeductionFormProps) {
  const fid = useId();
  const [form, setForm] = useState<HrDeductionPayload>({
    userId: 0,
    name: '',
    reason: '',
    currency: 'NIO',
    frequency: 'ONCE',
    requestedAmount: '',
    priority: 100,
    effectiveFrom: today,
  });
  const [confirmed, setConfirmed] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    await onSubmit({
      ...form,
      name: form.name.trim(),
      reason: form.reason.trim(),
      perPeriodLimit: form.perPeriodLimit || undefined,
      effectiveTo: form.effectiveTo || undefined,
    });
  };

  return (
    <HrModalFormShell
      ariaLabel="Sección de deducción"
      tabLabel="Deducción"
      sectionTitle="Persona, importe, prioridad y vigencia"
      icon={<BadgeMinus size={18} aria-hidden="true" />}
      formClassName="hr-benefits-form"
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} variant="primary" type="submit" disabled={!online || saving || !confirmed || !form.userId}>
            Crear deducción
          </Button>
        </>
      }
    >
      <div className="hr-benefits-warning span-full" role="note">
        <AlertTriangle size={19} aria-hidden="true" />
        <span>
          La nómina aplicará cada deducción una sola vez por corrida. El servidor decide monto
          aplicable, remanente y límites legales.
        </span>
      </div>
      <Field label="Persona" htmlFor={`${fid}-persona`}>
        <AppSelect<string> inputId={`${fid}-persona`}
          options={[
            { value: '', label: 'Selecciona una persona' },
            ...users.map((user) => ({
              value: String(user.id),
              label: user.name || user.username,
            })),
          ]}
          value={String(form.userId || '')}
          onChange={(next) =>
            setForm((current) => ({ ...current, userId: Number(next ?? '') }))
          }
          isClearable={false}
        />
      </Field>
      <Field label="Nombre" htmlFor={`${fid}-nombre`}>
        <Input id={`${fid}-nombre`}
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          maxLength={120}
          required
        />
      </Field>
      <Field label="Frecuencia" htmlFor={`${fid}-frecuencia`}>
        <AppSelect<string> inputId={`${fid}-frecuencia`}
          options={[
            { value: 'ONCE', label: 'Única' },
            { value: 'RECURRING', label: 'Recurrente' },
          ]}
          value={form.frequency}
          onChange={(next) =>
            setForm((current) => ({
              ...current,
              frequency: (next ?? '') as HrDeductionFrequency,
            }))
          }
          isClearable={false}
        />
      </Field>
      <Field label="Moneda" htmlFor={`${fid}-moneda`}>
        <AppSelect<string> inputId={`${fid}-moneda`}
          options={[
            { value: 'NIO', label: 'NIO — Córdoba' },
            { value: 'USD', label: 'USD — Dólar' },
          ]}
          value={form.currency}
          onChange={(next) => setForm((current) => ({ ...current, currency: next ?? '' }))}
          isClearable={false}
        />
      </Field>
      <Field label="Monto solicitado" htmlFor={`${fid}-monto-solicitado`}>
        <HrMoneyInput id={`${fid}-monto-solicitado`}
          value={form.requestedAmount}
          onValueChange={(requestedAmount) =>
            setForm((current) => ({ ...current, requestedAmount }))
          }
          required
        />
      </Field>
      <Field label="Límite por periodo" htmlFor={`${fid}-limite-por-periodo`}>
        <HrMoneyInput id={`${fid}-limite-por-periodo`}
          value={form.perPeriodLimit ?? ''}
          onValueChange={(perPeriodLimit) =>
            setForm((current) => ({ ...current, perPeriodLimit: perPeriodLimit || undefined }))
          }
        />
      </Field>
      <Field label="Prioridad" htmlFor={`${fid}-prioridad`} hint="Menor número se procesa primero; los límites del servidor prevalecen.">
        <Input id={`${fid}-prioridad`}
          type="number"
          min="1"
          max="9999"
          value={form.priority}
          onChange={(event) =>
            setForm((current) => ({ ...current, priority: Number(event.target.value) }))
          }
          required
        />
      </Field>
      <Field label="Vigente desde" htmlFor={`${fid}-vigente-desde`}>
        <DateInput id={`${fid}-vigente-desde`}
         
          value={form.effectiveFrom}
          onChange={(event) =>
            setForm((current) => ({ ...current, effectiveFrom: event.target.value }))
          }
          required
        />
      </Field>
      <Field label="Vigente hasta" htmlFor={`${fid}-vigente-hasta`}>
        <DateInput id={`${fid}-vigente-hasta`}
         
          min={form.effectiveFrom}
          value={form.effectiveTo ?? ''}
          onChange={(event) =>
            setForm((current) => ({ ...current, effectiveTo: event.target.value }))
          }
        />
      </Field>
      <div className="span-full">
        <Field label="Justificación" htmlFor={`${fid}-justificacion`}>
          <Textarea id={`${fid}-justificacion`}
            rows={4}
            value={form.reason}
            onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            maxLength={900}
            required
          />
        </Field>
      </div>
      <Checkbox className="span-full" checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} label={<><span>
          Confirmo la persona, vigencia, prioridad, límite y motivo. Se creará como borrador.
        </span></>} />
    </HrModalFormShell>
  );
}
