import { useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Calculator,
  ChevronDown,
  FileCheck2,
  Info,
  Landmark,
  Percent,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import Button from '../Button';
import HrMoneyInput from './HrMoneyInput';
import HrReactSelect from './HrReactSelect';
import PayrollPaymentConceptCatalogEditor from './PayrollPaymentConceptCatalogEditor';
import { DEFAULT_PAYMENT_CONCEPTS } from './payrollPaymentConceptDefaults';
import type {
  HrPayrollConfigurationReviewPayload,
  HrPayrollConfigurationUploadPayload,
  HrPayrollCompanyTaxProfile,
  HrPayrollLegalConfiguration,
  HrPayrollRuleConfigurationRevision,
  HrPayrollRuleVersion,
} from '../../types/hr-payroll';

interface Props {
  rule: HrPayrollRuleVersion;
  revisions: HrPayrollRuleConfigurationRevision[];
  loading: boolean;
  saving: boolean;
  online: boolean;
  companyTaxProfile: HrPayrollCompanyTaxProfile;
  onUpload: (payload: HrPayrollConfigurationUploadPayload) => Promise<void>;
  onReview: (payload: HrPayrollConfigurationReviewPayload) => Promise<void>;
}

type Bracket = HrPayrollLegalConfiguration['statutory']['incomeTax']['brackets'][number];

const DECIMAL = /^\d+(?:\.\d+)?$/;
const DEFAULT_BRACKETS: Bracket[] = [
  { lowerBound: '0', upperBound: '100000', baseTax: '0', rate: '0', excessOver: '0' },
  { lowerBound: '100000', upperBound: '200000', baseTax: '0', rate: '0.15', excessOver: '100000' },
  { lowerBound: '200000', upperBound: '350000', baseTax: '15000', rate: '0.20', excessOver: '200000' },
  { lowerBound: '350000', upperBound: '500000', baseTax: '45000', rate: '0.25', excessOver: '350000' },
  { lowerBound: '500000', upperBound: null, baseTax: '82500', rate: '0.30', excessOver: '500000' },
];

const decimalRateToPercent = (value: string) => value === ''
  ? ''
  : String(Number((Number(value) * 100).toFixed(6)));
const percentToDecimalRate = (value: string) => value === '' ? '' : String(Number(value) / 100);
const validPercent = (value: string) => DECIMAL.test(value) && Number(value) >= 0 && Number(value) <= 100;
const actorName = (actor?: { id: number; name?: string | null; username?: string | null } | null) =>
  actor?.name || actor?.username || (actor?.id ? `Usuario ${actor.id}` : 'Sin registro');

function formatDate(value?: string | null) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(new Date(value));
}

function configurationSeed(revisions: HrPayrollRuleConfigurationRevision[]) {
  return revisions[0]?.configuration;
}

function bracketTableIsValid(brackets: Bracket[]) {
  if (brackets.length < 2) return false;
  let expectedLower = 0;
  let expectedBase = 0;
  return brackets.every((bracket, index) => {
    if (
      !DECIMAL.test(bracket.lowerBound) || !DECIMAL.test(bracket.baseTax) ||
      !DECIMAL.test(bracket.excessOver) || !validPercent(decimalRateToPercent(bracket.rate))
    ) return false;
    const lower = Number(bracket.lowerBound);
    const base = Number(bracket.baseTax);
    if (lower !== expectedLower || Number(bracket.excessOver) !== lower || Math.abs(base - expectedBase) > 0.009) return false;
    if (index === brackets.length - 1) return bracket.upperBound === null;
    if (bracket.upperBound === null || !DECIMAL.test(bracket.upperBound)) return false;
    const upper = Number(bracket.upperBound);
    if (upper <= lower) return false;
    expectedLower = upper;
    expectedBase = Math.round((base + (upper - lower) * Number(bracket.rate)) * 100) / 100;
    return true;
  });
}

function recalculateBrackets(brackets: Bracket[]): Bracket[] {
  let lower = 0;
  let base = 0;
  return brackets.map((bracket, index) => {
    const next = {
      ...bracket,
      lowerBound: String(lower),
      excessOver: String(lower),
      baseTax: String(Math.round(base * 100) / 100),
      upperBound: index === brackets.length - 1 ? null : bracket.upperBound,
    };
    if (next.upperBound !== null && DECIMAL.test(next.upperBound) && Number(next.upperBound) > lower) {
      base = base + (Number(next.upperBound) - lower) * (DECIMAL.test(next.rate) ? Number(next.rate) : 0);
      lower = Number(next.upperBound);
    }
    return next;
  });
}

