import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { auth } from './auth';

const RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;
const PROCESSING_TTL_MS = 2 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const cleanupTimer = setInterval(() => {
    void prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } })
        .catch((error) => console.error('[Idempotency] Failed to clean expired records:', error));
}, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

function extractAuthToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    for (const rawCookie of cookieHeader.split(';')) {
        const [name, ...valueParts] = rawCookie.trim().split('=');
        if (name === 'auth_token' && valueParts.length) {
            return decodeURIComponent(valueParts.join('='));
        }
    }
    return null;
}

function singleHeader(req: Request, name: string): string | null {
    const value = req.headers[name];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function credentialNamespace(prefix: string, credential: string): string {
    return `${prefix}:${crypto.createHash('sha256').update(credential).digest('hex').slice(0, 60)}`;
}

export function resolveIdempotencyNamespace(req: Request): string {
    const token = extractAuthToken(req);
    if (token && req.user && req.authContextValidated === true) {
        const authorizationContext = JSON.stringify({
            userId: req.user.userId,
            companyId: req.user.companyId,
            branchId: req.user.branchId ?? null,
            role: req.user.role,
            roles: [...req.user.roles].sort(),
            permissions: [...req.user.permissions].sort(),
            accountType: req.user.accountType ?? null,
        });
        return credentialNamespace('s', `${token}\0${authorizationContext}`);
    }
    if (token) return credentialNamespace('t', token);
    // API-key auth runs on the route after this global middleware. Hash the
    // opaque credential now so two integrations can safely reuse the same
    // operation key without sharing responses. JWT remains authoritative when
    // both headers are present, preventing an authenticated caller from evading
    // its namespace by adding an arbitrary API-key header.
    const apiKey = singleHeader(req, 'x-api-key');
    if (apiKey) return credentialNamespace('k', apiKey);
    // Public delivery webhooks are authenticated later with tenant-specific
    // signatures. Isolate their pre-auth idempotency records by the opaque
    // signature rather than putting all providers in the anonymous namespace.
    const webhookSignature = singleHeader(req, 'x-pedidosya-signature')
        || singleHeader(req, 'x-webhook-signature');
    if (webhookSignature) return credentialNamespace('w', webhookSignature);
    return 'anon';
}

/**
 * Authenticate JWT/cookie requests before a completed idempotency record can
 * short-circuit route middleware. API-key/webhook routes remain route-owned.
 */
export function preAuthenticateIdempotentRequest(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    const key = req.headers['x-idempotency-key'];
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
    if (!key || req.method === 'GET' || path === '/api/auth/login' || !extractAuthToken(req)) {
        return next();
    }
    return auth(req, res, next);
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
    const rawKey = req.headers['x-idempotency-key'];
    if (Array.isArray(rawKey)) {
        res.status(400).json({ success: false, message: 'Debe enviar una sola clave de idempotencia' });
        return;
    }
    const key = rawKey;
    if (!key || req.method === 'GET') return next();
    if (key.length > 191) {
        res.status(400).json({ success: false, message: 'Clave de idempotencia demasiado larga' });
        return;
    }
    // Never replay before the credential's authoritative route middleware has
    // run. JWT/cookie requests are pre-authenticated by app.ts. API-key and
    // signed-webhook routes keep their route/domain idempotency instead.
    if (req.authContextValidated !== true || !req.user) return next();

    const namespace = resolveIdempotencyNamespace(req);
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
        void finalize
            .then(() => originalJson(body))
            .catch((error) => {
                // The business mutation may already be committed. Turning a
                // successful response into a 5xx would actively encourage a
                // duplicate retry. Preserve the authoritative endpoint response;
                // the domain-level payment key is the final safety net if the
                // durable response record could not be finalized.
                console.error(`[Idempotency] Failed to finalize record ${record.id}:`, error);
                originalJson(body);
            });
        return res;
    };

    const release = () => {
        if (!res.headersSent) {
            void prisma.idempotencyRecord.deleteMany({ where: { id: record.id, status: 'PROCESSING' } })
                .catch((error) => console.error(`[Idempotency] Failed to release processing record ${record.id}:`, error));
        }
    };
    res.on('close', release);
    res.on('error', release);
    next();
}
