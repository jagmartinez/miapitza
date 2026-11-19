import { describe, expect, it } from 'vitest';
import { cameraErrorMessage, presentAttendanceChecks } from './attendanceRules';
import type { HrAttendancePunchResult } from '../../types/hr-attendance';

describe('biometric guidance in Spanish', () => {
    it.each([
        ['MULTIPLE_FACES', /Solo debe aparecer tu rostro/],
        ['FACE_NOT_FOUND', /Centra tu cara/],
        ['PASSIVE_LIVENESS_FAILED', /fotos, pantallas ni videos/],
        ['ACTIVE_LIVENESS_WRONG_DIRECTION', /lado contrario/],
        ['CAPTURE_TOO_DARK', /luz frontal/],
        ['FACE_PROVIDER_UNAVAILABLE', /no respondió/],
        ['BIOMETRIC_REENROLL_REQUIRED', /Mi biometría/],
        ['BIOMETRIC_ENROLLMENT_PENDING_APPROVAL', /pendiente de aprobación de RRHH/],
    ])('gives specific guidance for %s', (reasonCode, expected) => {
        const checks = { biometric: { status: 'FAILED', message: 'x', reasonCode } } as unknown as HrAttendancePunchResult['checks'];
        expect(presentAttendanceChecks(checks)[0].guidance).toMatch(expected);
    });

    it('explains each camera failure instead of a generic error', () => {
        expect(cameraErrorMessage('NotAllowedError')).toMatch(/Permiso de cámara denegado/);
        expect(cameraErrorMessage('SecurityError')).toMatch(/HTTPS/);
        expect(cameraErrorMessage('NotFoundError')).toMatch(/No se encontró una cámara/);
        expect(cameraErrorMessage('NotReadableError')).toMatch(/otra aplicación/);
        expect(cameraErrorMessage('Weird')).toMatch(/No fue posible iniciar la cámara/);
    });
});
