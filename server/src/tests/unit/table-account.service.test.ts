import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { allocatePartialFinancials, TableAccountService } from '../../services/table-account.service';
import { assertCompatiblePhysicalGroups, validateTableGroupSelection } from '../../services/table-group.service';

describe('Table account operations', () => {
    it('rejects ambiguous or duplicate table selections before opening a transaction', async () => {
        await expect(TableAccountService.transfer(1, 9, {
            sourceTableId: 2,
            destinationTableId: 2,
            orderId: 10
        })).rejects.toThrow(/destino diferente/i);

        await expect(TableAccountService.consolidate(1, 9, {
            destinationTableId: 1,
            sourceTableIds: [2, 2]
        })).rejects.toThrow(/repita mesas/i);

        await expect(TableAccountService.updateLayout(1, 1, 9, [
            { id: 1, x: 0, y: 0, width: 120, height: 80, expectedVersion: 0 },
            { id: 1, x: 10, y: 10, width: 120, height: 80, expectedVersion: 0 }
        ])).rejects.toThrow(/repita mesas/i);
    });

    it('rejects invalid physical groups and cross-group account moves before mutation', () => {
        expect(() => validateTableGroupSelection({ primaryTableId: 1, memberTableIds: [] })).toThrow(/adicional/i);
        expect(() => validateTableGroupSelection({ primaryTableId: 1, memberTableIds: [1] })).toThrow(/principal/i);
        expect(() => validateTableGroupSelection({ primaryTableId: 1, memberTableIds: [2, 2] })).toThrow(/repita/i);
        expect(validateTableGroupSelection({ primaryTableId: 3, memberTableIds: [2, 1] })).toEqual([1, 2, 3]);
        expect(() => assertCompatiblePhysicalGroups([
            { activeTableGroupId: 10 },
            { activeTableGroupId: null }
        ], 'cambiar el consumo')).toThrow(/separe primero/i);
        expect(() => assertCompatiblePhysicalGroups([
            { activeTableGroupId: 10 },
            { activeTableGroupId: 11 }
        ], 'consolidar')).toThrow(/separe primero/i);
        expect(() => assertCompatiblePhysicalGroups([
            { activeTableGroupId: 10 },
            { activeTableGroupId: 10 }
        ], 'consolidar')).not.toThrow();
    });

    it('keeps the critical mutations behind granular backend permissions', () => {
        const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/table.routes.ts'), 'utf8');
        expect(routes).toContain("requirePermission('tables.map.edit'");
        expect(routes).toContain("requirePermission('tables.transfer'");
        expect(routes).toContain("requirePermission('tables.consolidate'");
        expect(routes).not.toContain('router.post(\'/consolidate\', requireRole');
    });

    it('ships provenance, optimistic locking and production permission grants in one migration', () => {
        const migration = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/migrations/20260714_add_table_map_and_account_operations/migration.sql'),
            'utf8'
        );
        expect(migration).toContain('`mapVersion` INTEGER NOT NULL DEFAULT 0');
        expect(migration).toContain('`originOrderId` INTEGER NULL');
        expect(migration).toContain("'tables.transfer'");
        expect(migration).toContain('INSERT IGNORE INTO `_PermissionToRole`');
    });

    it('persists physical groups separately from financial consolidation and closes them from terminal order flows', () => {
        const migration = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/migrations/20260719_add_physical_table_groups/migration.sql'),
            'utf8'
        );
        const groupService = fs.readFileSync(path.resolve(__dirname, '../../services/table-group.service.ts'), 'utf8');
        const orderService = fs.readFileSync(path.resolve(__dirname, '../../services/order.service.ts'), 'utf8');
        expect(migration).toContain('CREATE TABLE `TableGroup`');
        expect(migration).toContain('`activeTableGroupId` INTEGER NULL');
        expect(migration).toContain("'tables.group.manage'");
        expect(groupService).toContain("action: 'TABLE_GROUP_CREATE'");
        expect(groupService).toContain("action: 'TABLE_GROUP_CLOSE'");
        expect(orderService).toContain('closeInactiveTableGroupForTable');
    });

    it('derives the moved total from independently rounded financial components', () => {
        const allocation = allocatePartialFinancials({
            originalTotalCents: 10_003,
            sourceSubtotalCents: 9_999,
            movedSubtotalCents: 3_333,
            discountCents: 101,
            taxCents: 107,
            tipCents: 109
        });

        expect(allocation.movedTotalCents).toBe(
            3_333 - allocation.movedDiscountCents + allocation.movedTaxCents + allocation.movedTipCents
        );
        expect(allocation.sourceTotalCents + allocation.movedTotalCents).toBe(10_003);
    });

    it('preserves first-origin provenance before moving consolidated items', () => {
        const service = fs.readFileSync(
            path.resolve(__dirname, '../../services/table-account.service.ts'),
            'utf8'
        );
        expect(service).toContain('originOrderId: null');
        expect(service).toContain('originTableId: null');
        expect(service).toContain('data: { orderId: primary.id }');
        expect(service).not.toContain('orderId: primary.id,\n                            originOrderId: source.id');
    });
});
