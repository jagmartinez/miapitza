import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { AuthController } from '../../controllers/auth.controller';
import { SessionService } from '../../services/session.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('AuthController remote session revocation', () => {
    it('keeps the current cookie/session while revoking every other session', async () => {
        const revoke = jest.spyOn(SessionService, 'revokeAllExcept').mockResolvedValue({ count: 2 } as never);
        const req = {
            user: { userId: 7 },
            headers: { authorization: 'Bearer current-token' }
        } as unknown as Request;
        const res = {
            clearCookie: jest.fn(),
            json: jest.fn()
        } as unknown as Response;
        const next = jest.fn() as NextFunction;

        await AuthController.revokeAllSessions(req, res, next);

        expect(revoke).toHaveBeenCalledWith(7, 'current-token');
        expect(res.clearCookie).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Otras sesiones cerradas' });
        expect(next).not.toHaveBeenCalled();
    });
});
