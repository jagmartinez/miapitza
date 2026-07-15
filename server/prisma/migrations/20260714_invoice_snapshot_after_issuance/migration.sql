-- Runs after 20260714_invoice_before_payment, which introduces invoicedAt.
-- An issued fiscal document must render from immutable captured data, not from
-- mutable menu/catalog/settings rows. Backfill existing issued orders with the
-- best historical representation still available at migration time.
ALTER TABLE `Order`
    ADD COLUMN `invoiceSnapshot` JSON NULL;

UPDATE `Order` o
INNER JOIN `Branch` b ON b.`id` = o.`branchId`
INNER JOIN `Company` c ON c.`id` = o.`companyId`
SET o.`invoiceSnapshot` = JSON_OBJECT(
    'orderId', o.`id`,
    'customerName', COALESCE(o.`customerName`, 'Consumidor Final'),
    'customerRuc', 'N/A',
    'items', COALESCE((
        SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'name', mi.`name`,
            'quantity', oi.`quantity`,
            'price', oi.`price`,
            'subtotal', oi.`subtotal`
        ))
        FROM `OrderItem` oi
        INNER JOIN `MenuItem` mi ON mi.`id` = oi.`menuItemId`
        WHERE oi.`orderId` = o.`id`
    ), JSON_ARRAY()),
    'grossSubtotal', COALESCE((
        SELECT SUM(oi3.`subtotal`) FROM `OrderItem` oi3 WHERE oi3.`orderId` = o.`id`
    ), 0),
    'discount', o.`discount`,
    'subtotal', GREATEST(0, COALESCE((
        SELECT SUM(oi2.`subtotal`) FROM `OrderItem` oi2 WHERE oi2.`orderId` = o.`id`
    ), 0) - o.`discount`),
    'tax', o.`tax`,
    'tipAmount', o.`tipAmount`,
    'tipRatePercent', CASE
        WHEN o.`tipAmount` > 0 AND (o.`total` - o.`tax` - o.`tipAmount`) > 0
        THEN ROUND(o.`tipAmount` / (o.`total` - o.`tax` - o.`tipAmount`) * 100, 2)
        ELSE COALESCE((
            SELECT CAST(s_tip.`value` AS DECIMAL(10, 2))
            FROM `Setting` s_tip
            WHERE s_tip.`companyId` = o.`companyId`
              AND s_tip.`name` = CONCAT(o.`companyId`, '_tipRate')
            LIMIT 1
        ), 0)
    END,
    'total', o.`total`,
    'branchName', b.`name`,
    'branchAddress', b.`address`,
    'branchPhone', b.`phone`,
    'companyName', c.`name`,
    'companyRuc', c.`ruc`,
    'date', CONCAT(DATE_FORMAT(COALESCE(o.`invoicedAt`, o.`createdAt`), '%Y-%m-%dT%H:%i:%s.%f'), 'Z'),
    'invoiceNumber', o.`invoiceNumber`,
    'taxRatePercent', CASE
        WHEN (o.`total` - o.`tax` - o.`tipAmount`) > 0
        THEN ROUND(o.`tax` / (o.`total` - o.`tax` - o.`tipAmount`) * 100, 2)
        ELSE COALESCE((
            SELECT CAST(s_tax.`value` AS DECIMAL(10, 2))
            FROM `Setting` s_tax
            WHERE s_tax.`companyId` = o.`companyId`
              AND s_tax.`name` = CONCAT(o.`companyId`, '_tax_rate')
            LIMIT 1
        ), 15)
    END,
    'currencySymbol', COALESCE((
        SELECT NULLIF(TRIM(s_currency.`value`), '')
        FROM `Setting` s_currency
        WHERE s_currency.`companyId` = o.`companyId`
          AND s_currency.`name` = CONCAT(o.`companyId`, '_currency_symbol')
        LIMIT 1
    ), 'C$')
)
WHERE o.`invoiceNumber` IS NOT NULL;

ALTER TABLE `Order`
    ADD CONSTRAINT `Order_invoice_snapshot_required`
    CHECK (`invoiceNumber` IS NULL OR `invoiceSnapshot` IS NOT NULL);
