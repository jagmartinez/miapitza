import { createHash, timingSafeEqual } from 'node:crypto';

export class FaceProviderUnavailableError extends Error {
    readonly statusCode = 503;
    constructor(message = 'La verificación facial no está configurada en el servidor') {
        super(message);
        this.name = 'FaceProviderUnavailableError';
    }
}

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
    status: 'AVAILABLE' | 'UNAVAILABLE';
    checkedAt: string;
    detail?: string;
}

/** Server-side 1:1 verification contract. Implementations must never persist captures. */
export interface FaceVerificationProvider {
    readonly name: string;
    readonly model: string;
    healthCheck?(): Promise<FaceProviderHealth>;
    enroll(capture: Buffer): Promise<FaceEnrollmentResult>;
    verifyOneToOne(capture: Buffer, templateRef: string): Promise<FaceVerificationResult>;
    revokeTemplate(templateRef: string): Promise<void>;
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

    private digest(capture: Buffer): string {
        if (!capture.length) throw new Error('La captura facial está vacía');
        return createHash('sha256').update(capture).digest('hex');
    }

    async enroll(capture: Buffer): Promise<FaceEnrollmentResult> {
        return {
            templateRef: this.digest(capture), provider: this.name, model: this.model,
            livenessPassed: true, providerStatus: 'FAKE_DEV_ENROLLED',
        };
    }

    async verifyOneToOne(capture: Buffer, templateRef: string): Promise<FaceVerificationResult> {
        const actual = Buffer.from(this.digest(capture), 'hex');
        const expected = /^[0-9a-f]{64}$/i.test(templateRef) ? Buffer.from(templateRef, 'hex') : Buffer.alloc(32);
        const matched = actual.length === expected.length && timingSafeEqual(actual, expected);
        return { matched, livenessPassed: true, score: matched ? 1 : 0, providerStatus: 'FAKE_DEV_VERIFIED' };
    }

    async revokeTemplate(): Promise<void> {
        // The fake provider owns no external state; the encrypted local reference is wiped by the caller.
    }
}

type JsonMap = Record<string, unknown>;

function responseText(value: unknown, field: string, max = 191): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new FaceProviderUnavailableError(`Respuesta facial inválida: ${field}`);
    return value.trim();
}

function responseBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw new FaceProviderUnavailableError(`Respuesta facial inválida: ${field}`);
    return value;
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

    constructor(env: NodeJS.ProcessEnv) {
        const rawUrl = env.HR_FACE_PROVIDER_BASE_URL?.trim();
        this.token = env.HR_FACE_PROVIDER_TOKEN?.trim() || '';
        this.model = env.HR_FACE_PROVIDER_MODEL?.trim() || 'external-unspecified';
        const timeout = Number(env.HR_FACE_PROVIDER_TIMEOUT_MS || 5000);
        if (!rawUrl || !this.token) throw new FaceProviderUnavailableError('El proveedor facial HTTP requiere URL y token');
        try { this.baseUrl = new URL(rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`); }
        catch { throw new FaceProviderUnavailableError('HR_FACE_PROVIDER_BASE_URL no es válida'); }
        if (!['http:', 'https:'].includes(this.baseUrl.protocol)) throw new FaceProviderUnavailableError('El proveedor facial HTTP requiere protocolo HTTP(S)');
        if (env.NODE_ENV === 'production' && this.baseUrl.protocol !== 'https:') throw new FaceProviderUnavailableError('El proveedor facial HTTP requiere HTTPS en producción');
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
                headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
            });
            const text = await response.text();
            if (text.length > 65_536) throw new FaceProviderUnavailableError('La respuesta facial excede el límite permitido');
            if (!response.ok) throw new FaceProviderUnavailableError(`Proveedor facial respondió HTTP ${response.status}`);
            const parsed: unknown = text ? JSON.parse(text) : {};
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new FaceProviderUnavailableError('El proveedor facial devolvió JSON inválido');
            return parsed as JsonMap;
        } catch (error) {
            if (error instanceof FaceProviderUnavailableError) throw error;
            throw new FaceProviderUnavailableError(error instanceof Error ? `Proveedor facial no disponible: ${error.message}` : undefined);
        } finally {
            clearTimeout(timeout);
        }
    }

    async healthCheck(): Promise<FaceProviderHealth> {
        try {
            const response = await this.request('health');
            const available = response.status === 'ok' || response.status === 'available';
            return { provider: this.name, model: this.model, status: available ? 'AVAILABLE' : 'UNAVAILABLE', checkedAt: new Date().toISOString(), detail: available ? undefined : 'El proveedor no reportó disponibilidad' };
        } catch (error) {
            return { provider: this.name, model: this.model, status: 'UNAVAILABLE', checkedAt: new Date().toISOString(), detail: error instanceof Error ? error.message : 'Proveedor no disponible' };
        }
    }

    async enroll(capture: Buffer): Promise<FaceEnrollmentResult> {
        if (!capture.length) throw new FaceProviderUnavailableError('La captura facial está vacía');
        const response = await this.request('v1/enroll', { method: 'POST', body: JSON.stringify({ captureBase64: capture.toString('base64') }) });
        return {
            templateRef: responseText(response.templateRef, 'templateRef', 2000), provider: this.name, model: this.model,
            livenessPassed: responseBoolean(response.livenessPassed, 'livenessPassed'),
            providerStatus: responseText(response.providerStatus, 'providerStatus', 100),
        };
    }

    async verifyOneToOne(capture: Buffer, templateRef: string): Promise<FaceVerificationResult> {
        if (!capture.length || !templateRef) throw new FaceProviderUnavailableError('Captura o referencia facial ausente');
        const response = await this.request('v1/verify-one-to-one', { method: 'POST', body: JSON.stringify({ captureBase64: capture.toString('base64'), templateRef }) });
        const score = response.score === null || response.score === undefined ? null : Number(response.score);
        if (score !== null && (!Number.isFinite(score) || score < 0 || score > 1)) throw new FaceProviderUnavailableError('Respuesta facial inválida: score');
        return {
            matched: responseBoolean(response.matched, 'matched'), livenessPassed: responseBoolean(response.livenessPassed, 'livenessPassed'),
            score, providerStatus: responseText(response.providerStatus, 'providerStatus', 100),
        };
    }

    async revokeTemplate(templateRef: string): Promise<void> {
        if (!templateRef) throw new FaceProviderUnavailableError('Referencia facial ausente');
        await this.request('v1/templates/revoke', { method: 'POST', body: JSON.stringify({ templateRef }) });
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
