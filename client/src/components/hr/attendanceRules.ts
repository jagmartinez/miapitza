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
    FACE_NOT_FOUND: 'Centra tu cara dentro del óvalo, de frente y sin gorra, mascarilla ni lentes oscuros.',
    MULTIPLE_FACES: 'Solo debe aparecer tu rostro. Pide a las demás personas que se aparten de la cámara.',
    FACE_TOO_CLOSE: 'Aléjate un poco hasta que todo tu rostro quede dentro del óvalo.',
    CAPTURE_TOO_DARK: 'Busca una luz frontal; evita lugares oscuros o con la luz detrás de ti.',
    CAPTURE_TOO_BRIGHT: 'Evita la luz directa o el sol sobre el rostro y vuelve a intentarlo.',
    PASSIVE_LIVENESS_FAILED: 'Usa tu rostro real frente a la cámara; no se aceptan fotos, pantallas ni videos.',
    ACTIVE_LIVENESS_FAILED: 'Empieza mirando al frente y gira despacio solo cuando aparezca “AHORA GIRA”.',
    ACTIVE_LIVENESS_WRONG_DIRECTION: 'Giraste hacia el lado contrario. Sigue la flecha mostrada en la cámara.',
    IDENTITY_CHANGED_DURING_CAPTURE: 'La misma persona debe aparecer en todos los cuadros de la secuencia.',
    FACE_PROVIDER_UNAVAILABLE: 'El servicio de reconocimiento facial no respondió. El intento quedó registrado para revisión; reintenta en unos minutos.',
    FACE_PROVIDER_ERROR: 'El servicio de reconocimiento facial falló. El intento quedó registrado para revisión.',
    BIOMETRIC_PROFILE_REQUIRED: 'Primero completa tu enrolamiento en “Mi biometría”.',
    BIOMETRIC_ENROLLMENT_PENDING_APPROVAL: 'Registro facial pendiente de aprobación de RRHH. Podrás marcar cuando Recursos Humanos lo apruebe.',
    BIOMETRIC_RETENTION_EXPIRED: 'Tu plantilla expiró por la política de retención. Vuelve a enrolarte en “Mi biometría”.',
    BIOMETRIC_CONSENT_STALE: 'La política de consentimiento cambió. Vuelve a enrolarte en “Mi biometría” para aceptar la versión vigente.',
    BIOMETRIC_REENROLL_REQUIRED: 'Tu perfil biométrico debe renovarse. Vuelve a enrolarte en “Mi biometría”.',
    TEMPLATE_NOT_FOUND: 'Tu plantilla no está disponible. Vuelve a enrolarte en “Mi biometría”.',
    TEMPLATE_REVOKED: 'Tu plantilla fue revocada. Vuelve a enrolarte en “Mi biometría”.',
    TEMPLATE_EXPIRED: 'Tu plantilla expiró. Vuelve a enrolarte en “Mi biometría”.',
    TEMPLATE_MODEL_MISMATCH: 'El modelo facial se actualizó. Vuelve a enrolarte en “Mi biometría”.',
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

export function cameraErrorMessage(name: string): string {
    switch (name) {
        case 'NotAllowedError':
            return 'Permiso de cámara denegado. Habilítalo en la configuración del navegador o solicita el fallback supervisado.';
        case 'SecurityError':
            return 'El navegador bloqueó la cámara porque la página no se abrió en una conexión segura (HTTPS).';
        case 'NotFoundError':
        case 'OverconstrainedError':
            return 'No se encontró una cámara frontal disponible en este dispositivo.';
        case 'NotReadableError':
        case 'AbortError':
            return 'La cámara está siendo usada por otra aplicación o no respondió. Ciérrala e inténtalo de nuevo.';
        default:
            return 'No fue posible iniciar la cámara. Verifica que no esté siendo usada por otra aplicación.';
    }
}
