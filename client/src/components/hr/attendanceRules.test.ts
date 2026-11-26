import { describe, expect, it } from 'vitest';
import {
    ATTENDANCE_ACTION_LABELS,
    checkClass,
    checkClassForPolicy,
    isChallengeExpired,
    presentAttendanceChecks,
} from './attendanceRules';
import type { HrAttendancePolicy } from '../../types/hr-attendance';

const policy = { scheduleViolationMode: 'REVIEW' } as HrAttendancePolicy;

describe('attendance presentation rules', () => {
    it('covers every punch action with an explicit label', () => {
        expect(ATTENDANCE_ACTION_LABELS).toEqual({
            CHECK_IN: 'Entrada',
            BREAK_START: 'Iniciar descanso',
            BREAK_END: 'Finalizar descanso',
            CHECK_OUT: 'Salida',
        });
    });

    it('maps server checks without turning review into success', () => {
        expect(checkClass({ status: 'PASSED', message: 'ok' })).toBe('ok');
        expect(checkClass({ status: 'REVIEW', message: 'manual' })).toBe('warning');
        expect(checkClass({ status: 'FAILED', message: 'no' })).toBe('danger');
        expect(checkClass({ status: 'NOT_REQUIRED', message: 'n/a' })).toBe('neutral');
    });

    it('rejects expired and malformed challenges', () => {
        expect(isChallengeExpired('2026-07-13T12:00:00.000Z', Date.parse('2026-07-13T12:00:01.000Z'))).toBe(true);
        expect(isChallengeExpired('2026-07-13T12:01:00.000Z', Date.parse('2026-07-13T12:00:01.000Z'))).toBe(false);
        expect(isChallengeExpired('invalid', Date.now())).toBe(true);
    });

    it('shows actionable checks only and never leaks an internal policy snapshot', () => {
        const checks = {
            schedule: { status: 'FAILED' as const, reasonCode: 'CHECK_IN_LATE', message: 'Fuera de tolerancia' },
            geofence: { status: 'FAILED' as const, reasonCode: 'OUTSIDE_GEOFENCE', message: 'Fuera', measuredValue: 12.1, limitValue: 10 },
            device: { status: 'NOT_REQUIRED' as const, message: 'Directo' },
            policySnapshot: { version: 1 },
        };

        const presented = presentAttendanceChecks(checks);

        expect(presented.map((item) => item.key)).toEqual(['geofence', 'schedule']);
        expect(presented[0].measurement).toBe('Distancia detectada 12 m · radio 10 m');
        expect(presented[0].guidance).toContain('fuera del radio');
    });

    it('presents a review-only schedule deviation as warning rather than a blocker', () => {
        expect(checkClassForPolicy('schedule', { status: 'FAILED', message: 'Tarde' }, policy)).toBe('warning');
        expect(checkClassForPolicy('geofence', { status: 'FAILED', message: 'Fuera' }, policy)).toBe('danger');
    });
});
