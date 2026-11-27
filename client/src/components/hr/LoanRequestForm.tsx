import { AppSelect, Button, Checkbox, DateInput, Field, Input, Textarea } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import { useState, useId } from 'react';
import { ShieldCheck, WalletCards } from 'lucide-react';
import HrModalFormShell from './HrModalFormShell';
import type { HrUserSummary } from '../../types/hr';
import type { HrLoanRequestPayload } from '../../types/hr-benefits';

interface LoanRequestFormProps {
  users?: HrUserSummary[];
  online: boolean;
  saving: boolean;
  selfService?: boolean;
  onSubmit: (payload: HrLoanRequestPayload) => Promise<void>;
  onCancel: () => void;
}

export default function LoanRequestForm({
  users = [],
  online,
  saving,
  selfService = false,
  onSubmit,
  onCancel,
}: LoanRequestFormProps) {
  const fid = useId();
  const [form, setForm] = useState<HrLoanRequestPayload>({
    purpose: '',
    currency: 'NIO',
    requestedAmount: '',
    preferredInstallments: 1,
    payrollDeductionRequested: true,
  });
  const [confirmed, setConfirmed] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    await onSubmit({ ...form, purpose: form.purpose.trim() });
  };

  return (
    <HrModalFormShell
      ariaLabel="Sección de solicitud de préstamo"
      tabLabel="Préstamo"
      sectionTitle="Solicitante, monto y plan preferido"
      icon={<WalletCards size={18} aria-hidden="true" />}
      formClassName="hr-benefits-form"
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} variant="primary" type="submit" disabled={!online || saving || !confirmed}>
            Enviar solicitud
          </Button>
        </>
      }
    >
      {!selfService && (
        <div className="span-full">
          <Field label="Persona solicitante" htmlFor={`${fid}-persona-solicitante`}>
            <AppSelect<string> inputId={`${fid}-persona-solicitante`}
              options={[
                { value: '', label: 'Selecciona una persona' },
                ...users.map((user) => ({
                  value: String(user.id),
                  label: user.name || user.username,
                })),
              ]}
              value={String(form.userId ?? '')}
              onChange={(next) =>
                setForm((current) => ({ ...current, userId: Number(next ?? '') }))
              }
              isClearable={false}
            />
          </Field>
        </div>
      )}
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
      <Field label="Cuotas preferidas" htmlFor={`${fid}-cuotas-preferidas`} hint="El calendario final y sus cuotas se calculan en el servidor.">
        <Input id={`${fid}-cuotas-preferidas`}
          type="number"
          min="1"
          max="120"
          value={form.preferredInstallments}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              preferredInstallments: Number(event.target.value),
            }))
          }
          required
        />
      </Field>
      <Field label="Primera fecha preferida" htmlFor={`${fid}-primera-fecha-preferida`}>
        <DateInput id={`${fid}-primera-fecha-preferida`}
         
          value={form.firstPreferredDeductionDate ?? ''}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              firstPreferredDeductionDate: event.target.value || undefined,
            }))
          }
        />
      </Field>
      <div className="span-full">
        <Field label="Finalidad" htmlFor={`${fid}-finalidad`}>
          <Textarea id={`${fid}-finalidad`}
            rows={4}
            value={form.purpose}
            onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
            maxLength={900}
            required
          />
        </Field>
      </div>
      <Checkbox className="span-full" checked={form.payrollDeductionRequested}
          onChange={(event) =>
            setForm((current) => ({ ...current, payrollDeductionRequested: event.target.checked }))
          } label={<><span>Solicitar descuento por nómina, sujeto a elegibilidad, límites y aprobación.</span></>} />
      <Checkbox className="span-full" checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} label={<><span>
          <ShieldCheck size={17} aria-hidden="true" /> Confirmo que los datos son correctos y
          entiendo que no representan aprobación.
        </span></>} />
    </HrModalFormShell>
  );
}
