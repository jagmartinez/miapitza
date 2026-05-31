import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface CachedResponse {
    status: number;
    body: unknown;
    createdAt: number;
}

const store = new Map<string, CachedResponse>();
const processing = new Set<string>();

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (now - entry.createdAt > TTL_MS) store.delete(key);
    }
}, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

/**
 * Derives a tenant namespace for idempotency keys.
 *
 * This middleware is mounted on /api BEFORE per-route authentication runs, so
 * req.user is usually undefined here. Falling back to a single 'anon' namespace
 * would let requests from different tenants collide on the same idempotency key.
 * To keep keys tenant-scoped we fall back to a hash of the caller's auth token
 * (Authorization header or auth_token cookie), which is unique per session/tenant.
 */
function resolveNamespace(req: Request): string {
    if (req.user?.companyId) {
        return `c:${req.user.companyId}`;
    }

    const token = extractAuthToken(req);
    if (token) {
        return `t:${crypto.createHash('sha256').update(token).digest('hex')}`;
    }

    return 'anon';
}

function extractAuthToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }

    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;

    for (const rawCookie of cookieHeader.split(';')) {
        const [name, ...valueParts] = rawCookie.trim().split('=');
        if (name === 'auth_token') {
            const value = valueParts.join('=');
            if (value) return value;
        }
    }

    return null;
}

export function idempotency(req: Request, res: Response, next: NextFunction): void {
    const key = req.headers['x-idempotency-key'] as string | undefined;

    if (!key || req.method === 'GET') {
        next();
        return;
    }

    const fullKey = `${resolveNamespace(req)}:${key}`;

    const cached = store.get(fullKey);
    if (cached) {
        res.status(cached.status).json(cached.body);
        return;
    }

    if (processing.has(fullKey)) {
        res.status(409).json({ success: false, message: 'Solicitud duplicada en proceso' });
        return;
    }

    processing.add(fullKey);

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
        processing.delete(fullKey);
        store.set(fullKey, {
            status: res.statusCode,
            body,
            createdAt: Date.now(),
        });
        return originalJson(body);
    };

    const cleanup = () => processing.delete(fullKey);
    res.on('close', cleanup);
    res.on('error', cleanup);

    next();
}
