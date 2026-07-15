import { useState } from 'react';
import { FileCheck2, ShieldCheck } from 'lucide-react';
import Button from '../Button';
import type {
  HrPayrollConfigurationReviewPayload,
  HrPayrollConfigurationUploadPayload,
  HrPayrollRuleConfigurationRevision,
  HrPayrollRuleVersion,
} from '../../types/hr-payroll';

interface Props {
  rule: HrPayrollRuleVersion;
  revisions: HrPayrollRuleConfigurationRevision[];
  loading: boolean;
  saving: boolean;
  online: boolean;
  onUpload: (payload: HrPayrollConfigurationUploadPayload) => Promise<void>;
  onReview: (payload: HrPayrollConfigurationReviewPayload) => Promise<void>;
}

const decimal = /^\d+(?:\.\d+)?$/;

export default function PayrollRuleConfigurationPanel({
  rule,
  revisions,
  loading,
  saving,
  online,
  onUpload,
  onReview,
}: Props) {
  const [currency, setCurrency] = useState('NIO');
  const [weekly, setWeekly] = useState('');
  const [biweekly, setBiweekly] = useState('');
  const [monthly, setMonthly] = useState('');
  const [overtime, setOvertime] = useState('');
  const [leaveDay, setLeaveDay] = useState('');
  const [leaveHour, setLeaveHour] = useState('');
  const [leaveMinute, setLeaveMinute] = useState('');
  const [lookbackDays, setLookbackDays] = useState('');
  const [incomeDivisor, setIncomeDivisor] = useState('');
  const [prorationMode, setProrationMode] = useState<'NONE' | 'SERVICE_DAYS_RATIO'>('SERVICE_DAYS_RATIO');
  const [eligibleSources, setEligibleSources] = useState('');
  const [sourceReference, setSourceReference] = useState(rule.sourceReference);
  const [evidenceReference, setEvidenceReference] = useState('');
  const [uploadReason, setUploadReason] = useState('');
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const decimals = [weekly, biweekly, monthly, overtime, leaveDay, leaveHour, leaveMinute, incomeDivisor];
  const uploadReady =
    /^[A-Z]{3}$/.test(currency) &&
    decimals.every((value) => decimal.test(value) && Number(value) > 0) &&
    Number.isInteger(Number(lookbackDays)) &&
    Number(lookbackDays) >= 1 &&
    Number(lookbackDays) <= 731 &&
    eligibleSources.split(',').some((value) => value.trim()) &&
    sourceReference.trim().length >= 3 &&
    evidenceReference.trim().length >= 3 &&
    uploadReason.trim().length >= 3 &&
    sourceConfirmed;

  const submitUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadReady) return;
    await onUpload({
      configuration: {
        schema: 'HR_PAYROLL_PARAMETRIC_V1',
        legallyValidated: true,
        currency,
        regular: {
          minuteDivisors: { WEEKLY: weekly, BIWEEKLY: biweekly, MONTHLY: monthly },
          overtimeMultiplier: overtime,
          paidLeaveUnitMinutes: { DAYS: leaveDay, HOURS: leaveHour, MINUTES: leaveMinute },
        },
        aguinaldo: {
          method: 'HISTORICAL_PAID_COMPONENTS',
          lookbackDays: Number(lookbackDays),
          incomeDivisor,
          prorationMode,
          eligibleSources: eligibleSources.split(',').map((value) => value.trim()).filter(Boolean),
          roundingScale: 2,
        },
      },
      sourceReference: sourceReference.trim(),
      evidenceReference: evidenceReference.trim(),
      reason: uploadReason.trim(),
      expectedRevision: rule.revision,
    });
  };

  const review = async (
    revision: HrPayrollRuleConfigurationRevision,
    decision: 'VALIDATED' | 'REJECTED'
  ) => {
    if (!reviewConfirmed || reviewReason.trim().length < 3) return;
    await onReview({
      configurationRevisionId: revision.id,
      decision,
      reason: reviewReason.trim(),
      expectedRevision: rule.revision,
    });
  };

  return (
    <div className="hr-payroll-configuration">
      <div className="hr-payroll-warning span-full" role="note">
        <ShieldCheck size={20} aria-hidden="true" />
        <span>
          El servidor valida el esquema, congela el hash y exige que otra identidad revise la carga.
          La activación permanece bloqueada hasta obtener estado VALIDATED.
        </span>
      </div>

      {rule.status === 'DRAFT' && (
        <form className="hr-payroll-form" onSubmit={(event) => void submitUpload(event)}>
          <h3 className="span-full">Nueva configuración paramétrica</h3>
          <label>
            Moneda ISO
            <input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} required />
          </label>
          <label>
            Multiplicador hora extra
            <input type="number" min="0.0001" step="0.0001" value={overtime} onChange={(event) => setOvertime(event.target.value)} required />
          </label>
          <label>
            Divisor minutos semanal
            <input type="number" min="0.0001" step="0.0001" value={weekly} onChange={(event) => setWeekly(event.target.value)} required />
          </label>
          <label>
            Divisor minutos quincenal
            <input type="number" min="0.0001" step="0.0001" value={biweekly} onChange={(event) => setBiweekly(event.target.value)} required />
          </label>
          <label>
            Divisor minutos mensual
            <input type="number" min="0.0001" step="0.0001" value={monthly} onChange={(event) => setMonthly(event.target.value)} required />
          </label>
          <label>
            Permiso: minutos por día
            <input type="number" min="0.0001" step="0.0001" value={leaveDay} onChange={(event) => setLeaveDay(event.target.value)} required />
          </label>
          <label>
            Permiso: minutos por hora
            <input type="number" min="0.0001" step="0.0001" value={leaveHour} onChange={(event) => setLeaveHour(event.target.value)} required />
          </label>
          <label>
            Permiso: minutos por minuto
            <input type="number" min="0.0001" step="0.0001" value={leaveMinute} onChange={(event) => setLeaveMinute(event.target.value)} required />
          </label>
          <label>
            Aguinaldo: días históricos
            <input type="number" min="1" max="731" value={lookbackDays} onChange={(event) => setLookbackDays(event.target.value)} required />
          </label>
          <label>
            Aguinaldo: divisor de ingreso
            <input type="number" min="0.0001" step="0.0001" value={incomeDivisor} onChange={(event) => setIncomeDivisor(event.target.value)} required />
          </label>
          <label>
            Prorrateo
            <select value={prorationMode} onChange={(event) => setProrationMode(event.target.value as typeof prorationMode)}>
              <option value="SERVICE_DAYS_RATIO">Proporción por días de servicio</option>
              <option value="NONE">Sin prorrateo</option>
            </select>
          </label>
          <label>
            Fuentes elegibles, separadas por coma
            <input value={eligibleSources} onChange={(event) => setEligibleSources(event.target.value)} placeholder="RULE, OVERTIME" required />
          </label>
          <label className="span-full">
            Referencia de fuente
            <input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} maxLength={500} required />
          </label>
          <label className="span-full">
            Referencia de evidencia validada
            <input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={500} required />
          </label>
          <label className="span-full">
            Motivo de carga
            <textarea rows={3} value={uploadReason} onChange={(event) => setUploadReason(event.target.value)} maxLength={900} required />
          </label>
          <label className="hr-payroll-confirm span-full">
            <input type="checkbox" checked={sourceConfirmed} onChange={(event) => setSourceConfirmed(event.target.checked)} />
            <span>Confirmo que cada parámetro fue transcrito de una fuente autorizada y verificable.</span>
          </label>
          <div className="hr-payroll-form-actions span-full">
            <Button type="submit" disabled={!online || saving || !uploadReady}>
              {saving ? 'Guardando…' : 'Cargar revisión inmutable'}
            </Button>
          </div>
        </form>
      )}

      <section className="hr-payroll-config-history" aria-live="polite">
        <h3>Historial de control dual</h3>
        {loading ? (
          <p>Cargando revisiones…</p>
        ) : revisions.length === 0 ? (
          <p className="hr-payroll-empty">Aún no hay configuraciones cargadas.</p>
        ) : (
          revisions.map((revision) => (
            <article key={revision.id}>
              <div>
                <strong>Configuración v{revision.revision} · {revision.status}</strong>
                <span>Hash {revision.configurationHash.slice(0, 16)}…</span>
                <small>
                  Cargó {revision.uploadedBy?.name ?? `usuario ${revision.uploadedBy?.id ?? '—'}`} · fuente {revision.sourceReference}
                </small>
                {revision.reviewer && <small>Revisó {revision.reviewer.name ?? revision.reviewer.username} · {revision.reviewReason}</small>}
              </div>
              {revision.status === 'UPLOADED' && rule.status === 'DRAFT' && (
                <div className="hr-payroll-config-review">
                  <label>
                    Dictamen independiente
                    <input value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} maxLength={900} />
                  </label>
                  <label className="hr-payroll-confirm">
                    <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
                    <span>Revisé fuente, evidencia, vigencia y hash.</span>
                  </label>
                  <div>
                    <Button size="sm" variant="danger" disabled={!online || saving || !reviewConfirmed || reviewReason.trim().length < 3} onClick={() => void review(revision, 'REJECTED')}>Rechazar</Button>
                    <Button size="sm" disabled={!online || saving || !reviewConfirmed || reviewReason.trim().length < 3} onClick={() => void review(revision, 'VALIDATED')}><FileCheck2 size={15} /> Validar</Button>
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
