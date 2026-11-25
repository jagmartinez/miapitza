import { AppSelect, Button } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import { useState } from 'react';
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
          <Button variant="primary" type="submit" disabled={!online || saving || !confirmed}>
            {saving ? 'Enviando…' : 'Enviar solicitud'}
          </Button>
        </>
      }
    >
      {!selfService && (
        <label className="span-full">
          Persona solicitante
          <AppSelect<string>
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
        </label>
      )}
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
        Cuotas preferidas
        <input
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
        <small>El calendario final y sus cuotas se calculan en el servidor.</small>
      </label>
      <label>
        Primera fecha preferida
        <input
          type="date"
          value={form.firstPreferredDeductionDate ?? ''}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              firstPreferredDeductionDate: event.target.value || undefined,
            }))
          }
        />
      </label>
      <label className="span-full">
        Finalidad
        <textarea
          rows={4}
          value={form.purpose}
          onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
          maxLength={900}
          required
        />
      </label>
      <label className="hr-benefits-check span-full">
        <input
          type="checkbox"
          checked={form.payrollDeductionRequested}
          onChange={(event) =>
            setForm((current) => ({ ...current, payrollDeductionRequested: event.target.checked }))
          }
        />
        <span>Solicitar descuento por nómina, sujeto a elegibilidad, límites y aprobación.</span>
      </label>
      <label className="hr-benefits-confirm span-full">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          <ShieldCheck size={17} aria-hidden="true" /> Confirmo que los datos son correctos y
          entiendo que no representan aprobación.
        </span>
      </label>
    </HrModalFormShell>
  );
}
