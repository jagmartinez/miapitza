import crypto from 'crypto';
import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/** Paths (relative to /api/auth) authenticated by an X-Device-Token header. */
const DEVICE_AUTH_PATHS = new Set(['/device-roster', '/pin-login', '/device-login']);

export function isDeviceAuthPath(path: string): boolean {
    return DEVICE_AUTH_PATHS.has(path.replace(/\/+$/, ''));
}

/**
 * Tablets of one restaurant share a NAT IP, so these routes are limited per
 * device (sha256 of the token, never the token itself), falling back to IP.
 */
export function deviceRateLimitKey(req: Request): string {
    const header = req.headers['x-device-token'];
    if (typeof header === 'string' && header.length > 0 && header.length <= 512) {
        return `device:${crypto.createHash('sha256').update(header).digest('hex')}`;
    }
    return `ip:${ipKeyGenerator(req.ip || '')}`;
}

export function createDeviceAuthLimiter(max: number) {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max,
        keyGenerator: deviceRateLimitKey,
        message: { success: false, code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' },
        standardHeaders: true,
        legacyHeaders: false,
    });
}
