import { Button, DateInput, Field, Input, Textarea } from '@/ui';
import { useState, type ReactNode, useId } from 'react';
import { Scale } from 'lucide-react';
import HrModalFormShell from './HrModalFormShell';
import type { HrPayrollRulePayload, HrPayrollRuleVersion } from '../../types/hr-payroll';

interface PayrollRuleFormProps {
  initial?: HrPayrollRuleVersion | null;
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrPayrollRulePayload) => Promise<void>;
  onCancel: () => void;
  notice?: ReactNode;
}

export default function PayrollRuleForm({
  initial,
  online,
  saving,
  onSubmit,
  onCancel,
  notice,
}: PayrollRuleFormProps) {
  const fid = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom ?? '');
  const [effectiveTo, setEffectiveTo] = useState(initial?.effectiveTo ?? '');
  const [sourceReference, setSourceReference] = useState(initial?.sourceReference ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);

  const sourceIsValid = sourceReference.trim().length >= 3;
  const datesAreValid = !effectiveTo || !effectiveFrom || effectiveTo >= effectiveFrom;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sourceIsValid) {
      setValidationError('La referencia normativa debe contener al menos 3 caracteres.');
      return;
    }
    if (!datesAreValid) {
      setValidationError('La fecha final no puede ser anterior a la fecha inicial.');
      return;
    }
    setValidationError(null);
    await onSubmit({
      name: name.trim(),
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      sourceReference: sourceReference.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <HrModalFormShell
      ariaLabel="Sección de regla de nómina"
      tabLabel="Regla"
      sectionTitle="Identidad, vigencia y respaldo normativo"
      icon={<Scale size={18} aria-hidden="true" />}
      notice={notice}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving}
            type="submit"
            disabled={
              !online ||
              saving ||
              !name.trim() ||
              !effectiveFrom ||
              !sourceIsValid ||
              !datesAreValid
            }
          >
            {initial ? 'Guardar nueva revisión' : 'Crear borrador'}
          </Button>
        </>
      }
    >
      <Field label="Nombre de la versión" htmlFor={`${fid}-nombre-de-la-version`}>
        <Input id={`${fid}-nombre-de-la-version`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
        />
      </Field>
      <Field label="Vigente desde" htmlFor={`${fid}-vigente-desde`}>
        <DateInput id={`${fid}-vigente-desde`}
         
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
          required
        />
      </Field>
      <Field label="Vigente hasta" htmlFor={`${fid}-vigente-hasta`}>
        <DateInput id={`${fid}-vigente-hasta`}
         
          min={effectiveFrom || undefined}
          value={effectiveTo}
          onChange={(event) => setEffectiveTo(event.target.value)}
        />
      </Field>
      <Field label="Referencia normativa o interna" htmlFor={`${fid}-referencia-normativa-o-interna`}>
        <Input id={`${fid}-referencia-normativa-o-interna`}
          value={sourceReference}
          onChange={(event) => setSourceReference(event.target.value)}
          minLength={3}
          maxLength={240}
          required
        />
      </Field>
      {validationError && (
        <p className="hr-payroll-warning span-full" role="alert">
          {validationError}
        </p>
      )}
      <div className="span-full">
        <Field label="Descripción de alcance" htmlFor={`${fid}-descripcion-de-alcance`}>
          <Textarea id={`${fid}-descripcion-de-alcance`}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={700}
          />
        </Field>
      </div>
      <p className="hr-payroll-help span-full">
        Esta pantalla versiona metadatos y vigencia. No captura tasas, fórmulas legales ni valores
        calculados.
      </p>
    </HrModalFormShell>
  );
}
