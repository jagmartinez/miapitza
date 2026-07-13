import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { validate } from '../../middlewares/validate';
import { cashCount } from '../../middlewares/validate-schemas';
import { CashArqueoService } from '../../services/cash-arqueo.service';

describe('cash arqueo validation', () => {
    it('accepts bill and coin arrays used by the arqueo service', () => {
        const req = {
            params: { shiftId: '4' },
            body: {
                bills: [{ denomination: 100, count: 2 }],
                coins: [{ denomination: 5, count: 3 }]
            }
        } as unknown as Request;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;

        validate(cashCount)(req, { status, json } as unknown as Response, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(status).not.toHaveBeenCalled();
    });

    it('rejects a non-finite closing amount before any database access', async () => {
        await expect(CashArqueoService.closeShiftWithArqueo(4, 1, Number.NaN, ['ADMIN']))
            .rejects.toThrow(/número finito/i);
    });
});
