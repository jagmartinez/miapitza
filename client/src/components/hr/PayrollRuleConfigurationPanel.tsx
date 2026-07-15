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
const rate = (value: string) => decimal.test(value) && Number(value) >= 0 && Number(value) <= 1;
const codes = (value: string) => value.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
const DEFAULT_BRACKETS = [
  { lowerBound: '0', upperBound: '100000', baseTax: '0', rate: '0', excessOver: '0' },
  { lowerBound: '100000', upperBound: '200000', baseTax: '0', rate: '0.15', excessOver: '100000' },
  { lowerBound: '200000', upperBound: '350000', baseTax: '15000', rate: '0.20', excessOver: '200000' },
  { lowerBound: '350000', upperBound: '500000', baseTax: '45000', rate: '0.25', excessOver: '350000' },
  { lowerBound: '500000', upperBound: null, baseTax: '82500', rate: '0.30', excessOver: '500000' },
];

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
  const [companyTaxRegime, setCompanyTaxRegime] = useState<'GENERAL' | 'SIMPLIFIED_FIXED_QUOTA' | 'SPECIAL' | 'EXEMPT' | 'OTHER'>('GENERAL');
  const [taxRegimeReference, setTaxRegimeReference] = useState('https://www.dgi.gob.ni/pdfArchivo/22');
  const [inssApplicability, setInssApplicability] = useState<'APPLIES' | 'DOES_NOT_APPLY'>('APPLIES');
  const [inssRegime, setInssRegime] = useState<'INTEGRAL' | 'IVM_RP' | 'FACULTATIVE_INTEGRAL' | 'FACULTATIVE_IVM' | 'OTHER'>('INTEGRAL');
  const [inssEmployeeRate, setInssEmployeeRate] = useState('0.07');
  const [inssEmployerBelow, setInssEmployerBelow] = useState('0.215');
  const [inssEmployerAtOrAbove, setInssEmployerAtOrAbove] = useState('0.225');
  const [inssThreshold, setInssThreshold] = useState('50');
  const [inssMinimumBase, setInssMinimumBase] = useState('');
  const [inssCodes, setInssCodes] = useState('INGRESO_ORDINARIO,HORAS_EXTRA_APROBADAS,PERMISO_PAGADO_APROBADO');
  const [inssReference, setInssReference] = useState('https://inss-princ.inss.gob.ni/index.php/tramites-37/10-afiliaciones/13-regimenes-de-afiliacion');
  const [inssException, setInssException] = useState('');
  const [inatecApplicability, setInatecApplicability] = useState<'APPLIES' | 'DOES_NOT_APPLY'>('APPLIES');
  const [inatecRate, setInatecRate] = useState('0.02');
  const [inatecCodes, setInatecCodes] = useState('INGRESO_ORDINARIO,HORAS_EXTRA_APROBADAS,PERMISO_PAGADO_APROBADO');
  const [inatecReference, setInatecReference] = useState('https://www.tecnacional.edu.ni/acerca/');
  const [inatecException, setInatecException] = useState('');
  const [incomeTaxApplicability, setIncomeTaxApplicability] = useState<'APPLIES' | 'DOES_NOT_APPLY'>('APPLIES');
  const [incomeTaxCodes, setIncomeTaxCodes] = useState('INGRESO_ORDINARIO,HORAS_EXTRA_APROBADAS,PERMISO_PAGADO_APROBADO');
  const [incomeTaxReference, setIncomeTaxReference] = useState('https://legislacion.asamblea.gob.ni/SILEG/Gacetas.nsf/15a7e7ceb5efa9c6062576eb0060b321/9c520cbf65bf930606257aec005d6802/$FILE/2013-01-15-%20Decreto%20Ejecutivo%20No.%2001-2013,%20Reglamento%20de%20la%20Ley%20No.%20822,%20Ley%20de%20concertaci%C3%B3n%20tributaria.pdf');
  const [incomeTaxException, setIncomeTaxException] = useState('');
  const [periodsWeekly, setPeriodsWeekly] = useState('52');
  const [periodsBiweekly, setPeriodsBiweekly] = useState('24');
  const [periodsMonthly, setPeriodsMonthly] = useState('12');
  const [brackets, setBrackets] = useState(DEFAULT_BRACKETS);
  const [irIndependenceConfirmed, setIrIndependenceConfirmed] = useState(false);
  const [sourceReference, setSourceReference] = useState(rule.sourceReference);
  const [evidenceReference, setEvidenceReference] = useState('');
  const [uploadReason, setUploadReason] = useState('');
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const decimals = [weekly, biweekly, monthly, overtime, leaveDay, leaveHour, leaveMinute, incomeDivisor];
  const obligationReady = (applicability: 'APPLIES' | 'DOES_NOT_APPLY', reference: string, exception: string) =>
    reference.trim().length >= 3 && (applicability === 'APPLIES' || exception.trim().length >= 3);
  const statutoryReady =
    taxRegimeReference.trim().length >= 3 &&
    obligationReady(inssApplicability, inssReference, inssException) &&
    obligationReady(inatecApplicability, inatecReference, inatecException) &&
    obligationReady(incomeTaxApplicability, incomeTaxReference, incomeTaxException) &&
    rate(inssEmployeeRate) && rate(inssEmployerBelow) && rate(inssEmployerAtOrAbove) &&
    Number.isInteger(Number(inssThreshold)) && Number(inssThreshold) >= 1 &&
    decimal.test(inssMinimumBase) && (inssApplicability === 'DOES_NOT_APPLY' || Number(inssMinimumBase) > 0) &&
    rate(inatecRate) && codes(inssCodes).length > 0 && codes(inatecCodes).length > 0 && codes(incomeTaxCodes).length > 0 &&
    [periodsWeekly, periodsBiweekly, periodsMonthly].every((value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 366) &&
    brackets.every((bracket, index) => decimal.test(bracket.lowerBound) && decimal.test(bracket.baseTax) && rate(bracket.rate) && decimal.test(bracket.excessOver) && (index === brackets.length - 1 ? bracket.upperBound === null : Boolean(bracket.upperBound && decimal.test(bracket.upperBound)))) &&
    irIndependenceConfirmed;
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
    sourceConfirmed && statutoryReady;

  const submitUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadReady) return;
    await onUpload({
      configuration: {
        schema: 'HR_PAYROLL_PARAMETRIC_V2',
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
        statutory: {
          companyTaxRegime: { code: companyTaxRegime, sourceReference: taxRegimeReference.trim() },
          inss: {
            applicability: inssApplicability, sourceReference: inssReference.trim(), exceptionReason: inssApplicability === 'DOES_NOT_APPLY' ? inssException.trim() : undefined,
            regime: inssRegime, employeeRate: inssEmployeeRate, employerRateBelowThreshold: inssEmployerBelow,
            employerRateAtOrAboveThreshold: inssEmployerAtOrAbove, employerSizeThreshold: Number(inssThreshold),
            minimumMonthlyContributionBase: inssMinimumBase, minimumBaseProration: 'PER_PAY_PERIOD_SERVICE_RATIO',
            contributionComponentCodes: codes(inssCodes),
          },
          inatec: {
            applicability: inatecApplicability, sourceReference: inatecReference.trim(), exceptionReason: inatecApplicability === 'DOES_NOT_APPLY' ? inatecException.trim() : undefined,
            employerRate: inatecRate, contributionComponentCodes: codes(inatecCodes),
          },
          incomeTax: {
            applicability: incomeTaxApplicability, sourceReference: incomeTaxReference.trim(), exceptionReason: incomeTaxApplicability === 'DOES_NOT_APPLY' ? incomeTaxException.trim() : undefined,
            regimeIndependenceAcknowledged: true, calculationMethod: 'VARIABLE_ACCUMULATED', inssEmployeeContributionDeductible: true,
            adjustmentMode: 'WITHHOLD_OR_REFUND', annualPeriods: { WEEKLY: Number(periodsWeekly), BIWEEKLY: Number(periodsBiweekly), MONTHLY: Number(periodsMonthly) },
            taxableComponentCodes: codes(incomeTaxCodes), brackets,
          },
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

  const updateBracket = (index: number, field: keyof typeof brackets[number], value: string) => {
    setBrackets((current) => current.map((bracket, position) => position === index
      ? { ...bracket, [field]: field === 'upperBound' && position === current.length - 1 ? null : value }
      : bracket));
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
          <h3 className="span-full">Obligaciones estatutarias de Nicaragua</h3>
          <div className="hr-payroll-warning span-full" role="note">
            El régimen de cuota fija afecta la actividad económica, pero no desactiva automáticamente el IR de rentas del trabajo. Cada obligación se configura y evidencia por separado.
          </div>
          <label>
            Régimen tributario empresarial
            <select value={companyTaxRegime} onChange={(event) => setCompanyTaxRegime(event.target.value as typeof companyTaxRegime)}>
              <option value="GENERAL">General</option>
              <option value="SIMPLIFIED_FIXED_QUOTA">Cuota fija / simplificado</option>
              <option value="SPECIAL">Especial</option>
              <option value="EXEMPT">Exento</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>
          <label>
            Fuente del régimen
            <input value={taxRegimeReference} onChange={(event) => setTaxRegimeReference(event.target.value)} maxLength={500} required />
          </label>

          <h4 className="span-full">INSS</h4>
          <label>Aplicación<select value={inssApplicability} onChange={(event) => setInssApplicability(event.target.value as typeof inssApplicability)}><option value="APPLIES">Aplica</option><option value="DOES_NOT_APPLY">No aplica con excepción documentada</option></select></label>
          <label>Régimen INSS<select value={inssRegime} onChange={(event) => setInssRegime(event.target.value as typeof inssRegime)}><option value="INTEGRAL">Integral</option><option value="IVM_RP">IVM-RP</option><option value="FACULTATIVE_INTEGRAL">Facultativo integral</option><option value="FACULTATIVE_IVM">Facultativo IVM</option><option value="OTHER">Otro</option></select></label>
          <label>Tasa laboral (0.07 = 7%)<input type="number" min="0" max="1" step="0.000001" value={inssEmployeeRate} onChange={(event) => setInssEmployeeRate(event.target.value)} required /></label>
          <label>Tasa patronal menor al umbral<input type="number" min="0" max="1" step="0.000001" value={inssEmployerBelow} onChange={(event) => setInssEmployerBelow(event.target.value)} required /></label>
          <label>Tasa patronal desde el umbral<input type="number" min="0" max="1" step="0.000001" value={inssEmployerAtOrAbove} onChange={(event) => setInssEmployerAtOrAbove(event.target.value)} required /></label>
          <label>Umbral de colaboradores<input type="number" min="1" step="1" value={inssThreshold} onChange={(event) => setInssThreshold(event.target.value)} required /></label>
          <label>Base mínima mensual del sector<input type="number" min="0" step="0.01" value={inssMinimumBase} onChange={(event) => setInssMinimumBase(event.target.value)} required /></label>
          <label className="span-full">Conceptos cotizables INSS<input value={inssCodes} onChange={(event) => setInssCodes(event.target.value)} maxLength={1000} required /></label>
          <label className="span-full">Fuente INSS<input value={inssReference} onChange={(event) => setInssReference(event.target.value)} maxLength={500} required /></label>
          {inssApplicability === 'DOES_NOT_APPLY' && <label className="span-full">Fundamento de excepción INSS<textarea value={inssException} onChange={(event) => setInssException(event.target.value)} required /></label>}

          <h4 className="span-full">INATEC</h4>
          <label>Aplicación<select value={inatecApplicability} onChange={(event) => setInatecApplicability(event.target.value as typeof inatecApplicability)}><option value="APPLIES">Aplica</option><option value="DOES_NOT_APPLY">No aplica con excepción documentada</option></select></label>
          <label>Tasa patronal (0.02 = 2%)<input type="number" min="0" max="1" step="0.000001" value={inatecRate} onChange={(event) => setInatecRate(event.target.value)} required /></label>
          <label className="span-full">Conceptos base INATEC<input value={inatecCodes} onChange={(event) => setInatecCodes(event.target.value)} maxLength={1000} required /></label>
          <label className="span-full">Fuente INATEC<input value={inatecReference} onChange={(event) => setInatecReference(event.target.value)} maxLength={500} required /></label>
          {inatecApplicability === 'DOES_NOT_APPLY' && <label className="span-full">Fundamento de excepción INATEC<textarea value={inatecException} onChange={(event) => setInatecException(event.target.value)} required /></label>}

          <h4 className="span-full">IR de rentas del trabajo</h4>
          <label>Aplicación<select value={incomeTaxApplicability} onChange={(event) => setIncomeTaxApplicability(event.target.value as typeof incomeTaxApplicability)}><option value="APPLIES">Aplica</option><option value="DOES_NOT_APPLY">No aplica con excepción documentada</option></select></label>
          <label>Períodos anuales semanales<input type="number" min="1" max="366" value={periodsWeekly} onChange={(event) => setPeriodsWeekly(event.target.value)} required /></label>
          <label>Períodos anuales quincenales<input type="number" min="1" max="366" value={periodsBiweekly} onChange={(event) => setPeriodsBiweekly(event.target.value)} required /></label>
          <label>Períodos anuales mensuales<input type="number" min="1" max="366" value={periodsMonthly} onChange={(event) => setPeriodsMonthly(event.target.value)} required /></label>
          <label className="span-full">Conceptos gravables IR<input value={incomeTaxCodes} onChange={(event) => setIncomeTaxCodes(event.target.value)} maxLength={1000} required /></label>
          <label className="span-full">Fuente de metodología IR<input value={incomeTaxReference} onChange={(event) => setIncomeTaxReference(event.target.value)} maxLength={500} required /></label>
          {incomeTaxApplicability === 'DOES_NOT_APPLY' && <label className="span-full">Fundamento de excepción IR laboral<textarea value={incomeTaxException} onChange={(event) => setIncomeTaxException(event.target.value)} required /></label>}
          <div className="span-full hr-payroll-tax-table">
            <strong>Tabla progresiva anual</strong>
            <div className="table-scroll"><table><thead><tr><th>Desde</th><th>Hasta</th><th>Impuesto base</th><th>Tasa</th><th>Sobre exceso</th></tr></thead><tbody>
              {brackets.map((bracket, index) => <tr key={index}>
                <td><input type="number" min="0" step="0.01" value={bracket.lowerBound} onChange={(event) => updateBracket(index, 'lowerBound', event.target.value)} required /></td>
                <td>{index === brackets.length - 1 ? 'En adelante' : <input type="number" min="0" step="0.01" value={bracket.upperBound ?? ''} onChange={(event) => updateBracket(index, 'upperBound', event.target.value)} required />}</td>
                <td><input type="number" min="0" step="0.01" value={bracket.baseTax} onChange={(event) => updateBracket(index, 'baseTax', event.target.value)} required /></td>
                <td><input type="number" min="0" max="1" step="0.000001" value={bracket.rate} onChange={(event) => updateBracket(index, 'rate', event.target.value)} required /></td>
                <td><input type="number" min="0" step="0.01" value={bracket.excessOver} onChange={(event) => updateBracket(index, 'excessOver', event.target.value)} required /></td>
              </tr>)}
            </tbody></table></div>
          </div>
          <label className="hr-payroll-confirm span-full">
            <input type="checkbox" checked={irIndependenceConfirmed} onChange={(event) => setIrIndependenceConfirmed(event.target.checked)} />
            <span>Confirmo que revisé por separado el régimen de la empresa y la obligación de retener IR laboral.</span>
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
