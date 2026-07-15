import { describe, expect, it } from 'vitest';
import { ATTENDANCE_ACTION_LABELS, checkClass, isChallengeExpired } from './attendanceRules';

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
});
