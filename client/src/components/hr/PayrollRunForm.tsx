import { AppSelect, Button, DateInput, Field, Input, Textarea } from '@/ui';
import { useState, type ReactNode, useId } from 'react';
import { Calculator, Gift } from 'lucide-react';
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
  const fid = useId();
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
      notice={notice}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} variant="primary" type="submit" disabled={!online || saving || !valid}>
            {isAguinaldo ? 'Crear aguinaldo' : 'Crear corrida'}
          </Button>
        </>
      }
    >
      {kind === 'REGULAR' ? (
        <Field label="Periodo" htmlFor={`${fid}-periodo`}>
          <AppSelect<string> inputId={`${fid}-periodo`}
            options={[
              { value: '', label: 'Seleccionar…' },
              ...periods
                .filter((period) => period.status !== 'VOID')
                .map((period) => ({
                  value: String(period.id),
                  label: `${period.code} · ${period.dateFrom} – ${period.dateTo}`,
                })),
            ]}
            value={periodId}
            onChange={(next) => setPeriodId(next ?? '')}
            isClearable={false}
          />
        </Field>
      ) : (
        <>
          <Field label="Año" htmlFor={`${fid}-ano`}>
            <Input id={`${fid}-ano`}
              type="number"
              min="2000"
              max="2200"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              required
            />
          </Field>
          <Field label="Fecha de corte" htmlFor={`${fid}-fecha-de-corte`}>
            <DateInput id={`${fid}-fecha-de-corte`}
             
              value={cutoffDate}
              onChange={(event) => setCutoffDate(event.target.value)}
              required
            />
          </Field>
        </>
      )}
      <Field label="Regla activa" htmlFor={`${fid}-regla-activa`}>
        <AppSelect<string> inputId={`${fid}-regla-activa`}
          options={[
            { value: '', label: 'Seleccionar…' },
            ...rules
              .filter((rule) => rule.status === 'ACTIVE')
              .map((rule) => ({
                value: String(rule.id),
                label: `${rule.name} · v${rule.version}`,
              })),
          ]}
          value={ruleVersionId}
          onChange={(next) => setRuleVersionId(next ?? '')}
          isClearable={false}
        />
      </Field>
      <div className="span-full">
        <Field label="Razón de apertura" htmlFor={`${fid}-razon-de-apertura`}>
          <Textarea id={`${fid}-razon-de-apertura`}
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={700}
            required
          />
        </Field>
      </div>
      <p className="hr-payroll-help span-full">
        Se enviará sólo alcance, periodo y regla. El servidor obtiene empleados elegibles, snapshot
        y todos los importes.
      </p>
    </HrModalFormShell>
  );
}
