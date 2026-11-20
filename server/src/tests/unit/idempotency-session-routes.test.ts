import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

const authMock = jest.fn();
jest.mock('../../middlewares/auth', () => ({ auth: (...a: unknown[]) => authMock(...a) }));

const prisma = require('../../utils/prisma').default as typeof import('../../utils/prisma').default;
const { idempotency, isSessionAuthPath, isCredentialBearingPath, preAuthenticateIdempotentRequest } = require('../../middlewares/idempotency') as typeof import('../../middlewares/idempotency');

function mk(url: string): Request {
    return {
        headers: { authorization: 'Bearer stale-or-valid', 'x-idempotency-key': 'k1' },
        method: 'POST', originalUrl: url, body: {}, authContextValidated: true,
        user: { userId: 1, companyId: 1, branchId: 1, role: 'MESERO', roles: ['MESERO'], permissions: [], accountType: 'INTERNAL' },
    } as unknown as Request;
}

describe('session-issuing auth routes bypass idempotency', () => {
    it.each([
        '/api/auth/login', '/api/auth/pin-login', '/api/auth/device-login', '/api/auth/logout',
        '/api/auth/change-password', '/api/auth/sessions', '/api/auth/sessions/abc',
        '/api/auth/PIN-LOGIN/', '/api/v1/auth/pin-login', '/api//auth/device-login?x=1',
    ])('%s is excluded', (url) => { expect(isSessionAuthPath(url)).toBe(true); });

    it('does not exclude ordinary routes', () => {
        expect(isSessionAuthPath('/api/orders')).toBe(false);
        expect(isSessionAuthPath('/api/auth/me/pin')).toBe(false);
    });

    it('device-login with a stale Bearer is not rejected by pre-auth', () => {
        authMock.mockClear();
        const next = jest.fn() as unknown as NextFunction;
        preAuthenticateIdempotentRequest(mk('/api/auth/device-login'), {} as Response, next);
        expect(authMock).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('pre-auth still runs for ordinary routes', () => {
        authMock.mockClear();
        preAuthenticateIdempotentRequest(mk('/api/orders'), {} as Response, jest.fn() as unknown as NextFunction);
        expect(authMock).toHaveBeenCalledTimes(1);
    });

    it.each(['/api/auth/pin-login', '/api/auth/PIN-LOGIN/'])('%s is never stored nor replayed', async (url) => {
        const create = jest.spyOn(prisma.idempotencyRecord, 'create');
        const find = jest.spyOn(prisma.idempotencyRecord, 'findUnique');
        const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;
        await idempotency(mk(url), res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(create).not.toHaveBeenCalled();
        expect(find).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });
});

describe('credential-bearing routes bypass idempotency storage and replay', () => {
    it.each([
        '/api/orders/12/discount/authorize', '/api/v1/orders/12/discount/authorize/',
        '/api/ORDERS/12/Discount/Authorize?x=1', '/api/auth/me/pin', '/api//auth/ME/pin/',
    ])('%s is credential-bearing', (url) => { expect(isCredentialBearingPath(url)).toBe(true); });

    it('ordinary routes are not credential-bearing', () => {
        expect(isCredentialBearingPath('/api/orders/12/pricing')).toBe(false);
        expect(isCredentialBearingPath('/api/orders/12/discount/supervisors')).toBe(false);
    });

    it.each(['/api/orders/12/discount/authorize', '/api/auth/me/pin'])('%s gets no stored row and no replay', async (url) => {
        const create = jest.spyOn(prisma.idempotencyRecord, 'create');
        const find = jest.spyOn(prisma.idempotencyRecord, 'findUnique');
        create.mockClear(); find.mockClear();
        const res = { status: jest.fn(), json: jest.fn(), on: jest.fn() } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;
        await idempotency(mk(url), res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(create).not.toHaveBeenCalled();
        expect(find).not.toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
