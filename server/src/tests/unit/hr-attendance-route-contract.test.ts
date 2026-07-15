import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('HR attendance route security contract', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../routes/hr-attendance.routes.ts'), 'utf8');

    it('uses memory-only bounded multipart uploads and accepts the UI field', () => {
        expect(source).toContain('multer.memoryStorage()');
        expect(source).toContain("{ name: 'faceImage', maxCount: 1 }");
        expect(source).toContain('fileSize: 2 * 1024 * 1024');
        expect(source).not.toContain('diskStorage');
    });

    it('exposes the complete attendance contract with separated permissions', () => {
        for (const pathValue of [
            '/attendance/policy', '/me/attendance/today', '/biometrics/challenges', '/biometrics/me',
            '/biometrics/enroll', '/biometrics/users/:userId/revoke', '/biometrics/maintenance/run',
            '/biometrics/provider/health',
            '/attendance/punches', '/attendance/events', '/attendance/manual', '/attendance/devices',
        ]) expect(source).toContain(pathValue);
        expect(source).toContain("requirePermission('hr.attendance.manage', ROLES.SUPERADMIN)");
        expect(source).toContain("requirePermission('hr.attendance.review', ROLES.SUPERADMIN)");
        expect(source).toContain("requirePermission('hr.attendance.self'");
        expect(source).toContain("requirePermission('hr.biometric.self'");
        expect(source).toContain("requirePermission('hr.biometric.manage'");
        expect(source).toContain("requirePermission('hr.attendance.device.manage', ROLES.SUPERADMIN)");
    });

    it('never allows client-supplied tenant or face-verification decisions', () => {
        expect(source).not.toMatch(/allowHrBodyFields\([^)]*companyId/);
        expect(source).not.toMatch(/allowHrBodyFields\([^)]*(faceStatus|livenessStatus|providerStatus|matched)/);
    });
});
