-- Dropping the column loses the provisional valuation of open negative
-- balances; a covering inbound will then silently drop the deficit value again
-- (legacy behavior). COST_TRUE_UP movements already posted stay in the ledger.
ALTER TABLE `Stock`
    DROP COLUMN `negativeBalanceCost`;
