-- Negative-stock cost true-up (inventory audit D1).
--
-- Stock.negativeBalanceCost is the provisional value already charged to COGS
-- for units sold while the warehouse balance was negative (allowNegative).
-- When an inbound later covers the deficit, the inventory engine posts a
-- zero-quantity ADJUSTMENT movement (origin COST_TRUE_UP) for
-- (real inbound cost of the covered units - this provisional value) and
-- reduces the column pro rata, so COGS and the movement ledger reconcile.
ALTER TABLE `Stock`
    ADD COLUMN `negativeBalanceCost` DECIMAL(18, 6) NOT NULL DEFAULT 0;

-- Existing negative balances were valued by the legacy engine at the product's
-- effective cost (moving average, else reference cost). Seed the column with
-- that valuation so the first covering inbound trues up only the real delta.
UPDATE `Stock` s
    JOIN `Product` p ON p.`id` = s.`productId`
SET s.`negativeBalanceCost` = (-s.`quantity`) * (
        CASE WHEN p.`currentAverageCost` > 0 THEN p.`currentAverageCost` ELSE p.`cost` END
    )
WHERE s.`quantity` < 0;
