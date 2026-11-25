-- Art. 19 LCT: separa renta fija, variable y ocasional sin inferir históricos V2.
ALTER TABLE `PayrollComponent`
  ADD COLUMN `incomeTaxTreatment` VARCHAR(32) NULL;

ALTER TABLE `PayrollStatutoryCalculation`
  ADD COLUMN `methodVersion` VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNCLASSIFIED',
  ADD COLUMN `incomeTaxMethod` VARCHAR(40) NOT NULL DEFAULT 'LEGACY_UNCLASSIFIED',
  ADD COLUMN `regularEmployeeInss` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `occasionalEmployeeInss` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `fixedIncomeTaxGross` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `variableIncomeTaxGross` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `occasionalIncomeTaxGross` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `fixedCompensationAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `currentRegularIncomeTaxNet` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `currentOccasionalIncomeTaxNet` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `priorOccasionalIncomeTaxNet` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `priorHadVariableIncome` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `elapsedFiscalMonths` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `regularAnnualIncomeTax` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `annualIncomeTaxWithOccasional` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `priorRegularIncomeTaxWithheld` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `priorOccasionalIncomeTaxWithheld` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `regularIncomeTaxWithheld` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `occasionalIncomeTaxWithheld` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `incomeTaxCreditBalance` DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE `PayrollComponent`
  ADD CONSTRAINT `PayrollComponent_ir_treatment_ck`
  CHECK (
    `incomeTaxTreatment` IS NULL OR
    (`type` = 'INCOME' AND `taxable` = TRUE AND `incomeTaxTreatment` IN ('REGULAR_FIXED', 'REGULAR_VARIABLE', 'OCCASIONAL'))
  );
