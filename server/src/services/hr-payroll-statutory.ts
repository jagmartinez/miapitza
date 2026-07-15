import { Prisma } from '@prisma/client';

export type PayrollTaxRegime = 'GENERAL' | 'SIMPLIFIED_FIXED_QUOTA' | 'SPECIAL' | 'EXEMPT' | 'OTHER';
export type StatutoryApplicability = 'APPLIES' | 'DOES_NOT_APPLY';
export type StatutoryPayFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type IncomeTaxTreatment = 'REGULAR_FIXED' | 'REGULAR_VARIABLE' | 'OCCASIONAL';
export type IncomeTaxCalculationMethod = 'FIXED_PERIOD_PROJECTION' | 'FIXED_SALARY_CHANGE' | 'VARIABLE_ACCUMULATED';

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
        annualPeriods: Record<StatutoryPayFrequency, number>;
        contributionComponentCodes: string[];
    };
    inatec: StatutoryObligation & {
        employerRate: string;
        contributionComponentCodes: string[];
    };
    incomeTax: StatutoryObligation & {
        regimeIndependenceAcknowledged: true;
        calculationMethods: {
            fixed: 'FIXED_PERIOD_PROJECTION';
            salaryChange: 'FIXED_SALARY_CHANGE';
            variable: 'VARIABLE_ACCUMULATED';
            occasional: 'OCCASIONAL_INCREMENTAL';
        };
        inssEmployeeContributionDeductible: true;
        occasionalInssDeductionTreatment: 'DEDUCT_FROM_OCCASIONAL_NET';
        adjustmentMode: 'WITHHOLD_OR_REFUND';
        annualPeriods: Record<StatutoryPayFrequency, number>;
        fixedTaxableComponentCodes: string[];
        variableTaxableComponentCodes: string[];
        occasionalTaxableComponentCodes: string[];
        authorizedDeductionComponentCodes: string[];
        brackets: ProgressiveTaxBracket[];
    };
}

export interface StatutoryCalculationInput {
    inssContributionBase: Prisma.Decimal.Value;
    regularInssContributionBase: Prisma.Decimal.Value;
    occasionalInssContributionBase: Prisma.Decimal.Value;
    inatecContributionBase: Prisma.Decimal.Value;
    fixedIncomeTaxGross: Prisma.Decimal.Value;
    variableIncomeTaxGross: Prisma.Decimal.Value;
    occasionalIncomeTaxGross: Prisma.Decimal.Value;
    otherIncomeTaxDeductions: Prisma.Decimal.Value;
    priorRegularIncomeTaxNet: Prisma.Decimal.Value;
    priorOccasionalIncomeTaxNet: Prisma.Decimal.Value;
    priorRegularIncomeTaxWithheld: Prisma.Decimal.Value;
    priorOccasionalIncomeTaxWithheld: Prisma.Decimal.Value;
    currentFixedCompensationAmount: Prisma.Decimal.Value;
    latestFixedCompensationAmount: Prisma.Decimal.Value;
    latestRegularIncomeTaxNet: Prisma.Decimal.Value;
    priorFixedSalaryChangeActive: boolean;
    priorFixedSalaryChangeAnnualProjection: Prisma.Decimal.Value;
    priorHadVariableIncome: boolean;
    employerRefundAllowed: boolean;
    elapsedFiscalMonths: number;
    priorPeriods: number;
    payFrequency: StatutoryPayFrequency;
    employerHeadcount: number;
    serviceRatio: Prisma.Decimal.Value;
}

