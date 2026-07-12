import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { AuthController } from '../../controllers/auth.controller';
import { SessionService } from '../../services/session.service';

describe('AuthController.logout', () => {
    it('revokes the presented session and clears the auth cookie', async () => {
        const revoke = jest.spyOn(SessionService, 'revokeByToken').mockResolvedValue({ count: 1 } as never);
        const clearCookie = jest.fn();
        const json = jest.fn();
        const req = { headers: { authorization: 'Bearer current-token' } } as Request;
        const res = { clearCookie, json } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;

        await AuthController.logout(req, res, next);

        expect(revoke).toHaveBeenCalledWith('current-token');
        expect(clearCookie).toHaveBeenCalledWith('auth_token', { path: '/' });
        expect(json).toHaveBeenCalledWith({ success: true, message: 'Sesión cerrada' });
        expect(next).not.toHaveBeenCalled();
    });
});
