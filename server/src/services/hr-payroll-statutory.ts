import { Prisma } from '@prisma/client';

export type PayrollTaxRegime = 'GENERAL' | 'SIMPLIFIED_FIXED_QUOTA' | 'SPECIAL' | 'EXEMPT' | 'OTHER';
export type StatutoryApplicability = 'APPLIES' | 'DOES_NOT_APPLY';
export type StatutoryPayFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface ProgressiveTaxBracket {
    lowerBound: string;
    upperBound: string | null;
    baseTax: string;
    rate: string;
    excessOver: string;
}

interface StatutoryObligation {
    applicability: StatutoryApplicability;
    sourceReference: string;
    exceptionReason?: string;
}

export interface PayrollStatutoryConfiguration {
    companyTaxRegime: {
        code: PayrollTaxRegime;
        sourceReference: string;
    };
    inss: StatutoryObligation & {
        regime: 'INTEGRAL' | 'IVM_RP' | 'FACULTATIVE_INTEGRAL' | 'FACULTATIVE_IVM' | 'OTHER';
        employeeRate: string;
        employerRateBelowThreshold: string;
        employerRateAtOrAboveThreshold: string;
        employerSizeThreshold: number;
        minimumMonthlyContributionBase: string;
        minimumBaseProration: 'PER_PAY_PERIOD_SERVICE_RATIO';
        contributionComponentCodes: string[];
    };
    inatec: StatutoryObligation & {
        employerRate: string;
        contributionComponentCodes: string[];
    };
    incomeTax: StatutoryObligation & {
        regimeIndependenceAcknowledged: true;
        calculationMethod: 'VARIABLE_ACCUMULATED';
        inssEmployeeContributionDeductible: true;
        adjustmentMode: 'WITHHOLD_OR_REFUND';
        annualPeriods: Record<StatutoryPayFrequency, number>;
        taxableComponentCodes: string[];
        brackets: ProgressiveTaxBracket[];
    };
}

export interface StatutoryCalculationInput {
    inssContributionBase: Prisma.Decimal.Value;
    inatecContributionBase: Prisma.Decimal.Value;
    incomeTaxGross: Prisma.Decimal.Value;
    otherIncomeTaxDeductions: Prisma.Decimal.Value;
    priorIncomeTaxNet: Prisma.Decimal.Value;
    priorIncomeTaxWithheld: Prisma.Decimal.Value;
    priorPeriods: number;
    payFrequency: StatutoryPayFrequency;
    employerHeadcount: number;
    serviceRatio: Prisma.Decimal.Value;
}

export interface StatutoryCalculationResult {
    inssBase: Prisma.Decimal;
    employeeInss: Prisma.Decimal;
    employerInssRate: Prisma.Decimal;
    employerInss: Prisma.Decimal;
    inatecBase: Prisma.Decimal;
    employerInatec: Prisma.Decimal;
    currentIncomeTaxNet: Prisma.Decimal;
    otherIncomeTaxDeductions: Prisma.Decimal;
    accumulatedIncomeTaxNet: Prisma.Decimal;
    annualProjection: Prisma.Decimal;
    annualIncomeTax: Prisma.Decimal;
    priorIncomeTaxWithheld: Prisma.Decimal;
    currentIncomeTaxWithholding: Prisma.Decimal;
    incomeTaxRefund: Prisma.Decimal;
    elapsedPeriods: number;
    annualPeriods: number;
    bracket: ProgressiveTaxBracket | null;
}

const decimalPattern = /^\d+(?:\.\d+)?$/;

function decimal(value: string): Prisma.Decimal {
    return new Prisma.Decimal(value);
}

function money(value: Prisma.Decimal.Value): Prisma.Decimal {
    return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function isRate(value: unknown): value is string {
    return typeof value === 'string' && decimalPattern.test(value) && decimal(value).greaterThanOrEqualTo(0) && decimal(value).lessThanOrEqualTo(1);
}

function isNonNegativeDecimal(value: unknown): value is string {
    return typeof value === 'string' && decimalPattern.test(value) && decimal(value).greaterThanOrEqualTo(0);
}

function validCodes(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0 && value.every(code => typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code));
}