export interface StatutoryCalculationResult {
    incomeTaxMethod: IncomeTaxCalculationMethod;
    inssBase: Prisma.Decimal;
    employeeInss: Prisma.Decimal;
    regularEmployeeInss: Prisma.Decimal;
    occasionalEmployeeInss: Prisma.Decimal;
    employerInssRate: Prisma.Decimal;
    employerInss: Prisma.Decimal;
    inatecBase: Prisma.Decimal;
    employerInatec: Prisma.Decimal;
    fixedIncomeTaxGross: Prisma.Decimal;
    variableIncomeTaxGross: Prisma.Decimal;
    occasionalIncomeTaxGross: Prisma.Decimal;
    currentRegularIncomeTaxNet: Prisma.Decimal;
    currentOccasionalIncomeTaxNet: Prisma.Decimal;
    currentIncomeTaxNet: Prisma.Decimal;
    otherIncomeTaxDeductions: Prisma.Decimal;
    accumulatedIncomeTaxNet: Prisma.Decimal;
    annualProjection: Prisma.Decimal;
    regularAnnualIncomeTax: Prisma.Decimal;
    annualIncomeTaxWithOccasional: Prisma.Decimal;
    annualIncomeTax: Prisma.Decimal;
    priorRegularIncomeTaxWithheld: Prisma.Decimal;
    priorOccasionalIncomeTaxWithheld: Prisma.Decimal;
    regularIncomeTaxWithholding: Prisma.Decimal;
    occasionalIncomeTaxWithholding: Prisma.Decimal;
    currentIncomeTaxWithholding: Prisma.Decimal;
    incomeTaxRefund: Prisma.Decimal;
    incomeTaxCreditBalance: Prisma.Decimal;
    elapsedFiscalMonths: number;
    elapsedPeriods: number;
    annualPeriods: number;
    bracket: ProgressiveTaxBracket | null;
    bracketSnapshot: {
        regular: ProgressiveTaxBracket | null;
        beforeCurrentOccasional: ProgressiveTaxBracket | null;
        withCurrentOccasional: ProgressiveTaxBracket | null;
        effective: ProgressiveTaxBracket | null;
    };
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

function validOptionalCodes(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(code => typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code));
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
        !(['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const).every(frequency => Number.isInteger(inss.annualPeriods?.[frequency]) && inss.annualPeriods[frequency] >= 1 && inss.annualPeriods[frequency] <= 366) ||
        !validCodes(inss.contributionComponentCodes)
    ) return false;
    if (!validObligation(inatec) || !isRate(inatec.employerRate) || !validCodes(inatec.contributionComponentCodes)) return false;
    const incomeTaxCodes = [
        ...(incomeTax?.fixedTaxableComponentCodes ?? []),
        ...(incomeTax?.variableTaxableComponentCodes ?? []),
        ...(incomeTax?.occasionalTaxableComponentCodes ?? []),
    ];
    const allIncomeTaxCodes = [...incomeTaxCodes, ...(incomeTax?.authorizedDeductionComponentCodes ?? [])];
    if (
        !validObligation(incomeTax) || incomeTax.regimeIndependenceAcknowledged !== true ||
        incomeTax.calculationMethods?.fixed !== 'FIXED_PERIOD_PROJECTION' || incomeTax.calculationMethods?.salaryChange !== 'FIXED_SALARY_CHANGE' ||
        incomeTax.calculationMethods?.variable !== 'VARIABLE_ACCUMULATED' || incomeTax.calculationMethods?.occasional !== 'OCCASIONAL_INCREMENTAL' ||
        incomeTax.inssEmployeeContributionDeductible !== true || incomeTax.occasionalInssDeductionTreatment !== 'DEDUCT_FROM_OCCASIONAL_NET' ||
        incomeTax.adjustmentMode !== 'WITHHOLD_OR_REFUND' ||
        !validOptionalCodes(incomeTax.fixedTaxableComponentCodes) || !validOptionalCodes(incomeTax.variableTaxableComponentCodes) ||
        !validOptionalCodes(incomeTax.occasionalTaxableComponentCodes) || !validOptionalCodes(incomeTax.authorizedDeductionComponentCodes) ||
        incomeTaxCodes.length === 0 || new Set(allIncomeTaxCodes).size !== allIncomeTaxCodes.length ||
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
    const elapsedFiscalMonths = input.elapsedFiscalMonths;
    const serviceRatio = Prisma.Decimal.min(1, Prisma.Decimal.max(0, new Prisma.Decimal(input.serviceRatio)));
    const inssAnnualPeriods = config.inss.annualPeriods[input.payFrequency];
    const periodMinimum = money(new Prisma.Decimal(config.inss.minimumMonthlyContributionBase).times(12).dividedBy(inssAnnualPeriods).times(serviceRatio));
    const rawInssBase = money(input.inssContributionBase);
    const inssBase = config.inss.applicability === 'APPLIES' ? Prisma.Decimal.max(rawInssBase, periodMinimum) : new Prisma.Decimal(0);
    const employeeInss = config.inss.applicability === 'APPLIES' ? money(inssBase.times(config.inss.employeeRate)) : new Prisma.Decimal(0);
    const rawRegularInssBase = money(input.regularInssContributionBase);
    const rawOccasionalInssBase = money(input.occasionalInssContributionBase);
    const allocableInssBase = rawRegularInssBase.plus(rawOccasionalInssBase);
    const allocatedOccasionalEmployeeInss = allocableInssBase.greaterThan(0)
        ? money(employeeInss.times(rawOccasionalInssBase).dividedBy(allocableInssBase))
        : new Prisma.Decimal(0);
    const occasionalEmployeeInss = allocatedOccasionalEmployeeInss;
    const regularEmployeeInss = money(employeeInss.minus(occasionalEmployeeInss));
    const employerInssRate = config.inss.applicability === 'APPLIES'
        ? decimal(input.employerHeadcount >= config.inss.employerSizeThreshold ? config.inss.employerRateAtOrAboveThreshold : config.inss.employerRateBelowThreshold)
        : new Prisma.Decimal(0);
    const employerInss = money(inssBase.times(employerInssRate));
    const inatecBase = config.inatec.applicability === 'APPLIES' ? money(input.inatecContributionBase) : new Prisma.Decimal(0);
    const employerInatec = config.inatec.applicability === 'APPLIES' ? money(inatecBase.times(config.inatec.employerRate)) : new Prisma.Decimal(0);
    const fixedIncomeTaxGross = config.incomeTax.applicability === 'APPLIES' ? money(input.fixedIncomeTaxGross) : new Prisma.Decimal(0);
    const variableIncomeTaxGross = config.incomeTax.applicability === 'APPLIES' ? money(input.variableIncomeTaxGross) : new Prisma.Decimal(0);
    const occasionalIncomeTaxGross = config.incomeTax.applicability === 'APPLIES' ? money(input.occasionalIncomeTaxGross) : new Prisma.Decimal(0);
    const otherIncomeTaxDeductions = config.incomeTax.applicability === 'APPLIES' ? money(input.otherIncomeTaxDeductions) : new Prisma.Decimal(0);
    const currentRegularIncomeTaxNet = money(Prisma.Decimal.max(0, fixedIncomeTaxGross.plus(variableIncomeTaxGross).minus(regularEmployeeInss).minus(otherIncomeTaxDeductions)));
    const currentOccasionalIncomeTaxNet = money(Prisma.Decimal.max(0, occasionalIncomeTaxGross.minus(occasionalEmployeeInss)));
    const currentIncomeTaxNet = money(currentRegularIncomeTaxNet.plus(currentOccasionalIncomeTaxNet));
    const priorRegularIncomeTaxNet = money(Prisma.Decimal.max(0, new Prisma.Decimal(input.priorRegularIncomeTaxNet)));
    const accumulatedIncomeTaxNet = money(priorRegularIncomeTaxNet.plus(currentRegularIncomeTaxNet));
    const priorRegularIncomeTaxWithheld = money(Prisma.Decimal.max(0, new Prisma.Decimal(input.priorRegularIncomeTaxWithheld)));
    const currentFixedCompensationAmount = money(input.currentFixedCompensationAmount);
    const latestFixedCompensationAmount = money(input.latestFixedCompensationAmount);
    const fixedCompensationChanged = input.priorPeriods > 0 && !latestFixedCompensationAmount.equals(currentFixedCompensationAmount);
    const fixedGrossIsPartial = currentFixedCompensationAmount.greaterThan(0) && !fixedIncomeTaxGross.equals(currentFixedCompensationAmount);
    const regularNetWithoutFixedCompensation = currentFixedCompensationAmount.isZero() && currentRegularIncomeTaxNet.greaterThan(0);
    const regularNetChangedWithoutSalaryChange = input.priorPeriods > 0 && !fixedCompensationChanged &&
        !currentRegularIncomeTaxNet.equals(money(input.latestRegularIncomeTaxNet));
    const hasVariableIncome = input.priorHadVariableIncome || variableIncomeTaxGross.greaterThan(0) ||
        fixedGrossIsPartial || regularNetWithoutFixedCompensation ||
        (!fixedCompensationChanged && regularNetChangedWithoutSalaryChange);
    if (
        config.incomeTax.applicability === 'APPLIES' && hasVariableIncome &&
        (!Number.isInteger(elapsedFiscalMonths) || elapsedFiscalMonths < 1 || elapsedFiscalMonths > 12)
    ) {
        throw new Error('elapsedFiscalMonths debe ser un conteo entero de meses fiscales entre uno y doce para el cálculo variable');
    }
    const fixedSalaryChanged = !hasVariableIncome && (fixedCompensationChanged || input.priorFixedSalaryChangeActive);
    const incomeTaxMethod: IncomeTaxCalculationMethod = hasVariableIncome
        ? 'VARIABLE_ACCUMULATED'
        : fixedSalaryChanged ? 'FIXED_SALARY_CHANGE' : 'FIXED_PERIOD_PROJECTION';

    let annualProjection = new Prisma.Decimal(0);
    let regularIncomeTaxAdjustment = new Prisma.Decimal(0);
    if (config.incomeTax.applicability === 'APPLIES') {
        if (incomeTaxMethod === 'VARIABLE_ACCUMULATED') {
            annualProjection = money(accumulatedIncomeTaxNet.dividedBy(elapsedFiscalMonths).times(12));
        } else if (incomeTaxMethod === 'FIXED_SALARY_CHANGE') {
            const remainingPeriods = Math.max(1, annualPeriods - input.priorPeriods);
            annualProjection = fixedCompensationChanged
                ? money(priorRegularIncomeTaxNet.plus(currentRegularIncomeTaxNet.times(remainingPeriods)))
                : money(input.priorFixedSalaryChangeAnnualProjection);
        } else {
            annualProjection = money(currentRegularIncomeTaxNet.times(annualPeriods));
        }
    }
    const priorOccasionalIncomeTaxNet = money(Prisma.Decimal.max(0, new Prisma.Decimal(input.priorOccasionalIncomeTaxNet)));
    const priorOccasionalIncomeTaxWithheld = money(Prisma.Decimal.max(0, new Prisma.Decimal(input.priorOccasionalIncomeTaxWithheld)));
    const annualBeforeCurrentOccasionalBase = money(annualProjection.plus(priorOccasionalIncomeTaxNet));
    const regularAnnualTaxResult = config.incomeTax.applicability === 'APPLIES'
        ? progressiveIncomeTax(annualProjection, config.incomeTax.brackets)
        : { tax: new Prisma.Decimal(0), bracket: null };
    const annualBeforeCurrentOccasionalResult = config.incomeTax.applicability === 'APPLIES'
        ? progressiveIncomeTax(annualBeforeCurrentOccasionalBase, config.incomeTax.brackets)
        : { tax: new Prisma.Decimal(0), bracket: null };
    if (config.incomeTax.applicability === 'APPLIES') {
        if (incomeTaxMethod === 'VARIABLE_ACCUMULATED') {
            const targetThroughCurrent = money(regularAnnualTaxResult.tax.dividedBy(12).times(elapsedFiscalMonths));
            regularIncomeTaxAdjustment = money(targetThroughCurrent.minus(priorRegularIncomeTaxWithheld));
        } else if (incomeTaxMethod === 'FIXED_SALARY_CHANGE') {
            const pendingAnnualTax = money(annualBeforeCurrentOccasionalResult.tax.minus(priorRegularIncomeTaxWithheld).minus(priorOccasionalIncomeTaxWithheld));
            regularIncomeTaxAdjustment = pendingAnnualTax.isNegative()
                ? pendingAnnualTax
                : money(pendingAnnualTax.dividedBy(Math.max(1, annualPeriods - input.priorPeriods)));
        } else {
            const targetThroughCurrent = money(regularAnnualTaxResult.tax.dividedBy(annualPeriods).times(elapsedPeriods));
            regularIncomeTaxAdjustment = money(targetThroughCurrent.minus(priorRegularIncomeTaxWithheld));
        }
    }
    const annualWithOccasionalResult = config.incomeTax.applicability === 'APPLIES'
        ? progressiveIncomeTax(annualProjection.plus(priorOccasionalIncomeTaxNet).plus(currentOccasionalIncomeTaxNet), config.incomeTax.brackets)
        : { tax: new Prisma.Decimal(0), bracket: null };
    let occasionalIncomeTaxWithholding = money(Prisma.Decimal.max(0, annualWithOccasionalResult.tax.minus(annualBeforeCurrentOccasionalResult.tax)));
    let regularIncomeTaxWithholding = regularIncomeTaxAdjustment.isPositive() ? regularIncomeTaxAdjustment : new Prisma.Decimal(0);
    let incomeTaxCreditBalance = regularIncomeTaxAdjustment.isNegative() ? regularIncomeTaxAdjustment.abs() : new Prisma.Decimal(0);
    let incomeTaxRefund = new Prisma.Decimal(0);
    if (!input.employerRefundAllowed && regularIncomeTaxAdjustment.isNegative()) {
        const netCurrentAdjustment = money(occasionalIncomeTaxWithholding.plus(regularIncomeTaxAdjustment));
        occasionalIncomeTaxWithholding = netCurrentAdjustment.isPositive() ? netCurrentAdjustment : new Prisma.Decimal(0);
        incomeTaxCreditBalance = netCurrentAdjustment.isNegative() ? netCurrentAdjustment.abs() : new Prisma.Decimal(0);
    }
    let effectiveAnnualIncomeTaxResult = annualWithOccasionalResult;
    if (input.employerRefundAllowed) {
        const actualAnnualIncomeTaxNet = money(accumulatedIncomeTaxNet.plus(priorOccasionalIncomeTaxNet).plus(currentOccasionalIncomeTaxNet));
        effectiveAnnualIncomeTaxResult = config.incomeTax.applicability === 'APPLIES'
            ? progressiveIncomeTax(actualAnnualIncomeTaxNet, config.incomeTax.brackets)
            : { tax: new Prisma.Decimal(0), bracket: null };
        const annualLiquidationAdjustment = money(effectiveAnnualIncomeTaxResult.tax.minus(priorRegularIncomeTaxWithheld).minus(priorOccasionalIncomeTaxWithheld));
        if (annualLiquidationAdjustment.isPositive()) {
            occasionalIncomeTaxWithholding = money(Prisma.Decimal.min(occasionalIncomeTaxWithholding, annualLiquidationAdjustment));
            regularIncomeTaxWithholding = money(annualLiquidationAdjustment.minus(occasionalIncomeTaxWithholding));
            incomeTaxCreditBalance = new Prisma.Decimal(0);
        } else {
            occasionalIncomeTaxWithholding = new Prisma.Decimal(0);
            regularIncomeTaxWithholding = new Prisma.Decimal(0);
            incomeTaxCreditBalance = annualLiquidationAdjustment.isNegative() ? annualLiquidationAdjustment.abs() : new Prisma.Decimal(0);
            incomeTaxRefund = incomeTaxCreditBalance;
        }
    }
    const currentIncomeTaxWithholding = money(regularIncomeTaxWithholding.plus(occasionalIncomeTaxWithholding));
    return {
        incomeTaxMethod, inssBase: money(inssBase), employeeInss, regularEmployeeInss, occasionalEmployeeInss,
        employerInssRate, employerInss, inatecBase, employerInatec,
        fixedIncomeTaxGross, variableIncomeTaxGross, occasionalIncomeTaxGross,
        currentRegularIncomeTaxNet, currentOccasionalIncomeTaxNet, currentIncomeTaxNet, otherIncomeTaxDeductions,
        accumulatedIncomeTaxNet, annualProjection, regularAnnualIncomeTax: regularAnnualTaxResult.tax,
        annualIncomeTaxWithOccasional: effectiveAnnualIncomeTaxResult.tax, annualIncomeTax: effectiveAnnualIncomeTaxResult.tax,
        priorRegularIncomeTaxWithheld, priorOccasionalIncomeTaxWithheld, regularIncomeTaxWithholding, occasionalIncomeTaxWithholding,
        currentIncomeTaxWithholding, incomeTaxRefund, incomeTaxCreditBalance, elapsedFiscalMonths, elapsedPeriods, annualPeriods,
        bracket: input.employerRefundAllowed
            ? effectiveAnnualIncomeTaxResult.bracket
            : currentOccasionalIncomeTaxNet.greaterThan(0) ? annualWithOccasionalResult.bracket : regularAnnualTaxResult.bracket,
        bracketSnapshot: {
            regular: regularAnnualTaxResult.bracket,
            beforeCurrentOccasional: annualBeforeCurrentOccasionalResult.bracket,
            withCurrentOccasional: annualWithOccasionalResult.bracket,
            effective: effectiveAnnualIncomeTaxResult.bracket,
        },
    };
}
