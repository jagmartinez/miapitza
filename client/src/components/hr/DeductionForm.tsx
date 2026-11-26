import { AppSelect, Button, Checkbox, DateInput, Input, Textarea } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import { useState } from 'react';
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
          <Button variant="primary" type="submit" disabled={!online || saving || !confirmed || !form.userId}>
            {saving ? 'Guardando…' : 'Crear deducción'}
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
      <label>
        Persona
        <AppSelect<string>
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
      </label>
      <label>
        Nombre
        <Input
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          maxLength={120}
          required
        />
      </label>
      <label>
        Frecuencia
        <AppSelect<string>
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
      </label>
      <label>
        Moneda
        <AppSelect<string>
          options={[
            { value: 'NIO', label: 'NIO — Córdoba' },
            { value: 'USD', label: 'USD — Dólar' },
          ]}
          value={form.currency}
          onChange={(next) => setForm((current) => ({ ...current, currency: next ?? '' }))}
          isClearable={false}
        />
      </label>
      <label>
        Monto solicitado
        <HrMoneyInput
          value={form.requestedAmount}
          onValueChange={(requestedAmount) =>
            setForm((current) => ({ ...current, requestedAmount }))
          }
          required
        />
      </label>
      <label>
        Límite por periodo
        <HrMoneyInput
          value={form.perPeriodLimit ?? ''}
          onValueChange={(perPeriodLimit) =>
            setForm((current) => ({ ...current, perPeriodLimit: perPeriodLimit || undefined }))
          }
        />
      </label>
      <label>
        Prioridad
        <Input
          type="number"
          min="1"
          max="9999"
          value={form.priority}
          onChange={(event) =>
            setForm((current) => ({ ...current, priority: Number(event.target.value) }))
          }
          required
        />
        <small>Menor número se procesa primero; los límites del servidor prevalecen.</small>
      </label>
      <label>
        Vigente desde
        <DateInput
         
          value={form.effectiveFrom}
          onChange={(event) =>
            setForm((current) => ({ ...current, effectiveFrom: event.target.value }))
          }
          required
        />
      </label>
      <label>
        Vigente hasta
        <DateInput
         
          min={form.effectiveFrom}
          value={form.effectiveTo ?? ''}
          onChange={(event) =>
            setForm((current) => ({ ...current, effectiveTo: event.target.value }))
          }
        />
      </label>
      <label className="span-full">
        Justificación
        <Textarea
          rows={4}
          value={form.reason}
          onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
          maxLength={900}
          required
        />
      </label>
      <Checkbox className="hr-benefits-confirm span-full" checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} label={<><span>
          Confirmo la persona, vigencia, prioridad, límite y motivo. Se creará como borrador.
        </span></>} />
    </HrModalFormShell>
  );
}
