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
const registerRouter = require('../../routes/cash-register.routes').default;
const { CashArqueoService } = require('../../services/cash-arqueo.service');
const { SettingService } = require('../../services/setting.service');
/* eslint-enable @typescript-eslint/no-var-requires */

const app = express();
app.use(express.json());
app.use('/cash-shifts', shiftRouter);
app.use('/cash-arqueo', arqueoRouter);
app.use('/cash-registers', registerRouter);
app.use(errorHandler);

const cajero = { userId: 7, companyId: 5, role: 'CAJERO', roles: ['CAJERO'], branchId: 1 };
const admin = { userId: 1, companyId: 5, role: 'ADMIN', roles: ['ADMIN'], branchId: 1 };
const as = (u: object) => JSON.stringify(u);

afterEach(() => {
    jest.restoreAllMocks();
});

function mockOpenTx(findFirstResults: unknown[]) {
    const queue = [...findFirstResults];
    const tx = {
        $queryRaw: jest.fn(async () => []),
        user: { findFirst: jest.fn(async () => ({ id: 7 })) },
        cashRegister: { findFirst: jest.fn(async () => ({ id: 1, branchId: 1 })) },
        cashShift: {
            findFirst: jest.fn(async () => queue.shift() ?? null),
            create: jest.fn(async () => ({ id: 99 })),
        },
    };
    jest.spyOn(prisma.cashRegister, 'findFirst').mockResolvedValue({ id: 1, branchId: 1, name: 'Caja 1' } as never);
    jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: any) => cb(tx)) as never);
    return tx;
}

function mockShiftLookup(owner: object) {
    jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) =>
        args?.select?.cashRegister ? { cashRegister: { branchId: 1 } } : owner) as never);
}

describe('cash API typed errors', () => {
    it('open on an occupied register returns 409 CASH_REGISTER_OCCUPIED with occupant name', async () => {
        mockOpenTx([{ id: 3, user: { id: 9, name: 'Ana' } }]);
        const res = await request(app).post('/cash-shifts/open').set('x-test-user', as(cajero))
            .send({ cashRegisterId: 1, startAmount: 100 });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
            success: false,
            code: 'CASH_REGISTER_OCCUPIED',
            message: 'Esta caja ya tiene un turno abierto',
            occupiedBy: { id: 9, name: 'Ana' },
        });
    });

    it('second open by the same user returns 409 CASH_SHIFT_ALREADY_OPEN', async () => {
        mockOpenTx([null, { id: 4 }]);
        const res = await request(app).post('/cash-shifts/open').set('x-test-user', as(cajero))
            .send({ cashRegisterId: 1, startAmount: 100 });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
            code: 'CASH_SHIFT_ALREADY_OPEN',
            message: 'El usuario ya tiene un turno de caja abierto',
        });
    });

    it('close with diff over tolerance as CAJERO returns 403 CASH_DIFF_EXCEEDS_TOLERANCE', async () => {
        mockShiftLookup({ userId: 7, endDate: null, closedById: null });
        jest.spyOn(CashArqueoService, 'getShiftDetails').mockResolvedValue({ amounts: { expectedEndAmount: 100 } } as never);
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1 as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        const res = await request(app).post('/cash-arqueo/5/close').set('x-test-user', as(cajero))
            .send({ endAmount: 90, bills: [{ denomination: 10, count: 9 }], coins: [] });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('CASH_DIFF_EXCEEDS_TOLERANCE');
        expect(res.body.message).toMatch(/excede la tolerancia/);
    });

    it('close with a diff inside tolerance and no note returns 400 CASH_NOTE_REQUIRED', async () => {
        mockShiftLookup({ userId: 7, endDate: null, closedById: null });
        jest.spyOn(CashArqueoService, 'getShiftDetails').mockResolvedValue({ amounts: { expectedEndAmount: 100 } } as never);
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1 as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        const res = await request(app).post('/cash-arqueo/5/close').set('x-test-user', as(cajero))
            .send({ endAmount: 99.5, bills: [{ denomination: 0.5, count: 199 }], coins: [] });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('CASH_NOTE_REQUIRED');
    });

    it('close retry on an already closed own shift returns 409 CASH_SHIFT_ALREADY_CLOSED closedByMe=true', async () => {
        mockShiftLookup({ userId: 7, endDate: new Date(), closedById: 7 });
        const res = await request(app).post('/cash-arqueo/5/close').set('x-test-user', as(cajero))
            .send({ endAmount: 100, bills: [{ denomination: 100, count: 1 }], coins: [] });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'CASH_SHIFT_ALREADY_CLOSED', closedByMe: true });
    });

    it('close retry on a shift closed by someone else reports closedByMe=false', async () => {
        mockShiftLookup({ userId: 1, endDate: new Date(), closedById: 1 });
        const res = await request(app).post('/cash-arqueo/5/close').set('x-test-user', as({ ...admin, userId: 2 }))
            .send({ endAmount: 100, bills: [{ denomination: 100, count: 1 }], coins: [] });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'CASH_SHIFT_ALREADY_CLOSED', closedByMe: false });
    });

    it('USD counted without rate returns 400 CASH_EXCHANGE_RATE_REQUIRED', async () => {
        mockShiftLookup({ userId: 7, endDate: null, closedById: null });
        const res = await request(app).post('/cash-arqueo/5/preview-close').set('x-test-user', as(cajero))
            .send({ endAmount: 0, bills: [], coins: [], usdBills: [{ denomination: 20, count: 1 }] });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('CASH_EXCHANGE_RATE_REQUIRED');
    });

    it('count mismatch and invalid breakdown are typed 400s', async () => {
        mockShiftLookup({ userId: 7, endDate: null, closedById: null });
        const mismatch = await request(app).post('/cash-arqueo/5/preview-close').set('x-test-user', as(cajero))
            .send({ endAmount: 50, bills: [{ denomination: 100, count: 1 }], coins: [] });
        expect(mismatch.status).toBe(400);
        expect(mismatch.body.code).toBe('CASH_COUNT_MISMATCH');
        const invalid = await request(app).post('/cash-arqueo/5/preview-close').set('x-test-user', as(cajero))
            .send({ endAmount: 50, bills: [{ denomination: -5, count: 1 }], coins: [] });
        expect(invalid.status).toBe(400);
        expect(invalid.body.code).toBe('CASH_INVALID_BREAKDOWN');
    });
});

