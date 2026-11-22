import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { PIN_ROLES, ROLES } from '../../constants/roles';

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, '../../..', ...p), 'utf8');
const dir = 'prisma/migrations/20261124_inventory_count_sheet';

describe('inventory count schema (Phase 5b Task 1)', () => {
    it('models expose the expected columns', () => {
        expect(Object.keys(Prisma.InventoryCountSheetScalarFieldEnum).sort()).toEqual([
            'approvedAt', 'approvedById', 'branchId', 'companyId', 'id', 'openWarehouseId', 'rejectReason', 'rejectedAt',
            'rejectedById', 'returnNote', 'returnedAt', 'scopeCategoryIds', 'startedAt', 'startedById', 'status',
            'submittedAt', 'submittedById', 'warehouseId',
        ]);
        expect(Object.keys(Prisma.InventoryCountLineScalarFieldEnum).sort()).toEqual([
            'adjustmentValue', 'categoryId', 'clientCountedAt', 'countedAt', 'countedBaseQuantity', 'countedById',
            'countedQuantity', 'expectedAtCount', 'id', 'movementId', 'notCounted', 'previousCountedBase', 'productId',
            'recountRequested', 'sheetId', 'unit',
        ]);
    });

    it('migration creates both tables with the unique indexes and grants inventory.count', () => {
        const sql = read(dir, 'migration.sql');
        expect(sql).toContain('CREATE TABLE `InventoryCountSheet`');
        expect(sql).toContain('CREATE TABLE `InventoryCountLine`');
        expect(sql).toContain('UNIQUE INDEX `InventoryCountSheet_openWarehouseId_key` (`openWarehouseId`)');
        expect(sql).toContain('UNIQUE INDEX `InventoryCountLine_sheetId_productId_key` (`sheetId`, `productId`)');
        expect(sql).toContain("'inventory.count'");
        expect(sql).toContain('INSERT IGNORE INTO `_PermissionToRole`');
        expect(sql).toContain("IN ('SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF')");
        expect(sql).toContain('utf8mb4');
        // Only the lines cascade (towards their sheet); every other FK restricts.
        expect(sql.match(/ON DELETE CASCADE/g)).toHaveLength(1);
        expect(sql).toContain('`InventoryCountLine_sheetId_fkey` FOREIGN KEY (`sheetId`) REFERENCES `InventoryCountSheet` (`id`) ON DELETE CASCADE');
        expect(sql).not.toMatch(/ON DELETE SET NULL/);
    });

    it('rollback removes the permission and both tables', () => {
        const rb = read(dir, 'rollback.sql');
        expect(rb).toContain("DELETE FROM `Permission` WHERE `name` = 'inventory.count'");
        expect(rb).toContain('DROP TABLE `InventoryCountLine`');
        expect(rb).toContain('DROP TABLE `InventoryCountSheet`');
        expect(rb.indexOf('InventoryCountLine')).toBeLessThan(rb.indexOf('DROP TABLE `InventoryCountSheet`'));
    });

    it('seed and provisioning put inventory.count in ADMIN, BODEGA and CHEF only (SUPERADMIN gets all)', () => {
        const seed = read('prisma/seed.ts');
        expect(seed).toContain("inventoryCountPermissions = ['inventory.count']");
        const line = (role: string) => seed.split('\n').find((l) => l.trim().startsWith(`${role}:`)) ?? '';
        for (const role of ['ADMIN', 'BODEGA', 'CHEF']) expect(line(role)).toContain('...inventoryCountPermissions');
        for (const role of ['MESERO', 'CAJERO', 'COCINA', 'HOST']) expect(line(role)).not.toContain('inventoryCount');
        expect(seed).toMatch(/const permissions = \[[\s\S]*\.\.\.inventoryCountPermissions[\s\S]*\];/);
        expect(line('SUPERADMIN')).toContain('permissions');

        const src = read('src/services/company-provisioning.service.ts');
        expect(src).toContain("INVENTORY_COUNT_PERMISSIONS = ['inventory.count']");
        const block = (key: string) => {
            const start = src.indexOf(`[ROLES.${key}]: [`);
            return src.slice(start, src.indexOf('],', start));
        };
        for (const role of ['ADMIN', 'BODEGA', 'CHEF']) expect(block(role)).toContain('...INVENTORY_COUNT_PERMISSIONS');
        for (const role of ['MESERO', 'CAJERO', 'COCINA', 'HOST']) expect(block(role)).not.toContain('INVENTORY_COUNT');
    });

    it('PIN_ROLES contains BODEGA and CHEF', () => {
        expect(PIN_ROLES).toEqual(expect.arrayContaining([ROLES.BODEGA, ROLES.CHEF]));
    });

    it('the router is mounted at /inventory-counts and every counter route requires inventory.count', () => {
        expect(read('src/routes/v1.router.ts')).toContain("v1.use('/inventory-counts', inventoryCountRoutes)");
        const routes = read('src/routes/inventory-count.routes.ts');
        const counterRoutes = routes.split('\n').filter((l) => /^router\.(get|post|put)\(/.test(l.trim()));
        expect(counterRoutes.length).toBeGreaterThanOrEqual(4);
        for (const l of counterRoutes) expect(l).toContain("requirePermission('inventory.count'");
        expect(routes).toContain("'SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'");
    });
});
