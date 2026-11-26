-- A fiscal invoice freezes the sale data but does not settle the account.
-- Heal only false-available tables that still have non-cancelled debt. This is
-- intentionally one-directional: releasing tables requires transactional
-- reconciliation of payments, cancellations and active table groups.
UPDATE `Table` AS t
SET t.`status` = 'OCCUPIED'
WHERE t.`status` = 'AVAILABLE'
  AND EXISTS (
      SELECT 1
      FROM `Order` AS o
      WHERE o.`companyId` = t.`companyId`
        AND o.`tableId` = t.`id`
        AND o.`status` IN (
            'OPEN',
            'SENT_TO_KITCHEN',
            'IN_PREPARATION',
            'READY',
            'DELIVERED'
        )
        AND o.`financialStatus` IN ('UNPAID', 'PARTIAL')
  );
