-- Rollback of 20260802_purchase_order_partial_receipts.
-- PARTIALLY_RECEIVED orders cannot be represented in the old enum. Abort and
-- resolve them first (close the remaining balance or reverse the receipts):
--   SELECT COUNT(*) FROM `PurchaseOrder` WHERE `status` = 'PARTIALLY_RECEIVED';
-- Orders closed short keep their adjusted total (= received value).
-- Receipt history (per-receipt references PO-{id}-R{n}) is dropped; the
-- inventory movements and FIFO layers themselves are untouched, but a later
-- reverse-receipt on the old code only recognises the legacy PO-{id} reference.
ALTER TABLE `PurchaseOrderReceiptLine` DROP FOREIGN KEY `PurchaseOrderReceiptLine_purchaseOrderItemId_fkey`;
ALTER TABLE `PurchaseOrderReceiptLine` DROP FOREIGN KEY `PurchaseOrderReceiptLine_receiptId_fkey`;
ALTER TABLE `PurchaseOrderReceipt` DROP FOREIGN KEY `PurchaseOrderReceipt_purchaseOrderId_fkey`;

DROP TABLE `PurchaseOrderReceiptLine`;
DROP TABLE `PurchaseOrderReceipt`;

ALTER TABLE `PurchaseOrderItem` DROP COLUMN `receivedQuantity`;

ALTER TABLE `PurchaseOrder`
    DROP COLUMN `receivingCloseReason`,
    DROP COLUMN `receivingClosedById`,
    DROP COLUMN `receivingClosedAt`,
    DROP COLUMN `receivedTotal`,
    MODIFY `status` ENUM('DRAFT', 'ISSUED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';
