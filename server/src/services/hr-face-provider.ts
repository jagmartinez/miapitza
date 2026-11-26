import { createHash, timingSafeEqual } from 'node:crypto';

export class FaceProviderUnavailableError extends Error {
    readonly statusCode = 503;
    constructor(message = 'La verificación facial no está configurada en el servidor') {
        super(message);
        this.name = 'FaceProviderUnavailableError';
    }
}

export class FaceEvidenceRejectedError extends Error {
    readonly statusCode = 422;
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'FaceEvidenceRejectedError';
    }
}

export type FaceLivenessAction = 'TURN_LEFT' | 'TURN_RIGHT';

export interface FaceCaptureFrame {
    buffer: Buffer;
    mimeType: 'image/jpeg' | 'image/png';
}

export interface FaceCaptureEvidence {
    frames: FaceCaptureFrame[];
}

export interface FaceProviderContext {
    tenantRef: string;
    subjectRef: string;
    challengeRef: string;
    livenessAction: FaceLivenessAction;
    requireLiveness: boolean;
    retentionDays?: number;
}

export type FaceTemplateOwner = Pick<FaceProviderContext, 'tenantRef' | 'subjectRef'>;

export interface FaceEnrollmentResult {
    templateRef: string;
    provider: string;
    model: string;
    livenessPassed: boolean;
    providerStatus: string;
}

export interface FaceVerificationResult {
    matched: boolean;
    livenessPassed: boolean;
    score: number | null;
    providerStatus: string;
}

export interface FaceProviderHealth {
    provider: string;
    model: string;
    version?: string;
    status: 'AVAILABLE' | 'UNAVAILABLE';
    checkedAt: string;
    detail?: string;
}

/** Server-side 1:1 verification contract. Implementations must never persist captures. */
export interface FaceVerificationProvider {
    readonly name: string;
    readonly model: string;
    healthCheck?(): Promise<FaceProviderHealth>;
    enroll(evidence: FaceCaptureEvidence, context: FaceProviderContext): Promise<FaceEnrollmentResult>;
    verifyOneToOne(evidence: FaceCaptureEvidence, templateRef: string, context: FaceProviderContext): Promise<FaceVerificationResult>;
    revokeTemplate(templateRef: string, owner: FaceTemplateOwner): Promise<void>;
}

class DisabledFaceProvider implements FaceVerificationProvider {
    readonly name = 'disabled';
    readonly model = 'none';
    async healthCheck(): Promise<FaceProviderHealth> {
        return { provider: this.name, model: this.model, status: 'UNAVAILABLE', checkedAt: new Date().toISOString(), detail: 'Proveedor deshabilitado' };
    }
    async enroll(): Promise<never> { throw new FaceProviderUnavailableError(); }
    async verifyOneToOne(): Promise<never> { throw new FaceProviderUnavailableError(); }
    async revokeTemplate(): Promise<never> { throw new FaceProviderUnavailableError(); }
}

/** Deterministic adapter for automated tests and explicit local development only. */
class FakeFaceProvider implements FaceVerificationProvider {
    readonly name = 'fake';
    readonly model = 'sha256-exact-match-dev-only';

    async healthCheck(): Promise<FaceProviderHealth> {
        return { provider: this.name, model: this.model, status: 'AVAILABLE', checkedAt: new Date().toISOString(), detail: 'Sólo desarrollo; prohibido en producción' };
    }

    private digest(evidence: FaceCaptureEvidence): string {
        if (!evidence.frames.length || evidence.frames.some((frame) => !frame.buffer.length)) throw new Error('La captura facial está vacía');
        const hash = createHash('sha256');
        for (const frame of evidence.frames) hash.update(frame.buffer);
        return hash.digest('hex');
    }

    async enroll(evidence: FaceCaptureEvidence): Promise<FaceEnrollmentResult> {
        return {
            templateRef: this.digest(evidence), provider: this.name, model: this.model,
            livenessPassed: true, providerStatus: 'FAKE_DEV_ENROLLED',
        };
    }

