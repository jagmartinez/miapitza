import type { Request } from 'express';
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

/**
 * Parse TRUST_PROXY the way Express understands `trust proxy`: a hop count,
 * true/false, or a comma-separated list of addresses/subnets. Defaults to one
 * hop (the reverse proxy in front of the app), which is the historical value.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
    const trimmed = value?.trim();
    if (!trimmed) return 1;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    return trimmed;
}

// Paths relative to the /api mount point.
const HEALTH_PATHS = new Set(['/health', '/v1/health']);
// HMAC-validated webhooks have their own dedicated limiter; a busy delivery
// platform must not be throttled by the generic per-IP bucket.
const WEBHOOK_PATH = /^\/(?:v1\/)?(?:delivery|pedidosya)\/webhook\//;

export function isApiRateLimitExempt(req: Pick<Request, 'path' | 'headers'>): boolean {
    if (typeof req.headers.upgrade === 'string' && req.headers.upgrade.toLowerCase() === 'websocket') return true;
    if (HEALTH_PATHS.has(req.path)) return true;
    return WEBHOOK_PATH.test(req.path);
}

export interface ApiRateLimitOptions {
    env?: NodeJS.ProcessEnv;
    windowMs?: number;
}

/**
 * Generous per-client-IP ceiling for every /api request: a backstop against
 * scraping and flooding, not a business rule. The key is the library default
 * (req.ip, IPv6-subnet aware), so it honours the app's `trust proxy` setting.
 * Disabled under NODE_ENV=test unless API_RATE_LIMIT_IN_TESTS=true.
 */
export function createApiRateLimiter(options: ApiRateLimitOptions = {}): RateLimitRequestHandler {
    const env = options.env ?? process.env;
    const isProd = env.NODE_ENV === 'production';
    const configured = Number(env.API_RATE_LIMIT_PER_MINUTE);
    const max = Number.isInteger(configured) && configured > 0 ? configured : (isProd ? 600 : 5000);
    const disabledInTests = env.NODE_ENV === 'test' && env.API_RATE_LIMIT_IN_TESTS !== 'true';

    return rateLimit({
        windowMs: options.windowMs ?? 60 * 1000,
        max,
        message: { success: false, code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.' },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => disabledInTests || isApiRateLimitExempt(req),
    });
}
