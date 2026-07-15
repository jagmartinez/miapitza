import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('HR schedule route contract', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/hr-schedule.routes.ts'), 'utf8');

    it('exposes owner and self schedule workflows with explicit permissions', () => {
        expect(routes).toContain("requirePermission('hr.schedule.read', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.schedule.manage', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.schedule.publish', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.schedule.self'");
        expect(routes).toContain("router.put('/schedules/:id'");
        expect(routes).toContain("router.get('/me/schedule'");
        expect(routes).toContain("router.get('/holidays'");
    });

    it('never accepts companyId from a privileged DTO body', () => {
        expect(routes).not.toMatch(/allowHrBodyFields\([^)]*companyId/);
    });
});
