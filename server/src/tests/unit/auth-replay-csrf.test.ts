import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { generate, generateSecret } from 'otplib';
import prisma from '../../utils/prisma';
import { TwoFactorService } from '../../services/twoFactor.service';
import { csrfProtection } from '../../middlewares/csrf';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('TOTP replay protection', () => {
    // Simulates the shared User row every replica reads and conditionally updates.
    function mockSharedUserRow(secret: string) {
        const row: { twoFactorSecret: string; twoFactorLastTimeStep: number | null } = {
            twoFactorSecret: secret,
            twoFactorLastTimeStep: null,
        };
        jest.spyOn(prisma.user, 'findUnique').mockImplementation((async () => ({ ...row })) as never);
        const updateMany = jest.spyOn(prisma.user, 'updateMany').mockImplementation((async (args: {
            where: { OR: Array<{ twoFactorLastTimeStep: null | { lt: number } }> };
            data: { twoFactorLastTimeStep: number };
        }) => {
            const lt = (args.where.OR[1].twoFactorLastTimeStep as { lt: number }).lt;
            if (row.twoFactorLastTimeStep === null || row.twoFactorLastTimeStep < lt) {
                row.twoFactorLastTimeStep = args.data.twoFactorLastTimeStep;
                return { count: 1 };
            }
            return { count: 0 };
        }) as never);
        return { row, updateMany };
    }

    it('accepts a login TOTP code once and rejects its replay', async () => {
        const secret = generateSecret();
        const { row } = mockSharedUserRow(secret);
        const token = await generate({ secret });

        await expect(TwoFactorService.validateCode(7, token)).resolves.toBe(true);
        expect(row.twoFactorLastTimeStep).toEqual(expect.any(Number));
        await expect(TwoFactorService.validateCode(7, token)).resolves.toBe(false);
    });

    it('rejects a replay that reaches another replica after the step was persisted', async () => {
        const secret = generateSecret();
        const token = await generate({ secret });
        const { row } = mockSharedUserRow(secret);
        // Another replica already accepted this time step.
        row.twoFactorLastTimeStep = Math.floor(Date.now() / 30_000);

        await expect(TwoFactorService.validateCode(7, token)).resolves.toBe(false);
    });

    it('lets only one of two concurrent requests with the same code succeed', async () => {
        const secret = generateSecret();
        mockSharedUserRow(secret);
        const token = await generate({ secret });

        const results = await Promise.all([
            TwoFactorService.validateCode(7, token),
            TwoFactorService.validateCode(7, token),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
    });
});

describe('csrfProtection', () => {
    it('does not exempt cookie-authenticated writes that merely send x-api-key', () => {
        const req = {
            method: 'POST',
            path: '/orders',
            headers: { 'x-api-key': 'anything', cookie: 'csrf_token=abc; auth_token=jwt' },
        } as unknown as Request;
        const json = jest.fn();
        const res = {
            cookie: jest.fn(),
            setHeader: jest.fn(),
            status: jest.fn(() => ({ json })),
        } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
