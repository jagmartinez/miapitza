-- Narrowing back rounds values to the previous scale. Abort first if any value
-- would overflow the old integer range (it would fail mid-way otherwise):
--   SELECT COUNT(*) FROM `Recipe` WHERE ABS(`quantity`) >= 10000000;
--   SELECT COUNT(*) FROM `Modifier` WHERE ABS(`consumeQuantity`) >= 10000000;
--   SELECT COUNT(*) FROM `Product` WHERE ABS(`cost`) >= 100000000;
-- Quantities below 0.0005 become 0.000 and stop deducting stock again.
ALTER TABLE `ProductUnit`
    MODIFY `conversionFactor` DECIMAL(18, 6) NOT NULL;

ALTER TABLE `Product`
    MODIFY `cost` DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE `Modifier`
    MODIFY `consumeQuantity` DECIMAL(10, 3) NULL;

ALTER TABLE `Recipe`
    MODIFY `quantity` DECIMAL(10, 3) NOT NULL;
