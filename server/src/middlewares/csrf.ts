import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

const CSRF_EXEMPT_PATHS = ['/auth/login', '/auth/register', '/pedidosya/webhook'];

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
    // API key requests are stateless — skip CSRF
    if (req.headers['x-api-key']) {
        next();
        return;
    }

    // Exempt specific public endpoints that have their own protection (rate-limit, HMAC, etc.)
    if (CSRF_EXEMPT_PATHS.some(p => req.path.startsWith(p))) {
        next();
        return;
    }

    // Ensure a CSRF cookie exists on every response
    const cookies = parseCookies(req.headers.cookie || '');
    let cookieToken = cookies[CSRF_COOKIE];

    if (!cookieToken) {
        cookieToken = generateToken();
        const isSecure = process.env.NODE_ENV === 'production';
        res.cookie(CSRF_COOKIE, cookieToken, {
            httpOnly: false, // JS must read this to send in header
            secure: isSecure,
            sameSite: 'lax',
            path: '/',
            maxAge: 8 * 60 * 60 * 1000,
        });
    }

    // Safe methods don't need validation
    if (SAFE_METHODS.has(req.method)) {
        next();
        return;
    }

    const headerToken = req.headers[CSRF_HEADER] as string | undefined;

    if (!headerToken || headerToken !== cookieToken) {
        res.status(403).json({ success: false, message: 'CSRF token inválido' });
        return;
    }

    next();
}

function parseCookies(header: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pair of header.split(';')) {
        const [key, ...rest] = pair.trim().split('=');
        if (key) result[key] = decodeURIComponent(rest.join('=') || '');
    }
    return result;
}
