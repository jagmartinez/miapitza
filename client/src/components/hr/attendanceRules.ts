import type {
    HrAttendanceAction,
    HrAttendanceCheck,
    HrAttendanceDecision,
    HrAttendancePolicy,
    HrAttendancePunchResult,
} from '../../types/hr-attendance';

export type AttendanceCheckKey = keyof HrAttendancePunchResult['checks'];

export interface PresentedAttendanceCheck {
    key: AttendanceCheckKey;
    label: string;
    check: HrAttendanceCheck;
    guidance: string | null;
    measurement: string | null;
}

const CHECK_PRESENTATION: Record<AttendanceCheckKey, { label: string; guidance: string }> = {
    schedule: { label: 'Horario', guidance: 'Revisa el turno publicado. Si no corresponde, solicita una corrección de asistencia.' },
    geofence: { label: 'Geocerca de la sucursal', guidance: 'Confirma que estés físicamente dentro del local y vuelve a capturar tu ubicación.' },
    locationAccuracy: { label: 'Precisión de ubicación', guidance: 'Activa la ubicación precisa, desactiva el ahorro de batería y vuelve a intentarlo cerca de una ventana.' },
    locationFreshness: { label: 'Vigencia de ubicación', guidance: 'Actualiza la ubicación y confirma el marcaje inmediatamente.' },
    biometric: { label: 'Reconocimiento facial', guidance: 'Usa buena iluminación, mantén el teléfono estable y sigue la guía de movimiento.' },
    sequence: { label: 'Secuencia del marcaje', guidance: 'Actualiza la pantalla. Si existe una jornada pendiente, solicita una corrección.' },
    device: { label: 'Dispositivo', guidance: 'Usa el dispositivo autorizado para esta sucursal o realiza el marcaje directo.' },
    branchAuthorization: { label: 'Sucursal asignada', guidance: 'Solicita a Recursos Humanos revisar tu adscripción vigente.' },
    branchStatus: { label: 'Configuración de la sucursal', guidance: 'Un administrador debe revisar la sucursal y su versión de geocerca.' },
};

const CHECK_ORDER: AttendanceCheckKey[] = [
    'geofence',
    'locationAccuracy',
    'biometric',
    'schedule',
    'locationFreshness',
    'sequence',
    'branchAuthorization',
    'branchStatus',
    'device',
];

const REASON_GUIDANCE: Record<string, string> = {
    OUTSIDE_GEOFENCE: 'El punto detectado quedó fuera del radio permitido. Entra al local y vuelve a capturar la ubicación.',
    GEOFENCE_UNCERTAIN: 'El punto parece estar dentro, pero el margen de error GPS cruza el límite. Mejora la precisión y reintenta.',
    LOCATION_ACCURACY_TOO_LOW: 'El GPS no alcanzó el margen exigido por la sucursal. Activa “Ubicación precisa” y vuelve a capturar.',
    FACE_TOO_SMALL: 'Acerca el rostro a la cámara hasta ocupar el óvalo, sin cortar la frente ni el mentón.',
    CAPTURE_BLURRY: 'Limpia la cámara, mejora la iluminación y mantén el teléfono inmóvil durante la captura.',
    FACE_NOT_MATCHED: 'Retira mascarilla o lentes oscuros y repite la prueba con el rostro de frente.',
    LIVENESS_FAILED: 'Repite la prueba y gira únicamente cuando la pantalla lo indique.',
    CHECK_IN_LATE: 'La hora ya superó la tolerancia del turno. El intento será una novedad de horario, no un fallo del GPS.',
    CHECK_IN_TOO_EARLY: 'Espera a que inicie la ventana permitida o revisa el turno publicado.',
    GEOFENCE_NOT_CONFIGURED: 'La sucursal necesita una geocerca activa y versionada antes de permitir marcajes.',
    GEOFENCE_VERSION_MISSING: 'Un administrador debe guardar nuevamente la geocerca para crear su versión auditable.',
};

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

export function checkClassForPolicy(
    key: AttendanceCheckKey,
    check: HrAttendanceCheck,
    policy: HrAttendancePolicy,
): 'ok' | 'warning' | 'danger' | 'neutral' {
    if (key === 'schedule' && check.status === 'FAILED' && policy.scheduleViolationMode !== 'BLOCK') return 'warning';
    return checkClass(check);
}

function roundedMeters(value: number): string {
    return `${Math.round(value)} m`;
}

function measurementFor(key: AttendanceCheckKey, check: HrAttendanceCheck): string | null {
    if (typeof check.measuredValue !== 'number' || typeof check.limitValue !== 'number') return null;
    if (key === 'locationAccuracy') {
        return `Precisión detectada ±${roundedMeters(check.measuredValue)} · límite ±${roundedMeters(check.limitValue)}`;
    }
    if (key === 'geofence') {
        return `Distancia detectada ${roundedMeters(check.measuredValue)} · radio ${roundedMeters(check.limitValue)}`;
    }
    return null;
}

export function presentAttendanceChecks(checks: HrAttendancePunchResult['checks']): PresentedAttendanceCheck[] {
    return CHECK_ORDER.flatMap((key) => {
        const check = checks[key];
        if (!check || check.status === 'NOT_REQUIRED') return [];
        return [{
            key,
            label: CHECK_PRESENTATION[key].label,
            check,
            guidance: check.status === 'PASSED' ? null : REASON_GUIDANCE[check.reasonCode ?? ''] ?? CHECK_PRESENTATION[key].guidance,
            measurement: measurementFor(key, check),
        }];
    });
}

export function isChallengeExpired(expiresAt: string, now = Date.now()): boolean {
    const expiry = new Date(expiresAt).getTime();
    return !Number.isFinite(expiry) || expiry <= now;
}
