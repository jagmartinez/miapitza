-- El régimen fiscal pertenece a la empresa. Las revisiones legales conservan
-- una copia congelada para trazabilidad y deben coincidir con este perfil.
ALTER TABLE `Company`
  ADD COLUMN `payrollTaxRegime` VARCHAR(40) NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN `payrollIncomeTaxWithholding` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN `payrollTaxRegimeReference` VARCHAR(500) NULL,
  ADD COLUMN `payrollIncomeTaxException` VARCHAR(500) NULL,
  ADD COLUMN `payrollTaxProfileReady` BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE `Company`
SET `payrollTaxRegimeReference` = CASE
  WHEN `ruc` IS NOT NULL AND TRIM(`ruc`) <> '' THEN CONCAT('Perfil fiscal de la empresa · RUC ', `ruc`)
  ELSE 'Perfil fiscal empresarial pendiente de actualizar'
END
WHERE `payrollTaxRegimeReference` IS NULL;

-- Si ya existe una versión ACTIVE validada, el snapshot fiscal es la fuente
-- más segura para preparar el perfil maestro sin inventar una clasificación.
UPDATE `Company` AS c
JOIN (
  SELECT `companyId`, MAX(`id`) AS `ruleVersionId`
  FROM `PayrollRuleVersion`
  WHERE `status` = 'ACTIVE'
    AND `activeConfigurationRevisionId` IS NOT NULL
  GROUP BY `companyId`
  HAVING COUNT(*) = 1
) AS eligible
  ON eligible.`companyId` = c.`id`
JOIN `PayrollRuleVersion` AS r
  ON r.`id` = eligible.`ruleVersionId`
JOIN `PayrollRuleConfigurationRevision` AS cr
  ON cr.`id` = r.`activeConfigurationRevisionId`
SET
  c.`payrollTaxRegime` = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.code')), c.`payrollTaxRegime`),
  c.`payrollIncomeTaxWithholding` = JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.incomeTaxApplicability')) = 'APPLIES',
  c.`payrollTaxRegimeReference` = JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.sourceReference')),
  c.`payrollIncomeTaxException` = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.incomeTaxExceptionReason')), 'null'),
  c.`payrollTaxProfileReady` = IF((
    JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.code')) IN ('GENERAL', 'SIMPLIFIED_FIXED_QUOTA', 'SPECIAL', 'EXEMPT', 'OTHER')
    AND CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.sourceReference')))) >= 3
    AND JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.incomeTaxApplicability')) IN ('APPLIES', 'DOES_NOT_APPLY')
    AND (
      JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.incomeTaxApplicability')) = 'APPLIES'
      OR CHAR_LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(cr.`configuration`, '$.statutory.companyTaxRegime.incomeTaxExceptionReason')))) >= 3
    )
  ), TRUE, FALSE);
