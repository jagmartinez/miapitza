import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { invalidatePermissionCache, requirePermission } from '../../middlewares/auth';
import prisma from '../../utils/prisma';

function requestFor(role = 'ADMIN') {
    return {
        user: { userId: 17, companyId: 4, role, roles: [role], timezone: 'America/Managua' },
    } as Request;
}

function responseWithStatus() {
    const json = jest.fn();
    const status = jest.fn((_statusCode: number) => ({ json }));
    return { response: { status } as unknown as Response, status };
}

describe('requirePermission authoritative catalog behavior', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        invalidatePermissionCache();
    });

    it('denies a fallback role after a catalogued permission is revoked', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            role: { permissions: [] }, userRoles: [],
        } as never);
        jest.spyOn(prisma.permission, 'findUnique').mockResolvedValue({ id: 9 } as never);
        const { response, status } = responseWithStatus();
        const next = jest.fn() as NextFunction;

        await requirePermission('payments.reverse', 'ADMIN')(requestFor(), response, next);

        expect(next).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(403);
    });

    it('allows the explicit grant regardless of fallback roles', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            role: { permissions: [{ name: 'payments.reverse' }] }, userRoles: [],
        } as never);
        jest.spyOn(prisma.permission, 'findUnique').mockResolvedValue({ id: 9 } as never);
        const { response, status } = responseWithStatus();
        const next = jest.fn() as NextFunction;

        await requirePermission('payments.reverse', 'SUPERADMIN')(requestFor('ADMIN'), response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(status).not.toHaveBeenCalled();
    });

    it('uses the role fallback only when a legacy database lacks the definition', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            role: { permissions: [] }, userRoles: [],
        } as never);
        jest.spyOn(prisma.permission, 'findUnique').mockResolvedValue(null);
        const { response, status } = responseWithStatus();
        const next = jest.fn() as NextFunction;

        await requirePermission('future.permission', 'ADMIN')(requestFor(), response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(status).not.toHaveBeenCalled();
    });
});