describe('cash API user hygiene', () => {
    it('summary never includes passwordHash or other user columns', async () => {
        const fullUser = { id: 7, name: 'Ana', passwordHash: 'secret-hash', email: 'a@b.c', pin: '1234' };
        jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) => {
            if (args?.select?.cashRegister) return { cashRegister: { branchId: 1 } };
            const u = args?.include?.user;
            return {
                id: 5, startAmount: 50, endAmount: null, endDate: null, movements: [],
                cashRegister: { id: 1, name: 'Caja' },
                user: u && typeof u === 'object' && u.select
                    ? Object.fromEntries(Object.keys(u.select).map((k) => [k, (fullUser as any)[k]]))
                    : fullUser,
            };
        }) as never);
        const res = await request(app).get('/cash-shifts/5/summary').set('x-test-user', as(admin)).expect(200);
        expect(res.body.data.shift.user).toEqual({ id: 7, name: 'Ana' });
        expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|secret-hash|a@b\.c|1234/);
    });

    it('cash-registers list includes active shift user name', async () => {
        const findMany = jest.spyOn(prisma.cashRegister, 'findMany').mockResolvedValue([{
            id: 1, name: 'Caja 1', branch: { id: 1, name: 'Central', code: 'C' }, _count: { shifts: 2 },
            shifts: [{ id: 3, startDate: new Date(), userId: 9, user: { id: 9, name: 'Ana' } }],
        }] as never);
        const res = await request(app).get('/cash-registers').set('x-test-user', as(admin)).expect(200);
        expect(res.body.data[0].status).toBe('OPEN');
        expect(res.body.data[0].activeShift.user).toEqual({ id: 9, name: 'Ana' });
        const arg: any = findMany.mock.calls[0][0];
        expect(arg.include.shifts.select.user).toEqual({ select: { id: true, name: true } });
    });
});

