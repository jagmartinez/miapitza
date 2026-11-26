import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';

let currentUser: Record<string, unknown> = {};
jest.mock('../../middlewares/auth', () => ({
    authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = currentUser; next(); },
    extractAuthToken: () => 'session-token',
    requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const prisma = require('../../utils/prisma').default as typeof import('../../utils/prisma').default;
const surveyRoutes = require('../../routes/survey.routes').default as import('express').Router;
const { errorHandler } = require('../../middlewares/errorHandler') as typeof import('../../middlewares/errorHandler');
const { zonedMonthKey } = require('../../utils/timezone') as typeof import('../../utils/timezone');

const app = express();
app.use(express.json());
app.use('/api/v1/surveys', surveyRoutes);
app.use(errorHandler);

const TZ = 'America/Guatemala'; // UTC-6, no DST
const admin = { userId: 1, companyId: 5, branchId: null, role: 'ADMIN', roles: ['ADMIN'], permissions: ['surveys.view'], timezone: TZ };
const waiter = { userId: 21, companyId: 5, branchId: 1, role: 'MESERO', roles: ['MESERO'], permissions: [], timezone: TZ };

interface Row {
    id?: number; nps: number; waiterRating?: number | null; foodRating?: number | null; waitRating?: number | null;
    ambienceRating?: number | null; waiterUserId: number; branchId: number; createdAt?: Date;
}
const mk = (r: Row) => ({
    waiterRating: null, foodRating: null, waitRating: null, ambienceRating: null,
    createdAt: new Date('2026-03-10T18:00:00Z'), ...r,
});

function setup(rows: Row[], user: Record<string, unknown> = admin) {
    currentUser = user;
    const all = rows.map(mk);
    const find = jest.spyOn(prisma.surveyResponse, 'findMany').mockImplementation(((args: { where?: { waiterUserId?: number } }) =>
        Promise.resolve(args?.where?.waiterUserId ? all.filter((r) => r.waiterUserId === args.where!.waiterUserId) : all)) as never);
    const count = jest.spyOn(prisma.surveyResponse, 'count').mockResolvedValue(all.length as never);
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
        { id: 21, name: 'Ana' }, { id: 22, name: 'Beto' }, { id: 23, name: 'Cami' },
    ] as never);
    jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([{ id: 1, name: 'Centro' }, { id: 2, name: 'Norte' }] as never);
    return { find, count };
}

const repeat = (n: number, r: Row): Row[] => Array.from({ length: n }, () => ({ ...r }));

