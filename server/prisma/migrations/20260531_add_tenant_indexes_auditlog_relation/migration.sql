-- Additive migration: tenant query indexes + AuditLog.companyId FK.
-- Safe to run on databases previously synced via `prisma db push`.
-- If an index already exists, `migrate deploy` may fail on that statement;
-- drop the duplicate index manually or mark the migration as applied.

-- Product: tenant-scoped listings
CREATE INDEX `Product_companyId_idx` ON `Product`(`companyId`);
CREATE INDEX `Product_companyId_active_idx` ON `Product`(`companyId`, `active`);

-- User: tenant / branch lookups
CREATE INDEX `User_companyId_idx` ON `User`(`companyId`);
CREATE INDEX `User_branchId_idx` ON `User`(`branchId`);

-- ModifierGroup: tenant listings
CREATE INDEX `ModifierGroup_companyId_idx` ON `ModifierGroup`(`companyId`);

-- Recipe: join paths from menu items / products
CREATE INDEX `Recipe_menuItemId_idx` ON `Recipe`(`menuItemId`);
CREATE INDEX `Recipe_productId_idx` ON `Recipe`(`productId`);

-- PurchaseOrder: branch-filtered lists within a tenant
CREATE INDEX `PurchaseOrder_companyId_branchId_idx` ON `PurchaseOrder`(`companyId`, `branchId`);

-- AuditLog: optional FK to Company (companyId column already exists)
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
