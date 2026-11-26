import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

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
const { CashShiftService } = require('../../services/cash-shift.service');
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

// salesBreakdown reads payments: keep every route test hermetic (no real database)
function mockNoPayments() {
    jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.payment, 'groupBy').mockResolvedValue([] as never);
}

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
        // La tolerancia se resuelve por sucursal (SettingsScopeService); se fija igual que la de empresa.
        jest.spyOn(CashArqueoService, 'resolveTolerance').mockResolvedValue(1 as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        const res = await request(app).post('/cash-arqueo/5/close').set('x-test-user', as(cajero))
            .send({ endAmount: 90, bills: [{ denomination: 10, count: 9 }], coins: [] });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('CASH_DIFF_EXCEEDS_TOLERANCE');
        expect(res.body.message).toBe('La diferencia excede la tolerancia. Llama a un supervisor.');
        expect(res.body.message).not.toMatch(/\d/);
    });

    it('close with a diff inside tolerance and no note returns 400 CASH_NOTE_REQUIRED', async () => {
        mockShiftLookup({ userId: 7, endDate: null, closedById: null });
        jest.spyOn(CashArqueoService, 'getShiftDetails').mockResolvedValue({ amounts: { expectedEndAmount: 100 } } as never);
        jest.spyOn(SettingService, 'getCashReconciliationTolerance').mockResolvedValue(1 as never);
        // La tolerancia se resuelve por sucursal (SettingsScopeService); se fija igual que la de empresa.
        jest.spyOn(CashArqueoService, 'resolveTolerance').mockResolvedValue(1 as never);
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
                id: 5, userId: 7, startDate: new Date(), startAmount: 50, endAmount: null, endDate: null, movements: [],
                cashRegister: { id: 1, name: 'Caja', branchId: 1 },
                user: u && typeof u === 'object' && u.select
                    ? Object.fromEntries(Object.keys(u.select).map((k) => [k, (fullUser as any)[k]]))
                    : fullUser,
            };
        }) as never);
        mockNoPayments();
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
        mockNoPayments();
        jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) =>
            args?.select?.cashRegister ? { cashRegister: { branchId: 1 } } : {
                id: 5, userId: 7, startDate: new Date(Date.now() - 3600_000), startAmount: 50, endAmount: endDate ? 50 : null, endDate, movements: [],
                cashRegister: { id: 1, name: 'Caja', branchId: 1 }, user: { id: 7, name: 'Ana' },
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

describe('cash API blind arqueo detail', () => {
    function mockDetailsShift(endDate: Date | null) {
        jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) =>
            args?.select?.cashRegister ? { cashRegister: { branchId: 1 } } : {
                id: 5, startAmount: 50, endAmount: endDate ? 40 : null, endDate, startDate: new Date(),
                forceClosed: false, closingExchangeRate: null, closedBy: null, movements: [],
                cashRegister: { id: 1, name: 'Caja', branchId: 1 }, user: { id: 7, name: 'Ana' },
            }) as never);
        jest.spyOn(prisma.cashCount, 'findMany').mockResolvedValue([] as never);
    }

    it('CAJERO open shift omits expected and reconciliation amounts; ADMIN includes them', async () => {
        mockDetailsShift(null);
        const blind = await request(app).get('/cash-arqueo/5').set('x-test-user', as(cajero)).expect(200);
        expect(blind.body.data.amounts).not.toHaveProperty('expectedEndAmount');
        expect(blind.body.data.amounts).not.toHaveProperty('difference');
        expect(blind.body.data.reconciliation).not.toHaveProperty('surplus');
        expect(blind.body.data.reconciliation).not.toHaveProperty('deficit');
        expect(blind.body.data.amounts.startAmount).toBe(50);
        const full = await request(app).get('/cash-arqueo/5').set('x-test-user', as(admin)).expect(200);
        expect(full.body.data.amounts.expectedEndAmount).toBe(50);
        expect(full.body.data.reconciliation).toHaveProperty('surplus');
    });

    it('CAJERO closed shift detail stays complete (R2)', async () => {
        mockDetailsShift(new Date());
        const res = await request(app).get('/cash-arqueo/5').set('x-test-user', as(cajero)).expect(200);
        expect(res.body.data.amounts.expectedEndAmount).toBe(50);
        expect(res.body.data.amounts.difference).toBe(-10);
    });
});

describe('cash summary access', () => {
    it('GET /cash-shifts/:id/summary is for cashier roles only (a waiter cannot read an open shift expected amount)', async () => {
        const getSummary = jest.spyOn(CashShiftService, 'getShiftSummary').mockResolvedValue({ summary: {} } as never);
        const mesero = { userId: 9, companyId: 5, role: 'MESERO', roles: ['MESERO'], branchId: 1 };
        await request(app).get('/cash-shifts/5/summary').set('x-test-user', as(mesero)).expect(403);
        expect(getSummary).not.toHaveBeenCalled();
    });
});