describe('GET /surveys/summary', () => {
    it('computes nps and averages per waiter and branch', async () => {
        setup([
            { nps: 10, waiterRating: 5, foodRating: 4, waitRating: 3, ambienceRating: 5, waiterUserId: 21, branchId: 1, createdAt: new Date('2026-03-10T18:00:00Z') },
            { nps: 9, waiterRating: 4, foodRating: 5, waiterUserId: 21, branchId: 1, createdAt: new Date('2026-03-11T18:00:00Z') },
            { nps: 3, waiterRating: 2, waiterUserId: 22, branchId: 2, createdAt: new Date('2026-03-18T18:00:00Z') },
            { nps: 8, waiterUserId: 22, branchId: 2, createdAt: new Date('2026-03-18T18:00:00Z') },
        ]);
        const res = await request(app).get('/api/v1/surveys/summary?dateFrom=2026-03-01&dateTo=2026-03-31').expect(200);
        const d = res.body.data;
        expect(d).toMatchObject({ responses: 4, promoters: 2, passives: 1, detractors: 1, nps: 25, avgWaiter: 3.7, avgFood: 4.5, avgWait: 3, avgAmbience: 5 });
        expect(d.byWaiter).toEqual([
            { userId: 21, name: 'Ana', responses: 2, nps: 100, avgWaiter: 4.5 },
            { userId: 22, name: 'Beto', responses: 2, nps: -50, avgWaiter: 2 },
        ]);
        expect(d.byBranch).toEqual([
            { branchId: 1, name: 'Centro', responses: 2, nps: 100 },
            { branchId: 2, name: 'Norte', responses: 2, nps: -50 },
        ]);
        // 2026-03-10 is a Tuesday; weeks start on Monday (local date)
        expect(d.trend).toEqual([
            { weekStart: '2026-03-09', responses: 2, nps: 100 },
            { weekStart: '2026-03-16', responses: 2, nps: -50 },
        ]);
    });

    it('averages are null when nothing was rated', async () => {
        setup([]);
        const res = await request(app).get('/api/v1/surveys/summary').expect(200);
        expect(res.body.data).toMatchObject({ responses: 0, nps: null, avgWaiter: null, avgFood: null, avgWait: null, avgAmbience: null, byWaiter: [], byBranch: [], trend: [] });
    });

    it('scoped to company, and pinned branch for non-admin', async () => {
        const { find } = setup([]);
        await request(app).get('/api/v1/surveys/summary?branchId=99').expect(200);
        expect(find.mock.calls[0][0]).toMatchObject({ where: { companyId: 5, branchId: 99 } });
        // a pinned user cannot widen the scope
        const pinned = setup([], { ...waiter, permissions: ['surveys.view'] });
        pinned.find.mockClear();
        await request(app).get('/api/v1/surveys/summary?branchId=99').expect(200);
        const where = (pinned.find.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toMatchObject({ companyId: 5, branchId: 1 });
    });

    it('defaults to the current month in the user timezone when no dates are given', async () => {
        const { find } = setup([]);
        const res = await request(app).get('/api/v1/surveys/summary?branchId=99').expect(200);
        expect(res.body.data.responses).toBe(0);
        const { gte, lte } = (find.mock.calls[0][0] as { where: { createdAt: { gte: Date; lte: Date } } }).where.createdAt;
        expect(zonedMonthKey(gte, TZ)).toBe(zonedMonthKey(new Date(), TZ));
        expect(zonedMonthKey(lte, TZ)).toBe(zonedMonthKey(new Date(), TZ));
        expect(gte.getUTCHours()).toBe(6);
    });

    it('rejects spans over 366 days with SURVEY_RANGE_TOO_LARGE', async () => {
        const { find } = setup([]);
        const res = await request(app).get('/api/v1/surveys/summary?dateFrom=2024-01-01&dateTo=2026-01-01').expect(400);
        expect(res.body.code).toBe('SURVEY_RANGE_TOO_LARGE');
        expect(res.body.message).toBe('El período máximo es de un año.');
        expect(find).not.toHaveBeenCalled();
        await request(app).get('/api/v1/surveys/responses?dateFrom=2024-01-01').expect(400);
        await request(app).get('/api/v1/surveys/summary?dateFrom=2025-03-01&dateTo=2026-02-28').expect(200);
    });

    it('rejects non-integer branchId / waiterUserId / page with 400', async () => {
        setup([]);
        await request(app).get('/api/v1/surveys/summary?branchId=1.5').expect(400);
        await request(app).get('/api/v1/surveys/responses?waiterUserId=1.5').expect(400);
        await request(app).get('/api/v1/surveys/responses?page=1.5').expect(400);
        await request(app).get('/api/v1/surveys/ranking?branchId=abc').expect(400);
    });

    it('applies the date window in the user timezone', async () => {
        const { find } = setup([]);
        await request(app).get('/api/v1/surveys/summary?dateFrom=2026-03-01&dateTo=2026-03-31').expect(200);
        const where = (find.mock.calls[0][0] as { where: { createdAt: { gte: Date; lte: Date } } }).where;
        expect(where.createdAt.gte.toISOString()).toBe('2026-03-01T06:00:00.000Z');
        expect(where.createdAt.lte.toISOString()).toBe('2026-04-01T05:59:59.999Z');
    });
});

describe('GET /surveys/responses', () => {
    it('detractorsOnly filters nps<=6 and paginates, newest first', async () => {
        const { find, count } = setup([]);
        find.mockResolvedValue([{
            id: 3, createdAt: new Date('2026-03-10T18:00:00Z'), orderId: 40, nps: 2, waiterRating: 1, foodRating: null,
            waitRating: 2, ambienceRating: null, comment: 'Lento', contactPhone: '5551234',
            branch: { name: 'Centro' }, waiter: { name: 'Ana' },
        }] as never);
        count.mockResolvedValue(31 as never);
        const res = await request(app).get('/api/v1/surveys/responses?detractorsOnly=true&page=2&pageSize=10&waiterUserId=21&branchId=1').expect(200);
        const args = find.mock.calls[0][0] as { where: Record<string, unknown>; skip: number; take: number; orderBy: unknown };
        expect(args.where).toMatchObject({ companyId: 5, branchId: 1, waiterUserId: 21, nps: { lte: 6 } });
        expect(args).toMatchObject({ skip: 10, take: 10, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        expect(res.body.data).toEqual({
            items: [{
                id: 3, createdAt: '2026-03-10T18:00:00.000Z', branchName: 'Centro', waiterName: 'Ana', orderId: 40, nps: 2,
                waiterRating: 1, foodRating: null, waitRating: 2, ambienceRating: null, comment: 'Lento', contactPhone: '5551234',
            }],
            total: 31, page: 2, pageSize: 10,
        });
    });

    it('rejects pageSize over 100', async () => {
        setup([]);
        await request(app).get('/api/v1/surveys/responses?pageSize=101').expect(400);
    });
});

describe('GET /surveys/ranking', () => {
    const rows = [
        ...repeat(32, { nps: 10, waiterRating: 5, waiterUserId: 21, branchId: 1 }),
        ...repeat(8, { nps: 8, waiterRating: 4, waiterUserId: 21, branchId: 1 }),
        ...repeat(2, { nps: 10, waiterRating: 5, waiterUserId: 22, branchId: 1 }),
        ...repeat(10, { nps: 9, waiterRating: 5, waiterUserId: 23, branchId: 2 }),
    ];

    it('excludes waiters under 10 responses and orders by bayesian score', async () => {
        const { find } = setup(rows);
        const res = await request(app).get('/api/v1/surveys/ranking?month=2026-03').expect(200);
        const d = res.body.data;
        expect(d.month).toBe('2026-03');
        expect(d.minResponses).toBe(10);
        // 10x5 stars shrinks less than it gains versus 40 ratings averaging 4.8 (C = 4.85)
        expect(d.items.map((i: { userId: number; rank: number }) => [i.rank, i.userId])).toEqual([[1, 23], [2, 21]]);
        expect(d.items[1]).toMatchObject({ name: 'Ana', branchName: 'Centro', responses: 40, attentionAvg: 4.8, nps: 80 });
        expect(typeof d.items[0].score).toBe('number');
        expect(d.ineligible).toEqual([{ userId: 22, name: 'Beto', responses: 2 }]);
        const where = (find.mock.calls[0][0] as { where: { createdAt: { gte: Date; lt: Date } } }).where;
        expect(where.createdAt.gte.toISOString()).toBe('2026-03-01T06:00:00.000Z');
        expect(where.createdAt.lt.toISOString()).toBe('2026-04-01T06:00:00.000Z');
    });

    it('rejects a malformed month', async () => {
        setup([]);
        await request(app).get('/api/v1/surveys/ranking?month=2026-13').expect(400);
        await request(app).get('/api/v1/surveys/ranking?month=hoy').expect(400);
    });
});

describe('GET /surveys/me', () => {
    it('masks below 3 responses', async () => {
        setup([...repeat(2, { nps: 10, waiterRating: 5, waiterUserId: 21, branchId: 1 })], waiter);
        let res = await request(app).get('/api/v1/surveys/me?month=2026-03').expect(200);
        expect(res.body.data).toMatchObject({ month: '2026-03', responses: 2, nps: null, attentionAvg: null, rank: null });
        setup([...repeat(3, { nps: 10, waiterRating: 5, waiterUserId: 21, branchId: 1 })], waiter);
        res = await request(app).get('/api/v1/surveys/me?month=2026-03').expect(200);
        expect(res.body.data).toMatchObject({ responses: 3, nps: 100, attentionAvg: 5 });
    });

    it('never returns comments (exact key set)', async () => {
        setup([{ nps: 10, waiterRating: 5, waiterUserId: 21, branchId: 1 }], waiter);
        const res = await request(app).get('/api/v1/surveys/me?month=2026-03').expect(200);
        expect(Object.keys(res.body.data).sort()).toEqual(['attentionAvg', 'month', 'nps', 'rank', 'rankedCount', 'responses']);
    });

    it('returns rank when eligible, null otherwise', async () => {
        const rows = [
            ...repeat(10, { nps: 9, waiterRating: 5, waiterUserId: 23, branchId: 1 }),
            ...repeat(12, { nps: 9, waiterRating: 4, waiterUserId: 21, branchId: 1 }),
            ...repeat(4, { nps: 9, waiterRating: 5, waiterUserId: 22, branchId: 1 }),
        ];
        setup(rows, waiter);
        let res = await request(app).get('/api/v1/surveys/me?month=2026-03').expect(200);
        expect(res.body.data).toMatchObject({ rank: 2, rankedCount: 2, responses: 12 });
        setup(rows, { ...waiter, userId: 22 });
        res = await request(app).get('/api/v1/surveys/me?month=2026-03').expect(200);
        expect(res.body.data).toMatchObject({ rank: null, rankedCount: 2, responses: 4 });
    });

    it('filters by the session user and uses the user timezone for month bounds', async () => {
        const { find } = setup([], waiter);
        const res = await request(app).get('/api/v1/surveys/me?month=2026-03').expect(200);
        const own = find.mock.calls.map((c) => c[0] as { where: { waiterUserId?: number; createdAt: { gte: Date; lt: Date } } })
            .find((a) => a.where.waiterUserId !== undefined)!;
        expect(own.where.waiterUserId).toBe(21);
        expect(own.where.createdAt.gte.toISOString()).toBe('2026-03-01T06:00:00.000Z');
        expect(own.where.createdAt.lt.toISOString()).toBe('2026-04-01T06:00:00.000Z');
        expect(res.body.data.responses).toBe(0);
    });

    it('defaults to the current month in the user timezone', async () => {
        setup([], waiter);
        const res = await request(app).get('/api/v1/surveys/me').expect(200);
        expect(res.body.data.month).toBe(zonedMonthKey(new Date(), TZ));
    });
});

describe('route permissions', () => {
    it('summary, responses and ranking carry the surveys.view literal; /me does not', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../routes/survey.routes.ts'), 'utf8');
        const literal = "requirePermission('surveys.view', 'SUPERADMIN', 'ADMIN')";
        for (const route of ['/summary', '/responses', '/ranking']) {
            const start = src.indexOf(`router.get('${route}'`);
            expect(start).toBeGreaterThan(-1);
            expect(src.slice(start, src.indexOf('\n', start))).toContain(literal);
        }
        const me = src.slice(src.indexOf("router.get('/me'"));
        expect(me.slice(0, me.indexOf('\n'))).not.toContain('requirePermission');
    });
});

describe('ranking with unrated responses', () => {
    it('lists waiters whose responses carry no waiterRating as ineligible with 0', async () => {
        setup([
            ...repeat(10, { nps: 9, waiterRating: 5, waiterUserId: 21, branchId: 1 }),
            ...repeat(4, { nps: 9, waiterUserId: 22, branchId: 1 }),
        ]);
        const res = await request(app).get('/api/v1/surveys/ranking?month=2026-03').expect(200);
        expect(res.body.data.items.map((i: { userId: number }) => i.userId)).toEqual([21]);
        expect(res.body.data.ineligible).toEqual([{ userId: 22, name: 'Beto', responses: 0 }]);
    });
});

describe('demo cleanup', () => {
    it('deletes SurveyResponse rows before the orders they reference (FK restrict)', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/cleanup-demo-data.ts'), 'utf8');
        const survey = src.indexOf('tx.surveyResponse.deleteMany');
        expect(survey).toBeGreaterThan(-1);
        expect(survey).toBeLessThan(src.indexOf('tx.order.deleteMany'));
    });
});
