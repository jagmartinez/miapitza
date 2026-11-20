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
    isDeviceAuthPath,
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
});
