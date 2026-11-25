import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('HR route permission contract', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/hr.routes.ts'), 'utf8');
    const corePermissionMigration = fs.readFileSync(path.resolve(
        __dirname,
        '../../../prisma/migrations/20260714_materialize_hr_core_permissions/migration.sql',
    ), 'utf8');

    it('uses the permission names seeded by the application', () => {
        expect(routes).toContain("requirePermission('hr.dashboard.read'");
        expect(routes).toContain("requirePermission('hr.employee.read'");
        expect(routes).toContain("requirePermission('hr.catalog.read'");
        expect(routes).toContain("requirePermission('hr.catalog.manage'");
        expect(routes).toContain("requirePermission('hr.geofence.read'");
        expect(routes).toContain("requirePermission('hr.geofence.manage'");
        expect(routes).not.toContain('hr.dashboard.view');
        expect(routes).not.toContain('hr.config.manage');
    });

    it('guards sensitive employee detail separately from employee mutation', () => {
        expect(routes).toContain("requirePermission('hr.employee.sensitive.view', ROLES.SUPERADMIN)");
    });

    it('does not grant geofence mutation through an ADMIN role fallback', () => {
        const putRoute = routes.slice(routes.indexOf("router.put('/branches/:id/geofence'"));
        expect(putRoute).toContain("requirePermission('hr.geofence.manage', ROLES.SUPERADMIN)");
        expect(putRoute).not.toContain('ROLES.ADMIN');
    });

    it('exposes organization catalogs and atomic branch creation', () => {
        expect(routes).toContain("['departments', 'department']");
        expect(routes).toContain("['positions', 'jobPosition']");
        expect(routes).toContain("['cost-centers', 'costCenter']");
        expect(routes).toContain("router.post('/branches'");
    });

    it('materializes every RH F1-F4 route permission during migrate deploy', () => {
        const routePermissions = Array.from(routes.matchAll(/requirePermission\('([^']+)'/g), (match) => match[1]);
        const scheduleRoutes = fs.readFileSync(path.resolve(__dirname, '../../routes/hr-schedule.routes.ts'), 'utf8');
        const attendanceRoutes = fs.readFileSync(path.resolve(__dirname, '../../routes/hr-attendance.routes.ts'), 'utf8');
        const workforceRoutes = fs.readFileSync(path.resolve(__dirname, '../../routes/hr-workforce.routes.ts'), 'utf8');
        for (const source of [scheduleRoutes, attendanceRoutes, workforceRoutes]) {
            routePermissions.push(...Array.from(source.matchAll(/requirePermission\('([^']+)'/g), (match) => match[1]));
        }
        for (const permission of new Set(routePermissions)) {
            expect(corePermissionMigration).toContain(`('${permission}'`);
        }
        expect(corePermissionMigration).toContain("r.`name` = 'SUPERADMIN'");
        expect(corePermissionMigration).toContain("r.`name` = 'ADMIN'");
        expect(corePermissionMigration).toContain("r.`name` IN ('CAJERO', 'MESERO', 'COCINA', 'CHEF', 'BODEGA', 'HOST')");
    });
});
