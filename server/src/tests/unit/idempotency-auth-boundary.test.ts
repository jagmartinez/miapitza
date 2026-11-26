import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import type { NextFunction, Request, Response } from 'express';
import {
    idempotency,
    resolveIdempotencyNamespace,
} from '../../middlewares/idempotency';

function authenticatedRequest(userId: number, roles: string[] = ['ADMIN']): Request {
    return {
        headers: {
            authorization: 'Bearer current-session-token',
            'x-idempotency-key': 'operation-1',
        },
        method: 'POST',
        originalUrl: '/api/payments',
        body: { amount: 10 },
        authContextValidated: true,
        user: {
            userId,
            companyId: 7,
            branchId: 3,
            role: roles[0],
            roles,
            timezone: 'America/Managua',
            permissions: ['payments.create'],
            accountType: 'INTERNAL',
        },
    } as unknown as Request;
}

describe('idempotency authentication boundary', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('labels an in-flight duplicate with IDEMPOTENCY_IN_PROGRESS so clients retry it', async () => {
        const req = authenticatedRequest(10);
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ amount: 10 })).digest('hex');
        jest.spyOn(prisma.idempotencyRecord, 'create').mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }) as never,
        );
        jest.spyOn(prisma.idempotencyRecord, 'findUnique').mockResolvedValue({
            id: 1, fingerprint, status: 'PROCESSING', httpStatus: null, response: null,
            expiresAt: new Date(Date.now() + 60_000),
        } as never);
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;

        await idempotency(req, res, next);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'IDEMPOTENCY_IN_PROGRESS' }));
        expect(next).not.toHaveBeenCalled();
    });

    it('binds replay records to the authoritative user and authorization context', () => {
        const first = resolveIdempotencyNamespace(authenticatedRequest(10));
        const anotherUser = resolveIdempotencyNamespace(authenticatedRequest(11));
        const changedRoles = resolveIdempotencyNamespace(authenticatedRequest(10, ['CAJERO']));

        expect(first).toMatch(/^s:[a-f0-9]{60}$/);
        expect(anotherUser).not.toBe(first);
        expect(changedRoles).not.toBe(first);
        expect(first).not.toContain('current-session-token');
    });

    it.each([
        [{ 'x-api-key': 'opaque-api-key', 'x-idempotency-key': 'same-key' }],
        [{ 'x-webhook-signature': 'opaque-signature', 'x-idempotency-key': 'same-key' }],
    ])('does not replay a completed record before non-JWT route auth (%o)', async (headers) => {
        const next = jest.fn() as unknown as NextFunction;
        const req = {
            headers,
            method: 'POST',
            originalUrl: '/api/integration',
            body: {},
        } as unknown as Request;
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

        await idempotency(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.json).not.toHaveBeenCalled();
    });

    it('mounts authoritative pre-authentication before the replay middleware', () => {
        const appSource = fs.readFileSync(path.resolve(__dirname, '../../app.ts'), 'utf8');
        expect(appSource.indexOf("app.use('/api', preAuthenticateIdempotentRequest)"))
            .toBeLessThan(appSource.indexOf("app.use('/api', idempotency)"));
    });
});
