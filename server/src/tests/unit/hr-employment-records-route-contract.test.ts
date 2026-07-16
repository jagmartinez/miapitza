import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('HR employment records route contract', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/hr.routes.ts'), 'utf8');

    it('guards reads with sensitive-view and mutations with employee-manage', () => {
        expect(routes).toContain("router.get('/employees/:id/contracts', requirePermission('hr.employee.sensitive.view'");
        expect(routes).toContain("router.get('/employees/:id/compensations', requirePermission('hr.employee.sensitive.view'");
        expect(routes).toContain("router.get('/employees/:id/documents', requirePermission('hr.employee.sensitive.view'");
        expect(routes).toContain("router.post('/employees/:id/contracts'");
        expect(routes).toContain("router.post('/employees/:id/compensations'");
        expect(routes).toContain("router.post('/employees/:id/documents'");
        expect(routes).toContain("requirePermission('hr.employee.manage', ROLES.SUPERADMIN)");
    });

    it('bounds document uploads in memory and exposes retention/health gates', () => {
        expect(routes).toContain('multer.memoryStorage()');
        expect(routes).toContain('fileSize: 10 * 1024 * 1024');
        expect(routes).toContain("['application/pdf', 'image/jpeg', 'image/png']");
        expect(routes).toContain("router.get('/documents/storage/health'");
        expect(routes).toContain("router.post('/documents/retention/run'");
    });

    it('requires atomic onboarding compensation and keeps later salary writes append-only', () => {
        expect(routes).toContain("'initialCompensation'");
        expect(routes).toContain('initialCompensation: {');
        expect(routes).toContain("required: true, enum: ['WEEKLY', 'BIWEEKLY', 'FORTNIGHTLY', 'MONTHLY']");
        expect(routes).toContain("field !== 'initialCompensation'");
        expect(routes).toContain("router.post('/employees/:id/compensations'");
        expect(routes).not.toContain("router.put('/employees/:id/compensations'");
    });
});
