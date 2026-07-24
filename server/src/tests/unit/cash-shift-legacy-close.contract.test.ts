import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { CashShiftController } from '../../controllers/cash-shift.controller';
import prisma from '../../utils/prisma';

describe('legacy cash-shift close contract', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns 410 with the physical-arqueo successor and performs no persistence', async () => {
        const transaction = jest.spyOn(prisma, '$transaction');
        const setHeader = jest.fn();
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;
        const req = {
            params: { id: '44' },
            body: { closingBalance: 1250 }
        } as unknown as Request;
        const res = { setHeader, status, json } as unknown as Response;

        await CashShiftController.close(req, res, next);

        expect(setHeader).toHaveBeenCalledWith('Deprecation', 'true');
        expect(setHeader).toHaveBeenCalledWith(
            'Link',
            '</api/cash-arqueo/44/close>; rel="successor-version"'
        );
        expect(status).toHaveBeenCalledWith(410);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            message: expect.stringMatching(/denominaciones/i)
        }));
        expect(transaction).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