export default function PayrollRuleConfigurationPanel({
  rule,
  revisions,
  loading,
  saving,
  online,
  companyTaxProfile,
  onUpload,
  onReview,
}: Props) {
  const seed = configurationSeed(revisions);
  const seedStatutory = seed?.statutory;
  const [currency, setCurrency] = useState(seed?.currency ?? 'NIO');
  const [weekly, setWeekly] = useState(seed?.regular.minuteDivisors.WEEKLY ?? '2400');
  const [biweekly, setBiweekly] = useState(seed?.regular.minuteDivisors.BIWEEKLY ?? '4800');
  const [monthly, setMonthly] = useState(seed?.regular.minuteDivisors.MONTHLY ?? '9600');
  const [overtime, setOvertime] = useState(seed?.regular.overtimeMultiplier ?? '2');
  const [leaveDay, setLeaveDay] = useState(seed?.regular.paidLeaveUnitMinutes.DAYS ?? '480');
  const [leaveHour, setLeaveHour] = useState(seed?.regular.paidLeaveUnitMinutes.HOURS ?? '60');
  const [leaveMinute, setLeaveMinute] = useState(seed?.regular.paidLeaveUnitMinutes.MINUTES ?? '1');
  const [lookbackDays, setLookbackDays] = useState(String(seed?.aguinaldo.lookbackDays ?? 365));
  const [incomeDivisor, setIncomeDivisor] = useState(seed?.aguinaldo.incomeDivisor ?? '12');
  const [prorationMode, setProrationMode] = useState<'NONE' | 'SERVICE_DAYS_RATIO'>(seed?.aguinaldo.prorationMode ?? 'SERVICE_DAYS_RATIO');
  const [eligibleSources, setEligibleSources] = useState(seed?.aguinaldo.eligibleSources.join(', ') ?? 'ORDINARY, OVERTIME, PAID_LEAVE');
  const companyTaxRegime = companyTaxProfile.taxRegime;
  const taxRegimeReference = companyTaxProfile.sourceReference ?? '';
  const regimeIncomeTaxApplicability = companyTaxProfile.incomeTaxWithholding ? 'APPLIES' as const : 'DOES_NOT_APPLY' as const;
  const regimeIncomeTaxException = companyTaxProfile.incomeTaxException ?? '';
  const [inssApplicability, setInssApplicability] = useState<'APPLIES' | 'DOES_NOT_APPLY'>(seedStatutory?.inss.applicability ?? 'APPLIES');
  const [inssRegime, setInssRegime] = useState<'INTEGRAL' | 'IVM_RP' | 'FACULTATIVE_INTEGRAL' | 'FACULTATIVE_IVM' | 'OTHER'>(seedStatutory?.inss.regime ?? 'INTEGRAL');
  const [inssEmployeeRate, setInssEmployeeRate] = useState(decimalRateToPercent(seedStatutory?.inss.employeeRate ?? '0.07'));
  const [inssEmployerBelow, setInssEmployerBelow] = useState(decimalRateToPercent(seedStatutory?.inss.employerRateBelowThreshold ?? '0.215'));
  const [inssEmployerAtOrAbove, setInssEmployerAtOrAbove] = useState(decimalRateToPercent(seedStatutory?.inss.employerRateAtOrAboveThreshold ?? '0.225'));
  const [inssThreshold, setInssThreshold] = useState(String(seedStatutory?.inss.employerSizeThreshold ?? 50));
  const [inssMinimumBase, setInssMinimumBase] = useState(seedStatutory?.inss.minimumMonthlyContributionBase ?? '10000');
  const [inssReference, setInssReference] = useState(seedStatutory?.inss.sourceReference ?? 'Decreto 975 y reformas vigentes');
  const [inssException, setInssException] = useState(seedStatutory?.inss.exceptionReason ?? '');
  const [inatecApplicability, setInatecApplicability] = useState<'APPLIES' | 'DOES_NOT_APPLY'>(seedStatutory?.inatec.applicability ?? 'APPLIES');
  const [inatecRate, setInatecRate] = useState(decimalRateToPercent(seedStatutory?.inatec.employerRate ?? '0.02'));
  const [inatecReference, setInatecReference] = useState(seedStatutory?.inatec.sourceReference ?? 'Decreto 3-91, aporte patronal INATEC');
  const [inatecException, setInatecException] = useState(seedStatutory?.inatec.exceptionReason ?? '');
  const [paymentConceptCatalog, setPaymentConceptCatalog] = useState<HrPayrollLegalConfiguration['statutory']['paymentConceptCatalog']>(() =>
    (seedStatutory?.paymentConceptCatalog ?? DEFAULT_PAYMENT_CONCEPTS).map((concept) => ({
      ...concept,
      active: 'active' in concept ? concept.active : true,
    }))
  );
  const [incomeTaxReference, setIncomeTaxReference] = useState(seedStatutory?.incomeTax.sourceReference ?? 'Ley 822 art. 23 y Decreto 01-2013 art. 19');
  const [periodsWeekly, setPeriodsWeekly] = useState(String(seedStatutory?.incomeTax.annualPeriods.WEEKLY ?? 52));
  const [periodsBiweekly, setPeriodsBiweekly] = useState(String(seedStatutory?.incomeTax.annualPeriods.BIWEEKLY ?? 24));
  const [periodsMonthly, setPeriodsMonthly] = useState(String(seedStatutory?.incomeTax.annualPeriods.MONTHLY ?? 12));
  const [brackets, setBrackets] = useState<Bracket[]>(() => (seedStatutory?.incomeTax.brackets ?? DEFAULT_BRACKETS).map((bracket) => ({ ...bracket })));
  const [regimeRuleConfirmed, setRegimeRuleConfirmed] = useState(false);
  const [sourceReference, setSourceReference] = useState(rule.sourceReference);
  const [evidenceReference, setEvidenceReference] = useState(revisions[0]?.evidenceReference ?? '');
  const [uploadReason, setUploadReason] = useState(seed ? `Nueva revisión basada en la configuración v${revisions[0].revision}` : 'Configuración inicial de obligaciones laborales');
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [reviewReasonById, setReviewReasonById] = useState<Record<number, string>>({});
  const [reviewConfirmedById, setReviewConfirmedById] = useState<Record<number, boolean>>({});

  const conceptCatalogReady = useMemo(() => {
    const codes = paymentConceptCatalog.map((concept) => concept.code);
    return paymentConceptCatalog.length > 0 && new Set(codes).size === codes.length && paymentConceptCatalog.every((concept) =>
      /^[A-Z0-9_]{2,64}$/.test(concept.code) && concept.name.trim().length >= 2 && concept.sourceReference.trim().length >= 3 &&
      (concept.type === 'INCOME'
        ? !concept.incomeTaxDeductible
        : !concept.socialSecurityApplicable && !concept.trainingContributionApplicable && concept.incomeTaxTreatment === null)
    );
  }, [paymentConceptCatalog]);

  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    const obligationReady = (applicability: 'APPLIES' | 'DOES_NOT_APPLY', reference: string, exception: string) =>
      reference.trim().length >= 3 && (applicability === 'APPLIES' || exception.trim().length >= 3);
    const operationalDecimals = [weekly, biweekly, monthly, overtime, leaveDay, leaveHour, leaveMinute, incomeDivisor];
    if (!/^[A-Z]{3}$/.test(currency) || operationalDecimals.some((value) => !DECIMAL.test(value) || Number(value) <= 0)) issues.push('Completa los parámetros operativos de nómina y aguinaldo.');
    if (!Number.isInteger(Number(lookbackDays)) || Number(lookbackDays) < 1 || Number(lookbackDays) > 731 || !eligibleSources.split(',').some((value) => value.trim())) issues.push('Revisa el período y las fuentes elegibles del aguinaldo.');
    if (!companyTaxProfile.ready || !taxRegimeReference.trim() || (regimeIncomeTaxApplicability === 'DOES_NOT_APPLY' && regimeIncomeTaxException.trim().length < 3)) issues.push('Completa y confirma el perfil fiscal desde Empresas antes de guardar esta versión.');
    if (!obligationReady(inssApplicability, inssReference, inssException) || ![inssEmployeeRate, inssEmployerBelow, inssEmployerAtOrAbove].every(validPercent) || !Number.isInteger(Number(inssThreshold)) || Number(inssThreshold) < 1 || !DECIMAL.test(inssMinimumBase) || (inssApplicability === 'APPLIES' && Number(inssMinimumBase) <= 0)) issues.push('Revisa tasas, umbral, base mínima y fuente del INSS.');
    if (!obligationReady(inatecApplicability, inatecReference, inatecException) || !validPercent(inatecRate)) issues.push('Revisa la tasa, aplicabilidad y fuente del INATEC.');
    if (!incomeTaxReference.trim() || !bracketTableIsValid(brackets) || [periodsWeekly, periodsBiweekly, periodsMonthly].some((value) => !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 366)) issues.push('La tabla progresiva del IR debe ser continua y cuadrar impuesto base, tasa y exceso.');
    if (!conceptCatalogReady) issues.push('Cada concepto de pago necesita código único, clasificación y fuente.');
    if (inssApplicability === 'APPLIES' && !paymentConceptCatalog.some((concept) => concept.active && concept.type === 'INCOME' && concept.socialSecurityApplicable)) issues.push('Marca al menos un ingreso activo como sujeto a INSS.');
    if (inatecApplicability === 'APPLIES' && !paymentConceptCatalog.some((concept) => concept.active && concept.type === 'INCOME' && concept.trainingContributionApplicable)) issues.push('Marca al menos un ingreso activo como base de INATEC.');
    if (regimeIncomeTaxApplicability === 'APPLIES' && !paymentConceptCatalog.some((concept) => concept.active && concept.type === 'INCOME' && concept.incomeTaxTreatment !== null)) issues.push('Clasifica al menos un ingreso activo sujeto a IR laboral.');
    if (sourceReference.trim().length < 3 || evidenceReference.trim().length < 3 || uploadReason.trim().length < 3) issues.push('Agrega fuente general, evidencia y motivo de la revisión.');
    if (!regimeRuleConfirmed || !sourceConfirmed) issues.push('Faltan las dos confirmaciones finales.');
    return issues;
  }, [brackets, companyTaxProfile.ready, conceptCatalogReady, currency, eligibleSources, evidenceReference, incomeDivisor, incomeTaxReference, inatecApplicability, inatecException, inatecRate, inatecReference, inssApplicability, inssEmployeeRate, inssEmployerAtOrAbove, inssEmployerBelow, inssException, inssMinimumBase, inssReference, inssThreshold, leaveDay, leaveHour, leaveMinute, lookbackDays, monthly, overtime, paymentConceptCatalog, periodsBiweekly, periodsMonthly, periodsWeekly, regimeIncomeTaxApplicability, regimeIncomeTaxException, regimeRuleConfirmed, sourceConfirmed, sourceReference, taxRegimeReference, uploadReason, weekly, biweekly]);

  const uploadReady = validationIssues.length === 0;
  const editable = rule.status === 'DRAFT' && !rule.activeConfigurationRevisionId;
  const displayRevision = revisions.find((revision) => revision.id === rule.activeConfigurationRevisionId)
    ?? revisions.find((revision) => revision.status === 'VALIDATED')
    ?? revisions[0];

  const submitUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadReady) return;
    await onUpload({
      configuration: {
        schema: 'HR_PAYROLL_PARAMETRIC_V4',
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
          companyTaxRegime: {
            code: companyTaxRegime,
            sourceReference: taxRegimeReference.trim(),
            incomeTaxApplicability: regimeIncomeTaxApplicability,
            incomeTaxExceptionReason: regimeIncomeTaxApplicability === 'DOES_NOT_APPLY' ? regimeIncomeTaxException.trim() : undefined,
          },
          inss: {
            applicability: inssApplicability,
            sourceReference: inssReference.trim(),
            exceptionReason: inssApplicability === 'DOES_NOT_APPLY' ? inssException.trim() : undefined,
            regime: inssRegime,
            employeeRate: percentToDecimalRate(inssEmployeeRate),
            employerRateBelowThreshold: percentToDecimalRate(inssEmployerBelow),
            employerRateAtOrAboveThreshold: percentToDecimalRate(inssEmployerAtOrAbove),
            employerSizeThreshold: Number(inssThreshold),
            minimumMonthlyContributionBase: inssMinimumBase,
            minimumBaseProration: 'PER_PAY_PERIOD_SERVICE_RATIO',
            annualPeriods: { WEEKLY: Number(periodsWeekly), BIWEEKLY: Number(periodsBiweekly), MONTHLY: Number(periodsMonthly) },
          },
          inatec: {
            applicability: inatecApplicability,
            sourceReference: inatecReference.trim(),
            exceptionReason: inatecApplicability === 'DOES_NOT_APPLY' ? inatecException.trim() : undefined,
            employerRate: percentToDecimalRate(inatecRate),
          },
          incomeTax: {
            sourceReference: incomeTaxReference.trim(),
            regimeApplicabilityAcknowledged: true,
            calculationMethods: {
              fixed: 'FIXED_PERIOD_PROJECTION',
              salaryChange: 'FIXED_SALARY_CHANGE',
              variable: 'VARIABLE_ACCUMULATED',
              occasional: 'OCCASIONAL_INCREMENTAL',
            },
            inssEmployeeContributionDeductible: true,
            occasionalInssDeductionTreatment: 'DEDUCT_FROM_OCCASIONAL_NET',
            adjustmentMode: 'WITHHOLD_OR_REFUND',
            annualPeriods: { WEEKLY: Number(periodsWeekly), BIWEEKLY: Number(periodsBiweekly), MONTHLY: Number(periodsMonthly) },
            brackets,
          },
          paymentConceptCatalog,
        },
      },
      sourceReference: sourceReference.trim(),
      evidenceReference: evidenceReference.trim(),
      reason: uploadReason.trim(),
      expectedRevision: rule.revision,
    });
  };

  const review = async (revision: HrPayrollRuleConfigurationRevision, decision: 'VALIDATED' | 'REJECTED') => {
    const reason = reviewReasonById[revision.id]?.trim() ?? '';
    if (!reviewConfirmedById[revision.id] || reason.length < 3) return;
    await onReview({ configurationRevisionId: revision.id, decision, reason, expectedRevision: rule.revision });
  };

  const updateBracket = (index: number, field: keyof Bracket, value: string) => {
    setBrackets((current) => recalculateBrackets(current.map((bracket, position) => position === index
      ? { ...bracket, [field]: field === 'upperBound' && position === current.length - 1 ? null : value }
      : bracket)));
  };

  const addBracket = () => {
    setBrackets((current) => {
      const last = current[current.length - 1];
      const suggestedUpper = String(Number(last.lowerBound) + 100000);
      const next = [
        ...current.slice(0, -1),
        { ...last, upperBound: suggestedUpper },
        { ...last, lowerBound: suggestedUpper, excessOver: suggestedUpper, upperBound: null },
      ];
      return recalculateBrackets(next);
    });
  };

  return (
    <div className="hr-payroll-configuration hr-legal-panel">
      {editable ? (
        <form className="hr-legal-form" onSubmit={(event) => void submitUpload(event)} noValidate>
          <section className="hr-legal-form-section" aria-labelledby="legal-regime-title">
            <header>
              <span className="hr-legal-section-icon"><Landmark size={20} aria-hidden="true" /></span>
              <div><span className="hr-legal-step-label">1 · Alcance</span><h3 id="legal-regime-title">Régimen de la empresa</h3><p>Define si esta empresa retiene IR laboral. INSS e INATEC se configuran de forma independiente.</p></div>
            </header>
            <div className="hr-legal-company-profile" role="note">
              <dl>
                <div><dt>Empresa</dt><dd>{companyTaxProfile.companyName}</dd></div>
                <div><dt>Régimen DGI</dt><dd>{companyTaxRegime === 'GENERAL' ? 'General' : companyTaxRegime === 'SIMPLIFIED_FIXED_QUOTA' ? 'Cuota fija / simplificado' : companyTaxRegime === 'SPECIAL' ? 'Especial' : companyTaxRegime === 'EXEMPT' ? 'Exento' : 'Otro'}</dd></div>
                <div><dt>IR laboral</dt><dd>{companyTaxProfile.incomeTaxWithholding ? 'Calcula y retiene' : 'No retiene'}</dd></div>
                <div><dt>Estado</dt><dd>{companyTaxProfile.ready ? 'Confirmado' : 'Pendiente'}</dd></div>
                <div><dt>Respaldo</dt><dd>{taxRegimeReference || 'Pendiente'}</dd></div>
              </dl>
              {!companyTaxProfile.incomeTaxWithholding && <p><strong>Fundamento:</strong> {regimeIncomeTaxException || 'Pendiente de documentar en Empresas.'}</p>}
              <p>Este dato viene de <strong>Configuración → Empresas</strong>. La versión guarda una copia para auditoría; no se modifica aquí.</p>
            </div>
          </section>

          <section className="hr-legal-form-section" aria-labelledby="legal-contributions-title">
            <header>
              <span className="hr-legal-section-icon"><Users size={20} aria-hidden="true" /></span>
              <div><span className="hr-legal-step-label">2 · Aportes</span><h3 id="legal-contributions-title">INSS e INATEC</h3><p>Las tasas se ingresan como porcentajes normales: escribe 7 para representar 7%.</p></div>
            </header>
            <div className="hr-legal-obligation-grid">
              <fieldset>
                <legend>INSS</legend>
                <label>Aplicación<HrReactSelect value={inssApplicability} onChange={(event) => setInssApplicability(event.target.value as typeof inssApplicability)}><option value="APPLIES">Aplica</option><option value="DOES_NOT_APPLY">No aplica (documentar)</option></HrReactSelect></label>
                <label>Régimen INSS<HrReactSelect value={inssRegime} onChange={(event) => setInssRegime(event.target.value as typeof inssRegime)}><option value="INTEGRAL">Integral</option><option value="IVM_RP">IVM-RP</option><option value="FACULTATIVE_INTEGRAL">Facultativo integral</option><option value="FACULTATIVE_IVM">Facultativo IVM</option><option value="OTHER">Otro</option></HrReactSelect></label>
                <div className="hr-legal-rate-grid">
                  <label>Tasa del empleado<span className="hr-legal-input-suffix"><input aria-label="Tasa INSS del empleado en porcentaje" type="number" min="0" max="100" step="0.0001" value={inssEmployeeRate} onChange={(event) => setInssEmployeeRate(event.target.value)} /><span>%</span></span><small>Se deduce al empleado.</small></label>
                  <label>Patronal, menor al umbral<span className="hr-legal-input-suffix"><input aria-label="Tasa INSS patronal menor al umbral en porcentaje" type="number" min="0" max="100" step="0.0001" value={inssEmployerBelow} onChange={(event) => setInssEmployerBelow(event.target.value)} /><span>%</span></span></label>
                  <label>Patronal, desde el umbral<span className="hr-legal-input-suffix"><input aria-label="Tasa INSS patronal desde el umbral en porcentaje" type="number" min="0" max="100" step="0.0001" value={inssEmployerAtOrAbove} onChange={(event) => setInssEmployerAtOrAbove(event.target.value)} /><span>%</span></span></label>
                  <label>Umbral de empleados<input type="number" min="1" step="1" value={inssThreshold} onChange={(event) => setInssThreshold(event.target.value)} /><small>Desde esta cantidad usa la segunda tasa patronal.</small></label>
                </div>
                <label>Base mínima mensual (C$)<HrMoneyInput value={inssMinimumBase} onValueChange={setInssMinimumBase} required /><small>El sistema la prorratea según período y días de servicio.</small></label>
                <label>Fuente INSS<input value={inssReference} onChange={(event) => setInssReference(event.target.value)} maxLength={500} required /></label>
                {inssApplicability === 'DOES_NOT_APPLY' && <label>Fundamento de excepción<textarea value={inssException} onChange={(event) => setInssException(event.target.value)} required /></label>}
              </fieldset>
              <fieldset>
                <legend>INATEC</legend>
                <label>Aplicación<HrReactSelect value={inatecApplicability} onChange={(event) => setInatecApplicability(event.target.value as typeof inatecApplicability)}><option value="APPLIES">Aplica</option><option value="DOES_NOT_APPLY">No aplica (documentar)</option></HrReactSelect></label>
                <label>Tasa patronal<span className="hr-legal-input-suffix"><input aria-label="Tasa INATEC patronal en porcentaje" type="number" min="0" max="100" step="0.0001" value={inatecRate} onChange={(event) => setInatecRate(event.target.value)} /><span>%</span></span><small>Es un costo patronal; no se deduce al empleado.</small></label>
                <label>Fuente INATEC<input value={inatecReference} onChange={(event) => setInatecReference(event.target.value)} maxLength={500} required /></label>
                {inatecApplicability === 'DOES_NOT_APPLY' && <label>Fundamento de excepción<textarea value={inatecException} onChange={(event) => setInatecException(event.target.value)} required /></label>}
                <div className="hr-legal-impact-note"><Info size={18} aria-hidden="true" /><p><strong>Cómo impacta:</strong> INSS laboral aparece como deducción; INSS patronal e INATEC aparecen como aportes de la empresa en la corrida y sus reportes.</p></div>
              </fieldset>
            </div>
          </section>

          <section className="hr-legal-form-section" aria-labelledby="legal-ir-title">
            <header>
              <span className="hr-legal-section-icon"><Percent size={20} aria-hidden="true" /></span>
              <div><span className="hr-legal-step-label">3 · Retención</span><h3 id="legal-ir-title">Tramos progresivos de IR laboral</h3><p>La tabla es anual. El sistema proyecta el ingreso neto gravable y aplica el tramo que corresponda.</p></div>
            </header>
            <div className="hr-legal-field-grid hr-legal-period-grid">
              <label>Semanal · períodos/año<input type="number" min="1" max="366" value={periodsWeekly} onChange={(event) => setPeriodsWeekly(event.target.value)} /></label>
              <label>Quincenal · períodos/año<input type="number" min="1" max="366" value={periodsBiweekly} onChange={(event) => setPeriodsBiweekly(event.target.value)} /></label>
              <label>Mensual · períodos/año<input type="number" min="1" max="366" value={periodsMonthly} onChange={(event) => setPeriodsMonthly(event.target.value)} /></label>
              <label className="span-full">Fuente de la metodología IR<input value={incomeTaxReference} onChange={(event) => setIncomeTaxReference(event.target.value)} maxLength={500} required /></label>
            </div>
            <div className="hr-legal-formula"><Calculator size={18} aria-hidden="true" /><span><strong>Fórmula por tramo:</strong> impuesto base + (renta anual − exceso) × tasa. El INSS laboral se descuenta de la renta gravable antes del cálculo.</span></div>
            <div className="hr-payroll-tax-table hr-legal-tax-table">
              <div className="hr-legal-tax-table-heading"><div><strong>Tabla progresiva anual</strong><small>Modifica el límite superior y la tasa; los campos calculados se actualizan automáticamente.</small></div><Button type="button" size="sm" variant="ghost" onClick={addBracket}><Plus size={16} aria-hidden="true" /> Agregar tramo</Button></div>
              <div className="table-scroll"><table><thead><tr><th>Tramo</th><th>Desde (C$)</th><th>Hasta (C$)</th><th>Impuesto base (C$)</th><th>Tasa</th><th>Sobre exceso de (C$)</th><th><span className="sr-only">Acción</span></th></tr></thead><tbody>
                {brackets.map((bracket, index) => <tr key={index}>
                  <td><span className="hr-legal-bracket-number">{index + 1}</span></td>
                  <td><HrMoneyInput aria-label={`Inicio tramo ${index + 1}, calculado`} value={bracket.lowerBound} onValueChange={() => undefined} readOnly /></td>
                  <td>{index === brackets.length - 1 ? <span className="hr-legal-open-ended">En adelante</span> : <HrMoneyInput aria-label={`Fin tramo ${index + 1}`} value={bracket.upperBound ?? ''} onValueChange={(value) => updateBracket(index, 'upperBound', value)} required />}</td>
                  <td><HrMoneyInput aria-label={`Impuesto base tramo ${index + 1}, calculado`} value={bracket.baseTax} onValueChange={() => undefined} readOnly /></td>
                  <td><span className="hr-legal-input-suffix"><input aria-label={`Tasa tramo ${index + 1} en porcentaje`} type="number" min="0" max="100" step="0.0001" value={decimalRateToPercent(bracket.rate)} onChange={(event) => updateBracket(index, 'rate', percentToDecimalRate(event.target.value))} /><span>%</span></span></td>
                  <td><HrMoneyInput aria-label={`Exceso tramo ${index + 1}, calculado`} value={bracket.excessOver} onValueChange={() => undefined} readOnly /></td>
                  <td>{brackets.length > 2 && index > 0 && index < brackets.length - 1 && <Button type="button" size="sm" variant="ghost" aria-label={`Eliminar tramo ${index + 1}`} onClick={() => setBrackets((current) => recalculateBrackets(current.filter((_, position) => position !== index)))}><Trash2 size={15} aria-hidden="true" /></Button>}</td>
                </tr>)}
              </tbody></table></div>
              {!bracketTableIsValid(brackets) && <p className="hr-legal-inline-error" role="alert"><AlertCircle size={16} aria-hidden="true" /> Los tramos deben ser continuos; “desde” y “sobre exceso” deben coincidir, y el impuesto base debe acumular el tramo anterior.</p>}
            </div>
          </section>

          <section className="hr-legal-form-section" aria-labelledby="legal-concepts-title">
            <header>
              <span className="hr-legal-section-icon"><BadgeCheck size={20} aria-hidden="true" /></span>
              <div><span className="hr-legal-step-label">4 · Base de cálculo</span><h3 id="legal-concepts-title">Qué ingresos llevan INSS, INATEC e IR</h3><p>Esta es la asignación por tipo de ingreso. Marca cada obligación y el tratamiento de IR que corresponde.</p></div>
            </header>
            <PayrollPaymentConceptCatalogEditor concepts={paymentConceptCatalog} onChange={(concepts) => { setPaymentConceptCatalog(concepts); setRegimeRuleConfirmed(false); }} />
          </section>

          <details className="hr-legal-advanced">
            <summary><span><ChevronDown size={18} aria-hidden="true" /><strong>Parámetros operativos de nómina y aguinaldo</strong></span><small>Divisores, horas extra, permisos y fuentes históricas</small></summary>
            <div className="hr-legal-advanced-grid">
              <fieldset><legend>Nómina</legend><div className="hr-legal-field-grid">
                <label>Moneda de la corrida<input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /><small>Código ISO de tres letras, por ejemplo NIO.</small></label>
                <label>Multiplicador de hora extra<input type="number" min="0.0001" step="0.0001" value={overtime} onChange={(event) => setOvertime(event.target.value)} /><small>2 representa pago doble.</small></label>
                <label>Divisor semanal (minutos)<input type="number" min="0.0001" step="0.0001" value={weekly} onChange={(event) => setWeekly(event.target.value)} /></label>
                <label>Divisor quincenal (minutos)<input type="number" min="0.0001" step="0.0001" value={biweekly} onChange={(event) => setBiweekly(event.target.value)} /></label>
                <label>Divisor mensual (minutos)<input type="number" min="0.0001" step="0.0001" value={monthly} onChange={(event) => setMonthly(event.target.value)} /></label>
              </div></fieldset>
              <fieldset><legend>Permisos pagados</legend><div className="hr-legal-field-grid">
                <label>Minutos por día<input type="number" min="0.0001" step="0.0001" value={leaveDay} onChange={(event) => setLeaveDay(event.target.value)} /></label>
                <label>Minutos por hora<input type="number" min="0.0001" step="0.0001" value={leaveHour} onChange={(event) => setLeaveHour(event.target.value)} /></label>
                <label>Minutos por minuto<input type="number" min="0.0001" step="0.0001" value={leaveMinute} onChange={(event) => setLeaveMinute(event.target.value)} /></label>
              </div></fieldset>
              <fieldset><legend>Aguinaldo</legend><div className="hr-legal-field-grid">
                <label>Días históricos<input type="number" min="1" max="731" value={lookbackDays} onChange={(event) => setLookbackDays(event.target.value)} /><small>Ventana de componentes pagados que alimenta el cálculo.</small></label>
                <label>Divisor de ingreso<input type="number" min="0.0001" step="0.0001" value={incomeDivisor} onChange={(event) => setIncomeDivisor(event.target.value)} /></label>
                <label>Prorrateo<HrReactSelect value={prorationMode} onChange={(event) => setProrationMode(event.target.value as typeof prorationMode)}><option value="SERVICE_DAYS_RATIO">Proporción por días de servicio</option><option value="NONE">Sin prorrateo</option></HrReactSelect></label>
                <label className="span-full">Fuentes elegibles<input value={eligibleSources} onChange={(event) => setEligibleSources(event.target.value)} placeholder="ORDINARY, OVERTIME" /><small>Códigos separados por coma.</small></label>
              </div></fieldset>
            </div>
          </details>

          <section className="hr-legal-form-section hr-legal-evidence" aria-labelledby="legal-evidence-title">
            <header>
              <span className="hr-legal-section-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
              <div><span className="hr-legal-step-label">5 · Respaldo</span><h3 id="legal-evidence-title">Guardar para revisión independiente</h3><p>Guardar crea una revisión inmutable; todavía no se usa en nómina hasta validarla y activarla.</p></div>
            </header>
            <div className="hr-legal-field-grid hr-legal-evidence-grid">
              <label>Fuente general<input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} maxLength={500} required /></label>
              <label>Evidencia verificada<input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={500} placeholder="URL, expediente o documento interno" required /></label>
              <label className="span-full">Motivo de esta revisión<textarea rows={3} value={uploadReason} onChange={(event) => setUploadReason(event.target.value)} maxLength={900} required /></label>
            </div>
            <label className="hr-payroll-confirm"><input type="checkbox" checked={regimeRuleConfirmed} onChange={(event) => setRegimeRuleConfirmed(event.target.checked)} /><span>Confirmo que el perfil fiscal empresarial mostrado y la clasificación de cada concepto son correctos.</span></label>
            <label className="hr-payroll-confirm"><input type="checkbox" checked={sourceConfirmed} onChange={(event) => setSourceConfirmed(event.target.checked)} /><span>Confirmo que tasas, topes, bases y tramos fueron transcritos de fuentes autorizadas y vigentes.</span></label>
            {validationIssues.length > 0 && <div className="hr-legal-validation-summary" role="alert"><AlertCircle size={20} aria-hidden="true" /><div><strong>Antes de enviar, revisa:</strong><ul>{validationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div></div>}
            <div className="hr-legal-submit-bar"><div><strong>{uploadReady ? 'Configuración lista para revisión' : `${validationIssues.length} ${validationIssues.length === 1 ? 'pendiente' : 'pendientes'}`}</strong><span>Después de guardar, otra persona debe validar y luego activar.</span></div><Button type="submit" disabled={!online || saving || !uploadReady}>{saving ? 'Guardando…' : 'Guardar y enviar a validación'}</Button></div>
          </section>
        </form>
      ) : (
        <>
          <div className="hr-legal-readonly-note" role="note"><ShieldCheck size={22} aria-hidden="true" /><div><strong>Configuración vigente en modo consulta.</strong><p>{rule.status === 'DRAFT' ? 'Ya fue validada. Puedes revisar todos los valores antes de activarla.' : 'Estos son los valores que usa la nómina. Para cambiarlos, crea y valida una nueva versión legal.'}</p></div></div>
          {displayRevision?.configuration
            ? <ReadOnlyConfiguration configuration={displayRevision.configuration} revision={displayRevision.revision} />
            : <div className="hr-legal-history-empty"><AlertCircle size={22} /><div><strong>No encontramos parámetros para mostrar.</strong><p>Actualiza la pantalla o revisa el historial de esta regla.</p></div></div>}
        </>
      )}

      <section className="hr-payroll-config-history hr-legal-history" aria-live="polite" aria-labelledby="legal-history-title">
        <header><div><span className="hr-legal-step-label">Auditoría</span><h3 id="legal-history-title">Revisiones de esta regla</h3><p>Cada tarjeta conserva quién cargó, quién revisó, la fuente y la huella técnica.</p></div></header>
        {loading ? <p>Cargando revisiones…</p> : revisions.length === 0 ? <div className="hr-legal-history-empty"><FileCheck2 size={28} aria-hidden="true" /><div><strong>Aún no hay revisiones.</strong><p>Completa la configuración y envíala a validación.</p></div></div> : revisions.map((revision) => {
          const reviewReason = reviewReasonById[revision.id] ?? '';
          const reviewConfirmed = reviewConfirmedById[revision.id] ?? false;
          return <article key={revision.id} className={`hr-legal-revision hr-legal-revision--${revision.status.toLowerCase()}`}>
            <div className="hr-legal-revision-main">
              <div className="hr-legal-revision-title"><span>v{revision.revision}</span><div><strong>{revision.status === 'UPLOADED' ? 'Esperando validación' : revision.status === 'VALIDATED' ? 'Validada' : 'Rechazada'}</strong><small>{formatDate(revision.uploadedAt)}</small></div></div>
              <dl><div><dt>Cargó</dt><dd>{actorName(revision.uploadedBy)}</dd></div><div><dt>Fuente</dt><dd>{revision.sourceReference}</dd></div><div><dt>Motivo</dt><dd>{revision.uploadReason}</dd></div>{revision.reviewer && <div><dt>Revisó</dt><dd>{actorName(revision.reviewer)} · {revision.reviewReason}</dd></div>}</dl>
              <details className="hr-legal-audit-details"><summary>Ver evidencia y huella técnica</summary><div><span><strong>Evidencia:</strong> {revision.evidenceReference}</span><code title={revision.configurationHash}>SHA-256 · {revision.configurationHash}</code><small>La huella permite comprobar que los parámetros no cambiaron después de la carga.</small></div></details>
            </div>
            {revision.status === 'UPLOADED' && rule.status === 'DRAFT' && !rule.activeConfigurationRevisionId && <div className="hr-payroll-config-review hr-legal-review-box"><div><strong>Dictamen independiente</strong><p>Debe realizarlo una persona distinta de quien cargó la revisión.</p></div><label>Justificación del dictamen<textarea rows={3} value={reviewReason} onChange={(event) => setReviewReasonById((current) => ({ ...current, [revision.id]: event.target.value }))} maxLength={900} /></label><label className="hr-payroll-confirm"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmedById((current) => ({ ...current, [revision.id]: event.target.checked }))} /><span>Revisé tasas, tramos, conceptos, fuentes, evidencia y vigencia.</span></label><div><Button type="button" size="sm" variant="danger" disabled={!online || saving || !reviewConfirmed || reviewReason.trim().length < 3} onClick={() => void review(revision, 'REJECTED')}>Rechazar</Button><Button type="button" size="sm" disabled={!online || saving || !reviewConfirmed || reviewReason.trim().length < 3} onClick={() => void review(revision, 'VALIDATED')}><FileCheck2 size={15} aria-hidden="true" /> Validar configuración</Button></div></div>}
          </article>;
        })}
      </section>
    </div>
  );
}

