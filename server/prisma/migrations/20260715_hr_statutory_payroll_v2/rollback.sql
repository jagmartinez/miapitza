DROP TRIGGER IF EXISTS `PayrollStatutoryCalculation_no_delete`;
DROP TRIGGER IF EXISTS `PayrollStatutoryCalculation_no_update`;
DROP TRIGGER IF EXISTS `PayrollEmployerContribution_no_delete`;
DROP TRIGGER IF EXISTS `PayrollEmployerContribution_no_update`;

DROP TABLE IF EXISTS `PayrollStatutoryCalculation`;
DROP TABLE IF EXISTS `PayrollEmployerContribution`;

ALTER TABLE `PayrollRunReversal`
  DROP COLUMN `reversedEmployerContributions`;

ALTER TABLE `PayrollComponent`
  DROP COLUMN `trainingContributionApplicable`,
  DROP COLUMN `socialSecurityApplicable`,
  DROP COLUMN `incomeTaxDeductible`;
