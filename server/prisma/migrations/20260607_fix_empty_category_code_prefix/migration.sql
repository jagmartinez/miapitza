-- Empty codePrefix values violate unique constraint when multiple rows share ''.
UPDATE `Category` SET `codePrefix` = NULL WHERE `codePrefix` = '';
