import { AppSelect, Button, Checkbox, DateInput, Input, Textarea } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import { useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import HrModalFormShell from './HrModalFormShell';
import type { HrTravelExpensePayload } from '../../types/hr-benefits';

interface TravelExpenseFormProps {
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrTravelExpensePayload) => Promise<void>;
  onCancel: () => void;
}

export default function TravelExpenseForm({
  online,
  saving,
  onSubmit,
  onCancel,
}: TravelExpenseFormProps) {
  const [form, setForm] = useState<HrTravelExpensePayload>({
    category: 'ALIMENTACION',
    description: '',
    occurredOn: new Date().toISOString().slice(0, 10),
    currency: 'NIO',
    claimedAmount: '',
  });
  const [confirmed, setConfirmed] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    await onSubmit({
      ...form,
      description: form.description.trim(),
      receiptReference: form.receiptReference?.trim() || undefined,
    });
  };

  const notice = (
      <div className="hr-benefits-warning" role="note">
        <FileCheck2 size={19} aria-hidden="true" />
        <span>
          Este formulario registra metadatos. Los archivos se cargan por el flujo seguro de
          evidencias y se referencian por identificador.
        </span>
      </div>
  );

  return (
    <HrModalFormShell
      ariaLabel="Registro de gasto"
      tabLabel="Soporte"
      sectionTitle="Detalle y evidencia del gasto"
      icon={<FileCheck2 size={18} aria-hidden="true" />}
      formClassName="hr-benefits-form"
      notice={notice}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" disabled={!online || saving || !confirmed}>
            {saving ? 'Registrando…' : 'Registrar gasto'}
          </Button>
        </>
      }
    >
      <label>
        Categoría
        <AppSelect<string>
          options={[
            { value: 'ALIMENTACION', label: 'Alimentación' },
            { value: 'TRANSPORTE', label: 'Transporte' },
            { value: 'HOSPEDAJE', label: 'Hospedaje' },
            { value: 'OTRO', label: 'Otro' },
          ]}
          value={form.category}
          onChange={(next) => setForm((current) => ({ ...current, category: next ?? '' }))}
          isClearable={false}
        />
      </label>
      <label>
        Fecha
        <DateInput
         
          value={form.occurredOn}
          onChange={(event) =>
            setForm((current) => ({ ...current, occurredOn: event.target.value }))
          }
          required
        />
      </label>
      <label>
        Moneda
        <AppSelect<string>
          options={[
            { value: 'NIO', label: 'NIO' },
            { value: 'USD', label: 'USD' },
          ]}
          value={form.currency}
          onChange={(next) => setForm((current) => ({ ...current, currency: next ?? '' }))}
          isClearable={false}
        />
      </label>
      <label>
        Monto reclamado
        <HrMoneyInput
          value={form.claimedAmount}
          onValueChange={(claimedAmount) =>
            setForm((current) => ({ ...current, claimedAmount }))
          }
          required
        />
      </label>
      <label className="span-full">
        Referencia de factura o soporte
        <Input
          value={form.receiptReference ?? ''}
          onChange={(event) =>
            setForm((current) => ({ ...current, receiptReference: event.target.value }))
          }
          maxLength={160}
        />
      </label>
      <label className="span-full">
        ID de evidencia segura
        <Input
          type="number"
          min="1"
          inputMode="numeric"
          value={form.evidenceId ?? ''}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              evidenceId: event.target.value ? Number(event.target.value) : undefined,
            }))
          }
          aria-describedby="evidence-help"
        />
        <small id="evidence-help">
          Opcional. Usa el identificador emitido por el flujo seguro de documentos.
        </small>
      </label>
      <label className="span-full">
        Descripción
        <Textarea
          rows={4}
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
          maxLength={600}
          required
        />
      </label>
      <Checkbox className="span-full" checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} label={<><span>Confirmo que el gasto y su referencia coinciden con el soporte.</span></>} />
    </HrModalFormShell>
  );
}