describe('cash API blind count for CAJERO', () => {
    const fullPreview = {
        expectedAmount: 100, countedAmount: 99.5, countedBreakdown: { bills: 99.5 }, notes: '',
        difference: -0.5, absoluteDifference: 0.5, status: 'FALTANTE',
        withinTolerance: true, requiresNote: true, exceedsTolerance: false, tolerance: 1,
    };
    const openShiftLookup = () => jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) =>
        args?.select?.cashRegister ? { cashRegister: { branchId: 1 } } : null) as never);

    it('preview-close as CAJERO omits expected and difference; as ADMIN includes them', async () => {
        openShiftLookup();
        jest.spyOn(CashArqueoService, 'previewClose').mockResolvedValue({ ...fullPreview } as never);
        const body = { endAmount: 99.5, bills: [], coins: [] };
        const blind = await request(app).post('/cash-arqueo/5/preview-close').set('x-test-user', as(cajero)).send(body).expect(200);
        for (const key of ['expectedAmount', 'difference', 'absoluteDifference']) {
            expect(blind.body.data).not.toHaveProperty(key);
        }
        expect(blind.body.data).toMatchObject({
            status: 'FALTANTE', withinTolerance: true, requiresNote: true, exceedsTolerance: false, tolerance: 1,
        });
        const full = await request(app).post('/cash-arqueo/5/preview-close').set('x-test-user', as(admin)).send(body).expect(200);
        expect(full.body.data).toMatchObject({ expectedAmount: 100, difference: -0.5, absoluteDifference: 0.5 });
    });

    it('count as CAJERO omits expected and difference and keeps classification flags', async () => {
        openShiftLookup();
        jest.spyOn(CashArqueoService, 'performArqueo').mockResolvedValue({
            counted: { total: 99.5 }, expected: 100, difference: -0.5, status: 'FALTANTE', withinTolerance: true,
            breakdown: { bills: [], coins: [], usdBills: [] },
        } as never);
        const blind = await request(app).post('/cash-arqueo/5/count').set('x-test-user', as(cajero))
            .send({ bills: [], coins: [] }).expect(200);
        expect(blind.body.data).not.toHaveProperty('expected');
        expect(blind.body.data).not.toHaveProperty('difference');
        expect(blind.body.data).toMatchObject({ status: 'FALTANTE', withinTolerance: true });
        const full = await request(app).post('/cash-arqueo/5/count').set('x-test-user', as(admin))
            .send({ bills: [], coins: [] }).expect(200);
        expect(full.body.data).toMatchObject({ expected: 100, difference: -0.5 });
    });

    function mockSummaryShift(endDate: Date | null) {
        jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) =>
            args?.select?.cashRegister ? { cashRegister: { branchId: 1 } } : {
                id: 5, startAmount: 50, endAmount: endDate ? 50 : null, endDate, movements: [],
                cashRegister: { id: 1, name: 'Caja' }, user: { id: 7, name: 'Ana' },
            }) as never);
    }

    it('summary of an OPEN shift omits expected end amount for CAJERO only', async () => {
        mockSummaryShift(null);
        const blind = await request(app).get('/cash-shifts/5/summary').set('x-test-user', as(cajero)).expect(200);
        expect(blind.body.data.summary).not.toHaveProperty('expectedBalance');
        expect(blind.body.data.summary).not.toHaveProperty('expectedAmount');
        expect(blind.body.data.summary.startAmount).toBe(50);
        const full = await request(app).get('/cash-shifts/5/summary').set('x-test-user', as(admin)).expect(200);
        expect(full.body.data.summary.expectedAmount).toBe(50);
    });

    it('summary of a CLOSED shift stays complete for CAJERO (R2)', async () => {
        mockSummaryShift(new Date());
        const res = await request(app).get('/cash-shifts/5/summary').set('x-test-user', as(cajero)).expect(200);
        expect(res.body.data.summary.expectedAmount).toBe(50);
        expect(res.body.data.summary.expectedBalance).toBe(50);
    });
});