describe('cash API in-transaction blind check', () => {
    it('a movement landing after the preview that pushes the difference out of tolerance gives CAJERO the amount-free message', async () => {
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({ userId: 7 } as never);
        jest.spyOn(CashArqueoService, 'previewClose').mockResolvedValue({
            difference: 0, tolerance: 1, requiresNote: false, exceedsTolerance: false,
        } as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            cashShift: {
                // 100 at open, +500 IN landed after the preview: the locked expected is 600, the cashier counted 100
                findFirst: jest.fn(async () => ({
                    id: 5, endDate: null, closedById: null, startAmount: 100, movements: [{ type: 'IN', amount: 500 }],
                })),
                update: jest.fn(),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: any) => cb(tx)) as never);
        const err: any = await CashArqueoService.closeShiftWithArqueo(5, 5, 100, ['CAJERO'], 7, 'nota').catch((e: unknown) => e);
        expect(err.statusCode ?? err.status).toBe(403);
        expect(err.code).toBe('CASH_DIFF_EXCEEDS_TOLERANCE');
        expect(err.message).toBe('La diferencia excede la tolerancia. Llama a un supervisor.');
        expect(err.message).not.toMatch(/\d/);
        expect(tx.cashShift.update).not.toHaveBeenCalled();
    });
});

describe('cash API blind scope and report', () => {
    const detailsShift = (endDate: Date | null) => jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) => {
        if (args?.select?.cashRegister?.select?.branch) {
            return {
                userId: 7, startDate: new Date(Date.now() - 3600_000), endDate,
                cashRegister: { branchId: 1, branch: { name: 'S', address: null, phone: null, company: { name: 'C', ruc: 'R' } } },
            };
        }
        if (args?.select?.cashRegister?.select?.branchId) return { cashRegister: { branchId: 1 } };
        return {
            id: 5, userId: 7, startAmount: 50, endAmount: endDate ? 40 : null, endDate, startDate: new Date(),
            forceClosed: false, closingExchangeRate: null, closedBy: null, movements: [],
            cashRegister: { id: 1, name: 'Caja', branchId: 1 }, user: { id: 7, name: 'Ana' },
        };
    }) as never);

    beforeEach(() => mockNoPayments());

    it('report of an OPEN shift omits expected/difference for blind CAJERO, also in summary text', async () => {
        detailsShift(null);
        jest.spyOn(prisma.cashCount, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        const res = await request(app).get('/cash-arqueo/5/report').set('x-test-user', as(cajero)).expect(200);
        expect(res.body.data.amounts).not.toHaveProperty('expectedEndAmount');
        expect(res.body.data.amounts).not.toHaveProperty('difference');
        expect(res.body.data.reconciliation).not.toHaveProperty('surplus');
        expect(res.body.data.report.summary).not.toMatch(/Esperado|Diferencia/);
        expect(res.body.data.report.summary).toMatch(/Monto Inicial/);
    });

    it('report of a CLOSED shift stays complete for CAJERO (R2)', async () => {
        detailsShift(new Date());
        jest.spyOn(prisma.cashCount, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        const res = await request(app).get('/cash-arqueo/5/report').set('x-test-user', as(cajero)).expect(200);
        expect(res.body.data.amounts.expectedEndAmount).toBe(50);
        expect(res.body.data.report.summary).toMatch(/Esperado/);
    });

    it('report of an OPEN shift keeps sales, discounts, tips and header for blind CAJERO (they are not blind data)', async () => {
        detailsShift(null);
        jest.spyOn(prisma.cashCount, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$' as never);
        const at = new Date(Date.now() - 1800_000);
        jest.spyOn(prisma.payment, 'findMany').mockImplementation((async (args: any) => args?.where?.orderId
            ? [{ orderId: 1, createdAt: at, registeredById: 7 }]
            : [{ orderId: 1, methodType: 'CARD', amount: 40, order: { discount: 5, tipAmount: 2 } }]) as never);
        const res = await request(app).get('/cash-arqueo/5/report').set('x-test-user', as(cajero)).expect(200);
        // the blind redaction ran (expected and difference are gone) ...
        expect(res.body.data.amounts).not.toHaveProperty('expectedEndAmount');
        expect(res.body.data.report.summary).not.toMatch(/Esperado|Diferencia/);
        // ... and left the sales data alone
        expect(res.body.data.salesByMethod).toEqual({ cash: 0, card: 40, transfer: 0, paymentCount: 1 });
        expect(res.body.data.discounts).toBe(5);
        expect(res.body.data.tips).toBe(2);
        expect(res.body.data.header.companyName).toBe('C');
    });

    it('CAJERO combined with ADMIN or SUPERADMIN is not blinded', async () => {
        jest.spyOn(CashArqueoService, 'previewClose').mockResolvedValue({ expectedAmount: 100, difference: 1, absoluteDifference: 1, status: 'SOBRANTE' } as never);
        jest.spyOn(prisma.cashShift, 'findFirst').mockImplementation((async (args: any) =>
            args?.select?.cashRegister ? { cashRegister: { branchId: 1 } } : null) as never);
        for (const roles of [['CAJERO', 'ADMIN'], ['CAJERO', 'SUPERADMIN'], ['SUPERADMIN']]) {
            const user = { userId: 3, companyId: 5, role: roles[0], roles, branchId: 1 };
            const res = await request(app).post('/cash-arqueo/5/preview-close').set('x-test-user', as(user))
                .send({ endAmount: 101, bills: [], coins: [] }).expect(200);
            expect(res.body.data.expectedAmount).toBe(100);
            expect(res.body.data.difference).toBe(1);
        }
    });
});
