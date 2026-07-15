import HrReactSelect from './HrReactSelect';
import HrMoneyInput from './HrMoneyInput';
import { useState } from 'react';
import Button from '../Button';
import type { HrUserSummary } from '../../types/hr';
import type { HrPayrollComponentPayload, HrPayrollPaymentConceptDefinition } from '../../types/hr-payroll';

interface PayrollComponentFormProps {
  users: HrUserSummary[];
  concepts: HrPayrollPaymentConceptDefinition[];
  incomeTaxApplicability: 'APPLIES' | 'DOES_NOT_APPLY' | null;
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrPayrollComponentPayload) => Promise<void>;
  onCancel: () => void;
}

export default function PayrollComponentForm({
  users,
  concepts,
  incomeTaxApplicability,
  online,
  saving,
  onSubmit,
  onCancel,
}: PayrollComponentFormProps) {
  const [userId, setUserId] = useState('');
  const [code, setCode] = useState('');
  const [inputAmount, setInputAmount] = useState('');
  const [classificationConfirmed, setClassificationConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  const selectedConcept = concepts.find((concept) => concept.code === code) ?? null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!classificationConfirmed || !selectedConcept) return;
    await onSubmit({
      userId: Number(userId),
      code: selectedConcept.code,
      type: selectedConcept.type,
      inputAmount,
      taxable: selectedConcept.type === 'INCOME' && selectedConcept.incomeTaxTreatment !== null,
      incomeTaxTreatment: selectedConcept.incomeTaxTreatment ?? undefined,
      incomeTaxDeductible: selectedConcept.incomeTaxDeductible,
      socialSecurityApplicable: selectedConcept.socialSecurityApplicable,
      trainingContributionApplicable: selectedConcept.trainingContributionApplicable,
      classificationConfirmed: true,
      reason: reason.trim(),
      reference: reference.trim() || selectedConcept.sourceReference,
    });
  };

  return (
    <form className="hr-payroll-form" onSubmit={(event) => void submit(event)}>
      <label>
        Persona
        <HrReactSelect value={userId} onChange={(event) => setUserId(event.target.value)} required>
          <option value="">Seleccionar…</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} · @{user.username}
            </option>
          ))}
        </HrReactSelect>
      </label>
      <label>
        Concepto configurado
        <HrReactSelect value={code} onChange={(event) => { setCode(event.target.value); setClassificationConfirmed(false); }} required>
          <option value="">Seleccionar…</option>
          {concepts.map((concept) => <option key={concept.code} value={concept.code}>{concept.name} · {concept.code}</option>)}
        </HrReactSelect>
      </label>
      <label>
        Importe de entrada
        <HrMoneyInput
          value={inputAmount}
          onValueChange={setInputAmount}
          required
        />
      </label>
      {selectedConcept && <fieldset className="span-full hr-payroll-component-classification">
        <legend>Tratamiento congelado del catálogo</legend>
        <span>Tipo: {selectedConcept.type === 'INCOME' ? 'Ingreso' : 'Deducción'}</span>
        <span>INSS laboral: {selectedConcept.socialSecurityApplicable ? 'Aplica' : 'No aplica'}</span>
        <span>INATEC: {selectedConcept.trainingContributionApplicable ? 'Aplica' : 'No aplica'}</span>
        <span>IR laboral: {selectedConcept.incomeTaxTreatment ?? (selectedConcept.incomeTaxDeductible ? 'Deducción autorizada' : 'No aplica')}</span>
        <span>IR por régimen empresarial: {incomeTaxApplicability === 'APPLIES' ? 'Se calcula' : incomeTaxApplicability === 'DOES_NOT_APPLY' ? 'No se calcula' : 'Sin configuración disponible'}</span>
        <small>Fuente configurada: {selectedConcept.sourceReference}</small>
        <label><input type="checkbox" checked={classificationConfirmed} onChange={(event) => setClassificationConfirmed(event.target.checked)} /> Confirmo que este es el concepto correcto; las banderas no pueden modificarse en la corrida.</label>
      </fieldset>}
      <label>
        Referencia de soporte
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          maxLength={500}
          placeholder={selectedConcept?.sourceReference}
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
        desde el catálogo congelado; la UI no permite alterar las banderas INSS o IR dentro de la corrida.
      </p>
      <div className="hr-payroll-form-actions span-full">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={!online || saving || !userId || !selectedConcept || !inputAmount || !reason.trim() || !classificationConfirmed}
        >
          {saving ? 'Agregando…' : 'Agregar componente'}
        </Button>
      </div>
    </form>
  );
}
