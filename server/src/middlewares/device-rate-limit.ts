import crypto from 'crypto';
import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { extractAuthToken } from './auth';

/** Paths (relative to /api/auth) authenticated by an X-Device-Token header. */
const DEVICE_AUTH_PATHS = new Set(['/device-roster', '/pin-login', '/device-login']);

/** Express matches routes case-insensitively and ignores a trailing slash; so must the limiter routing. */
function normalizeAuthPath(path: string): string {
    return `/${path.split('?')[0].replace(/^\/+|\/+$/g, '').toLowerCase()}`;
}

export function isDeviceAuthPath(path: string): boolean {
    return DEVICE_AUTH_PATHS.has(normalizeAuthPath(path));
}

/**
 * Authenticated /auth paths that check no credential (logout, session check,
 * session list/revocation). They are hit on every user switch and app start,
 * so they must not drain the strict per-IP login bucket shared by the NAT.
 * Credential-checking paths (/login, /me/pin, /change-password, /2fa/*) stay strict.
 */
const SESSION_PATH = /^\/(logout|me|sessions(\/[^/]+)?)$/;

export function isSessionAuthPath(path: string): boolean {
    return SESSION_PATH.test(normalizeAuthPath(path));
}

/** Per session token (sha256, never the token), falling back to the IP. */
export function sessionRateLimitKey(req: Request): string {
    const token = extractAuthToken(req);
    if (token && token.length <= 4096) {
        return `session:${crypto.createHash('sha256').update(token).digest('hex')}`;
    }
    return `ip:${ipKeyGenerator(req.ip || '')}`;
}

export function createSessionAuthLimiter(max: number) {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        max,
        keyGenerator: sessionRateLimitKey,
        message: { success: false, code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.' },
        standardHeaders: true,
        legacyHeaders: false,
    });
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
