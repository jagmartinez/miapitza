import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../utils/prisma';
import { WebSocketService } from '../services/websocket.service';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { generateApiKey } from '../utils/apiKeyGenerator';
import hrRoutes from './hr.routes';
import { createFaceVerificationProvider } from '../services/hr-face-provider';
import { checkStorageReadiness } from '../services/storage-identity.service';

const v1 = Router();
type ReadinessCheck = {
    status: 'ok' | 'error';
    latencyMs?: number;
    required?: boolean;
    mode?: string;
    verified?: boolean;
    identityHash?: string;
    provider?: string;
    model?: string;
    version?: string;
};

let biometricRequirementCache: { required: boolean; expiresAt: number } | null = null;
let storageReadinessCache: { check: ReadinessCheck; expiresAt: number } | null = null;
let storageReadinessInFlight: Promise<ReadinessCheck> | null = null;

export function resetOperationalReadinessCache(): void {
    biometricRequirementCache = null;
    storageReadinessCache = null;
    storageReadinessInFlight = null;
}

function readinessDatabaseTimeoutMs(): number {
    const raw = process.env.READINESS_DB_TIMEOUT_MS;
    if (raw === undefined || raw.trim() === '') return 2_000;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 50 || value > 10_000) {
        throw new Error('READINESS_DB_TIMEOUT_MS debe estar entre 50 y 10000');
    }
    return value;
}

async function checkDatabaseReadiness(): Promise<void> {
    const timeoutMs = readinessDatabaseTimeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            prisma.$queryRaw`SELECT 1`,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Database readiness timeout')), timeoutMs);
                timer.unref?.();
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function readinessBiometricTimeoutMs(): number {
    const raw = process.env.READINESS_BIOMETRIC_TIMEOUT_MS;
    if (raw === undefined || raw.trim() === '') return 2_000;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 100 || value > 10_000) {
        throw new Error('READINESS_BIOMETRIC_TIMEOUT_MS debe estar entre 100 y 10000');
    }
    return value;
}

function readinessStorageTimeoutMs(): number {
    const raw = process.env.READINESS_STORAGE_TIMEOUT_MS;
    if (raw === undefined || raw.trim() === '') return 2_000;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 100 || value > 10_000) {
        throw new Error('READINESS_STORAGE_TIMEOUT_MS debe estar entre 100 y 10000');
    }
    return value;
}

async function biometricAttendanceIsRequired(): Promise<boolean> {
    const now = Date.now();
    if (biometricRequirementCache && biometricRequirementCache.expiresAt > now) {
        return biometricRequirementCache.required;
    }
    const count = await prisma.attendancePolicy.count({
        where: {
            active: true,
            requireBiometric: true,
            company: { active: true },
            OR: [
                {
                    branch: {
                        is: {
                            attendanceEnabled: true,
                            status: 'ACTIVE',
                        },
                    },
                },
                {
                    branchId: null,
                    company: {
                        branches: {
                            some: {
                                attendanceEnabled: true,
                                status: 'ACTIVE',
                            },
                        },
                    },
                },
            ],
        },
    });
    const required = count > 0;
    biometricRequirementCache = { required, expiresAt: now + 5_000 };
    return required;
}

async function checkBiometricReadiness(): Promise<ReadinessCheck> {
    const started = Date.now();
    const required = await biometricAttendanceIsRequired();
    if (!required) return { status: 'ok', latencyMs: Date.now() - started, required: false };

    const provider = createFaceVerificationProvider(process.env);
    if (!provider.healthCheck) return { status: 'error', latencyMs: Date.now() - started, required: true };
    const timeoutMs = readinessBiometricTimeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const health = await Promise.race([
            provider.healthCheck(),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Biometric readiness timeout')), timeoutMs);
                timer.unref?.();
            }),
        ]);
        return {
            status: health.status === 'AVAILABLE' ? 'ok' : 'error',
            latencyMs: Date.now() - started,
            required: true,
            provider: health.provider,
            model: health.model,
            version: health.version,
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function checkFilesystemReadiness(): Promise<ReadinessCheck> {
    const now = Date.now();
    if (storageReadinessCache && storageReadinessCache.expiresAt > now) {
        return storageReadinessCache.check;
    }
    if (!storageReadinessInFlight) {
        const started = Date.now();
        const probe = checkStorageReadiness().then(result => {
            const check: ReadinessCheck = {
                status: 'ok',
                latencyMs: Date.now() - started,
                required: process.env.NODE_ENV === 'production',
                mode: result.mode,
                verified: result.identityVerified,
                identityHash: result.identityHash,
            };
            storageReadinessCache = { check, expiresAt: Date.now() + 5_000 };
            return check;
        });
        storageReadinessInFlight = probe;
        const clearProbe = () => {
            if (storageReadinessInFlight === probe) storageReadinessInFlight = null;
        };
        void probe.then(clearProbe, clearProbe);
    }

    const probe = storageReadinessInFlight;
    const timeoutMs = readinessStorageTimeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            probe,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Storage readiness timeout')), timeoutMs);
                timer.unref?.();
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ── Global rate limiter for v1 ──
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { success: false, message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const apiKey = req.headers['x-api-key'];
        if (typeof apiKey === 'string') return `apikey:${apiKey.slice(0, 8)}`;
        return req.ip || 'unknown';
    },
    validate: { keyGeneratorIpFallback: false }
});

