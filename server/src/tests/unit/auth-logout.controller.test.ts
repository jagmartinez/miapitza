import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { AuthController } from '../../controllers/auth.controller';
import { SessionService } from '../../services/session.service';
import { AuditLogService } from '../../services/audit-log.service';
import prisma from '../../utils/prisma';

describe('AuthController.logout', () => {
    it('revokes the presented session and clears the auth cookie', async () => {
        const revoke = jest.spyOn(SessionService, 'revokeByToken').mockResolvedValue({ count: 1 } as never);
        const audit = jest.spyOn(AuditLogService, 'log').mockResolvedValue({ id: 1 } as never);
        const transactionClient = {} as never;
        jest.spyOn(prisma, '$transaction').mockImplementation(
            async (callback: unknown) => (callback as (tx: unknown) => Promise<unknown>)(transactionClient),
        );
        const clearCookie = jest.fn();
        const json = jest.fn();
        const req = {
            headers: { authorization: 'Bearer current-token' },
            user: { userId: 9, companyId: 3 },
        } as Request;
        const res = { clearCookie, json } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;

        await AuthController.logout(req, res, next);

        expect(revoke).toHaveBeenCalledWith('current-token', transactionClient);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            companyId: 3,
            userId: 9,
            action: 'LOGOUT',
        }), transactionClient);
        expect(clearCookie).toHaveBeenCalledWith('auth_token', { path: '/' });
        expect(json).toHaveBeenCalledWith({ success: true, message: 'Sesión cerrada' });
        expect(next).not.toHaveBeenCalled();
    });
});
