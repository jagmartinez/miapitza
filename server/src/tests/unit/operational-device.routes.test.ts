import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.doMock('../../middlewares/auth', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = JSON.parse(String(req.headers['x-test-user']));
        next();
    },
    requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const router = require('../../routes/operational-device.routes').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OperationalDeviceService } = require('../../services/operational-device.service');

const app = express();
app.use(express.json());
app.use('/', router);
app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
});

const admin = { userId: 1, companyId: 5, role: 'ADMIN', roles: ['ADMIN'], branchId: 1 };
const pinned = { userId: 2, companyId: 5, role: 'MESERO', roles: ['MESERO'], branchId: 1 };
const as = (u: object) => JSON.stringify(u);

afterEach(() => {
    jest.restoreAllMocks();
});

describe('operational-device routes branch scoping', () => {
    it('GET / forces a branch-pinned user to their own branch', async () => {
        const list = jest.spyOn(OperationalDeviceService, 'list').mockResolvedValue([]);
        await request(app).get('/').set('x-test-user', as(pinned)).expect(200);
        expect(list).toHaveBeenCalledWith({ userId: 2, companyId: 5 }, 1);
    });

    it('GET / rejects another branch for a branch-pinned user', async () => {
        const list = jest.spyOn(OperationalDeviceService, 'list');
        await request(app).get('/?branchId=2').set('x-test-user', as(pinned)).expect(403);
        expect(list).not.toHaveBeenCalled();
    });

    it('GET / lets a company-wide admin list every branch', async () => {
        const list = jest.spyOn(OperationalDeviceService, 'list').mockResolvedValue([]);
        await request(app).get('/').set('x-test-user', as(admin)).expect(200);
        expect(list).toHaveBeenCalledWith({ userId: 1, companyId: 5 }, undefined);
    });

    it('POST /:id/revoke passes the branch scope for branch-pinned users only', async () => {
        const revoke = jest.spyOn(OperationalDeviceService, 'revoke').mockResolvedValue(undefined as never);
        await request(app).post('/7/revoke').set('x-test-user', as(pinned)).expect(200);
        expect(revoke).toHaveBeenLastCalledWith({ userId: 2, companyId: 5 }, 7, { branchScope: 1 });
        await request(app).post('/7/revoke').set('x-test-user', as(admin)).expect(200);
        expect(revoke).toHaveBeenLastCalledWith({ userId: 1, companyId: 5 }, 7, { branchScope: undefined });
    });

    it('POST / coerces a numeric-string branchId and rejects a non-numeric one with 400', async () => {
        const register = jest.spyOn(OperationalDeviceService, 'register')
            .mockResolvedValue({ device: { id: 1, tokenHash: 'x' }, deviceToken: 't' } as never);
        const res: any = await request(app).post('/').set('x-test-user', as(admin))
            .send({ branchId: '1', type: 'SERVICE_TABLET', name: 'T' }).expect(201);
        expect((register.mock.calls[0] as any[])[1].branchId).toBe(1);
        expect(res.body.data.device.tokenHash).toBeUndefined();
        await request(app).post('/').set('x-test-user', as(admin))
            .send({ branchId: 'abc', type: 'SERVICE_TABLET', name: 'T' }).expect(400);
    });
});