// ── Extended health endpoint ──
v1.get('/health', async (_req: Request, res: Response) => {
    const checks: Record<string, ReadinessCheck> = {};

    const dbStart = Date.now();
    try {
        await checkDatabaseReadiness();
        checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch {
        checks.database = { status: 'error', latencyMs: Date.now() - dbStart };
    }

    if (checks.database.status === 'ok') {
        try {
            checks.storage = await checkFilesystemReadiness();
        } catch {
            checks.storage = {
                status: 'error',
                required: process.env.NODE_ENV === 'production',
            };
        }
    } else {
        // Shared storage identity is reconciled through MySQL. Do not issue a
        // second database query after the authoritative DB probe already failed.
        checks.storage = {
            status: 'error',
            required: process.env.NODE_ENV === 'production',
        };
    }

    checks.websocket = {
        status: WebSocketService.isInitialized() ? 'ok' : 'error',
        latencyMs: 0
    };

    if (checks.database.status === 'ok') {
        try {
            checks.biometric = await checkBiometricReadiness();
        } catch {
            checks.biometric = { status: 'error' };
        }
    } else {
        checks.biometric = { status: 'error' };
    }

    const wsClients = WebSocketService.getClientCount();
    const allOk = Object.values(checks).every(c => c.status === 'ok');

    res.status(allOk ? 200 : 503).json({
        success: allOk,
        data: {
            status: allOk ? 'healthy' : 'degraded',
            version: 'v1',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            checks,
            connections: { websocket: wsClients }
        }
    });
});

// Readiness is intentionally outside the public API limiter. A busy caller
// behind the same proxy must not consume the orchestrator's release probes.
v1.use(globalLimiter);
v1.use('/hr', hrRoutes);

// ── API info endpoint ──
v1.get('/', (_req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            name: 'Restaurant System API',
            version: 'v1',
            documentation: '/api/docs',
            endpoints: {
                health: '/api/v1/health',
                auth: '/api/auth/*',
                resources: '/api/*'
            }
        }
    });
});

// ── API Key Management (admin-only) ──

const VALID_SCOPES = ['read:orders', 'write:orders', 'read:menu', 'write:menu', 'read:inventory', 'write:inventory', 'read:reports'];

v1.post('/api-keys',
    authMiddleware,
    requireRole('ADMIN', 'SUPERADMIN'),
    validate({
        body: {
            name: { type: 'string', required: true, min: 1, max: 100 },
            scopes: { type: 'array', required: true, min: 1 },
        },
    }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { name, scopes, expiresAt } = req.body;

            const invalidScopes = (scopes as string[]).filter(s => !VALID_SCOPES.includes(s));
            if (invalidScopes.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Scopes inválidos: ${invalidScopes.join(', ')}`,
                    validScopes: VALID_SCOPES,
                });
            }

            const { plainKey, keyHash, keyPrefix } = generateApiKey();

            const apiKey = await prisma.apiKey.create({
                data: {
                    companyId: req.user!.companyId,
                    name,
                    keyHash,
                    keyPrefix,
                    scopes,
                    expiresAt: expiresAt ? new Date(expiresAt) : null,
                    createdBy: req.user!.userId,
                },
                select: {
                    id: true, name: true, keyPrefix: true, scopes: true,
                    active: true, expiresAt: true, createdAt: true,
                },
            });

            res.status(201).json({
                success: true,
                data: { ...apiKey, key: plainKey },
                experimental: true,
                message: 'Guarda esta clave, no se mostrará de nuevo',
            });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error al crear API key' });
        }
    }
);

v1.get('/api-keys',
    authMiddleware,
    requireRole('ADMIN', 'SUPERADMIN'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const keys = await prisma.apiKey.findMany({
                where: { companyId: req.user!.companyId },
                select: {
                    id: true, name: true, keyPrefix: true, scopes: true,
                    active: true, expiresAt: true, lastUsedAt: true, createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
            });

            res.json({ success: true, data: keys });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error al listar API keys' });
        }
    }
);

v1.patch('/api-keys/:id/revoke',
    authMiddleware,
    requireRole('ADMIN', 'SUPERADMIN'),
    validate({ params: { id: { type: 'number', required: true, min: 1 } } }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);

            const key = await prisma.apiKey.findFirst({
                where: { id, companyId: req.user!.companyId },
            });

            if (!key) {
                return res.status(404).json({ success: false, message: 'API key no encontrada' });
            }

            await prisma.apiKey.update({
                where: { id },
                data: { active: false },
            });

            res.json({ success: true, message: 'API key revocada' });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error al revocar API key' });
        }
    }
);

v1.delete('/api-keys/:id',
    authMiddleware,
    requireRole('ADMIN', 'SUPERADMIN'),
    validate({ params: { id: { type: 'number', required: true, min: 1 } } }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);

            const key = await prisma.apiKey.findFirst({
                where: { id, companyId: req.user!.companyId },
            });

            if (!key) {
                return res.status(404).json({ success: false, message: 'API key no encontrada' });
            }

            await prisma.apiKey.delete({ where: { id } });

            res.json({ success: true, message: 'API key eliminada' });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error al eliminar API key' });
        }
    }
);

v1.get('/api-keys/scopes', authMiddleware, requireRole('ADMIN', 'SUPERADMIN'), (_req: Request, res: Response) => {
    res.json({ success: true, data: VALID_SCOPES });
});

export default v1;
