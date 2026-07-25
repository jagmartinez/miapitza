import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const apiSource = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const usersSource = readFileSync(new URL('../pages/Users.tsx', import.meta.url), 'utf8');
const branchesSource = readFileSync(new URL('../pages/Branches.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8');
const profileSource = readFileSync(new URL('../pages/Profile.tsx', import.meta.url), 'utf8');

describe('Phase 1 HR API contract', () => {
    it('keeps every HR resource under the versioned API prefix', () => {
        expect(apiSource).toContain("const HR_API_BASE = '/v1/hr'");
        expect(apiSource).toContain('`${HR_API_BASE}/dashboard`');
        expect(apiSource).toContain('`${HR_API_BASE}/employees`');
        expect(apiSource).toContain('`${HR_API_BASE}/employees/${employeeId}`');
        expect(apiSource).toContain('`${HR_API_BASE}/lookups`');
        expect(apiSource).toContain('`${HR_API_BASE}/employees/${employeeId}/status`');
    });

    it('exposes a versioned GET/PUT geofence contract', () => {
        expect(apiSource).toContain('`${HR_API_BASE}/branches/${branchId}/geofence`');
        expect(apiSource).toContain('expectedVersion?: number');
        expect(apiSource).toContain('attendanceEnabled: boolean');
    });

    it('coordinates account type and geofence mutations from their existing admin screens', () => {
        expect(usersSource).toContain('accountType: formData.accountType');
        expect(usersSource).toContain('Tipo de cuenta');
        expect(branchesSource).toContain('hrAPI.getBranchGeofence(branch.id)');
        expect(apiSource).toContain('api.post(`${HR_API_BASE}/branches`, data)');
        expect(branchesSource).toContain('hrAPI.updateBranchGeofence(editingBranch.id');
        expect(branchesSource).toContain('branchesAPI.create({ ...branchPayload, ...geofencePayload })');
        expect(branchesSource).toContain('Usar mi ubicación');
    });
});

describe('Phase 2 HR schedule navigation contract', () => {
    it('lazy-loads Owner schedules and limits self schedule to internal employees', () => {
        expect(appSource).toContain("lazy(() => import('./pages/hr/Schedules'))");
        expect(appSource).toContain("lazy(() => import('./pages/hr/ShiftTemplates'))");
        expect(appSource).toContain("lazy(() => import('./pages/hr/MySchedule'))");
        expect(appSource).toContain('path="/rh/horarios" element={<RoleGuard roles={HR_OWNER} permission="hr.schedule.read"><Schedules /></RoleGuard>}');
        expect(appSource).toContain('path="/rh/horarios/jornadas" element={<RoleGuard roles={HR_OWNER} permission="hr.schedule.read"><ShiftTemplates /></RoleGuard>}');
        expect(appSource).toContain('path="/rh/mi-portal/horario" element={<InternalEmployeeGuard permission="hr.schedule.self"><MySchedule /></InternalEmployeeGuard>}');
        expect(appSource).toContain('path="/rh/mi-portal" element={<InternalEmployeeGuard><Navigate to="/profile?tab=hr" replace /></InternalEmployeeGuard>}');
    });

    it('keeps Owner navigation role-scoped and consolidates employee access in Profile', () => {
        expect(layoutSource).toContain("{ to: '/rh/personal', icon: Users, label: 'Personal', roles: HR_OWNER, permission: 'hr.employee.read' }");
        expect(layoutSource).toContain("{ to: '/rh/horarios', icon: Calendar, label: 'Horarios', roles: HR_OWNER, permission: 'hr.schedule.read' }");
        expect(layoutSource).toContain("{ to: '/rh/horarios/jornadas', icon: Clock3, label: 'Jornadas configuradas', roles: HR_OWNER, permission: 'hr.schedule.read' }");
        expect(layoutSource).toContain("item.to === '/rh/horarios'");
        expect(layoutSource).not.toContain("section: 'Mi portal RH'");
        expect(profileSource).toContain('to="/rh/mi-portal/horario"');
        expect(profileSource).toContain('to="/rh/mi-portal/gestion?tab=LEAVE"');
        expect(layoutSource).toContain("item.to === '/rh/asistencia'");
        expect(layoutSource).toContain("item.to === '/rh/nomina'");
    });
});

describe('Phase 3 attendance navigation contract', () => {
    it('lazy-loads internal self-service and Owner attendance review with the correct guards', () => {
        expect(appSource).toContain("lazy(() => import('./pages/hr/TimeClock'))");
        expect(appSource).toContain("lazy(() => import('./pages/hr/Biometrics'))");
        expect(appSource).toContain("lazy(() => import('./pages/hr/AttendanceReview'))");
        expect(appSource).toContain('path="/rh/marcaje" element={<InternalEmployeeGuard permission="hr.attendance.self"><TimeClock /></InternalEmployeeGuard>}');
        expect(appSource).toContain('path="/rh/biometria" element={<InternalEmployeeGuard permission="hr.biometric.self"><Biometrics /></InternalEmployeeGuard>}');
        expect(appSource).toContain('path="/rh/mi-portal/biometria" element={<Navigate to="/rh/biometria" replace />}');
        expect(appSource).toContain('path="/rh/asistencia" element={<RoleGuard roles={HR_OWNER} permission="hr.attendance.review"><AttendanceReview /></RoleGuard>}');
        expect(appSource).not.toContain('path="/rh/marcaje" element={<RoleGuard');
        expect(appSource).not.toContain('path="/rh/biometria" element={<RoleGuard');
    });

    it('shows Owner administration only to HR_OWNER and keeps employee tools inside Profile', () => {
        expect(layoutSource).toContain("{ to: '/rh', icon: Briefcase, label: 'Panel RH', roles: HR_OWNER, permission: 'hr.dashboard.read' }");
        expect(layoutSource).toContain("{ to: '/rh/asistencia', icon: ClipboardList, label: 'Asistencia', roles: HR_OWNER, permission: 'hr.attendance.review' }");
        expect(layoutSource).toContain("{ to: '/rh/asistencia/configuracion', icon: SlidersHorizontal, label: 'Configurar asistencia', roles: HR_OWNER, permission: 'hr.attendance.manage' }");
        expect(layoutSource).toContain("item.to === '/rh/asistencia'");
        expect(layoutSource).toContain("item.to === '/rh/nomina'");
        expect(profileSource).toContain('to="/rh/marcaje"');
        expect(layoutSource).not.toContain("to: '/rh/marcaje'");
        expect(layoutSource).not.toContain("to: '/rh/biometria'");
        expect(layoutSource).not.toContain("label: 'Marcaje', roles:");
        expect(layoutSource).not.toContain("label: 'Mi biometría', roles:");

        const hrPaths = Array.from(layoutSource.matchAll(/\{ to: '(\/rh[^']*)'/g), (match) => match[1]);
        expect(new Set(hrPaths).size).toBe(hrPaths.length);
    });
});
