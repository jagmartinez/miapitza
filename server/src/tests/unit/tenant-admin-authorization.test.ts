import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { isCompanyWide, resolveBranchScope } from '../../utils/branch-scope';

const admin = {
    userId: 5,
    companyId: 7,
    branchId: 11,
    role: 'ADMIN',
    roles: ['ADMIN'],
};

const cashier = {
    userId: 6,
    companyId: 7,
    branchId: 11,
    role: 'CAJERO',
    roles: ['CAJERO'],
};

describe('tenant ADMIN authorization contract', () => {
    it('is company-wide inside its tenant while operational roles remain branch-bound', () => {
        expect(isCompanyWide(admin as never)).toBe(true);
        expect(resolveBranchScope(admin as never)).toBeUndefined();
        expect(resolveBranchScope(admin as never, 12)).toBe(12);
        expect(isCompanyWide(cashier as never)).toBe(false);
        expect(resolveBranchScope(cashier as never, 12)).toBe(11);
    });

    it('allows ADMIN on tenant branch mutations but keeps company creation platform-gated', () => {
        const branchRoutes = fs.readFileSync(path.resolve(__dirname, '../../routes/branch.routes.ts'), 'utf8');
        const companyRoutes = fs.readFileSync(path.resolve(__dirname, '../../routes/company.routes.ts'), 'utf8');
        const companyController = fs.readFileSync(path.resolve(__dirname, '../../controllers/company.controller.ts'), 'utf8');

        expect(branchRoutes).toContain("router.post('/', requireRole(...ADMINS)");
        expect(branchRoutes).toContain("router.delete('/:id', requireRole(...ADMINS)");
        expect(companyRoutes).toContain('router.use(requireRole(...ADMINS))');
        expect(companyController).toContain('assertPlatformOperator(req.user!)');
    });

    it('ships an additive existing-tenant ADMIN permission backfill', () => {
        const migration = fs.readFileSync(path.resolve(
            __dirname,
            '../../../prisma/migrations/20260716_enable_tenant_admin_operations/migration.sql',
        ), 'utf8');

        expect(migration).toContain('INSERT IGNORE INTO `_PermissionToRole`');
        expect(migration).toContain("r.`name` = 'ADMIN'");
        expect(migration).toContain('r.`companyId` IS NOT NULL');
        expect(migration).toContain("'hr.schedule.publish'");
        expect(migration).toContain("'hr.payroll.approve'");
        expect(migration).toContain("'hr.benefits.approve'");
        expect(migration).toContain("'orders.cancel'");
        expect(migration).toContain("'create_branch'");
        expect(migration).not.toContain('DELETE FROM `_PermissionToRole`');
    });
});
