-- Rollback: 001_api_keys
-- Description: Drops the ApiKey table.
-- WARNING: This will permanently delete all API keys.

DROP TABLE IF EXISTS `ApiKey`;
