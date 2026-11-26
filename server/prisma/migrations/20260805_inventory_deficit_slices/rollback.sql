-- Dropping the slice ledger keeps Stock.negativeBalanceCost (the pooled
-- provisional value); older builds fall back to pro-rata coverage and
-- episode-less returns.
DROP TABLE `InventoryDeficitSlice`;