function ReadOnlyConfiguration({ configuration, revision }: { configuration: HrPayrollLegalConfiguration; revision: number }) {
  const { statutory } = configuration;
  const pct = (value: string) => `${(Number(value) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}%`;
  const money = (value: string) => new Intl.NumberFormat('es-NI', { style: 'currency', currency: configuration.currency, maximumFractionDigits: 2 }).format(Number(value));
  const yesNo = (value: boolean) => value ? 'Sí' : 'No';
  const regimeLabels: Record<string, string> = { GENERAL: 'General', SIMPLIFIED_FIXED_QUOTA: 'Cuota fija / simplificado', SPECIAL: 'Especial', EXEMPT: 'Exento', OTHER: 'Otro' };
  const taxLabels: Record<string, string> = { REGULAR_FIXED: 'IR fijo', REGULAR_VARIABLE: 'IR variable', OCCASIONAL: 'IR ocasional' };

  return <div className="hr-legal-readonly-config" aria-label={`Parámetros de la revisión ${revision}`}>
    <section aria-labelledby="readonly-regime-title">
      <header><span className="hr-legal-section-icon"><Landmark size={20} /></span><div><span className="hr-legal-step-label">Aplicación</span><h3 id="readonly-regime-title">Régimen de la empresa y obligaciones</h3><p>Qué se retiene al empleado y qué paga la empresa.</p></div></header>
      <dl className="hr-legal-readonly-kpis">
        <div><dt>Régimen DGI</dt><dd>{regimeLabels[statutory.companyTaxRegime.code] ?? statutory.companyTaxRegime.code}</dd><small>{statutory.companyTaxRegime.sourceReference}</small></div>
        <div><dt>IR laboral</dt><dd>{statutory.companyTaxRegime.incomeTaxApplicability === 'APPLIES' ? 'Sí se retiene' : 'No se retiene'}</dd><small>{statutory.companyTaxRegime.incomeTaxExceptionReason ?? statutory.incomeTax.sourceReference}</small></div>
        <div><dt>INSS laboral</dt><dd>{statutory.inss.applicability === 'APPLIES' ? pct(statutory.inss.employeeRate) : 'No aplica'}</dd><small>Se deduce al empleado · régimen {statutory.inss.regime}</small></div>
        <div><dt>INATEC</dt><dd>{statutory.inatec.applicability === 'APPLIES' ? pct(statutory.inatec.employerRate) : 'No aplica'}</dd><small>Aporte de la empresa; nunca se deduce al empleado</small></div>
      </dl>
      <div className="hr-legal-readonly-obligations">
        <article><h4>INSS</h4><dl><div><dt>Empleado</dt><dd>{pct(statutory.inss.employeeRate)}</dd></div><div><dt>Patronal, menos de {statutory.inss.employerSizeThreshold} empleados</dt><dd>{pct(statutory.inss.employerRateBelowThreshold)}</dd></div><div><dt>Patronal, desde {statutory.inss.employerSizeThreshold} empleados</dt><dd>{pct(statutory.inss.employerRateAtOrAboveThreshold)}</dd></div><div><dt>Base mínima mensual</dt><dd>{money(statutory.inss.minimumMonthlyContributionBase)}</dd></div></dl><p>Fuente: {statutory.inss.sourceReference}</p></article>
        <article><h4>INATEC</h4><dl><div><dt>Tasa patronal</dt><dd>{pct(statutory.inatec.employerRate)}</dd></div><div><dt>Se descuenta al empleado</dt><dd>No</dd></div></dl><p>Fuente: {statutory.inatec.sourceReference}</p></article>
      </div>
    </section>

    <section aria-labelledby="readonly-ir-title">
      <header><span className="hr-legal-section-icon"><Percent size={20} /></span><div><span className="hr-legal-step-label">Retención</span><h3 id="readonly-ir-title">Tramos anuales de IR laboral</h3><p>La nómina proyecta el ingreso neto gravable anual y aplica el tramo correspondiente.</p></div></header>
      <div className="hr-legal-readonly-table-wrap"><table><thead><tr><th>Tramo</th><th>Desde</th><th>Hasta</th><th>Impuesto base</th><th>Tasa sobre exceso</th></tr></thead><tbody>{statutory.incomeTax.brackets.map((bracket, index) => <tr key={`${bracket.lowerBound}-${index}`}><td>{index + 1}</td><td>{money(bracket.lowerBound)}</td><td>{bracket.upperBound === null ? 'En adelante' : money(bracket.upperBound)}</td><td>{money(bracket.baseTax)}</td><td>{pct(bracket.rate)} sobre {money(bracket.excessOver)}</td></tr>)}</tbody></table></div>
      <p className="hr-legal-readonly-source">Fuente: {statutory.incomeTax.sourceReference} · Periodos: semanal {statutory.incomeTax.annualPeriods.WEEKLY}, quincenal {statutory.incomeTax.annualPeriods.BIWEEKLY}, mensual {statutory.incomeTax.annualPeriods.MONTHLY}.</p>
    </section>

    <section aria-labelledby="readonly-concepts-title">
      <header><span className="hr-legal-section-icon"><Users size={20} /></span><div><span className="hr-legal-step-label">Clasificación</span><h3 id="readonly-concepts-title">Qué aplica a cada ingreso y deducción</h3><p>Esta tabla responde si un concepto forma base de IR laboral, INSS o INATEC.</p></div></header>
      <div className="hr-legal-readonly-table-wrap"><table><thead><tr><th>Concepto</th><th>Tipo</th><th>IR laboral</th><th>INSS</th><th>INATEC</th><th>Estado</th><th>Fuente</th></tr></thead><tbody>{statutory.paymentConceptCatalog.map((concept) => <tr key={concept.code} className={!concept.active ? 'is-disabled' : undefined}><td><strong>{concept.name}</strong><small>{concept.code}</small></td><td>{concept.type === 'INCOME' ? 'Ingreso' : 'Deducción'}</td><td>{concept.incomeTaxTreatment ? taxLabels[concept.incomeTaxTreatment] : concept.incomeTaxDeductible ? 'Deducible' : 'No sujeto'}</td><td>{yesNo(concept.socialSecurityApplicable)}</td><td>{yesNo(concept.trainingContributionApplicable)}</td><td><span className={`hr-legal-status ${concept.active ? 'is-active' : 'is-inactive'}`}>{concept.active ? 'Activo' : 'Inhabilitado'}</span></td><td>{concept.sourceReference}</td></tr>)}</tbody></table></div>
    </section>

    <details className="hr-legal-readonly-operational"><summary>Ver parámetros operativos de nómina y aguinaldo</summary><dl><div><dt>Moneda</dt><dd>{configuration.currency}</dd></div><div><dt>Multiplicador de horas extra</dt><dd>{configuration.regular.overtimeMultiplier}×</dd></div><div><dt>Histórico de aguinaldo</dt><dd>{configuration.aguinaldo.lookbackDays} días</dd></div><div><dt>Divisor de aguinaldo</dt><dd>{configuration.aguinaldo.incomeDivisor}</dd></div></dl></details>
  </div>;
}
