-- Rollback of 20261123_customer_survey.
DELETE FROM `Permission` WHERE `name` = 'surveys.view';
DROP TABLE `SurveyResponse`;
