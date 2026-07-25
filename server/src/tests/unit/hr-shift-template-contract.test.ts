import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('HR shift-template persistence and API contract', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');
    const migration = fs.readFileSync(
        path.resolve(__dirname, '../../../prisma/migrations/20260725_add_shift_template_color_snapshots/migration.sql'),
        'utf8',
    );
    const companyWideMigration = fs.readFileSync(
        path.resolve(__dirname, '../../../prisma/migrations/20260725_shift_templates_company_wide/migration.sql'),
        'utf8',
    );
    const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/hr-schedule.routes.ts'), 'utf8');
    const controller = fs.readFileSync(path.resolve(__dirname, '../../controllers/hr-schedule.controller.ts'), 'utf8');
    const service = fs.readFileSync(path.resolve(__dirname, '../../services/hr-schedule.service.ts'), 'utf8');

    it('adds a non-null default color, optimistic revision, and immutable shift snapshots', () => {
        expect(schema).toMatch(/model ShiftTemplate[\s\S]*?color\s+String\s+@default\("#3B82F6"\)\s+@db\.VarChar\(7\)/);
        expect(schema).toMatch(/model ShiftTemplate[\s\S]*?revision\s+Int\s+@default\(0\)/);
        expect(schema).toMatch(/model ScheduledShift[\s\S]*?templateNameSnapshot\s+String\?/);
        expect(schema).toMatch(/model ScheduledShift[\s\S]*?templateColorSnapshot\s+String\?\s+@db\.VarChar\(7\)/);
        expect(migration).toContain("ADD COLUMN `color` VARCHAR(7) NOT NULL DEFAULT '#3B82F6'");
        expect(migration).toContain('UPDATE `ScheduledShift` AS `shift`');
        expect(migration).toContain('`shift`.`templateNameSnapshot` = `template`.`name`');
        expect(migration).toContain('`shift`.`templateColorSnapshot` = `template`.`color`');
    });

    it('supports additive company-wide templates while preserving existing scoped rows', () => {
        expect(schema).toMatch(/model ShiftTemplate[\s\S]*?branchId\s+Int\?/);
        expect(schema).toMatch(/model ShiftTemplate[\s\S]*?timezone\s+String\?\s+@db\.VarChar\(64\)/);
        expect(schema).toMatch(/model ShiftTemplate[\s\S]*?branch\s+Branch\?\s+@relation/);
        expect(companyWideMigration).toContain('MODIFY `branchId` INTEGER NULL');
        expect(companyWideMigration).toContain('MODIFY `timezone` VARCHAR(64) NULL');
        expect(companyWideMigration).not.toMatch(/\bUPDATE\s+`ShiftTemplate`/);
    });

    it('validates color and explicit revision in middleware for all template mutations', () => {
        expect(routes).toContain("color: { type: 'string' as const, pattern: /^#[0-9A-Fa-f]{6}$/ }");
        expect(routes).toContain("expectedRevision: { ...templateBody.expectedRevision, required: true }");
        expect(routes).toContain("allowHrBodyFields(['active', 'expectedRevision'])");
        expect(routes).toContain("router.delete('/shift-templates/:id', ownerManage");
        expect(routes).toMatch(/router\.delete\('\/shift-templates\/:id'[\s\S]*?expectedRevision:\s*\{\s*type:\s*'number',\s*required:\s*true/);
        expect(routes).not.toContain('branchId: { ...templateBody.branchId, required: true }');
        expect(routes).not.toContain('code: { ...templateBody.code, required: true }');
    });

    it('keeps every template endpoint behind owner permissions and tenant identity from auth', () => {
        expect(routes).toContain("const ownerRead = requirePermission('hr.schedule.read'");
        expect(routes).toContain("const ownerManage = requirePermission('hr.schedule.manage'");
        expect(routes).toContain("router.get('/shift-templates', ownerRead");
        expect(routes).toContain("router.post('/shift-templates', ownerManage");
        expect(routes).toContain("router.put('/shift-templates/:id', ownerManage");
        expect(routes).toContain("router.patch('/shift-templates/:id/status', ownerManage");
        expect(routes).toContain("router.delete('/shift-templates/:id', ownerManage");
        expect(routes).not.toMatch(/allowHrBodyFields\([^)]*companyId/);
        expect(controller).toContain('req.user!.companyId');
        expect(controller).toContain('ShiftTemplateService.remove(');
    });

    it('uses CAS, audit, soft deletion, and immutable assignment snapshots', () => {
        expect(service).toContain("where: { id, companyId, revision: expectedRevision }");
        expect(service).toContain("action: 'DELETE'");
        expect(service).toContain("mode: 'SOFT_DELETE'");
        expect(service).toContain("schedule: { status: 'DRAFT' }");
        expect(service).toContain('templateNameSnapshot: template?.name || null');
        expect(service).toContain('templateColorSnapshot: template?.color || null');
        expect(service).toContain('startTime no coincide con la plantilla seleccionada');
        expect(service).toContain('breakMinutes no coincide con la plantilla seleccionada');
        expect(service).toContain('shiftTemplateId: null');
        expect(service).toContain('templateSnapshotsPreserved');
        expect(service).toContain("OR: [{ branchId: null }, { branchId }]");
        expect(service).toContain("template.branchId !== null");
        expect(service).toContain("timezoneSnapshot: branch.timezone");
        expect(service).toContain("generatedShiftTemplateCode()");
    });

    it('maps duplicate unique keys to an explicit HTTP 409 instead of a generic 500', () => {
        expect(controller).toContain("if (error.code === 'P2002')");
        expect(controller).toContain('res.status(409)');
        expect(controller).toContain('Ya existe un registro equivalente');
    });
});
