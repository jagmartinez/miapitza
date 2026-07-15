import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from '../Button';
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
    <form className="hr-benefits-form" onSubmit={(event) => void submit(event)}>
      <div className="hr-benefits-warning span-full" role="note">
        <AlertTriangle size={19} aria-hidden="true" />
        <span>
          La nómina aplicará cada deducción una sola vez por corrida. El servidor decide monto
          aplicable, remanente y límites legales.
        </span>
      </div>
      <label>
        Persona
        <select
          required
          value={form.userId || ''}
          onChange={(event) =>
            setForm((current) => ({ ...current, userId: Number(event.target.value) }))
          }
        >
          <option value="">Selecciona una persona</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name || user.username}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nombre
        <input
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          maxLength={120}
          required
        />
      </label>
      <label>
        Frecuencia
        <select
          value={form.frequency}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              frequency: event.target.value as HrDeductionFrequency,
            }))
          }
        >
          <option value="ONCE">Única</option>
          <option value="RECURRING">Recurrente</option>
        </select>
      </label>
      <label>
        Moneda
        <select
          value={form.currency}
          onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
        >
          <option value="NIO">NIO — Córdoba</option>
          <option value="USD">USD — Dólar</option>
        </select>
      </label>
      <label>
        Monto solicitado
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={form.requestedAmount}
          onChange={(event) =>
            setForm((current) => ({ ...current, requestedAmount: event.target.value }))
          }
          required
        />
      </label>
      <label>
        Límite por periodo
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={form.perPeriodLimit ?? ''}
          onChange={(event) =>
            setForm((current) => ({ ...current, perPeriodLimit: event.target.value }))
          }
        />
      </label>
      <label>
        Prioridad
        <input
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
        <input
          type="date"
          value={form.effectiveFrom}
          onChange={(event) =>
            setForm((current) => ({ ...current, effectiveFrom: event.target.value }))
          }
          required
        />
      </label>
      <label>
        Vigente hasta
        <input
          type="date"
          min={form.effectiveFrom}
          value={form.effectiveTo ?? ''}
          onChange={(event) =>
            setForm((current) => ({ ...current, effectiveTo: event.target.value }))
          }
        />
      </label>
      <label className="span-full">
        Justificación
        <textarea
          rows={4}
          value={form.reason}
          onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
          maxLength={900}
          required
        />
      </label>
      <label className="hr-benefits-confirm span-full">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          Confirmo la persona, vigencia, prioridad, límite y motivo. Se creará como borrador.
        </span>
      </label>
      <div className="hr-benefits-form-actions span-full">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!online || saving || !confirmed || !form.userId}>
          {saving ? 'Guardando…' : 'Crear deducción'}
        </Button>
      </div>
    </form>
  );
}
