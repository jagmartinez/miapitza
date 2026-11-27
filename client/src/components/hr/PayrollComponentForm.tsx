import { AppSelect, Button, Checkbox, Field, Input, Textarea } from '@/ui';
import HrMoneyInput from './HrMoneyInput';
import HrModalFormShell from './HrModalFormShell';
import PayrollOnlineNotice from './PayrollOnlineNotice';
import { useState, useId } from 'react';
import { CircleDollarSign } from 'lucide-react';
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
  const fid = useId();
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
    <HrModalFormShell
      ariaLabel="Agregar concepto a la corrida"
      tabLabel="Concepto"
      sectionTitle="Colaborador, importe y clasificación legal"
      icon={<CircleDollarSign size={18} aria-hidden="true" />}
      notice={<PayrollOnlineNotice online={online} compact />}
      onSubmit={(event) => void submit(event)}
      footer={<>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button loading={saving} variant="primary"
          type="submit"
          disabled={!online || saving || !userId || !selectedConcept || !inputAmount || !reason.trim() || !classificationConfirmed}
        >
          Agregar componente
        </Button>
      </>}
    >
      <Field label="Persona" htmlFor={`${fid}-persona`}>
        <AppSelect<string> inputId={`${fid}-persona`}
          options={[
            { value: '', label: 'Seleccionar…' },
            ...users.map((user) => ({
              value: String(user.id),
              label: `${user.name} · @${user.username}`,
            })),
          ]}
          value={userId}
          onChange={(next) => setUserId(next ?? '')}
          isClearable={false}
        />
      </Field>
      <Field label="Concepto configurado" htmlFor={`${fid}-concepto-configurado`}>
        <AppSelect<string> inputId={`${fid}-concepto-configurado`}
          options={[
            { value: '', label: 'Seleccionar…' },
            ...concepts.map((concept) => ({
              value: String(concept.code),
              label: `${concept.name} · ${concept.code}`,
            })),
          ]}
          value={code}
          onChange={(next) => {
            setCode(next ?? '');
            setClassificationConfirmed(false);
          }}
          isClearable={false}
        />
      </Field>
      <Field label="Importe de entrada" htmlFor={`${fid}-importe-de-entrada`}>
        <HrMoneyInput id={`${fid}-importe-de-entrada`}
          value={inputAmount}
          onValueChange={setInputAmount}
          required
        />
      </Field>
      {selectedConcept && <fieldset className="span-full hr-payroll-component-classification">
        <legend>Tratamiento congelado del catálogo</legend>
        <span>Tipo: {selectedConcept.type === 'INCOME' ? 'Ingreso' : 'Deducción'}</span>
        <span>INSS laboral: {selectedConcept.socialSecurityApplicable ? 'Aplica' : 'No aplica'}</span>
        <span>INATEC: {selectedConcept.trainingContributionApplicable ? 'Aplica' : 'No aplica'}</span>
        <span>IR laboral: {selectedConcept.incomeTaxTreatment ?? (selectedConcept.incomeTaxDeductible ? 'Deducción autorizada' : 'No aplica')}</span>
        <span>IR por régimen empresarial: {incomeTaxApplicability === 'APPLIES' ? 'Se calcula' : incomeTaxApplicability === 'DOES_NOT_APPLY' ? 'No se calcula' : 'Sin configuración disponible'}</span>
        <small>Fuente configurada: {selectedConcept.sourceReference}</small>
        <Checkbox checked={classificationConfirmed} onChange={(event) => setClassificationConfirmed(event.target.checked)} label={<>Confirmo que este es el concepto correcto; las banderas no pueden modificarse en la corrida.</>} />
      </fieldset>}
      <Field label="Referencia de soporte" htmlFor={`${fid}-referencia-de-soporte`}>
        <Input id={`${fid}-referencia-de-soporte`}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          maxLength={500}
          placeholder={selectedConcept?.sourceReference}
        />
      </Field>
      <div className="span-full">
        <Field label="Motivo" htmlFor={`${fid}-motivo`}>
          <Textarea id={`${fid}-motivo`}
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={700}
            required
          />
        </Field>
      </div>
      <p className="hr-payroll-help span-full">
        El importe es una entrada manual auditable. El servidor recalcula INSS, INATEC, IR y totales
        desde el catálogo congelado; la UI no permite alterar las banderas INSS o IR dentro de la corrida.
      </p>
    </HrModalFormShell>
  );
}
