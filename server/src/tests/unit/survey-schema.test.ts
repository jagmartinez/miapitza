import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { Prisma } from '@prisma/client';

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, '../../..', ...p), 'utf8');
const dir = 'prisma/migrations/20261123_customer_survey';

describe('customer survey schema (Phase 5a Task 1)', () => {
    it('SurveyResponse exposes the expected columns', () => {
        expect(Object.keys(Prisma.SurveyResponseScalarFieldEnum).sort()).toEqual([
            'branchId', 'comment', 'companyId', 'contactPhone', 'createdAt', 'foodRating', 'id', 'nps',
            'operationalDeviceId', 'orderId', 'serviceRating', 'waiterRating', 'waiterUserId',
        ]);
    });

    it('migration creates the table with unique orderId and grants surveys.view to SUPERADMIN/ADMIN', () => {
        const sql = read(dir, 'migration.sql');
        expect(sql).toContain('CREATE TABLE `SurveyResponse`');
        expect(sql).toContain('UNIQUE INDEX `SurveyResponse_orderId_key` (`orderId`)');
        expect(sql).toContain("'surveys.view'");
        expect(sql).toContain('INSERT IGNORE INTO `_PermissionToRole`');
        expect(sql).toContain("IN ('SUPERADMIN', 'ADMIN')");
        expect(sql).not.toMatch(/ON DELETE (SET NULL|CASCADE)/);
    });

    it('rollback drops the permission and the table', () => {
        const rb = read(dir, 'rollback.sql');
        expect(rb).toContain("DELETE FROM `Permission` WHERE `name` = 'surveys.view'");
        expect(rb).toContain('DROP TABLE `SurveyResponse`');
    });

    it('seed and provisioning put surveys.view in ADMIN (and not in MESERO/CAJERO)', () => {
        const seed = read('prisma/seed.ts');
        expect(seed).toContain("surveyPermissions = ['surveys.view']");
        const line = (role: string) => seed.split('\n').find((l) => l.trim().startsWith(`${role}:`)) ?? '';
        expect(line('ADMIN')).toContain('...surveyPermissions');
        expect(line('MESERO')).not.toContain('survey');
        expect(line('CAJERO')).not.toContain('survey');
        expect(seed).toMatch(/const permissions = \[[\s\S]*\.\.\.surveyPermissions[\s\S]*\];/);
        const src = read('src/services/company-provisioning.service.ts');
        expect(src).toContain("SURVEY_PERMISSIONS = ['surveys.view']");
        const start = src.indexOf('[ROLES.ADMIN]: [');
        expect(src.slice(start, src.indexOf('],', start))).toContain('...SURVEY_PERMISSIONS');
    });

    it('the router is mounted at /surveys and the submit route carries no requirePermission', () => {
        expect(read('src/routes/v1.router.ts')).toContain("v1.use('/surveys', surveyRoutes)");
        const routes = read('src/routes/survey.routes.ts');
        const submit = routes.slice(routes.indexOf("router.post('/'"));
        const end = submit.indexOf('router.', 10);
        expect(end === -1 ? submit : submit.slice(0, end)).not.toContain('requirePermission');
    });
});
