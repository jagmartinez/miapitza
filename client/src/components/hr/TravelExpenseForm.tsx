import HrReactSelect from './HrReactSelect';
import HrMoneyInput from './HrMoneyInput';
import { useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import Button from '../Button';
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
          <Button type="submit" disabled={!online || saving || !confirmed}>
            {saving ? 'Registrando…' : 'Registrar gasto'}
          </Button>
        </>
      }
    >
      <label>
        Categoría
        <HrReactSelect
          value={form.category}
          onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
        >
          <option value="ALIMENTACION">Alimentación</option>
          <option value="TRANSPORTE">Transporte</option>
          <option value="HOSPEDAJE">Hospedaje</option>
          <option value="OTRO">Otro</option>
        </HrReactSelect>
      </label>
      <label>
        Fecha
        <input
          type="date"
          value={form.occurredOn}
          onChange={(event) =>
            setForm((current) => ({ ...current, occurredOn: event.target.value }))
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
          <option value="NIO">NIO</option>
          <option value="USD">USD</option>
        </HrReactSelect>
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
        <input
          value={form.receiptReference ?? ''}
          onChange={(event) =>
            setForm((current) => ({ ...current, receiptReference: event.target.value }))
          }
          maxLength={160}
        />
      </label>
      <label className="span-full">
        ID de evidencia segura
        <input
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
        <textarea
          rows={4}
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
          maxLength={600}
          required
        />
      </label>
      <label className="hr-benefits-confirm span-full">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>Confirmo que el gasto y su referencia coinciden con el soporte.</span>
      </label>
    </HrModalFormShell>
  );
}
