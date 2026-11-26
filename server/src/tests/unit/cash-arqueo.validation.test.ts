import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { validate } from '../../middlewares/validate';
import { cashCount, closeShift } from '../../middlewares/validate-schemas';
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

    it('does not allow the arqueo close contract to omit its physical breakdown', () => {
        const req = {
            params: { shiftId: '4' },
            body: { endAmount: 100 }
        } as unknown as Request;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;

        validate(closeShift)(req, { status, json } as unknown as Response, next);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({
            errors: expect.arrayContaining([
                expect.objectContaining({ field: 'body.bills' }),
                expect.objectContaining({ field: 'body.coins' })
            ])
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects a non-finite closing amount before any database access', async () => {
        await expect(CashArqueoService.closeShiftWithArqueo(4, 1, Number.NaN, ['ADMIN'], 9))
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

    it('rejects a declared total that does not match the physical denominations', async () => {
        const findShift = jest.spyOn(prisma.cashShift, 'findFirst');

        await expect(CashArqueoService.previewClose(4, 1, {
            endAmount: 100,
            bills: [{ denomination: 10, count: 1 }],
            coins: []
        })).rejects.toThrow(/no coincide con el total de denominaciones/i);

        expect(findShift).not.toHaveBeenCalled();
    });

    it('persists the closing actor, the real override flag and the historical USD rate', async () => {
        const update = jest.fn(async (args: { data: Record<string, unknown> }) => ({
            id: 4,
            ...args.data
        }));
        const tx = {
            $queryRaw: jest.fn(async () => []),
            cashShift: {
                findFirst: jest.fn(async () => ({
                    id: 4,
                    endDate: null,
                    startAmount: 100,
                    movements: []
                })),
                update
            },
            cashCount: {
                deleteMany: jest.fn(async () => ({ count: 0 })),
                createMany: jest.fn(async (_args: unknown) => ({ count: 1 }))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        jest.spyOn(CashArqueoService, 'previewClose').mockResolvedValue({
            expectedAmount: 100,
            countedAmount: 370,
            countedBreakdown: {
                bills: 0,
                coins: 0,
                usdBills: 10,
                usdInCordobas: 370,
                exchangeRate: 37
            },
            notes: 'Override autorizado',
            difference: 270,
            absoluteDifference: 270,
            status: 'SOBRANTE',
            withinTolerance: false,
            requiresNote: false,
            exceedsTolerance: true,
            tolerance: 1
        });
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$');

        await CashArqueoService.closeShiftWithArqueo(
            4,
            1,
            370,
            ['ADMIN'],
            9,
            'Override autorizado',
            { usdBills: [{ denomination: 10, count: 1 }], exchangeRate: 37 },
            { forceClose: true }
        );

        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                endAmount: 370,
                closedById: 9,
                forceClosed: true,
                closingExchangeRate: 37
            })
        }));
        expect(tx.cashCount.createMany).toHaveBeenCalledWith({
            data: [{ denomination: 10, count: 1, type: 'USD_BILL', shiftId: 4 }]
        });
    });
});
