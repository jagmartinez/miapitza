import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';
import { SettingsScopeService } from '../../services/settings-scope.service';

import biRoutes from '../../routes/bi.routes';
import { BiController, clearBiCache, parseBiQuery, resolveBiBranchIds } from '../../controllers/bi.controller';

// The first layer of the router is the JWT middleware: replace it with a test double that reads the
// user from a header, keeping the real requireRole guard and the real route table under test.
const authLayer = (biRoutes as unknown as { stack: { handle: unknown }[] }).stack[0];
authLayer.handle = (req: { headers: Record<string, string>; user?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const raw = req.headers['x-test-user'];
    if (!raw) return res.status(401).json({ success: false });
    req.user = JSON.parse(raw);
    return next();
};

const app = express();
app.use('/api/v1/bi', biRoutes);

const admin = JSON.stringify({ id: 1, companyId: 1, role: 'ADMIN', roles: ['ADMIN'], branchId: 1 });
const cajero = JSON.stringify({ id: 2, companyId: 1, role: 'CAJERO', roles: ['CAJERO'], branchId: 1 });

function mockPrisma() {
    jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
    jest.spyOn(SettingsScopeService, 'getNumber').mockResolvedValue(0 as never);
    jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.cashMovement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.payrollRun, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.scheduledShift, 'findMany').mockResolvedValue([] as never);
}

describe('BI routes', () => {
    beforeEach(() => { clearBiCache(); mockPrisma(); });
    afterEach(() => { jest.restoreAllMocks(); });

    it('rejects unauthenticated callers and non admin roles with 403', async () => {
        await request(app).get('/api/v1/bi/summary').expect(401);
        for (const route of ['summary', 'trend', 'bridge', 'channels', 'heatmap', 'pareto', 'branches', 'insights']) {
            await request(app).get(`/api/v1/bi/${route}`).set('x-test-user', cajero).expect(403);
        }
        expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('serves every endpoint to an admin', async () => {
        for (const route of ['summary', 'trend?metric=orders', 'bridge', 'channels', 'heatmap', 'pareto?limit=5', 'branches', 'insights']) {
            const res = await request(app).get(`/api/v1/bi/${route}`).set('x-test-user', admin).expect(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        }
    });

    it('returns 400 for an invalid period, compare, metric, limit, branchIds or custom range', async () => {
        const get = (qs: string, path = 'summary') => request(app).get(`/api/v1/bi/${path}${qs}`).set('x-test-user', admin);
        await get('?period=yesterday').expect(400);
        await get('?compare=decade').expect(400);
        await get('?branchIds=1,abc').expect(400);
        await get('?period=custom').expect(400);
        await get('?period=custom&from=2026-02-30&to=2026-03-01').expect(400);
        await get('?period=custom&from=2026-03-10&to=2026-03-01').expect(400);
        await get('?metric=profit', 'trend').expect(400);
        await get('?limit=0', 'pareto').expect(400);
    });

    it('does not query Prisma again for an identical request within 60 s, but does for a different one', async () => {
        const call = (qs: string) => request(app).get(`/api/v1/bi/summary${qs}`).set('x-test-user', admin).expect(200);
        await call('?period=7d&branchIds=2,1');
        const first = (prisma.order.findMany as jest.Mock).mock.calls.length;
        expect(first).toBeGreaterThan(0);
        await call('?branchIds=1,2&period=7d'); // same query, normalised
        expect((prisma.order.findMany as jest.Mock).mock.calls.length).toBe(first);
        await call('?period=30d');
        expect((prisma.order.findMany as jest.Mock).mock.calls.length).toBeGreaterThan(first);
    });

    it('re-queries after the 60 s window expires', async () => {
        const now = jest.spyOn(Date, 'now');
        now.mockReturnValue(1_000_000);
        await request(app).get('/api/v1/bi/summary').set('x-test-user', admin).expect(200);
        const first = (prisma.order.findMany as jest.Mock).mock.calls.length;
        now.mockReturnValue(1_000_000 + 61_000);
        await request(app).get('/api/v1/bi/summary').set('x-test-user', admin).expect(200);
        expect((prisma.order.findMany as jest.Mock).mock.calls.length).toBeGreaterThan(first);
    });

    it('does not cache failures', async () => {
        (prisma.order.findMany as jest.Mock).mockRejectedValueOnce(new Error('db down') as never);
        const res = await request(app).get('/api/v1/bi/summary').set('x-test-user', admin);
        expect(res.status).toBe(500);
        await request(app).get('/api/v1/bi/summary').set('x-test-user', admin).expect(200);
    });
});

describe('BI branch scope', () => {
    const user = (over: Record<string, unknown>) => ({ id: 2, companyId: 1, role: 'CAJERO', roles: ['CAJERO'], ...over }) as never;

    it('a single-branch user asking for another branch gets a 403 (BranchScopeError), never mixed data', () => {
        expect(() => resolveBiBranchIds(user({ branchId: 1 }), [2])).toThrow(/otra sucursal/);
        expect(() => resolveBiBranchIds(user({ branchId: 1 }), [1, 2])).toThrow();
        expect(resolveBiBranchIds(user({ branchId: 1 }), [])).toEqual([1]);
        expect(resolveBiBranchIds(user({ branchId: 1 }), [1])).toEqual([1]);
        expect(() => resolveBiBranchIds(user({ branchId: null }), [])).toThrow();
    });

    it('company-wide admins keep the requested branches (empty = all)', () => {
        const adminUser = user({ role: 'ADMIN', roles: ['ADMIN'], branchId: 1 });
        expect(resolveBiBranchIds(adminUser, [])).toEqual([]);
        expect(resolveBiBranchIds(adminUser, [2, 3])).toEqual([2, 3]);
    });

    it('the controller answers 403 to a scoped user outside their branch even if the role guard were bypassed', async () => {
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const req = { query: { branchIds: '2' }, user: user({ branchId: 1 }) } as never;
        await BiController.summary(req, { status, json } as never, jest.fn());
        expect(status).toHaveBeenCalledWith(403);
        expect(parseBiQuery({ query: {}, user: user({ branchId: 1 }) } as never).branchIds).toEqual([1]);
    });
});
