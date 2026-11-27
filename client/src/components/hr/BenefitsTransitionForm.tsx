import { Button, Checkbox, DateInput, Field, Input, Textarea } from '@/ui';
import { useState, useId } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import HrMoneyInput from './HrMoneyInput';
import HrModalFormShell from './HrModalFormShell';
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
  const fid = useId();
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

  const notice = (
      <div className={`hr-benefits-warning ${sensitive ? 'danger' : ''}`} role="note">
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
  );

  return (
    <HrModalFormShell
      ariaLabel="Confirmación de beneficio"
      tabLabel="Revisión"
      sectionTitle={`${LABELS[action]} ${code}`}
      icon={<ShieldCheck size={18} aria-hidden="true" />}
      formClassName="hr-benefits-form"
      notice={notice}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Volver
          </Button>
          <Button loading={saving}
            type="submit"
            variant={sensitive ? 'danger' : 'primary'}
            disabled={!online || saving || !confirmed || !reason.trim() || (asksAmount && !proposedAmount) || (asksReference && !operationReference.trim())}
          >
            {LABELS[action]}
          </Button>
        </>
      }
    >
      <Field label="Fecha efectiva" htmlFor={`${fid}-fecha-efectiva`}>
        <DateInput id={`${fid}-fecha-efectiva`}
         
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
          required
        />
      </Field>
      {asksAmount && (
        <Field
          label={action === 'REGISTER_PAYMENT' ? 'Monto recibido' : 'Monto propuesto para aprobación'}
          htmlFor={`${fid}-monto`}
          hint="El servidor devolverá el monto aplicado y el saldo resultante."
        >
          <HrMoneyInput id={`${fid}-monto`}
            value={proposedAmount}
            onValueChange={setProposedAmount}
            required
          />
        </Field>
      )}
      {resource === 'LOAN' && isApproval && (
        <>
          <Field label="Número de cuotas propuesto" htmlFor={`${fid}-numero-de-cuotas-propuesto`}>
            <Input id={`${fid}-numero-de-cuotas-propuesto`}
              type="number"
              min="1"
              max="120"
              value={installmentCount}
              onChange={(event) => setInstallmentCount(event.target.value)}
              required
            />
          </Field>
          <Field label="Primera cuota propuesta" htmlFor={`${fid}-primera-cuota-propuesta`}>
            <DateInput id={`${fid}-primera-cuota-propuesta`}
             
              value={firstDueDate}
              onChange={(event) => setFirstDueDate(event.target.value)}
              required
            />
          </Field>
        </>
      )}
      {asksReference && (
        <div className="span-full">
          <Field label="Referencia de operación" htmlFor={`${fid}-referencia-de-operacion`}>
            <Input id={`${fid}-referencia-de-operacion`}
              value={operationReference}
              onChange={(event) => setOperationReference(event.target.value)}
              maxLength={160}
              required
            />
          </Field>
        </div>
      )}
      <div className="span-full">
        <Field label="Motivo obligatorio" htmlFor={`${fid}-motivo-obligatorio`}>
          <Textarea id={`${fid}-motivo-obligatorio`}
            rows={5}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={900}
            required
          />
        </Field>
      </div>
      <Checkbox className="span-full" checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} label={<><span>
          <ShieldCheck size={17} aria-hidden="true" /> Confirmo <strong>{LABELS[action]}</strong>{' '}
          sobre {code} y revisé el detalle financiero.
        </span></>} />
    </HrModalFormShell>
  );
}
