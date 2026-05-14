import { Request, Response, NextFunction } from 'express';

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

export function idempotency(req: Request, res: Response, next: NextFunction): void {
    const key = req.headers['x-idempotency-key'] as string | undefined;

    if (!key || req.method === 'GET') {
        next();
        return;
    }

    const fullKey = `${req.user?.companyId || 'anon'}:${key}`;

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
