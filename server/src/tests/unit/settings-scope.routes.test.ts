import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { SettingController } from '../../controllers/setting.controller';
import { SettingConflictError, SettingsScopeService, SettingValidationError } from '../../services/settings-scope.service';

afterEach(() => { jest.restoreAllMocks(); });

function makeRes() {
    const res = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(b: unknown) { this.body = b; return this; } };
    return res;
}

function makeReq(over: Record<string, unknown> = {}) {
    return { user: { userId: 9, companyId: 1, role: 'ADMIN', roles: ['ADMIN'], branchId: 3 }, query: {}, body: {}, ...over } as unknown as Request;
}

async function call(fn: (r: Request, s: Response, n: NextFunction) => Promise<unknown>, req: Request) {
    const res = makeRes();
    const next = jest.fn();
    await fn(req, res as unknown as Response, next as unknown as NextFunction);
    return { res, next };
}

describe('settings routes contract', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/setting.routes.ts'), 'utf8');
    it('exposes scoped endpoints and restricts PATCH to admins', () => {
        expect(routes).toContain("router.get('/registry'");
        expect(routes).toContain("router.get('/resolved'");
        expect(routes).toContain("router.get('/history'");
        expect(routes).toMatch(/router\.patch\('\/resolved', requireRole\(\.\.\.ADMINS\)/);
        expect(routes).toContain("router.put('/', requireRole(...ADMINS)");
    });
});

describe('SettingController scoped API', () => {
    it('returns registry with sections and definitions', async () => {
        const { res } = await call(SettingController.getRegistry as never, makeReq());
        const data = (res.body as { data: { sections: unknown[]; definitions: unknown[] } }).data;
        expect(data.sections.length).toBeGreaterThan(0);
        expect(data.definitions.length).toBeGreaterThan(0);
    });

    it('404s a branch from another company without touching the service', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue(null as never);
        const resolve = jest.spyOn(SettingsScopeService, 'resolveWithVersion');
        const { next } = await call(SettingController.getResolved, makeReq({ query: { branchId: '77' } }));
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
        expect(resolve).not.toHaveBeenCalled();
    });

    it('403s a non company-wide user asking for another branch of the same company', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 8 } as never);
        const { next } = await call(SettingController.getResolved, makeReq({ query: { branchId: '8' } }));
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });

    it('resolves company scope without a branch', async () => {
        jest.spyOn(SettingsScopeService, 'resolveWithVersion').mockResolvedValue({ values: {}, version: 'v1' } as never);
        const { res } = await call(SettingController.getResolved, makeReq());
        expect(res.body).toEqual({ success: true, data: { values: {}, version: 'v1' } });
    });

    it('maps validation errors to 400 with per-key errors', async () => {
        jest.spyOn(SettingsScopeService, 'update').mockRejectedValue(new SettingValidationError({ tax_rate: 'inválido' }));
        const { res } = await call(SettingController.patchResolved, makeReq({ body: { branchId: null, version: 'v', changes: { tax_rate: '1,5' } } }));
        expect(res.statusCode).toBe(400);
        expect((res.body as { errors: unknown }).errors).toEqual({ tax_rate: 'inválido' });
    });

    it('maps a stale version to 409', async () => {
        jest.spyOn(SettingsScopeService, 'update').mockRejectedValue(new SettingConflictError());
        const { res } = await call(SettingController.patchResolved, makeReq({ body: { branchId: null, version: 'old', changes: { tax_rate: 16 } } }));
        expect(res.statusCode).toBe(409);
    });

    it('saves and returns values with the new version', async () => {
        const update = jest.spyOn(SettingsScopeService, 'update').mockResolvedValue({ resolved: {}, version: 'v2' } as never);
        const { res } = await call(SettingController.patchResolved, makeReq({ body: { branchId: null, version: 'v1', changes: { tax_rate: 16 } } }));
        expect(update).toHaveBeenCalledWith(1, null, 9, { tax_rate: 16 }, 'v1');
        expect(res.body).toEqual({ success: true, data: { values: {}, version: 'v2' } });
    });
});
