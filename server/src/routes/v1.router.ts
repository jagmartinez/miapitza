import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../utils/prisma';
import { WebSocketService } from '../services/websocket.service';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { generateApiKey } from '../utils/apiKeyGenerator';
import hrRoutes from './hr.routes';

const v1 = Router();

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

v1.use(globalLimiter);
v1.use('/hr', hrRoutes);

// ── Extended health endpoint ──
v1.get('/health', async (_req: Request, res: Response) => {
    const checks: Record<string, { status: string; latencyMs?: number }> = {};

    const dbStart = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch {
        checks.database = { status: 'error', latencyMs: Date.now() - dbStart };
    }

    checks.websocket = { status: 'ok', latencyMs: 0 };

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