    async verifyOneToOne(evidence: FaceCaptureEvidence, templateRef: string): Promise<FaceVerificationResult> {
        const actual = Buffer.from(this.digest(evidence), 'hex');
        const expected = /^[0-9a-f]{64}$/i.test(templateRef) ? Buffer.from(templateRef, 'hex') : Buffer.alloc(32);
        const matched = actual.length === expected.length && timingSafeEqual(actual, expected);
        return { matched, livenessPassed: true, score: matched ? 1 : 0, providerStatus: 'FAKE_DEV_VERIFIED' };
    }

    async revokeTemplate(): Promise<void> {
        // The fake provider owns no external state; the encrypted local reference is wiped by the caller.
    }
}

type JsonMap = Record<string, unknown>;

function parseJsonMap(value: string): JsonMap | null {
    if (!value) return {};
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonMap : null;
    } catch {
        return null;
    }
}

function responseText(value: unknown, field: string, max = 191): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new FaceProviderUnavailableError(`Respuesta facial inválida: ${field}`);
    return value.trim();
}

function responseBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw new FaceProviderUnavailableError(`Respuesta facial inválida: ${field}`);
    return value;
}

/**
 * Spanish, actionable messages for provider rejection codes. The provider's own
 * text is ASCII-only and terse; the worker must know what to change in the next
 * attempt (light, distance, motion) or that HR must intervene (template state).
 */
export const FACE_REJECTION_MESSAGES: Readonly<Record<string, string>> = {
    FACE_CROP_INVALID: 'No se pudo recortar el rostro de la captura. Centra tu cara en el óvalo e inténtalo de nuevo.',
    CHALLENGE_CONFLICT: 'El reto de verificación ya fue usado. Inicia una nueva captura.',
    CHALLENGE_IDEMPOTENCY_MISMATCH: 'El reto de verificación ya fue usado con otra captura. Inicia una nueva captura.',
    ENROLLMENT_CONFLICT: 'Ya hay un enrolamiento en curso para este perfil. Espera unos segundos e inicia una nueva captura.',
    FACE_NOT_FOUND: 'No se detectó un rostro completo. Centra tu cara dentro del óvalo, de frente y sin cubrirla.',
    MULTIPLE_FACES: 'Se detectó más de una persona. Solo debe aparecer tu rostro en la cámara.',
    FACE_TOO_SMALL: 'El rostro se ve muy lejos. Acércate a la cámara hasta ocupar el óvalo.',
    FACE_TOO_CLOSE: 'El rostro está demasiado cerca. Aléjate un poco de la cámara.',
    CAPTURE_BLURRY: 'La captura salió borrosa. Limpia la cámara y mantén el teléfono inmóvil.',
    CAPTURE_TOO_DARK: 'La imagen está muy oscura. Busca una iluminación frontal más clara.',
    CAPTURE_TOO_BRIGHT: 'La imagen tiene demasiada luz. Evita la luz directa o el contraluz sobre el rostro.',
    CAPTURE_INVALID: 'La captura no es una imagen válida. Repite la secuencia con la cámara.',
    CAPTURE_DIMENSIONS_INVALID: 'La resolución de la captura no es válida. Repite la secuencia con la cámara del dispositivo.',
    CAPTURE_SIZE_INVALID: 'La captura está vacía o es demasiado grande. Repite la secuencia.',
    INSUFFICIENT_FRAMES: 'La prueba de vida requiere la secuencia completa de cuadros. Repite la captura guiada.',
    TOO_MANY_FRAMES: 'La evidencia contiene demasiados cuadros. Repite la captura guiada.',
    PASSIVE_LIVENESS_FAILED: 'La captura parece una foto, pantalla o video. Usa tu rostro real frente a la cámara.',
    ACTIVE_LIVENESS_FAILED: 'No se detectó el giro solicitado. Empieza mirando al frente y gira solo cuando aparezca “AHORA GIRA”.',
    ACTIVE_LIVENESS_WRONG_DIRECTION: 'Giraste hacia el lado contrario. Sigue la flecha que muestra la cámara.',
    IDENTITY_CHANGED_DURING_CAPTURE: 'El rostro cambió durante la secuencia. Solo la misma persona debe aparecer en todos los cuadros.',
    TEMPLATE_NOT_FOUND: 'Tu plantilla biométrica no está disponible. Debes volver a enrolarte en “Mi biometría”.',
    TEMPLATE_REVOKED: 'Tu plantilla biométrica fue revocada. Debes volver a enrolarte en “Mi biometría”.',
    TEMPLATE_EXPIRED: 'Tu plantilla biométrica expiró. Debes volver a enrolarte en “Mi biometría”.',
    TEMPLATE_MODEL_MISMATCH: 'El modelo facial fue actualizado. Debes volver a enrolarte en “Mi biometría”.',
    REQUEST_TOO_LARGE: 'La evidencia facial excede el tamaño permitido. Repite la captura.',
    REQUEST_INVALID: 'La evidencia facial no cumple el formato esperado. Repite la captura.',
};