function validObligation(value: StatutoryObligation | undefined): boolean {
    if (!value || !['APPLIES', 'DOES_NOT_APPLY'].includes(value.applicability) || !value.sourceReference?.trim()) return false;
    return value.applicability === 'APPLIES' || Boolean(value.exceptionReason?.trim() && value.exceptionReason.trim().length >= 3);
}

export function validateProgressiveTaxBrackets(brackets: ProgressiveTaxBracket[] | undefined): boolean {
    if (!Array.isArray(brackets) || brackets.length < 2) return false;
    let previousUpper: Prisma.Decimal | null = null;
    let expectedBase = new Prisma.Decimal(0);
    for (let index = 0; index < brackets.length; index += 1) {
        const bracket = brackets[index];
        if (!isNonNegativeDecimal(bracket.lowerBound) || !isNonNegativeDecimal(bracket.baseTax) || !isRate(bracket.rate) || !isNonNegativeDecimal(bracket.excessOver)) return false;
        const lower = decimal(bracket.lowerBound);
        const excess = decimal(bracket.excessOver);
        if (!lower.equals(excess) || (index === 0 && !lower.isZero()) || (previousUpper && !lower.equals(previousUpper))) return false;
        if (!decimal(bracket.baseTax).equals(expectedBase)) return false;
        if (bracket.upperBound === null) return index === brackets.length - 1;
        if (!isNonNegativeDecimal(bracket.upperBound)) return false;
        const upper = decimal(bracket.upperBound);
        if (upper.lessThanOrEqualTo(lower) || index === brackets.length - 1) return false;
        expectedBase = money(expectedBase.plus(upper.minus(lower).times(bracket.rate)));
        previousUpper = upper;
    }
    return false;
}

