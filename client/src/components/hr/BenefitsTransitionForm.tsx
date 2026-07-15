import { useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import Button from '../Button';
import HrMoneyInput from './HrMoneyInput';
import type {
  HrBenefitsActionInput,
  HrDeductionAction,
  HrLoanAction,
  HrTravelAction,
} from '../../types/hr-benefits';

type BenefitsAction = HrTravelAction | HrLoanAction | HrDeductionAction;

const LABELS: Record<BenefitsAction, string> = {
  SUBMIT: 'Enviar a aprobación',
  APPROVE: 'Aprobar',
  REJECT: 'Rechazar',
  REGISTER_ADVANCE: 'Registrar anticipo',
  START_SETTLEMENT: 'Iniciar liquidación',
  SETTLE: 'Cerrar liquidación',
  CANCEL: 'Cancelar',
  REVERSE: 'Revertir',
  DISBURSE: 'Registrar desembolso',
  REGISTER_PAYMENT: 'Registrar abono',
  CLOSE: 'Cerrar préstamo',
  ACTIVATE: 'Activar',
  PAUSE: 'Pausar',
  RESUME: 'Reanudar',
};

interface BenefitsTransitionFormProps {
  code: string;
  revision: number;
  action: BenefitsAction;
  resource: 'TRAVEL' | 'LOAN' | 'DEDUCTION';
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrBenefitsActionInput) => Promise<void>;
  onCancel: () => void;
}

export default function BenefitsTransitionForm({
  code,
  revision,
  action,
  resource,
  online,
  saving,
  onSubmit,
  onCancel,
}: BenefitsTransitionFormProps) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [proposedAmount, setProposedAmount] = useState('');
  const [installmentCount, setInstallmentCount] = useState('');
  const [firstDueDate, setFirstDueDate] = useState('');
  const [operationReference, setOperationReference] = useState('');

  const isApproval = action === 'APPROVE';
  const asksAmount = isApproval || action === 'REGISTER_PAYMENT';
  const asksReference = ['REGISTER_ADVANCE', 'DISBURSE', 'REGISTER_PAYMENT', 'SETTLE', 'REVERSE'].includes(
    action
  );
  const sensitive = [
    'APPROVE',
    'DISBURSE',
    'SETTLE',
    'CLOSE',
    'CANCEL',
    'REVERSE',
    'ACTIVATE',
  ].includes(action);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    await onSubmit({
      reason: reason.trim(),
      confirmed: true,
      expectedRevision: revision,
      effectiveDate: effectiveDate || undefined,
      proposedAmount: proposedAmount || undefined,
      installmentCount: installmentCount ? Number(installmentCount) : undefined,
      firstDueDate: firstDueDate || undefined,
      operationReference: operationReference.trim() || undefined,
    });
  };

  return (
    <form className="hr-benefits-form" onSubmit={(event) => void submit(event)}>
      <div className={`hr-benefits-warning span-full ${sensitive ? 'danger' : ''}`} role="note">
        <AlertTriangle size={20} aria-hidden="true" />
        <span>
          {action === 'REVERSE'
            ? 'La reversión es compensatoria: conserva el asiento original y exige referencia y motivo auditable.'
            : action === 'APPROVE'
              ? 'La aprobación debe estar segregada de la solicitud. Elegibilidad, límites y monto final se validan en servidor.'
              : action === 'SETTLE'
                ? 'El servidor concilia anticipo y gastos aceptados para determinar devolución o reembolso.'
                : action === 'DISBURSE'
                  ? 'El desembolso crea el ledger y el calendario autoritativo; esta interfaz no calcula cuotas.'
                  : 'La transición será validada contra estado, revisión y permisos vigentes.'}
        </span>
      </div>
      <label>
        Fecha efectiva
        <input
          type="date"
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
          required
        />
      </label>
      {asksAmount && (
        <label>
          {action === 'REGISTER_PAYMENT' ? 'Monto recibido' : 'Monto propuesto para aprobación'}
          <HrMoneyInput
            value={proposedAmount}
            onValueChange={setProposedAmount}
            required
          />
          <small>El servidor devolverá el monto aplicado y el saldo resultante.</small>
        </label>
      )}
      {resource === 'LOAN' && isApproval && (
        <>
          <label>
            Número de cuotas propuesto
            <input
              type="number"
              min="1"
              max="120"
              value={installmentCount}
              onChange={(event) => setInstallmentCount(event.target.value)}
              required
            />
          </label>
          <label>
            Primera cuota propuesta
            <input
              type="date"
              value={firstDueDate}
              onChange={(event) => setFirstDueDate(event.target.value)}
              required
            />
          </label>
        </>
      )}
      {asksReference && (
        <label className="span-full">
          Referencia de operación
          <input
            value={operationReference}
            onChange={(event) => setOperationReference(event.target.value)}
            maxLength={160}
            required
          />
        </label>
      )}
      <label className="span-full">
        Motivo obligatorio
        <textarea
          rows={5}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
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
          <ShieldCheck size={17} aria-hidden="true" /> Confirmo <strong>{LABELS[action]}</strong>{' '}
          sobre {code} y revisé el detalle financiero.
        </span>
      </label>
      <div className="hr-benefits-form-actions span-full">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Volver
        </Button>
        <Button
          type="submit"
          variant={sensitive ? 'danger' : 'primary'}
          disabled={
            !online ||
            saving ||
            !confirmed ||
            !reason.trim() ||
            (asksAmount && !proposedAmount) ||
            (asksReference && !operationReference.trim())
          }
        >
          {saving ? 'Registrando…' : LABELS[action]}
        </Button>
      </div>
    </form>
  );
}
