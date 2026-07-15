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

/** Server-side 1:1 verification contract. Implementations must never persist captures. */
export interface FaceVerificationProvider {
    readonly name: string;
    readonly model: string;
    enroll(capture: Buffer): Promise<FaceEnrollmentResult>;
    verifyOneToOne(capture: Buffer, templateRef: string): Promise<FaceVerificationResult>;
    revokeTemplate(templateRef: string): Promise<void>;
}

class DisabledFaceProvider implements FaceVerificationProvider {
    readonly name = 'disabled';
    readonly model = 'none';
    async enroll(): Promise<never> { throw new FaceProviderUnavailableError(); }
    async verifyOneToOne(): Promise<never> { throw new FaceProviderUnavailableError(); }
    async revokeTemplate(): Promise<never> { throw new FaceProviderUnavailableError(); }
}

/** Deterministic adapter for automated tests and explicit local development only. */
class FakeFaceProvider implements FaceVerificationProvider {
    readonly name = 'fake';
    readonly model = 'sha256-exact-match-dev-only';

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
    throw new FaceProviderUnavailableError(`Proveedor facial no soportado: ${provider}`);
}

export function createFaceVerificationProvider(env: NodeJS.ProcessEnv = process.env): FaceVerificationProvider {
    return createFaceVerificationProviderForName(env.HR_FACE_PROVIDER || 'disabled', env);
}
