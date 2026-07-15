import { useState } from 'react';
import Button from '../Button';
import type { HrPayrollRulePayload, HrPayrollRuleVersion } from '../../types/hr-payroll';

interface PayrollRuleFormProps {
  initial?: HrPayrollRuleVersion | null;
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrPayrollRulePayload) => Promise<void>;
  onCancel: () => void;
}

export default function PayrollRuleForm({
  initial,
  online,
  saving,
  onSubmit,
  onCancel,
}: PayrollRuleFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom ?? '');
  const [effectiveTo, setEffectiveTo] = useState(initial?.effectiveTo ?? '');
  const [sourceReference, setSourceReference] = useState(initial?.sourceReference ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({
      name: name.trim(),
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      sourceReference: sourceReference.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <form className="hr-payroll-form" onSubmit={(event) => void submit(event)}>
      <label>
        Nombre de la versión
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
        />
      </label>
      <label>
        Vigente desde
        <input
          type="date"
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
          required
        />
      </label>
      <label>
        Vigente hasta
        <input
          type="date"
          min={effectiveFrom || undefined}
          value={effectiveTo}
          onChange={(event) => setEffectiveTo(event.target.value)}
        />
      </label>
      <label>
        Referencia normativa o interna
        <input
          value={sourceReference}
          onChange={(event) => setSourceReference(event.target.value)}
          maxLength={240}
          required
        />
      </label>
      <label className="span-full">
        Descripción de alcance
        <textarea
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={700}
        />
      </label>
      <p className="hr-payroll-help span-full">
        Esta pantalla versiona metadatos y vigencia. No captura tasas, fórmulas legales ni valores
        calculados.
      </p>
      <div className="hr-payroll-form-actions span-full">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={!online || saving || !name.trim() || !effectiveFrom || !sourceReference.trim()}
        >
          {saving ? 'Guardando…' : initial ? 'Guardar nueva revisión' : 'Crear borrador'}
        </Button>
      </div>
    </form>
  );
}
