import HrReactSelect from './HrReactSelect';
import HrMoneyInput from './HrMoneyInput';
import { useState } from 'react';
import { MapPin, ShieldCheck } from 'lucide-react';
import Button from '../Button';
import HrModalFormShell from './HrModalFormShell';
import type { HrNamedEntity, HrUserSummary } from '../../types/hr';
import type { HrTravelRequestPayload } from '../../types/hr-benefits';

interface TravelRequestFormProps {
  users?: HrUserSummary[];
  branches?: HrNamedEntity[];
  online: boolean;
  saving: boolean;
  selfService?: boolean;
  onSubmit: (payload: HrTravelRequestPayload) => Promise<void>;
  onCancel: () => void;
}

const today = new Date().toISOString().slice(0, 10);

export default function TravelRequestForm({
  users = [],
  branches = [],
  online,
  saving,
  selfService = false,
  onSubmit,
  onCancel,
}: TravelRequestFormProps) {
  const [form, setForm] = useState<HrTravelRequestPayload>({
    destination: '',
    purpose: '',
    departureDate: today,
    returnDate: today,
    currency: 'NIO',
    requestedAmount: '',
  });
  const [confirmed, setConfirmed] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    await onSubmit({
      ...form,
      destination: form.destination.trim(),
      purpose: form.purpose.trim(),
      requestedAmount: form.requestedAmount,
    });
  };

  return (
    <HrModalFormShell
      ariaLabel="Sección de viático"
      tabLabel="Viático"
      sectionTitle="Persona, destino y presupuesto"
      icon={<MapPin size={18} aria-hidden="true" />}
      formClassName="hr-benefits-form"
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!online || saving || !confirmed}>
            {saving ? 'Guardando…' : 'Crear borrador'}
          </Button>
        </>
      }
    >
      {!selfService && (
        <label>
          Persona
          <HrReactSelect
            required
            value={form.userId ?? ''}
            onChange={(event) =>
              setForm((current) => ({ ...current, userId: Number(event.target.value) }))
            }
          >
            <option value="">Selecciona una persona</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name ?? user.username}
              </option>
            ))}
          </HrReactSelect>
        </label>
      )}
      <label>
        Sucursal de origen
        <HrReactSelect
          value={form.branchId ?? ''}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              branchId: event.target.value ? Number(event.target.value) : undefined,
            }))
          }
        >
          <option value="">Sin sucursal específica</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </HrReactSelect>
      </label>
      <label className="span-full">
        Destino
        <span className="hr-benefits-input-icon">
          <MapPin size={16} aria-hidden="true" />
        </span>
        <input
          value={form.destination}
          onChange={(event) =>
            setForm((current) => ({ ...current, destination: event.target.value }))
          }
          maxLength={160}
          required
        />
      </label>
      <label>
        Salida
        <input
          type="date"
          value={form.departureDate}
          onChange={(event) =>
            setForm((current) => ({ ...current, departureDate: event.target.value }))
          }
          required
        />
      </label>
      <label>
        Regreso
        <input
          type="date"
          min={form.departureDate}
          value={form.returnDate}
          onChange={(event) =>
            setForm((current) => ({ ...current, returnDate: event.target.value }))
          }
          required
        />
      </label>
      <label>
        Moneda
        <HrReactSelect
          value={form.currency}
          onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
        >
          <option value="NIO">NIO — Córdoba</option>
          <option value="USD">USD — Dólar</option>
        </HrReactSelect>
      </label>
      <label>
        Estimado solicitado
        <HrMoneyInput
          value={form.requestedAmount}
          onValueChange={(requestedAmount) =>
            setForm((current) => ({ ...current, requestedAmount }))
          }
          required
        />
        <small>Es una solicitud; el servidor determina el monto elegible y aprobado.</small>
      </label>
      <label className="span-full">
        Motivo del viaje
        <textarea
          rows={4}
          value={form.purpose}
          onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
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
          <ShieldCheck size={17} aria-hidden="true" /> Confirmo fechas, destino, propósito y monto
          solicitado.
        </span>
      </label>
    </HrModalFormShell>
  );
}
