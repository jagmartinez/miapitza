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
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({
      userId: Number(userId),
      code: code.trim().toUpperCase(),
      type,
      inputAmount,
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
          onChange={(event) => setType(event.target.value as HrPayrollComponentType)}
        >
          <option value="INCOME">Ingreso</option>
          <option value="DEDUCTION">Deducción</option>
        </select>
      </label>
      <label>
        Código configurado
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
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
      <label>
        Referencia
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          maxLength={160}
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
        El importe es una entrada manual auditable. El servidor valida el código y vuelve a calcular
        totales; la UI no envía bruto, deducciones totales ni neto.
      </p>
      <div className="hr-payroll-form-actions span-full">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={!online || saving || !userId || !code.trim() || !inputAmount || !reason.trim()}
        >
          {saving ? 'Agregando…' : 'Agregar componente'}
        </Button>
      </div>
    </form>
  );
}
