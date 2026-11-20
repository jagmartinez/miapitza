import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.doMock('../../middlewares/auth', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = JSON.parse(String(req.headers['x-test-user']));
        next();
    },
    requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
        const userRoles = req.user.roles || [req.user.role];
        return userRoles.some((r: string) => roles.includes(r))
            ? next()
            : res.status(403).json({ success: false, message: 'Insufficient permissions' });
    },
    requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const prisma = require('../../utils/prisma').default;
const { errorHandler } = require('../../middlewares/errorHandler');
const shiftRouter = require('../../routes/cash-shift.routes').default;
const arqueoRouter = require('../../routes/cash-arqueo.routes').default;
const { SettingService, DEFAULT_COMPANY_SETTINGS, WRITABLE_SETTING_KEYS } = require('../../services/setting.service');
/* eslint-enable @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json());
app.use('/cash-shifts', shiftRouter);
app.use('/cash-arqueo', arqueoRouter);
app.use(errorHandler);

const cajero = { userId: 7, companyId: 5, role: 'CAJERO', roles: ['CAJERO'], branchId: 1 };
const mesero = { userId: 8, companyId: 5, role: 'MESERO', roles: ['MESERO'], branchId: 1 };
const as = (u: object) => JSON.stringify(u);

afterEach(() => {
    jest.restoreAllMocks();
});

describe('exchange_rate_usd setting', () => {
    it('exchange_rate_usd defaults to 36.5 and rejects 0 and negative', async () => {
        expect(DEFAULT_COMPANY_SETTINGS.exchange_rate_usd).toBe('36.5');
        expect(WRITABLE_SETTING_KEYS.has('exchange_rate_usd')).toBe(true);
        const tx = jest.spyOn(prisma, '$transaction');
        for (const bad of ['0', '-1', 'abc', '', 'Infinity']) {
            await expect(SettingService.update(5, { exchange_rate_usd: bad })).rejects.toThrow(/tipo de cambio/i);
        }
        expect(tx).not.toHaveBeenCalled();
    });

    it('accepts a positive finite rate', async () => {
        jest.spyOn(prisma, '$transaction').mockResolvedValue(undefined as never);
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({ exchange_rate_usd: '36.6' } as never);
        await expect(SettingService.update(5, { exchange_rate_usd: '36.6' })).resolves.toBeDefined();
    });

    it('cash-settings gives CASHIERS the rate and tolerance with defaults, and refuses other roles', async () => {
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({} as never);
        const res = await request(app).get('/cash-shifts/cash-settings').set('x-test-user', as(cajero)).expect(200);
        expect(res.body.data).toEqual({ exchangeRateUsd: 36.5, tolerance: 1 });

        jest.spyOn(SettingService, 'getAll').mockResolvedValue({
            exchange_rate_usd: '37.2', cash_reconciliation_tolerance: '2.5',
        } as never);
        const custom = await request(app).get('/cash-shifts/cash-settings').set('x-test-user', as(cajero)).expect(200);
        expect(custom.body.data).toEqual({ exchangeRateUsd: 37.2, tolerance: 2.5 });

        await request(app).get('/cash-shifts/cash-settings').set('x-test-user', as(mesero)).expect(403);
    });

    it('an invalid stored rate falls back to the default', async () => {
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({ exchange_rate_usd: '0' } as never);
        await expect(SettingService.getExchangeRateUsd(5)).resolves.toBe(36.5);
    });
});

describe('suggested float', () => {
    const registerLookup = () => jest.spyOn(prisma.cashRegister, 'findFirst')
        .mockResolvedValue({ id: 3, branchId: 1 } as never);

    it('suggested float is the last closed endAmount of that register only', async () => {
        registerLookup();
        const find = jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({ id: 41, endAmount: 1234.5 } as never);
        const res = await request(app).get('/cash-shifts/suggested-float?cashRegisterId=3')
            .set('x-test-user', as(cajero)).expect(200);
        expect(res.body.data).toEqual({ suggested: 1234.5, fromShiftId: 41 });
        const arg: any = find.mock.calls[0][0];
        expect(arg.where).toMatchObject({
            companyId: 5,
            cashRegisterId: 3,
            endDate: { not: null },
            cashRegister: { branchId: 1 },
        });
        expect(arg.orderBy).toEqual({ endDate: 'desc' });
    });

    it('suggested float is null when the register never closed', async () => {
        registerLookup();
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue(null as never);
        const res = await request(app).get('/cash-shifts/suggested-float?cashRegisterId=3')
            .set('x-test-user', as(cajero)).expect(200);
        expect(res.body.data).toEqual({ suggested: null, fromShiftId: null });
    });

    it('requires cashRegisterId, a register of the company, branch access and a cashier role', async () => {
        await request(app).get('/cash-shifts/suggested-float').set('x-test-user', as(cajero)).expect(400);
        jest.spyOn(prisma.cashRegister, 'findFirst').mockResolvedValue(null as never);
        await request(app).get('/cash-shifts/suggested-float?cashRegisterId=9').set('x-test-user', as(cajero)).expect(404);
        jest.spyOn(prisma.cashRegister, 'findFirst').mockResolvedValue({ id: 3, branchId: 2 } as never);
        await request(app).get('/cash-shifts/suggested-float?cashRegisterId=3').set('x-test-user', as(cajero)).expect(403);
        await request(app).get('/cash-shifts/suggested-float?cashRegisterId=3').set('x-test-user', as(mesero)).expect(403);
    });
});

describe('report header', () => {
    it('report header carries company RUC and branch', async () => {
        jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) => {
            if (args?.select?.cashRegister?.select?.branchId) return { cashRegister: { branchId: 1 } };
            if (args?.select?.cashRegister?.select?.branch) {
                return {
                    cashRegister: {
                        branch: {
                            name: 'Sucursal Centro', address: 'Km 4 Carretera', phone: '2222-0000',
                            company: { name: 'Mi Pitza S.A.', ruc: 'J0310000000001' },
                        },
                    },
                };
            }
            return {
                id: 5, startAmount: 50, endAmount: 50, endDate: new Date(), startDate: new Date(),
                forceClosed: false, closingExchangeRate: null, closedBy: null, movements: [],
                cashRegister: { id: 1, name: 'Caja 1', branchId: 1 }, user: { id: 7, name: 'Ana' },
            };
        }) as never);
        jest.spyOn(prisma.cashCount, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        const res = await request(app).get('/cash-arqueo/5/report').set('x-test-user', as(cajero)).expect(200);
        expect(res.body.data.header).toEqual({
            companyName: 'Mi Pitza S.A.',
            ruc: 'J0310000000001',
            branchName: 'Sucursal Centro',
            branchAddress: 'Km 4 Carretera',
            branchPhone: '2222-0000',
        });
        // Report stays complete for a CAJERO (R2).
        expect(res.body.data.amounts.expectedEndAmount).toBe(50);
        expect(res.body.data.report.title).toBe('REPORTE DE CIERRE DE CAJA');
    });
});
