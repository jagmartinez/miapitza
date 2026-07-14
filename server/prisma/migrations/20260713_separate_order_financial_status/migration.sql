-- Separate the immutable/payment ledger lifecycle from restaurant operations.
-- Historical PAID orders retain their former terminal meaning as DELIVERED,
-- while financialStatus is backfilled only from active payment ledger rows.
ALTER TABLE `Order`
    ADD COLUMN `financialStatus` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    ADD COLUMN `deliveredAt` DATETIME(3) NULL;

UPDATE `Order` AS o
LEFT JOIN (
    SELECT `orderId`, SUM(`amount`) AS `activePaid`, MAX(`createdAt`) AS `lastPaymentAt`
    FROM `Payment`
    WHERE `status` = 'ACTIVE'
    GROUP BY `orderId`
) AS p ON p.`orderId` = o.`id`
SET
    o.`financialStatus` = CASE
        WHEN COALESCE(p.`activePaid`, 0) >= o.`total` AND COALESCE(p.`activePaid`, 0) > 0 THEN 'PAID'
        WHEN COALESCE(p.`activePaid`, 0) > 0 THEN 'PARTIAL'
        ELSE 'UNPAID'
    END,
    o.`closedAt` = CASE
        WHEN COALESCE(p.`activePaid`, 0) >= o.`total` AND COALESCE(p.`activePaid`, 0) > 0
            THEN COALESCE(o.`closedAt`, p.`lastPaymentAt`)
        ELSE NULL
    END;

-- PAID was historically both "settled" and terminal/removed from KDS. Preserve
-- that terminal operational meaning for existing rows. New prepayments never
-- write PAID to status and therefore remain OPEN/in-kitchen until delivery.
UPDATE `Order`
SET `status` = 'DELIVERED',
    `deliveredAt` = COALESCE(`deliveredAt`, `updatedAt`)
WHERE `status` = 'PAID';

UPDATE `Order`
SET `deliveredAt` = COALESCE(`deliveredAt`, `updatedAt`)
WHERE `status` = 'DELIVERED';

ALTER TABLE `Order`
    MODIFY COLUMN `status` ENUM(
        'OPEN',
        'SENT_TO_KITCHEN',
        'IN_PREPARATION',
        'READY',
        'CANCELLED',
        'DELIVERED'
    ) NOT NULL DEFAULT 'OPEN';

CREATE INDEX `Order_companyId_financialStatus_closedAt_idx`
    ON `Order`(`companyId`, `financialStatus`, `closedAt`);
