import { AppSelect, Button, Checkbox, DateInput, Field, Input, Textarea } from '@/ui';
import HrModalFormShell from './HrModalFormShell';
import PayrollOnlineNotice from './PayrollOnlineNotice';
import { useState, useId } from 'react';
import { AlertTriangle, UsersRound } from 'lucide-react';
import type {
  HrPayrollAction,
  HrPayrollRun,
  HrPayrollTransitionPayload,
} from '../../types/hr-payroll';

const LABELS: Record<HrPayrollAction, string> = {
  CALCULATE: 'Calcular',
  RECALCULATE: 'Recalcular',
  SUBMIT_REVIEW: 'Enviar a revisión',
  APPROVE: 'Aprobar',
  MARK_PAID: 'Marcar como pagada',
  VOID: 'Anular corrida',
};

interface PayrollTransitionFormProps {
  run: HrPayrollRun;
  action: HrPayrollAction;
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrPayrollTransitionPayload) => Promise<void>;
  onCancel: () => void;
}

export default function PayrollTransitionForm({
  run,
  action,
  online,
  saving,
  onSubmit,
  onCancel,
}: PayrollTransitionFormProps) {
  const fid = useId();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate] = useState(() =>
    (run.kind === 'REGULAR' ? run.period?.payDate : run.cutoffDate)?.slice(0, 10) ?? ''
  );
  const [paymentMethod, setPaymentMethod] = useState('TRANSFERENCIA');
  const [batchReference, setBatchReference] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [reversalReference, setReversalReference] = useState('');
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [reversalMethod, setReversalMethod] = useState('TRANSFERENCIA_REVERSA');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    await onSubmit({
      reason: reason.trim(),
      confirmed: true,
      expectedRevision: run.revision,
      ...(action === 'MARK_PAID'
        ? {
            paymentReference: paymentReference.trim(),
            paymentDate,
            paymentMethod,
            batchReference: batchReference.trim() || undefined,
            evidenceReference: evidenceReference.trim(),
          }
        : {}),
      ...(action === 'VOID' && run.status === 'PAID'
        ? {
            reversalReference: reversalReference.trim(),
            reversalDate,
            reversalMethod,
            evidenceReference: evidenceReference.trim(),
          }
        : {}),
    });
  };

  const sensitive = action === 'APPROVE' || action === 'MARK_PAID' || action === 'VOID';

  return (
    <HrModalFormShell
      ariaLabel={`Acción de nómina: ${LABELS[action]}`}
      tabLabel={LABELS[action]}
      sectionTitle={`${LABELS[action]} · ${run.code}`}
      icon={<UsersRound size={18} aria-hidden="true" />}
      notice={<PayrollOnlineNotice online={online} compact />}
      onSubmit={(event) => void submit(event)}
      footer={<>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Volver
        </Button>
        <Button
          type="submit"
          variant={sensitive ? 'danger' : 'primary'}
          loading={saving}
          disabled={
            !online || saving || !confirmed || !reason.trim() ||
            (action === 'MARK_PAID' && (!paymentReference.trim() || !paymentDate || !paymentMethod || !evidenceReference.trim())) ||
            (action === 'VOID' && run.status === 'PAID' && (!reversalReference.trim() || !reversalDate || !reversalMethod || !evidenceReference.trim()))
          }
        >
          {LABELS[action]}
        </Button>
      </>}
    >
      <div className={`hr-payroll-warning span-full ${sensitive ? 'danger' : ''}`} role="note">
        <AlertTriangle size={20} aria-hidden="true" />
        <span>
          {action === 'CALCULATE' || action === 'RECALCULATE'
            ? 'El servidor congelará o renovará el snapshot y calculará todos los componentes. La UI no envía totales.'
            : action === 'APPROVE'
              ? 'Aprobar bloquea ediciones ordinarias. Anomalías bloqueantes y segregación de funciones se validan en servidor.'
              : action === 'MARK_PAID'
                ? 'Marcar pagada publica recibos y registra al actor de pago. Requiere control separado de cálculo y aprobación.'
                : action === 'VOID'
                  ? 'La anulación conserva corrida, recibos, actores y motivo; no elimina trazabilidad.'
                  : 'La revisión debe completarse antes de aprobar.'}
        </span>
      </div>
      <div className="hr-payroll-dual-control span-full">
        <UsersRound size={19} aria-hidden="true" />
        <div>
          <strong>Doble control</strong>
          <span>
            Calculó: {run.calculatedBy?.name ?? '—'} · Aprobó: {run.approvedBy?.name ?? '—'} · Pagó:{' '}
            {run.paidBy?.name ?? '—'}
          </span>
          <small>El backend impide que una misma identidad ejecute pasos incompatibles.</small>
        </div>
      </div>
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
      {action === 'MARK_PAID' && (
        <>
          <Field label="Referencia de pago" htmlFor={`${fid}-referencia-de-pago`}>
            <Input id={`${fid}-referencia-de-pago`} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={160} required />
          </Field>
          <Field label="Fecha fiscal congelada" htmlFor={`${fid}-fecha-fiscal-congelada`}>
            <DateInput id={`${fid}-fecha-fiscal-congelada`} value={paymentDate} readOnly required />
          </Field>
          <Field label="Método" htmlFor={`${fid}-metodo`}>
            <AppSelect<string> inputId={`${fid}-metodo`}
              options={[
                { value: 'TRANSFERENCIA', label: 'Transferencia' },
                { value: 'CHEQUE', label: 'Cheque' },
                { value: 'EFECTIVO', label: 'Efectivo' },
                { value: 'OTRO', label: 'Otro' },
              ]}
              value={paymentMethod}
              onChange={(next) => setPaymentMethod(next ?? '')}
              isClearable={false}
            />
          </Field>
          <Field label="Lote bancario o contable" htmlFor={`${fid}-lote-bancario-o-contable`}>
            <Input id={`${fid}-lote-bancario-o-contable`} value={batchReference} onChange={(event) => setBatchReference(event.target.value)} maxLength={160} />
          </Field>
          <div className="span-full">
            <Field label="Referencia de evidencia de pago" htmlFor={`${fid}-referencia-de-evidencia-de`}>
              <Input id={`${fid}-referencia-de-evidencia-de`} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={500} required />
            </Field>
          </div>
        </>
      )}
      {action === 'VOID' && run.status === 'PAID' && (
        <>
          <Field label="Referencia de reversión externa" htmlFor={`${fid}-referencia-de-reversion-externa`}>
            <Input id={`${fid}-referencia-de-reversion-externa`} value={reversalReference} onChange={(event) => setReversalReference(event.target.value)} maxLength={160} required />
          </Field>
          <Field label="Fecha de reversión" htmlFor={`${fid}-fecha-de-reversion`}>
            <DateInput id={`${fid}-fecha-de-reversion`} value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} required />
          </Field>
          <Field label="Método de reversión" htmlFor={`${fid}-metodo-de-reversion`}>
            <AppSelect<string> inputId={`${fid}-metodo-de-reversion`}
              options={[
                { value: 'TRANSFERENCIA_REVERSA', label: 'Transferencia reversa' },
                { value: 'ANULACION_CHEQUE', label: 'Anulación de cheque' },
                { value: 'DEVOLUCION_EFECTIVO', label: 'Devolución de efectivo' },
                { value: 'OTRO', label: 'Otro' },
              ]}
              value={reversalMethod}
              onChange={(next) => setReversalMethod(next ?? '')}
              isClearable={false}
            />
          </Field>
          <div className="span-full">
            <Field label="Evidencia de reversión" htmlFor={`${fid}-evidencia-de-reversion`}>
              <Input id={`${fid}-evidencia-de-reversion`} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={500} required />
            </Field>
          </div>
        </>
      )}
      <Checkbox className="span-full" checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)} label={<><span>
          Confirmo explícitamente la acción <strong>{LABELS[action]}</strong> sobre {run.code} y que
          revisé anomalías, snapshot y componentes.
        </span></>} />
    </HrModalFormShell>
  );
}
