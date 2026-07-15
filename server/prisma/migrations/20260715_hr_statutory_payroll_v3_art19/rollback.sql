-- Falla cerrado: una reversión de esquema destruiría la clasificación y
-- la traza de cualquier cálculo V3 ya materializado. El nombre inexistente es
-- intencional y produce un error transaccional antes de ejecutar cualquier DDL.
SET @hr_art19_v3_guard_sql = IF(
  EXISTS (
    SELECT 1
    FROM `PayrollStatutoryCalculation`
    WHERE `methodVersion` = 'ART19_V3'
    LIMIT 1
  ),
  'SELECT 1 FROM `__HR_ART19_V3_ROLLBACK_BLOCKED_ACTIVE_ROWS__`',
  'SELECT 1'
);
PREPARE hr_art19_v3_guard_stmt FROM @hr_art19_v3_guard_sql;
EXECUTE hr_art19_v3_guard_stmt;
DEALLOCATE PREPARE hr_art19_v3_guard_stmt;

-- MySQL 8 usa DROP CHECK; MariaDB usa DROP CONSTRAINT. La selección se hace
-- en el servidor para que este mismo artefacto sea portable entre ambos.
SET @hr_art19_v3_drop_check_sql = IF(
  LOCATE('MariaDB', VERSION()) > 0,
  'ALTER TABLE `PayrollComponent` DROP CONSTRAINT `PayrollComponent_ir_treatment_ck`',
  'ALTER TABLE `PayrollComponent` DROP CHECK `PayrollComponent_ir_treatment_ck`'
);
PREPARE hr_art19_v3_drop_check_stmt FROM @hr_art19_v3_drop_check_sql;
EXECUTE hr_art19_v3_drop_check_stmt;
DEALLOCATE PREPARE hr_art19_v3_drop_check_stmt;

ALTER TABLE `PayrollStatutoryCalculation`
  DROP COLUMN `incomeTaxCreditBalance`,
  DROP COLUMN `occasionalIncomeTaxWithheld`,
  DROP COLUMN `regularIncomeTaxWithheld`,
  DROP COLUMN `priorOccasionalIncomeTaxWithheld`,
  DROP COLUMN `priorRegularIncomeTaxWithheld`,
  DROP COLUMN `annualIncomeTaxWithOccasional`,
  DROP COLUMN `regularAnnualIncomeTax`,
  DROP COLUMN `elapsedFiscalMonths`,
  DROP COLUMN `priorHadVariableIncome`,
  DROP COLUMN `priorOccasionalIncomeTaxNet`,
  DROP COLUMN `currentOccasionalIncomeTaxNet`,
  DROP COLUMN `currentRegularIncomeTaxNet`,
  DROP COLUMN `fixedCompensationAmount`,
  DROP COLUMN `occasionalIncomeTaxGross`,
  DROP COLUMN `variableIncomeTaxGross`,
  DROP COLUMN `fixedIncomeTaxGross`,
  DROP COLUMN `occasionalEmployeeInss`,
  DROP COLUMN `regularEmployeeInss`,
  DROP COLUMN `incomeTaxMethod`,
  DROP COLUMN `methodVersion`;

ALTER TABLE `PayrollComponent`
  DROP COLUMN `incomeTaxTreatment`;
