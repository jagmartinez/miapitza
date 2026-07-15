import { useState } from 'react';
import { AlertTriangle, UsersRound } from 'lucide-react';
import Button from '../Button';
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
    <form className="hr-payroll-form" onSubmit={(event) => void submit(event)}>
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
      {action === 'MARK_PAID' && (
        <>
          <label>
            Referencia de pago
            <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={160} required />
          </label>
          <label>
            Fecha fiscal congelada
            <input type="date" value={paymentDate} readOnly required />
          </label>
          <label>
            Método
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="CHEQUE">Cheque</option>
              <option value="EFECTIVO">Efectivo</option>
              <option value="OTRO">Otro</option>
            </select>
          </label>
          <label>
            Lote bancario o contable
            <input value={batchReference} onChange={(event) => setBatchReference(event.target.value)} maxLength={160} />
          </label>
          <label className="span-full">
            Referencia de evidencia de pago
            <input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={500} required />
          </label>
        </>
      )}
      {action === 'VOID' && run.status === 'PAID' && (
        <>
          <label>
            Referencia de reversión externa
            <input value={reversalReference} onChange={(event) => setReversalReference(event.target.value)} maxLength={160} required />
          </label>
          <label>
            Fecha de reversión
            <input type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} required />
          </label>
          <label>
            Método de reversión
            <select value={reversalMethod} onChange={(event) => setReversalMethod(event.target.value)}>
              <option value="TRANSFERENCIA_REVERSA">Transferencia reversa</option>
              <option value="ANULACION_CHEQUE">Anulación de cheque</option>
              <option value="DEVOLUCION_EFECTIVO">Devolución de efectivo</option>
              <option value="OTRO">Otro</option>
            </select>
          </label>
          <label className="span-full">
            Evidencia de reversión
            <input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={500} required />
          </label>
        </>
      )}
      <label className="hr-payroll-confirm span-full">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          Confirmo explícitamente la acción <strong>{LABELS[action]}</strong> sobre {run.code} y que
          revisé anomalías, snapshot y componentes.
        </span>
      </label>
      <div className="hr-payroll-form-actions span-full">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Volver
        </Button>
        <Button
          type="submit"
          variant={sensitive ? 'danger' : 'primary'}
          disabled={
            !online || saving || !confirmed || !reason.trim() ||
            (action === 'MARK_PAID' && (!paymentReference.trim() || !paymentDate || !paymentMethod || !evidenceReference.trim())) ||
            (action === 'VOID' && run.status === 'PAID' && (!reversalReference.trim() || !reversalDate || !reversalMethod || !evidenceReference.trim()))
          }
        >
          {saving ? 'Registrando…' : LABELS[action]}
        </Button>
      </div>
    </form>
  );
}
