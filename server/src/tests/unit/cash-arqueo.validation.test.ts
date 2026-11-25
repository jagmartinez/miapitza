import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { validate } from '../../middlewares/validate';
import { cashCount } from '../../middlewares/validate-schemas';
import { CashArqueoService } from '../../services/cash-arqueo.service';
import { SettingService } from '../../services/setting.service';
import prisma from '../../utils/prisma';

describe('cash arqueo validation', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

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

    it('rejects USD bills without a positive exchange rate (no silent zero valuation)', async () => {
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({
            id: 4,
            companyId: 1,
            startAmount: 100,
            endAmount: null,
            endDate: null,
            startDate: new Date(),
            cashRegister: { id: 1, name: 'Caja' },
            user: { id: 1, name: 'Cajero' },
            movements: []
        } as never);
        jest.spyOn(prisma.cashCount, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1);

        await expect(CashArqueoService.previewClose(4, 1, {
            endAmount: 100,
            usdBills: [{ denomination: 20, count: 1 }],
            exchangeRate: 0
        })).rejects.toThrow(/tasa de cambio/i);
    });
});
