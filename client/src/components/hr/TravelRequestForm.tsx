import { AppSelect, Button, Checkbox, DateInput, Input, Textarea } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import { useState } from 'react';
import { MapPin, ShieldCheck } from 'lucide-react';
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
          <Button variant="primary" type="submit" disabled={!online || saving || !confirmed}>
            {saving ? 'Guardando…' : 'Crear borrador'}
          </Button>
        </>
      }
    >
      {!selfService && (
        <label>
          Persona
          <AppSelect<string>
            options={[
              { value: '', label: 'Selecciona una persona' },
              ...users.map((user) => ({
                value: String(user.id),
                label: user.name ?? user.username,
              })),
            ]}
            value={String(form.userId ?? '')}
            onChange={(next) =>
              setForm((current) => ({ ...current, userId: Number(next ?? '') }))
            }
            isClearable={false}
          />
        </label>
      )}
      <label>
        Sucursal de origen
        <AppSelect<string>
          options={[
            { value: '', label: 'Sin sucursal específica' },
            ...branches.map((branch) => ({ value: String(branch.id), label: branch.name })),
          ]}
          value={String(form.branchId ?? '')}
          onChange={(next) =>
            setForm((current) => ({
              ...current,
              branchId: (next ?? '') ? Number(next ?? '') : undefined,
            }))
          }
          isClearable={false}
        />
      </label>
      <label className="span-full">
        Destino
        <span className="hr-benefits-input-icon">
          <MapPin size={16} aria-hidden="true" />
        </span>
        <Input
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
        <DateInput
         
          value={form.departureDate}
          onChange={(event) =>
            setForm((current) => ({ ...current, departureDate: event.target.value }))
          }
          required
        />
      </label>
      <label>
        Regreso
        <DateInput
         
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
        <Textarea
          rows={4}
          value={form.purpose}
          onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
          maxLength={900}
          required
        />
      </label>
      <Checkbox className="span-full" checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} label={<><span>
          <ShieldCheck size={17} aria-hidden="true" /> Confirmo fechas, destino, propósito y monto
          solicitado.
        </span></>} />
    </HrModalFormShell>
  );
}
