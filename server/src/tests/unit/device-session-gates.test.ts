import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { auth } from '../../middlewares/auth';
import { SessionService } from '../../services/session.service';
import {
    createDeviceAuthLimiter,
    deviceRateLimitKey,
    createSessionAuthLimiter,
    isDeviceAuthPath,
    isSessionAuthPath,
    sessionRateLimitKey,
} from '../../middlewares/device-rate-limit';

beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-device-gates';
});
afterEach(() => {
    jest.restoreAllMocks();
});

describe('auth middleware password gate vs device sessions', () => {
    const app = express();
    app.use(auth);
    app.get('/api/orders', (_req, res) => { res.json({ ok: true }); });
    app.put('/api/auth/me/pin', (_req, res) => { res.json({ ok: true }); });

    const bearer = () => `Bearer ${jwt.sign({ userId: 21, role: 'MESERO' }, process.env.JWT_SECRET!, { algorithm: 'HS256' })}`;
    const userRow = (over: Record<string, unknown> = {}) => ({
        id: 21, branchId: 1, companyId: 5, status: 'ACTIVE', accountType: 'INTERNAL',
        role: { name: 'MESERO', permissions: [] }, userRoles: [], employee: null,
        mustChangePassword: false, passwordChangedAt: new Date(Date.now() - 400 * 86400_000),
        company: { active: true, settings: [] }, branch: { status: 'ACTIVE', timezone: null },
        allowedBranches: [], ...over,
    });

    function setup(device: string, user = userRow()) {
        jest.spyOn(SessionService, 'isValid').mockResolvedValue(true);
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(user as never);
        jest.spyOn(prisma.setting, 'findFirst').mockResolvedValue(null); // default 90 days
        jest.spyOn(prisma.userSession, 'findUnique').mockResolvedValue({ device } as never);
    }

    it('lets an op-device session through with an expired password', async () => {
        setup('op-device:7');
        await request(app).get('/api/orders').set('Authorization', bearer()).expect(200);
    });

    it('lets an op-device session through with mustChangePassword', async () => {
        setup('op-device:7', userRow({ mustChangePassword: true }));
        await request(app).get('/api/orders').set('Authorization', bearer()).expect(200);
    });

    it('still blocks a normal web session with an expired password', async () => {
        setup('Windows');
        const res = await request(app).get('/api/orders').set('Authorization', bearer()).expect(403);
        expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('still blocks a normal session with mustChangePassword', async () => {
        setup('Móvil', userRow({ mustChangePassword: true }));
        await request(app).get('/api/orders').set('Authorization', bearer()).expect(403);
    });

    it('keeps PUT /api/auth/me/pin gated even for an op-device session', async () => {
        setup('op-device:7');
        const res = await request(app).put('/api/auth/me/pin').set('Authorization', bearer()).expect(403);
        expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it.each(['/api/auth/me/pin/', '/API/auth/me/pin', '/api/AUTH/Me/PIN//', '/api/auth/me/pin/?x=1'])(
        'keeps the PIN route gated for the variant %s',
        async (url) => {
            setup('op-device:7');
            app.put('/api/auth/me/pin/', (_req, res) => { res.json({ ok: true }); });
            const res = await request(app).put(url).set('Authorization', bearer()).expect(403);
            expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
        },
    );

    it('does not look up the session device when no password change is required', async () => {
        setup('Windows', userRow({ passwordChangedAt: new Date() }));
        const find = jest.spyOn(prisma.userSession, 'findUnique');
        await request(app).get('/api/orders').set('Authorization', bearer()).expect(200);
        expect(find).not.toHaveBeenCalled();
    });
});

describe('device auth rate limiting', () => {
    it('recognises only the device-token paths', () => {
        for (const p of ['/device-roster', '/pin-login', '/device-login']) expect(isDeviceAuthPath(p)).toBe(true);
        for (const p of ['/login', '/me', '/me/pin', '/logout']) expect(isDeviceAuthPath(p)).toBe(false);
    });

    it('keys on the hash of the token and never contains the raw token', () => {
        const k1 = deviceRateLimitKey({ headers: { 'x-device-token': 'token-A' }, ip: '10.0.0.1' } as never);
        const k2 = deviceRateLimitKey({ headers: { 'x-device-token': 'token-B' }, ip: '10.0.0.1' } as never);
        const k3 = deviceRateLimitKey({ headers: {}, ip: '10.0.0.1' } as never);
        expect(k1).not.toBe(k2);
        expect(k1).not.toContain('token-A');
        expect(k3.startsWith('ip:')).toBe(true);
    });

    it('limits per device: one device is throttled while another on the same IP is not', async () => {
        const app = express();
        app.use(createDeviceAuthLimiter(3));
        app.post('/pin-login', (_req, res) => { res.json({ ok: true }); });
        const hit = (token: string) => request(app).post('/pin-login').set('X-Device-Token', token);

        for (let i = 0; i < 3; i += 1) await hit('device-one').expect(200);
        await hit('device-one').expect(429);
        await hit('device-two').expect(200);
    });

    it('matches device paths case-insensitively and tolerating trailing slashes', () => {
        for (const p of ['/PIN-LOGIN', '/pin-login/', '/Device-Roster//', '/device-login?x=1']) {
            expect(isDeviceAuthPath(p)).toBe(true);
        }
    });
});

describe('session (non-credential) auth rate limiting', () => {
    it('routes only logout, /me and session management to the lenient limiter', () => {
        for (const p of ['/logout', '/LOGOUT/', '/me', '/Me/', '/sessions', '/sessions/abc', '/sessions/abc/', '/me?x=1']) {
            expect(isSessionAuthPath(p)).toBe(true);
        }
        for (const p of ['/login', '/me/pin', '/ME/PIN/', '/change-password', '/2fa/verify', '/pin-login', '/register', '/sessions/a/b', '/']) {
            expect(isSessionAuthPath(p)).toBe(false);
        }
    });

    it('keys per session token hash, falling back to the IP, and never embeds the token', () => {
        const a = sessionRateLimitKey({ headers: { authorization: 'Bearer token-A' }, ip: '10.0.0.1' } as never);
        const b = sessionRateLimitKey({ headers: { authorization: 'Bearer token-B' }, ip: '10.0.0.1' } as never);
        const c = sessionRateLimitKey({ headers: { cookie: 'auth_token=token-A' }, ip: '10.0.0.2' } as never);
        const d = sessionRateLimitKey({ headers: {}, ip: '10.0.0.1' } as never);
        expect(a).not.toBe(b);
        expect(a).toBe(c);
        expect(a).not.toContain('token-A');
        expect(a.startsWith('session:')).toBe(true);
        expect(d.startsWith('ip:')).toBe(true);
    });

    it('does not throttle 21 logouts from one IP, and tablets with different sessions do not share a bucket', async () => {
        const app = express();
        app.use('/api/auth', (req, res, next) =>
            isSessionAuthPath(req.path) ? createSessionAuthLimiter(100)(req, res, next) : next());
        app.post('/api/auth/logout', (_req, res) => { res.json({ ok: true }); });
        for (let i = 0; i < 21; i += 1) {
            await request(app).post('/api/auth/logout').set('Authorization', `Bearer t-${i % 3}`).expect(200);
        }
    });

    it('throttles one session token without affecting another on the same IP', async () => {
        const app = express();
        app.use(createSessionAuthLimiter(2));
        app.get('/me', (_req, res) => { res.json({ ok: true }); });
        const hit = (t: string) => request(app).get('/me').set('Authorization', `Bearer ${t}`);
        await hit('one').expect(200);
        await hit('one').expect(200);
        await hit('one').expect(429);
        await hit('two').expect(200);
    });
});
