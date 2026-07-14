import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('Persistent table floor plan contract', () => {
    it('stores branch plans, editable areas and table-area assignment', () => {
        const schema = read('../../../prisma/schema.prisma');
        const migration = read('../../../prisma/migrations/20260714_add_floor_areas/migration.sql');

        expect(schema).toContain('model TableFloorPlan');
        expect(schema).toContain('model FloorArea');
        expect(schema).toContain('floorAreaId');
        expect(migration).toContain('CREATE TABLE `TableFloorPlan`');
        expect(migration).toContain('CREATE TABLE `FloorArea`');
        expect(migration).toContain('ON DELETE SET NULL');
    });

    it('protects snapshot reads and transactional saves with map permissions', () => {
        const routes = read('../../routes/table.routes.ts');
        const service = read('../../services/table-floor-plan.service.ts');

        expect(routes).toContain("router.get('/plan/:branchId'");
        expect(routes).toContain("requirePermission('tables.map.view'");
        expect(routes).toContain("router.put('/plan/:branchId'");
        expect(routes).toContain("requirePermission('tables.map.edit'");
        expect(service).toContain('prisma.$transaction');
        expect(service).toContain('plan.version !== expectedVersion');
        expect(service).toContain('mapVersion: { increment: 1 }');
        expect(service).toContain("action: 'FLOOR_PLAN_UPDATE'");
    });

    it('keeps the legacy layout endpoint synchronized with the plan version', () => {
        const service = read('../../services/table-account.service.ts');
        expect(service).toContain('tableFloorPlan.upsert');
        expect(service).toContain('version: { increment: 1 }');
    });
});
