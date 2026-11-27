import { AppSelect, Button, Checkbox, DateInput, Field, Input, Textarea } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import { useState, useId } from 'react';
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
  const fid = useId();
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
          <Button loading={saving} variant="primary" type="submit" disabled={!online || saving || !confirmed}>
            Registrar gasto
          </Button>
        </>
      }
    >
      <Field label="Categoría" htmlFor={`${fid}-categoria`}>
        <AppSelect<string> inputId={`${fid}-categoria`}
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
      </Field>
      <Field label="Fecha" htmlFor={`${fid}-fecha`}>
        <DateInput id={`${fid}-fecha`}
         
          value={form.occurredOn}
          onChange={(event) =>
            setForm((current) => ({ ...current, occurredOn: event.target.value }))
          }
          required
        />
      </Field>
      <Field label="Moneda" htmlFor={`${fid}-moneda`}>
        <AppSelect<string> inputId={`${fid}-moneda`}
          options={[
            { value: 'NIO', label: 'NIO' },
            { value: 'USD', label: 'USD' },
          ]}
          value={form.currency}
          onChange={(next) => setForm((current) => ({ ...current, currency: next ?? '' }))}
          isClearable={false}
        />
      </Field>
      <Field label="Monto reclamado" htmlFor={`${fid}-monto-reclamado`}>
        <HrMoneyInput id={`${fid}-monto-reclamado`}
          value={form.claimedAmount}
          onValueChange={(claimedAmount) =>
            setForm((current) => ({ ...current, claimedAmount }))
          }
          required
        />
      </Field>
      <div className="span-full">
        <Field label="Referencia de factura o soporte" htmlFor={`${fid}-referencia-de-factura-o`}>
          <Input id={`${fid}-referencia-de-factura-o`}
            value={form.receiptReference ?? ''}
            onChange={(event) =>
              setForm((current) => ({ ...current, receiptReference: event.target.value }))
            }
            maxLength={160}
          />
        </Field>
      </div>
      <div className="span-full">
        <Field label="ID de evidencia segura" htmlFor={`${fid}-id-de-evidencia-segura`} hint="Opcional. Usa el identificador emitido por el flujo seguro de documentos.">
          <Input id={`${fid}-id-de-evidencia-segura`}
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
        </Field>
      </div>
      <div className="span-full">
        <Field label="Descripción" htmlFor={`${fid}-descripcion`}>
          <Textarea id={`${fid}-descripcion`}
            rows={4}
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
            maxLength={600}
            required
          />
        </Field>
      </div>
      <Checkbox className="span-full" checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} label={<><span>Confirmo que el gasto y su referencia coinciden con el soporte.</span></>} />
    </HrModalFormShell>
  );
}
