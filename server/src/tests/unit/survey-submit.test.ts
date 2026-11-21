import express from 'express';
import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

let currentUser: Record<string, unknown> = {};
jest.mock('../../middlewares/auth', () => ({
    authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = currentUser; next(); },
    extractAuthToken: () => 'session-token',
    requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const prisma = require('../../utils/prisma').default as typeof import('../../utils/prisma').default;
const { SessionService } = require('../../services/session.service') as typeof import('../../services/session.service');
const surveyRoutes = require('../../routes/survey.routes').default as import('express').Router;
const { errorHandler } = require('../../middlewares/errorHandler') as typeof import('../../middlewares/errorHandler');

const app = express();
app.use(express.json());
app.use('/api/v1/surveys', surveyRoutes);
app.use(errorHandler);

const cashier = { userId: 99, companyId: 5, branchId: 1, role: 'CAJERO', roles: ['CAJERO'], permissions: [] };
const order = { id: 40, branchId: 1, userId: 21, financialStatus: 'PAID' };
const device = { id: 7, companyId: 5, branchId: 1, type: 'SERVICE_TABLET', status: 'ACTIVE' };

function setup(over: { tag?: string | null; device?: unknown; order?: unknown; existing?: unknown; user?: Record<string, unknown> } = {}) {
    currentUser = over.user ?? cashier;
    jest.spyOn(SessionService, 'deviceOf').mockResolvedValue(('tag' in over ? over.tag : 'op-device:7') as never);
    jest.spyOn(prisma.operationalDevice, 'findUnique').mockResolvedValue(('device' in over ? over.device : device) as never);
    jest.spyOn(prisma.order, 'findFirst').mockResolvedValue(('order' in over ? over.order : order) as never);
    const find = jest.spyOn(prisma.surveyResponse, 'findUnique').mockResolvedValue((over.existing ?? null) as never);
    const create = jest.spyOn(prisma.surveyResponse, 'create').mockResolvedValue({ id: 3 } as never);
    return { find, create };
}

const post = (body: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/surveys').send({ orderId: 40, nps: 9, ...body });

describe('POST /surveys', () => {
    it('creates response attributed to order creator', async () => {
        const { create } = setup();
        const res = await post({ waiterRating: 5, comment: 'Todo bien' }).expect(201);
        expect(res.body).toEqual({ success: true, data: { id: 3, orderId: 40, created: true } });
        const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data.waiterUserId).toBe(21);
        expect(data.waiterUserId).not.toBe(cashier.userId);
        expect(data).toMatchObject({ companyId: 5, branchId: 1, orderId: 40, operationalDeviceId: 7, nps: 9, waiterRating: 5, comment: 'Todo bien' });
        expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 40, companyId: 5 } }));
    });

    it('second submit for same order returns existing', async () => {
        const { create } = setup({ existing: { id: 11 } });
        const res = await post().expect(200);
        expect(res.body).toEqual({ success: true, data: { id: 11, orderId: 40, created: false } });
        expect(create).not.toHaveBeenCalled();
    });

    it('second submit for same order returns existing on a P2002 race', async () => {
        const { find, create } = setup();
        find.mockResolvedValueOnce(null as never).mockResolvedValueOnce({ id: 12 } as never);
        create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
        const res = await post().expect(200);
        expect(res.body.data).toEqual({ id: 12, orderId: 40, created: false });
    });

    it.each([
        ['non-device session tag', { tag: 'Windows' }],
        ['no session tag', { tag: null }],
        ['unknown device', { device: null }],
        ['revoked device', { device: { ...device, status: 'REVOKED' } }],
        ['kitchen tablet', { device: { ...device, type: 'KITCHEN_TABLET' } }],
        ['device of another company', { device: { ...device, companyId: 6 } }],
        ['device of another branch than the order', { device: { ...device, branchId: 2 } }],
    ])('rejects non-device session: %s', async (_label, over) => {
        const { create } = setup(over);
        const res = await post().expect(403);
        expect(res.body.code).toBe('SURVEY_DEVICE_REQUIRED');
        expect(create).not.toHaveBeenCalled();
    });

    it('rejects unpaid order', async () => {
        const { create } = setup({ order: { ...order, financialStatus: 'PARTIAL' } });
        const res = await post().expect(409);
        expect(res.body.code).toBe('SURVEY_ORDER_NOT_PAID');
        expect(create).not.toHaveBeenCalled();
    });

    it('order of other company', async () => {
        setup({ order: null });
        const res = await post().expect(404);
        expect(res.body.code).toBe('SURVEY_ORDER_NOT_FOUND');
    });

    it('rejects a user pinned to another branch', async () => {
        setup({ user: { ...cashier, branchId: 2 } });
        await post().expect(403);
    });

    it.each([
        ['nps 11', { nps: 11 }],
        ['nps -1', { nps: -1 }],
        ['waiterRating 0', { waiterRating: 0 }],
        ['waitRating 0', { waitRating: 0 }],
        ['ambienceRating 6', { ambienceRating: 6 }],
        ['foodRating 0', { foodRating: 0 }],
        ['waiterRating 6', { waiterRating: 6 }],
        ['waitRating 6', { waitRating: 6 }],
        ['ambienceRating 0', { ambienceRating: 0 }],
        ['foodRating 6', { foodRating: 6 }],
        ['comment of 501 chars', { comment: 'x'.repeat(501) }],
        ['phone abc', { contactPhone: 'abc' }],
    ])('validates ranges: %s', async (_label, body) => {
        const { create } = setup();
        await post(body).expect(400);
        expect(create).not.toHaveBeenCalled();
    });

    it('empty comment and phone stored as null', async () => {
        const { create } = setup();
        await post({ comment: '   ', contactPhone: '', waiterRating: null }).expect(201);
        const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data.comment).toBeNull();
        expect(data.contactPhone).toBeNull();
        expect(data.waiterRating).toBeNull();
    });

    it('trims before length and pattern checks (padded comment, whitespace-only phone)', async () => {
        const { create } = setup();
        await post({ comment: `   ${'x'.repeat(500)}   `, contactPhone: '   ' }).expect(201);
        const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data.comment).toBe('x'.repeat(500));
        expect(data.contactPhone).toBeNull();
        await post({ contactPhone: '  555-123-4567  ' }).expect(201);
    });
});
