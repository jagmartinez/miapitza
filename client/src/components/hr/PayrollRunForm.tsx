import HrReactSelect from './HrReactSelect';
import { useState, type ReactNode } from 'react';
import { Calculator, Gift } from 'lucide-react';
import Button from '../Button';
import HrModalFormShell from './HrModalFormShell';
import type {
  HrAguinaldoRunPayload,
  HrPayrollPeriod,
  HrPayrollRuleVersion,
  HrPayrollRunKind,
  HrPayrollRunPayload,
} from '../../types/hr-payroll';

interface PayrollRunFormProps {
  kind: HrPayrollRunKind;
  periods: HrPayrollPeriod[];
  rules: HrPayrollRuleVersion[];
  online: boolean;
  saving: boolean;
  onSubmit: (payload: HrPayrollRunPayload | HrAguinaldoRunPayload) => Promise<void>;
  onCancel: () => void;
  notice?: ReactNode;
}

export default function PayrollRunForm({
  kind,
  periods,
  rules,
  online,
  saving,
  onSubmit,
  onCancel,
  notice,
}: PayrollRunFormProps) {
  const currentYear = new Date().getFullYear();
  const [periodId, setPeriodId] = useState('');
  const [ruleVersionId, setRuleVersionId] = useState('');
  const [year, setYear] = useState(String(currentYear));
  const [cutoffDate, setCutoffDate] = useState(`${currentYear}-12-31`);
  const [reason, setReason] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (kind === 'AGUINALDO') {
      await onSubmit({
        year: Number(year),
        cutoffDate,
        ruleVersionId: Number(ruleVersionId),
        reason: reason.trim(),
      });
      return;
    }
    await onSubmit({
      periodId: Number(periodId),
      ruleVersionId: Number(ruleVersionId),
      reason: reason.trim(),
    });
  };

  const valid = Boolean(
    ruleVersionId && reason.trim() && (kind === 'AGUINALDO' ? year && cutoffDate : periodId)
  );
  const isAguinaldo = kind === 'AGUINALDO';
  const icon = isAguinaldo ? (
    <Gift size={18} aria-hidden="true" />
  ) : (
    <Calculator size={18} aria-hidden="true" />
  );

  return (
    <HrModalFormShell
      ariaLabel={isAguinaldo ? 'Sección de corrida de aguinaldo' : 'Sección de corrida de nómina'}
      tabLabel={isAguinaldo ? 'Aguinaldo' : 'Corrida'}
      sectionTitle={isAguinaldo ? 'Año, corte y regla aplicable' : 'Periodo y regla aplicable'}
      icon={icon}
      formClassName="hr-payroll-form"
      notice={notice}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!online || saving || !valid}>
            {saving ? 'Creando…' : isAguinaldo ? 'Crear aguinaldo' : 'Crear corrida'}
          </Button>
        </>
      }
    >
      {kind === 'REGULAR' ? (
        <label>
          Periodo
          <HrReactSelect
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
            required
          >
            <option value="">Seleccionar…</option>
            {periods
              .filter((period) => period.status !== 'VOID')
              .map((period) => (
                <option key={period.id} value={period.id}>
                  {period.code} · {period.dateFrom} – {period.dateTo}
                </option>
              ))}
          </HrReactSelect>
        </label>
      ) : (
        <>
          <label>
            Año
            <input
              type="number"
              min="2000"
              max="2200"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              required
            />
          </label>
          <label>
            Fecha de corte
            <input
              type="date"
              value={cutoffDate}
              onChange={(event) => setCutoffDate(event.target.value)}
              required
            />
          </label>
        </>
      )}
      <label>
        Regla activa
        <HrReactSelect
          value={ruleVersionId}
          onChange={(event) => setRuleVersionId(event.target.value)}
          required
        >
          <option value="">Seleccionar…</option>
          {rules
            .filter((rule) => rule.status === 'ACTIVE')
            .map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name} · v{rule.version}
              </option>
            ))}
        </HrReactSelect>
      </label>
      <label className="span-full">
        Razón de apertura
        <textarea
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={700}
          required
        />
      </label>
      <p className="hr-payroll-help span-full">
        Se enviará sólo alcance, periodo y regla. El servidor obtiene empleados elegibles, snapshot
        y todos los importes.
      </p>
    </HrModalFormShell>
  );
}
