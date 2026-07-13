import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../../utils/prisma';
import { RoleService } from '../../services/role.service';
import { TwoFactorService } from '../../services/twoFactor.service';
import { UserService } from '../../services/user.service';
import { SessionService } from '../../services/session.service';
import { WebSocketService } from '../../services/websocket.service';
import { auth } from '../../middlewares/auth';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('red-team privilege boundaries', () => {
    it('prevents an ADMIN from renaming an assigned role to SUPERADMIN', async () => {
        jest.spyOn(prisma.role, 'findFirst').mockResolvedValue({ id: 8, name: 'OPERADOR' } as never);
        const update = jest.spyOn(prisma.role, 'update');

        await expect(RoleService.update(8, 3, { name: 'SUPERADMIN' }, undefined, ['ADMIN']))
            .rejects.toThrow(/SUPERADMIN/);

        expect(update).not.toHaveBeenCalled();
    });

    it('prevents an ADMIN from resetting or deactivating a SUPERADMIN', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 9,
            role: { name: 'SUPERADMIN' },
            userRoles: []
        } as never);

        await expect(UserService.update(9, 3, { status: 'INACTIVE' }, ['ADMIN']))
            .rejects.toThrow(/SUPERADMIN/);
    });

    it('cannot remove the active branch from a user permitted-branch set', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 9,
            branchId: 10,
            role: { name: 'ADMIN' },
            userRoles: [],
            allowedBranches: [{ branch: { id: 10 } }]
        } as never);
        jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([{ id: 11 }] as never);

        await expect(UserService.update(9, 3, { branchIds: [11] }, ['SUPERADMIN']))
            .rejects.toThrow(/sucursal activa/i);
    });
});

describe('red-team 2FA state transitions', () => {
    it('does not let an authenticated session overwrite an already-enabled 2FA secret', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            username: 'admin',
            twoFactorEnabled: true,
            company: { name: 'Restaurant' }
        } as never);
        const update = jest.spyOn(prisma.user, 'update');

        await expect(TwoFactorService.setup(4)).rejects.toThrow(/ya est/i);
        expect(update).not.toHaveBeenCalled();
    });

    it('consumes a recovery code with compare-and-swap so a racing replay loses', async () => {
        const stored = ['$2a$12$one'];
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            twoFactorRecoveryCodes: stored,
            companyId: 2
        } as never);
        jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
        jest.spyOn(prisma.user, 'updateMany')
            .mockResolvedValueOnce({ count: 1 } as never)
            .mockResolvedValueOnce({ count: 0 } as never);
        jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 1 } as never);

        const results = await Promise.all([
            TwoFactorService.validateRecoveryCode(4, 'abcd-1234'),
            TwoFactorService.validateRecoveryCode(4, 'abcd-1234')
        ]);

        expect(results.sort()).toEqual([false, true]);
    });
});

describe('red-team session enforcement', () => {
    it('enforces mustChangePassword on the server instead of trusting the SPA flag', async () => {
        jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 5 } as never);
        jest.spyOn(SessionService, 'isValid').mockResolvedValue(true);
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            id: 5,
            branchId: 2,
            companyId: 3,
            role: { name: 'ADMIN' },
            userRoles: [],
            status: 'ACTIVE',
            mustChangePassword: true,
            passwordChangedAt: null,
            company: { active: true },
            branch: { status: 'ACTIVE' },
            allowedBranches: []
        } as never);
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const req = {
            headers: { authorization: 'Bearer tracked-token' },
            originalUrl: '/api/orders'
        } as unknown as Request;
        const res = { status, json } as unknown as Response;
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        const oldSecret = process.env.JWT_SECRET;
        process.env.JWT_SECRET = 'red-team-test-secret';
        try {
            await auth(req, res, next);
        } finally {
            if (oldSecret === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = oldSecret;
        }

        expect(status).toHaveBeenCalledWith(403);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
        expect(next).not.toHaveBeenCalled();
    });

    it('drops a long-lived socket after its tracked session is revoked', async () => {
        jest.spyOn(SessionService, 'isHashValid').mockResolvedValue(false);
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            id: 5,
            branchId: 2,
            companyId: 3,
            role: { name: 'ADMIN' },
            userRoles: [],
            status: 'ACTIVE',
            mustChangePassword: false,
            company: { active: true },
            branch: { status: 'ACTIVE' },
            allowedBranches: []
        } as never);
        const revalidate = (WebSocketService as unknown as {
            revalidateClient(client: Record<string, unknown>): Promise<boolean>;
        }).revalidateClient.bind(WebSocketService);

        await expect(revalidate({ userId: 5, sessionTokenHash: 'hash' })).resolves.toBe(false);
    });
});
