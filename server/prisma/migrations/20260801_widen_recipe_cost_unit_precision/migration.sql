-- Widen recipe quantities, product reference cost and per-product unit factors.
-- Every change only increases precision/scale, so existing values are kept
-- exactly (MySQL pads the extra decimals with zeros).
--
-- Recipe.quantity / Modifier.consumeQuantity: DECIMAL(10,3) stored 0.0004 as
-- 0.000, so a sale or modifier silently deducted nothing.
ALTER TABLE `Recipe`
    MODIFY `quantity` DECIMAL(18, 6) NOT NULL;

ALTER TABLE `Modifier`
    MODIFY `consumeQuantity` DECIMAL(18, 6) NULL;

-- Product.cost is the per-base-unit reference cost (e.g. per gram); two
-- decimals rounded 0.004 to 0.00.
ALTER TABLE `Product`
    MODIFY `cost` DECIMAL(18, 6) NOT NULL DEFAULT 0;

-- Small factors (1 g under a lb base = 0.002204622622) lost ~0.02% at scale 6.
ALTER TABLE `ProductUnit`
    MODIFY `conversionFactor` DECIMAL(24, 12) NOT NULL;