export function validateStatutoryConfiguration(value: PayrollStatutoryConfiguration | undefined): boolean {
    if (!value || !['GENERAL', 'SIMPLIFIED_FIXED_QUOTA', 'SPECIAL', 'EXEMPT', 'OTHER'].includes(value.companyTaxRegime?.code) || !value.companyTaxRegime?.sourceReference?.trim()) return false;
    const inss = value.inss;
    const inatec = value.inatec;
    const incomeTax = value.incomeTax;
    if (
        !validObligation(inss) || !['INTEGRAL', 'IVM_RP', 'FACULTATIVE_INTEGRAL', 'FACULTATIVE_IVM', 'OTHER'].includes(inss.regime) ||
        !isRate(inss.employeeRate) || !isRate(inss.employerRateBelowThreshold) || !isRate(inss.employerRateAtOrAboveThreshold) ||
        !Number.isInteger(inss.employerSizeThreshold) || inss.employerSizeThreshold < 1 ||
        !isNonNegativeDecimal(inss.minimumMonthlyContributionBase) || (inss.applicability === 'APPLIES' && !decimal(inss.minimumMonthlyContributionBase).greaterThan(0)) || inss.minimumBaseProration !== 'PER_PAY_PERIOD_SERVICE_RATIO' ||
        !validCodes(inss.contributionComponentCodes)
    ) return false;
    if (!validObligation(inatec) || !isRate(inatec.employerRate) || !validCodes(inatec.contributionComponentCodes)) return false;
    if (
        !validObligation(incomeTax) || incomeTax.regimeIndependenceAcknowledged !== true ||
        incomeTax.calculationMethod !== 'VARIABLE_ACCUMULATED' || incomeTax.inssEmployeeContributionDeductible !== true ||
        incomeTax.adjustmentMode !== 'WITHHOLD_OR_REFUND' || !validCodes(incomeTax.taxableComponentCodes) ||
        !validateProgressiveTaxBrackets(incomeTax.brackets) ||
        !(['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const).every(frequency => Number.isInteger(incomeTax.annualPeriods?.[frequency]) && incomeTax.annualPeriods[frequency] >= 1 && incomeTax.annualPeriods[frequency] <= 366)
    ) return false;
    return true;
}

export function progressiveIncomeTax(annualNetIncome: Prisma.Decimal.Value, brackets: ProgressiveTaxBracket[]): { tax: Prisma.Decimal; bracket: ProgressiveTaxBracket } {
    const annual = Prisma.Decimal.max(0, new Prisma.Decimal(annualNetIncome));
    const bracket = brackets.find(item => item.upperBound === null || annual.lessThanOrEqualTo(item.upperBound)) ?? brackets[brackets.length - 1];
    const taxableExcess = Prisma.Decimal.max(0, annual.minus(bracket.excessOver));
    return { tax: money(new Prisma.Decimal(bracket.baseTax).plus(taxableExcess.times(bracket.rate))), bracket };
}

export function calculateStatutoryPayroll(config: PayrollStatutoryConfiguration, input: StatutoryCalculationInput): StatutoryCalculationResult {
    const annualPeriods = config.incomeTax.annualPeriods[input.payFrequency];
    const elapsedPeriods = Math.min(annualPeriods, input.priorPeriods + 1);
    const serviceRatio = Prisma.Decimal.min(1, Prisma.Decimal.max(0, new Prisma.Decimal(input.serviceRatio)));
    const periodMinimum = money(new Prisma.Decimal(config.inss.minimumMonthlyContributionBase).times(12).dividedBy(annualPeriods).times(serviceRatio));
    const rawInssBase = money(input.inssContributionBase);
    const inssBase = config.inss.applicability === 'APPLIES' ? Prisma.Decimal.max(rawInssBase, periodMinimum) : new Prisma.Decimal(0);
    const employeeInss = config.inss.applicability === 'APPLIES' ? money(inssBase.times(config.inss.employeeRate)) : new Prisma.Decimal(0);
    const employerInssRate = config.inss.applicability === 'APPLIES'
        ? decimal(input.employerHeadcount >= config.inss.employerSizeThreshold ? config.inss.employerRateAtOrAboveThreshold : config.inss.employerRateBelowThreshold)
        : new Prisma.Decimal(0);
    const employerInss = money(inssBase.times(employerInssRate));
    const inatecBase = config.inatec.applicability === 'APPLIES' ? money(input.inatecContributionBase) : new Prisma.Decimal(0);
    const employerInatec = config.inatec.applicability === 'APPLIES' ? money(inatecBase.times(config.inatec.employerRate)) : new Prisma.Decimal(0);
    const incomeTaxGross = config.incomeTax.applicability === 'APPLIES' ? money(input.incomeTaxGross) : new Prisma.Decimal(0);
    const otherIncomeTaxDeductions = config.incomeTax.applicability === 'APPLIES' ? money(input.otherIncomeTaxDeductions) : new Prisma.Decimal(0);
    const currentIncomeTaxNet = Prisma.Decimal.max(0, money(incomeTaxGross.minus(employeeInss).minus(otherIncomeTaxDeductions)));
    const accumulatedIncomeTaxNet = money(Prisma.Decimal.max(0, new Prisma.Decimal(input.priorIncomeTaxNet)).plus(currentIncomeTaxNet));
    const annualProjection = config.incomeTax.applicability === 'APPLIES'
        ? money(accumulatedIncomeTaxNet.dividedBy(elapsedPeriods).times(annualPeriods))
        : new Prisma.Decimal(0);
    const annualTaxResult = config.incomeTax.applicability === 'APPLIES'
        ? progressiveIncomeTax(annualProjection, config.incomeTax.brackets)
        : { tax: new Prisma.Decimal(0), bracket: null };
    const priorIncomeTaxWithheld = money(Prisma.Decimal.max(0, new Prisma.Decimal(input.priorIncomeTaxWithheld)));
    const targetThroughCurrent = money(annualTaxResult.tax.dividedBy(annualPeriods).times(elapsedPeriods));
    const adjustment = money(targetThroughCurrent.minus(priorIncomeTaxWithheld));
    const currentIncomeTaxWithholding = adjustment.isPositive() ? adjustment : new Prisma.Decimal(0);
    const incomeTaxRefund = adjustment.isNegative() ? adjustment.abs() : new Prisma.Decimal(0);
    return {
        inssBase: money(inssBase), employeeInss, employerInssRate, employerInss,
        inatecBase, employerInatec, currentIncomeTaxNet: money(currentIncomeTaxNet), otherIncomeTaxDeductions,
        accumulatedIncomeTaxNet, annualProjection, annualIncomeTax: annualTaxResult.tax,
        priorIncomeTaxWithheld, currentIncomeTaxWithholding, incomeTaxRefund,
        elapsedPeriods, annualPeriods, bracket: annualTaxResult.bracket,
    };
}
