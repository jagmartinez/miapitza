import { useState } from 'react';
import Button from '../Button';
import type { HrUserSummary } from '../../types/hr';
import type { HrPayrollComponentPayload, HrPayrollComponentType } from '../../types/hr-payroll';

interface PayrollComponentFormProps {
  users: HrUserSummary[];
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrPayrollComponentPayload) => Promise<void>;
  onCancel: () => void;
}

export default function PayrollComponentForm({
  users,
  online,
  saving,
  onSubmit,
  onCancel,
}: PayrollComponentFormProps) {
  const [userId, setUserId] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<HrPayrollComponentType>('INCOME');
  const [inputAmount, setInputAmount] = useState('');
  const [taxable, setTaxable] = useState(false);
  const [incomeTaxTreatment, setIncomeTaxTreatment] = useState<'' | 'REGULAR_FIXED' | 'REGULAR_VARIABLE' | 'OCCASIONAL'>('');
  const [incomeTaxDeductible, setIncomeTaxDeductible] = useState(false);
  const [socialSecurityApplicable, setSocialSecurityApplicable] = useState(false);
  const [trainingContributionApplicable, setTrainingContributionApplicable] = useState(false);
  const [classificationConfirmed, setClassificationConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!classificationConfirmed) return;
    await onSubmit({
      userId: Number(userId),
      code: code.trim().toUpperCase(),
      type,
      inputAmount,
      taxable: type === 'INCOME' ? taxable : false,
      incomeTaxTreatment: type === 'INCOME' && taxable && incomeTaxTreatment ? incomeTaxTreatment : undefined,
      incomeTaxDeductible: type === 'DEDUCTION' ? incomeTaxDeductible : false,
      socialSecurityApplicable: type === 'INCOME' ? socialSecurityApplicable : false,
      trainingContributionApplicable: type === 'INCOME' ? trainingContributionApplicable : false,
      classificationConfirmed: true,
      reason: reason.trim(),
      reference: reference.trim() || undefined,
    });
  };

  return (
    <form className="hr-payroll-form" onSubmit={(event) => void submit(event)}>
      <label>
        Persona
        <select value={userId} onChange={(event) => setUserId(event.target.value)} required>
          <option value="">Seleccionar…</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} · @{user.username}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tipo
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value as HrPayrollComponentType);
            setTaxable(false);
            setIncomeTaxTreatment('');
            setClassificationConfirmed(false);
          }}
        >
          <option value="INCOME">Ingreso</option>
          <option value="DEDUCTION">Deducción</option>
        </select>
      </label>
      <label>
        Código configurado
        <input
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setClassificationConfirmed(false);
          }}
          maxLength={50}
          required
        />
      </label>
      <label>
        Importe de entrada
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={inputAmount}
          onChange={(event) => setInputAmount(event.target.value)}
          required
        />
      </label>
      {type === 'INCOME' && <fieldset className="span-full hr-payroll-component-classification">
        <legend>Tratamiento estatutario del ingreso</legend>
        <label><input type="checkbox" checked={socialSecurityApplicable} onChange={(event) => { setSocialSecurityApplicable(event.target.checked); setClassificationConfirmed(false); }} /> Integra base INSS</label>
        <label><input type="checkbox" checked={trainingContributionApplicable} onChange={(event) => { setTrainingContributionApplicable(event.target.checked); setClassificationConfirmed(false); }} /> Integra base INATEC</label>
        <label><input type="checkbox" checked={taxable} onChange={(event) => { setTaxable(event.target.checked); setIncomeTaxTreatment(''); setClassificationConfirmed(false); }} /> Integra renta gravable de IR laboral</label>
        {taxable && <label>
          Tratamiento para el artículo 19
          <select value={incomeTaxTreatment} onChange={(event) => { setIncomeTaxTreatment(event.target.value as typeof incomeTaxTreatment); setClassificationConfirmed(false); }} required>
            <option value="">Seleccionar…</option>
            <option value="REGULAR_FIXED">Ordinario fijo</option>
            <option value="REGULAR_VARIABLE">Ordinario variable</option>
            <option value="OCCASIONAL">Ocasional (bono, vacaciones o incentivo)</option>
          </select>
        </label>}
        <label><input type="checkbox" checked={classificationConfirmed} onChange={(event) => setClassificationConfirmed(event.target.checked)} /> Confirmo que revisé la naturaleza legal del concepto y su soporte.</label>
      </fieldset>}
      {type === 'DEDUCTION' && <fieldset className="span-full hr-payroll-component-classification">
        <legend>Tratamiento tributario de la deducción</legend>
        <label><input type="checkbox" checked={incomeTaxDeductible} onChange={(event) => { setIncomeTaxDeductible(event.target.checked); setClassificationConfirmed(false); }} /> Es una deducción autorizada para determinar la renta neta de IR</label>
        <label><input type="checkbox" checked={classificationConfirmed} onChange={(event) => setClassificationConfirmed(event.target.checked)} /> Confirmo que existe soporte legal y documental; préstamos y descuentos ordinarios no se marcan automáticamente.</label>
      </fieldset>}
      <label>
        Referencia de soporte
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          maxLength={500}
          required={type === 'DEDUCTION' && incomeTaxDeductible}
        />
      </label>
      <label className="span-full">
        Motivo
        <textarea
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={700}
          required
        />
      </label>
      <p className="hr-payroll-help span-full">
        El importe es una entrada manual auditable. El servidor recalcula INSS, INATEC, IR y totales
        desde la clasificación declarada; la UI no envía bruto, deducciones totales ni neto. El código y
        las banderas deben coincidir exactamente con los catálogos de la regla legal congelada.
      </p>
      <div className="hr-payroll-form-actions span-full">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={!online || saving || !userId || !code.trim() || !inputAmount || !reason.trim() || !classificationConfirmed || (type === 'INCOME' && taxable && !incomeTaxTreatment) || (type === 'DEDUCTION' && incomeTaxDeductible && !reference.trim())}
        >
          {saving ? 'Agregando…' : 'Agregar componente'}
        </Button>
      </div>
    </form>
  );
}
