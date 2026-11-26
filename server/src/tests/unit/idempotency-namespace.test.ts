import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import type { NextFunction, Request, Response } from 'express';
import { idempotency, resolveIdempotencyNamespace } from '../../middlewares/idempotency';

function req(userId: number, token: string, body: unknown = { amount: 10 }, companyId = 7): Request {
    return {
        headers: { authorization: `Bearer ${token}`, 'x-idempotency-key': 'op-1' },
        method: 'POST',
        originalUrl: '/api/payments',
        body,
        authContextValidated: true,
        user: {
            userId, companyId, branchId: 3, role: 'MESERO', roles: ['MESERO'],
            timezone: 'America/Managua', permissions: ['orders.create'], accountType: 'INTERNAL',
        },
    } as unknown as Request;
}

function fakeRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
}

describe('idempotency namespace is per user, not per token', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('same user with a new token gets the same namespace', () => {
        expect(resolveIdempotencyNamespace(req(10, 'token-A')))
            .toBe(resolveIdempotencyNamespace(req(10, 'token-B')));
    });

    it('different user or company gets an independent namespace', () => {
        const base = resolveIdempotencyNamespace(req(10, 'token-A'));
        expect(resolveIdempotencyNamespace(req(11, 'token-A'))).not.toBe(base);
        expect(resolveIdempotencyNamespace(req(10, 'token-A', undefined, 8))).not.toBe(base);
    });

    it('same user, new token, same key and body replays the stored response', async () => {
        const stored = { success: true, data: { id: 99 } };
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ amount: 10 })).digest('hex');
        const create = jest.spyOn(prisma.idempotencyRecord, 'create').mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }) as never,
        );
        const findUnique = jest.spyOn(prisma.idempotencyRecord, 'findUnique').mockResolvedValue({
            id: 1, fingerprint, status: 'COMPLETED', httpStatus: 201, response: stored,
            expiresAt: new Date(Date.now() + 60_000),
        } as never);

        await idempotency(req(10, 'token-A'), fakeRes(), jest.fn() as unknown as NextFunction);
        const res = fakeRes();
        const next = jest.fn() as unknown as NextFunction;
        await idempotency(req(10, 'token-B'), res, next);

        const nsA = (create.mock.calls[0][0] as any).data.namespace;
        const nsB = (create.mock.calls[1][0] as any).data.namespace;
        expect(nsB).toBe(nsA);
        expect((findUnique.mock.calls[1][0] as any).where.namespace_scope_key.namespace).toBe(nsA);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(stored);
        expect(next).not.toHaveBeenCalled();
    });

    it('same key with a different body still returns 409 IDEMPOTENCY_MISMATCH', async () => {
        jest.spyOn(prisma.idempotencyRecord, 'create').mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }) as never,
        );
        jest.spyOn(prisma.idempotencyRecord, 'findUnique').mockResolvedValue({
            id: 1, fingerprint: 'other', status: 'COMPLETED', httpStatus: 201, response: {},
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        const res = fakeRes();
        await idempotency(req(10, 'token-B', { amount: 11 }), res, jest.fn() as unknown as NextFunction);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'IDEMPOTENCY_MISMATCH' }));
    });
});
