-- The engine falls back to Company.costingMethod when the column is absent
-- only in older builds; roll the application back before dropping it.
ALTER TABLE `Warehouse`
    DROP COLUMN `costingMethod`;
