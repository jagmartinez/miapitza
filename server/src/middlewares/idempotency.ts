import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';

const RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;
const PROCESSING_TTL_MS = 2 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const cleanupTimer = setInterval(() => {
    void prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
}, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

function extractAuthToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    for (const rawCookie of cookieHeader.split(';')) {
        const [name, ...valueParts] = rawCookie.trim().split('=');
        if (name === 'auth_token' && valueParts.length) return valueParts.join('=');
    }
    return null;
}

function resolveNamespace(req: Request): string {
    if (req.user?.companyId) return `c:${req.user.companyId}`;
    const token = extractAuthToken(req);
    const secret = process.env.JWT_SECRET;
    if (token && secret) {
        try {
            const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { companyId?: number };
            if (decoded.companyId) return `c:${decoded.companyId}`;
        } catch {
            // Authentication middleware remains authoritative; isolate invalid tokens below.
        }
    }
    if (token) return `t:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 62)}`;
    return 'anon';
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, child]) => [name, canonicalize(child)]));
    }
    return value;
}

export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = req.headers['x-idempotency-key'] as string | undefined;
    if (!key || req.method === 'GET') return next();
    if (key.length > 191) {
        res.status(400).json({ success: false, message: 'Clave de idempotencia demasiado larga' });
        return;
    }

    const namespace = resolveNamespace(req);
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
    const scope = `${req.method.toUpperCase()}:${path}`;
    const fingerprint = crypto.createHash('sha256')
        .update(JSON.stringify(canonicalize(req.body ?? null)))
        .digest('hex');
    const now = new Date();
    let record;

    try {
        record = await prisma.idempotencyRecord.create({
            data: {
                namespace, scope, key, fingerprint, status: 'PROCESSING',
                expiresAt: new Date(now.getTime() + PROCESSING_TTL_MS)
            }
        });
    } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return next(error);
        const existing = await prisma.idempotencyRecord.findUnique({
            where: { namespace_scope_key: { namespace, scope, key } }
        });
        if (!existing) return next(error);
        if (existing.fingerprint !== fingerprint) {
            res.status(409).json({ success: false, message: 'Clave de idempotencia reutilizada con una solicitud diferente' });
            return;
        }
        if (existing.status === 'COMPLETED' && existing.expiresAt > now && existing.httpStatus !== null) {
            res.status(existing.httpStatus).json(existing.response);
            return;
        }
        if (existing.expiresAt > now) {
            res.status(409).json({ success: false, message: 'Solicitud duplicada en proceso' });
            return;
        }
        const claimed = await prisma.idempotencyRecord.updateMany({
            where: { id: existing.id, expiresAt: { lte: now } },
            data: { fingerprint, status: 'PROCESSING', httpStatus: null, response: Prisma.JsonNull, expiresAt: new Date(now.getTime() + PROCESSING_TTL_MS) }
        });
        if (claimed.count !== 1) {
            res.status(409).json({ success: false, message: 'Solicitud duplicada en proceso' });
            return;
        }
        record = { ...existing, fingerprint };
    }

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
        const finalize = res.statusCode >= 200 && res.statusCode < 300
            ? prisma.idempotencyRecord.update({
                where: { id: record.id },
                data: {
                    status: 'COMPLETED', httpStatus: res.statusCode,
                    response: body as Prisma.InputJsonValue,
                    expiresAt: new Date(Date.now() + RESPONSE_TTL_MS)
                }
            })
            : prisma.idempotencyRecord.deleteMany({ where: { id: record.id, status: 'PROCESSING' } });
        void finalize.then(() => originalJson(body)).catch(next);
        return res;
    };

    const release = () => {
        if (!res.headersSent) void prisma.idempotencyRecord.deleteMany({ where: { id: record.id, status: 'PROCESSING' } }).catch(() => undefined);
    };
    res.on('close', release);
    res.on('error', release);
    next();
}