export function faceRejectionMessage(code: string, fallback: string): string {
    return FACE_REJECTION_MESSAGES[code] ?? fallback;
}

function isInternalHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.internal') || normalized.endsWith('.local')) return true;
    if (!normalized.includes('.')) return true;
    if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^169\.254\./.test(normalized)) return true;
    const private172 = normalized.match(/^172\.(\d{1,3})\./);
    return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

/**
 * Vendor-neutral HTTPS adapter. The external service remains responsible for
 * liveness/model validation and opaque template custody. Captures are sent once
 * in request memory and are never written by this adapter.
 */
class HttpFaceProvider implements FaceVerificationProvider {
    readonly name = 'http';
    readonly model: string;
    private readonly baseUrl: URL;
    private readonly token: string;
    private readonly timeoutMs: number;
    private readonly expectedVersion: string;

    constructor(env: NodeJS.ProcessEnv) {
        const rawUrl = env.HR_FACE_PROVIDER_BASE_URL?.trim();
        this.token = env.HR_FACE_PROVIDER_TOKEN?.trim() || '';
        this.model = env.HR_FACE_PROVIDER_MODEL?.trim() || 'external-unspecified';
        this.expectedVersion = env.HR_FACE_PROVIDER_VERSION?.trim() || '';
        const timeout = Number(env.HR_FACE_PROVIDER_TIMEOUT_MS || 5000);
        if (!rawUrl || !this.token) throw new FaceProviderUnavailableError('El proveedor facial HTTP requiere URL y token');
        if (Buffer.byteLength(this.token, 'utf8') < 32) {
            throw new FaceProviderUnavailableError('HR_FACE_PROVIDER_TOKEN debe contener al menos 32 bytes');
        }
        try { this.baseUrl = new URL(rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`); }
        catch { throw new FaceProviderUnavailableError('HR_FACE_PROVIDER_BASE_URL no es válida'); }
        if (!['http:', 'https:'].includes(this.baseUrl.protocol)) throw new FaceProviderUnavailableError('El proveedor facial HTTP requiere protocolo HTTP(S)');
        if (this.baseUrl.username || this.baseUrl.password) throw new FaceProviderUnavailableError('HR_FACE_PROVIDER_BASE_URL no debe incluir credenciales');
        const internalHttpAllowed = env.HR_FACE_PROVIDER_ALLOW_HTTP_INTERNAL === 'true' && isInternalHostname(this.baseUrl.hostname);
        if (env.NODE_ENV === 'production' && this.baseUrl.protocol !== 'https:' && !internalHttpAllowed) {
            throw new FaceProviderUnavailableError('El proveedor facial HTTP requiere HTTPS en producción salvo red interna autorizada explícitamente');
        }
        if (!Number.isInteger(timeout) || timeout < 500 || timeout > 15000) throw new FaceProviderUnavailableError('HR_FACE_PROVIDER_TIMEOUT_MS debe estar entre 500 y 15000');
        this.timeoutMs = timeout;
    }

    private async request(pathname: string, init: RequestInit = {}): Promise<JsonMap> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(new URL(pathname, this.baseUrl), {
                ...init,
                signal: controller.signal,
                redirect: 'error',
                headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
            });
            const text = await response.text();
            if (text.length > 65_536) throw new FaceProviderUnavailableError('La respuesta facial excede el límite permitido');
            const parsed = parseJsonMap(text);
            if (!response.ok) {
                const code = parsed && typeof parsed.code === 'string' && /^[A-Z][A-Z0-9_]{2,99}$/.test(parsed.code)
                    ? parsed.code
                    : 'FACE_EVIDENCE_REJECTED';
                const message = parsed && typeof parsed.message === 'string' && parsed.message.length <= 500
                    ? parsed.message
                    : 'La evidencia facial fue rechazada';
                if ([400, 404, 409, 410, 413, 422].includes(response.status)) {
                    throw new FaceEvidenceRejectedError(faceRejectionMessage(code, message), code);
                }
                if (response.status === 401 || response.status === 403) {
                    throw new FaceProviderUnavailableError('El servidor no pudo autenticarse con el proveedor facial; un administrador debe revisar el token configurado');
                }
                if (response.status === 503 && code === 'PROVIDER_BUSY') {
                    throw new FaceProviderUnavailableError('El proveedor facial está ocupado; reintenta en unos segundos');
                }
                throw new FaceProviderUnavailableError(`El proveedor facial no está disponible (HTTP ${response.status})`);
            }
            if (!parsed) throw new FaceProviderUnavailableError('El proveedor facial devolvió JSON inválido');
            return parsed;
        } catch (error) {
            if (error instanceof FaceProviderUnavailableError || error instanceof FaceEvidenceRejectedError) throw error;
            // Never surface runtime text such as "fetch failed" or "This operation
            // was aborted" to workers; the cause is logged without evidence.
            const timedOut = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
            console.error('[Biometric] Provider request failed', {
                pathname, timedOut, errorType: error instanceof Error ? error.name : typeof error,
            });
            throw new FaceProviderUnavailableError(timedOut
                ? 'El proveedor facial no respondió a tiempo; reintenta en unos segundos'
                : 'No fue posible conectar con el proveedor facial; reintenta en unos segundos');
        } finally {
            clearTimeout(timeout);
        }
    }

    async healthCheck(): Promise<FaceProviderHealth> {
        try {
            const response = await this.request('health');
            const available = response.status === 'ok' || response.status === 'available';
            const reportedModel = response.model === undefined && this.model === 'external-unspecified'
                ? this.model
                : responseText(response.model, 'model', 100);
            const reportedVersion = response.version === undefined && !this.expectedVersion
                ? undefined
                : responseText(response.version, 'version', 100);
            if (!available) {
                return {
                    provider: this.name,
                    model: reportedModel,
                    version: reportedVersion,
                    status: 'UNAVAILABLE',
                    checkedAt: new Date().toISOString(),
                    detail: 'El proveedor no reportó disponibilidad',
                };
            }
            if (this.model !== 'external-unspecified' && reportedModel !== this.model) {
                return {
                    provider: this.name,
                    model: reportedModel,
                    version: reportedVersion,
                    status: 'UNAVAILABLE',
                    checkedAt: new Date().toISOString(),
                    detail: 'El modelo facial remoto no coincide con la configuración esperada',
                };
            }
            if (this.expectedVersion && reportedVersion !== this.expectedVersion) {
                return {
                    provider: this.name,
                    model: reportedModel,
                    version: reportedVersion,
                    status: 'UNAVAILABLE',
                    checkedAt: new Date().toISOString(),
                    detail: 'La versión facial remota no coincide con la configuración esperada',
                };
            }
            return {
                provider: this.name,
                model: reportedModel,
                version: reportedVersion,
                status: 'AVAILABLE',
                checkedAt: new Date().toISOString(),
            };
        } catch (error) {
            return {
                provider: this.name,
                model: this.model,
                version: this.expectedVersion || undefined,
                status: 'UNAVAILABLE',
                checkedAt: new Date().toISOString(),
                detail: error instanceof Error ? error.message : 'Proveedor no disponible',
            };
        }
    }

    private requestEvidence(evidence: FaceCaptureEvidence, context: FaceProviderContext) {
        if (!evidence.frames.length || evidence.frames.some((frame) => !frame.buffer.length)) {
            throw new FaceEvidenceRejectedError('La captura facial está vacía', 'FACE_CAPTURE_REQUIRED');
        }
        return {
            tenantRef: context.tenantRef,
            subjectRef: context.subjectRef,
            challengeRef: context.challengeRef,
            livenessAction: context.livenessAction,
            requireLiveness: context.requireLiveness,
            captures: evidence.frames.map((frame) => ({
                contentBase64: frame.buffer.toString('base64'),
                mimeType: frame.mimeType,
            })),
        };
    }

    async enroll(evidence: FaceCaptureEvidence, context: FaceProviderContext): Promise<FaceEnrollmentResult> {
        const response = await this.request('v1/enroll', {
            method: 'POST',
            body: JSON.stringify({ ...this.requestEvidence(evidence, context), retentionDays: context.retentionDays }),
        });
        return {
            templateRef: responseText(response.templateRef, 'templateRef', 2000), provider: this.name, model: this.model,
            livenessPassed: responseBoolean(response.livenessPassed, 'livenessPassed'),
            providerStatus: responseText(response.providerStatus, 'providerStatus', 100),
        };
    }

    async verifyOneToOne(evidence: FaceCaptureEvidence, templateRef: string, context: FaceProviderContext): Promise<FaceVerificationResult> {
        if (!templateRef) throw new FaceProviderUnavailableError('Referencia facial ausente');
        const response = await this.request('v1/verify-one-to-one', {
            method: 'POST',
            body: JSON.stringify({ ...this.requestEvidence(evidence, context), templateRef }),
        });
        const score = response.score === null || response.score === undefined ? null : Number(response.score);
        if (score !== null && (!Number.isFinite(score) || score < 0 || score > 1)) throw new FaceProviderUnavailableError('Respuesta facial inválida: score');
        return {
            matched: responseBoolean(response.matched, 'matched'), livenessPassed: responseBoolean(response.livenessPassed, 'livenessPassed'),
            score, providerStatus: responseText(response.providerStatus, 'providerStatus', 100),
        };
    }

    async revokeTemplate(templateRef: string, owner: FaceTemplateOwner): Promise<void> {
        if (!templateRef) throw new FaceProviderUnavailableError('Referencia facial ausente');
        await this.request('v1/templates/revoke', {
            method: 'POST',
            body: JSON.stringify({ templateRef, tenantRef: owner.tenantRef, subjectRef: owner.subjectRef }),
        });
    }
}

export function createFaceVerificationProviderForName(
    providerName: string,
    env: NodeJS.ProcessEnv = process.env,
): FaceVerificationProvider {
    const provider = providerName.trim().toLowerCase() || 'disabled';
    if (provider === 'disabled') return new DisabledFaceProvider();
    if (provider === 'fake') {
        if (env.NODE_ENV === 'production') throw new FaceProviderUnavailableError('El proveedor facial fake está prohibido en producción');
        if (env.HR_ALLOW_FAKE_FACE_PROVIDER !== 'true') throw new FaceProviderUnavailableError('El proveedor facial fake requiere opt-in explícito');
        return new FakeFaceProvider();
    }
    if (provider === 'http') return new HttpFaceProvider(env);
    throw new FaceProviderUnavailableError(`Proveedor facial no soportado: ${provider}`);
}

export function createFaceVerificationProvider(env: NodeJS.ProcessEnv = process.env): FaceVerificationProvider {
    return createFaceVerificationProviderForName(env.HR_FACE_PROVIDER || 'disabled', env);
}
