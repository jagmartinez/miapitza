import type { HrAttendanceAction, HrAttendanceCheck, HrAttendanceDecision } from '../../types/hr-attendance';

export const ATTENDANCE_ACTION_LABELS: Record<HrAttendanceAction, string> = {
    CHECK_IN: 'Entrada',
    BREAK_START: 'Iniciar descanso',
    BREAK_END: 'Finalizar descanso',
    CHECK_OUT: 'Salida',
};

export const ATTENDANCE_DECISION_LABELS: Record<HrAttendanceDecision, string> = {
    ACCEPTED: 'Marcaje aceptado',
    REVIEW_REQUIRED: 'Marcaje enviado a revisión',
    REJECTED: 'Marcaje rechazado',
};

export function checkClass(check: HrAttendanceCheck): 'ok' | 'warning' | 'danger' | 'neutral' {
    if (check.status === 'PASSED') return 'ok';
    if (check.status === 'REVIEW') return 'warning';
    if (check.status === 'FAILED') return 'danger';
    return 'neutral';
}

export function isChallengeExpired(expiresAt: string, now = Date.now()): boolean {
    const expiry = new Date(expiresAt).getTime();
    return !Number.isFinite(expiry) || expiry <= now;
}
