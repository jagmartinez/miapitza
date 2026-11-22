import express from 'express';
import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';

let currentUser: Record<string, unknown> = {};
jest.mock('../../middlewares/auth', () => ({
    authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = currentUser; next(); },
    extractAuthToken: () => 'session-token',
    requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    // Role-aware so the 403 test exercises the real contract (roles listed on the route).
    requireRole: (...roles: string[]) => (req: { user?: { role?: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
        if (req.user?.role && roles.includes(req.user.role)) next();
        else res.status(403).json({ success: false, message: 'Forbidden' });
    },
}));

const prisma = require('../../utils/prisma').default as typeof import('../../utils/prisma').default;
const inventoryCountRoutes = require('../../routes/inventory-count.routes').default as import('express').Router;
const { errorHandler } = require('../../middlewares/errorHandler') as typeof import('../../middlewares/errorHandler');
const { UnitConversionService } = require('../../services/unit-conversion.service') as typeof import('../../services/unit-conversion.service');
const { InventoryEngineService } = require('../../services/inventory-engine.service') as typeof import('../../services/inventory-engine.service');
const { CostingService } = require('../../services/costing.service') as typeof import('../../services/costing.service');
const { AuditLogService } = require('../../services/audit-log.service') as typeof import('../../services/audit-log.service');

const app = express();
app.use(express.json());
app.use('/api/v1/inventory-counts', inventoryCountRoutes);
app.use(errorHandler);

const admin = { userId: 2, companyId: 5, branchId: null, role: 'ADMIN', roles: ['ADMIN'], permissions: [] };
const bodega = { userId: 9, companyId: 5, branchId: 1, role: 'BODEGA', roles: ['BODEGA'], permissions: [] };
const KEY = { 'X-Idempotency-Key': 'approve-70-1234567890' };
const decimal = (value: number) => ({ toString: () => String(value), valueOf: () => value, [Symbol.toPrimitive]: () => value });

const costed = { currentAverageCost: 2, averageCostKnown: true, cost: 0, referenceCostKnown: false, lastPurchaseCost: 0, lastPurchaseCostKnown: false };
const uncosted = { currentAverageCost: 0, averageCostKnown: false, cost: 0, referenceCostKnown: false, lastPurchaseCost: 0, lastPurchaseCostKnown: false };

const units = (abbreviation = 'kg') => [{ unitId: 1, abbreviation, name: abbreviation, conversionFactor: 1, isBase: true, isDefault: true }];

const countedLine = (productId: number, counted: number, expected: number, over: Record<string, unknown> = {}) => ({
    id: productId * 10, productId, unit: 'kg', countedBaseQuantity: decimal(counted), expectedAtCount: decimal(expected),
    notCounted: false, recountRequested: false, ...over,
});

interface SetupOptions {
    status?: string;
    lines?: unknown[];
    products?: Record<number, { name: string } & typeof costed>;
}

/** Stateful fake of the sheet + a pseudo-transaction that discards "committed" movements when the callback throws. */
function setup(opts: SetupOptions = {}) {
    currentUser = admin;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = { status: opts.status ?? 'SUBMITTED', openWarehouseId: 3 as number | null, approvedById: null as number | null };
    const committed: Array<Record<string, unknown>> = [];
    let pending: Array<Record<string, unknown>> = [];
    const products = opts.products ?? { 10: { name: 'Leche', ...costed } };

    jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
        pending = [];
        try {
            const result = await fn(prisma);
            committed.push(...pending);
            return result;
        } catch (error) {
            pending = [];
            throw error;
        }
    }) as never);
    jest.spyOn(prisma, '$queryRaw').mockResolvedValue([] as never);
    jest.spyOn(prisma.inventoryCountSheet, 'findFirst').mockImplementation((async () => ({
        id: 70, companyId: 5, branchId: 1, warehouseId: 3, status: state.status, returnedAt: null, returnNote: null,
        startedAt: new Date('2026-11-24T09:00:00.000Z'), scopeCategoryIds: null,
        warehouse: { id: 3, name: 'Cocina' }, startedBy: { name: 'Ana' },
    })) as never);
    const sheetUpdate = jest.spyOn(prisma.inventoryCountSheet, 'update').mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
        if (data.status) state.status = data.status as string;
        if ('openWarehouseId' in data) state.openWarehouseId = data.openWarehouseId as number | null;
        if (data.approvedById) state.approvedById = data.approvedById as number;
        return {};
    }) as never);
    jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue((opts.lines ?? [countedLine(10, 8, 10)]) as never);
    const lineUpdate = jest.spyOn(prisma.inventoryCountLine, 'update').mockResolvedValue({} as never);
    jest.spyOn(prisma.product, 'findMany').mockImplementation((async () =>
        Object.entries(products).map(([id, p]) => ({ id: Number(id), ...p }))) as never);
    jest.spyOn(prisma.product, 'findFirst').mockImplementation((async ({ where }: { where: { id: number } }) => products[where.id] ?? null) as never);
    jest.spyOn(prisma.stock, 'aggregate').mockResolvedValue({ _sum: { quantity: 6 } } as never);
    jest.spyOn(UnitConversionService, 'getAllowedUnitsForProducts').mockImplementation((async (ids: number[]) =>
        new Map(ids.map((id) => [id, units()]))) as never);
    const lock = jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue(undefined as never);
    const apply = jest.spyOn(InventoryEngineService, 'applyMovement').mockImplementation((async (_tx: unknown, params: Record<string, unknown>) => {
        pending.push(params);
        return { movementId: 500 + Number(params.productId), unitCost: (params.unitCost as number | undefined) ?? 2, totalCost: 0, balanceQty: 0, balanceCost: 0 };
    }) as never);
    const fold = jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();
    const audit = jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);
    return { state, committed, sheetUpdate, lineUpdate, lock, apply, fold, audit };
}

const approve = () => request(app).post('/api/v1/inventory-counts/70/approve').set(KEY).send({});

afterEach(() => { jest.restoreAllMocks(); });

describe('POST /inventory-counts/:id/approve', () => {
    it('approval applies counted minus expected on top of current stock', async () => {
        // Expected 10, counted 8, stock is now 6 after later sales: the delta is -2 (not 0, not -4).
        const { apply, lock, lineUpdate, state } = setup({ lines: [countedLine(10, 8, 10)] });

        const res = await approve();

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ id: 70, status: 'APPROVED', adjustments: 1, netValue: -4 });
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            type: 'ADJUSTMENT', direction: 'OUT', quantity: 2, origin: 'MANUAL', warehouseId: 3, productId: 10,
            reason: 'Conteo físico: hoja #70', reference: 'CONTEO-70',
        }));
        expect(lock).toHaveBeenCalledWith(expect.anything(), 5, [3], [10]);
        expect(lineUpdate).toHaveBeenCalledWith({ where: { id: 100 }, data: { movementId: 510, adjustmentValue: -4 } });
        expect(state.status).toBe('APPROVED');
        expect(state.openWarehouseId).toBeNull();
        expect(state.approvedById).toBe(2);
    });

    it('surplus line posts IN at effective average cost', async () => {
        const { apply, fold } = setup({ lines: [countedLine(10, 12, 10)] });

        const res = await approve();

        expect(res.status).toBe(200);
        expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ direction: 'IN', quantity: 2, unitCost: 2 }));
        expect(fold).toHaveBeenCalledWith(expect.anything(), 10, 5, 2, 2, 6, undefined, 510);
        expect(res.body.data.netValue).toBe(4);
    });

    it('not counted and zero-diff lines produce no movement', async () => {
        const { apply, committed } = setup({
            lines: [
                countedLine(10, 10, 10),
                countedLine(11, 0, 0, { countedBaseQuantity: null, expectedAtCount: null, notCounted: true }),
                countedLine(12, 5, 5.0000000001),
            ],
            products: { 10: { name: 'Leche', ...costed }, 12: { name: 'Sal', ...costed } },
        });

        const res = await approve();

        expect(res.status).toBe(200);
        expect(res.body.data.adjustments).toBe(0);
        expect(apply).not.toHaveBeenCalled();
        expect(committed).toHaveLength(0);
    });

    it('second approve is rejected without new movements', async () => {
        const { apply, committed } = setup({ lines: [countedLine(10, 8, 10)] });

        const first = await approve();
        const second = await approve(); // retry / double click / second admin

        expect(first.status).toBe(200);
        expect(second.status).toBe(409);
        expect(second.body.code).toBe('INVENTORY_COUNT_NOT_EDITABLE');
        expect(apply).toHaveBeenCalledTimes(1);
        expect(committed).toHaveLength(1);
    });

    it('approving an already APPROVED sheet never calls the engine', async () => {
        const { apply, lock } = setup({ status: 'APPROVED' });
        const res = await approve();
        expect(res.status).toBe(409);
        expect(apply).not.toHaveBeenCalled();
        expect(lock).not.toHaveBeenCalled();
    });

    it('approve rolls back entirely on missing cost', async () => {
        const { committed, state, sheetUpdate, apply } = setup({
            lines: [countedLine(10, 12, 10), countedLine(11, 5, 1)],
            products: { 10: { name: 'Leche', ...costed }, 11: { name: 'Azafrán', ...uncosted } },
        });

        const res = await approve();

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INVENTORY_COUNT_COST_MISSING');
        expect(res.body.details).toEqual({ products: ['Azafrán'] });
        expect(apply).toHaveBeenCalledTimes(1); // line 1 was posted inside the transaction...
        expect(committed).toHaveLength(0); // ...and discarded with it
        expect(sheetUpdate).not.toHaveBeenCalled();
        expect(state.status).toBe('SUBMITTED');
    });

    it('reports every product without cost at once', async () => {
        setup({
            lines: [countedLine(11, 5, 1), countedLine(12, 5, 1)],
            products: { 11: { name: 'Azafrán', ...uncosted }, 12: { name: 'Vainilla', ...uncosted } },
        });
        const res = await approve();
        expect(res.body.details.products).toEqual(['Azafrán', 'Vainilla']);
    });

    it('lets an admin approve a sheet and records approvedById (lines keep their counter)', async () => {
        const { state, lineUpdate } = setup({ lines: [countedLine(10, 8, 10, { countedById: 2 })] });
        const res = await approve();
        expect(res.status).toBe(200);
        expect(state.approvedById).toBe(2);
        expect(JSON.stringify(lineUpdate.mock.calls)).not.toContain('countedById');
    });

    it('requires an idempotency key', async () => {
        setup();
        const res = await request(app).post('/api/v1/inventory-counts/70/approve').send({});
        expect(res.status).toBe(428);
    });
});

describe('POST /inventory-counts/:id/recount', () => {
    it('recount resets chosen lines, keeps previous count and returns sheet as DRAFT', async () => {
        const { lineUpdate, sheetUpdate, state } = setup({ lines: [] });
        jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue([
            { id: 100, countedBaseQuantity: decimal(8), previousCountedBase: null },
        ] as never);

        const res = await request(app).post('/api/v1/inventory-counts/70/recount').send({ productIds: [10], note: 'Revisar leche' });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ id: 70, status: 'DRAFT', recountCount: 1 });
        const data = (lineUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data).toEqual(expect.objectContaining({
            previousCountedBase: expect.anything(), countedQuantity: null, countedBaseQuantity: null, expectedAtCount: null,
            notCounted: false, recountRequested: true,
        }));
        expect(Number(data.previousCountedBase)).toBe(8);
        expect(sheetUpdate).toHaveBeenCalledWith({
            where: { id: 70 },
            data: expect.objectContaining({ status: 'DRAFT', returnNote: 'Revisar leche', returnedAt: expect.any(Date) }),
        });
        expect(state.openWarehouseId).toBe(3);
    });

    it('rejects an empty selection, unknown products and sheets that are not SUBMITTED', async () => {
        setup({ lines: [] });
        expect((await request(app).post('/api/v1/inventory-counts/70/recount').send({ productIds: [] })).status).toBe(400);
        jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue([] as never);
        expect((await request(app).post('/api/v1/inventory-counts/70/recount').send({ productIds: [99] })).status).toBe(400);
        jest.restoreAllMocks();
        setup({ status: 'DRAFT' });
        expect((await request(app).post('/api/v1/inventory-counts/70/recount').send({ productIds: [10] })).status).toBe(409);
    });
});

describe('POST /inventory-counts/:id/reject', () => {
    it('reject releases the warehouse for a new count', async () => {
        const { state, apply, sheetUpdate } = setup();

        const res = await request(app).post('/api/v1/inventory-counts/70/reject').send({ reason: 'Conteo dudoso' });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ id: 70, status: 'REJECTED' });
        expect(state.status).toBe('REJECTED');
        expect(state.openWarehouseId).toBeNull();
        expect(sheetUpdate).toHaveBeenCalledWith({
            where: { id: 70 },
            data: expect.objectContaining({ rejectedById: 2, rejectReason: 'Conteo dudoso' }),
        });
        expect(apply).not.toHaveBeenCalled();
    });

    it('requires a reason of 3 to 500 characters and a SUBMITTED sheet', async () => {
        setup();
        expect((await request(app).post('/api/v1/inventory-counts/70/reject').send({ reason: 'x' })).status).toBe(400);
        expect((await request(app).post('/api/v1/inventory-counts/70/reject').send({})).status).toBe(400);
        jest.restoreAllMocks();
        setup({ status: 'APPROVED' });
        expect((await request(app).post('/api/v1/inventory-counts/70/reject').send({ reason: 'Conteo dudoso' })).status).toBe(409);
    });
});

describe('review reads', () => {
    const reviewSheet = (over: Record<string, unknown> = {}) => ({
        id: 70, branchId: 1, warehouseId: 3, status: 'SUBMITTED', startedAt: new Date('2026-11-24T09:00:00.000Z'),
        submittedAt: new Date('2026-11-24T10:00:00.000Z'), returnedAt: null, returnNote: null, approvedAt: null, rejectedAt: null,
        rejectReason: null, scopeCategoryIds: null,
        branch: { name: 'Centro' }, warehouse: { id: 3, name: 'Cocina' }, startedBy: { name: 'Ana' }, submittedBy: { name: 'Ana' }, approvedBy: null, ...over,
    });
    const reviewLine = (productId: number, name: string, counted: number | null, expected: number | null, over: Record<string, unknown> = {}) => ({
        productId, unit: 'kg', countedQuantity: counted === null ? null : decimal(counted),
        countedBaseQuantity: counted === null ? null : decimal(counted), expectedAtCount: expected === null ? null : decimal(expected),
        notCounted: counted === null, recountRequested: false, previousCountedBase: null, countedAt: new Date('2026-11-24T09:30:00.000Z'),
        movementId: null, adjustmentValue: null,
        product: { name, unit: 'kg', baseUnit: { abbreviation: 'kg' } }, category: { name: 'Lácteos' }, countedBy: { name: 'Ana' }, ...over,
    });

    it('review lines expose expected, diff and value; totals split shortage and surplus', async () => {
        setup();
        jest.spyOn(prisma.inventoryCountSheet, 'findFirst').mockResolvedValue(reviewSheet() as never);
        jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue([
            reviewLine(10, 'Leche', 8, 10),
            reviewLine(11, 'Queso', 5, 3),
            reviewLine(12, 'Sal', 4, 4),
            reviewLine(13, 'Pimienta', null, null),
        ] as never);
        jest.spyOn(prisma.product, 'findMany').mockResolvedValue([
            { id: 10, ...costed }, { id: 11, ...costed, currentAverageCost: 3 }, { id: 12, ...costed }, { id: 13, ...costed },
        ] as never);

        const res = await request(app).get('/api/v1/inventory-counts/70/review');

        expect(res.status).toBe(200);
        const byId = new Map(res.body.data.lines.map((l: { productId: number }) => [l.productId, l]));
        expect(byId.get(10)).toEqual(expect.objectContaining({
            name: 'Leche', categoryName: 'Lácteos', expectedAtCount: 10, countedBaseQuantity: 8, diffQuantity: -2, unitCost: 2, diffValue: -4,
            notCounted: false, countedByName: 'Ana',
        }));
        expect(byId.get(11)).toEqual(expect.objectContaining({ diffQuantity: 2, unitCost: 3, diffValue: 6 }));
        expect(byId.get(12)).toEqual(expect.objectContaining({ diffQuantity: 0, diffValue: 0 }));
        expect(byId.get(13)).toEqual(expect.objectContaining({ notCounted: true, diffQuantity: null, diffValue: null }));
        expect(res.body.data.totals).toEqual({ differences: 2, shortageValue: 4, surplusValue: 6, netValue: 2, notCounted: 1 });
    });

    it('approved sheets report the stored adjustment value, not the cost of the day', async () => {
        setup();
        jest.spyOn(prisma.inventoryCountSheet, 'findFirst').mockResolvedValue(reviewSheet({ status: 'APPROVED' }) as never);
        jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue([
            reviewLine(10, 'Leche', 8, 10, { movementId: 510, adjustmentValue: decimal(-3) }),
        ] as never);
        jest.spyOn(prisma.product, 'findMany').mockResolvedValue([{ id: 10, ...costed, currentAverageCost: 99 }] as never);

        const res = await request(app).get('/api/v1/inventory-counts/70/review');

        expect(res.body.data.lines[0]).toEqual(expect.objectContaining({ diffValue: -3, unitCost: 1.5, movementId: 510 }));
        expect(res.body.data.totals.netValue).toBe(-3);
    });

    it('lists sheets for review with differences and net value', async () => {
        setup();
        jest.spyOn(prisma.inventoryCountSheet, 'findMany').mockResolvedValue([{
            id: 70, status: 'SUBMITTED', startedAt: new Date('2026-11-24T09:00:00.000Z'), submittedAt: new Date('2026-11-24T10:00:00.000Z'),
            returnedAt: null, branch: { name: 'Centro' }, warehouse: { name: 'Cocina' }, startedBy: { name: 'Ana' },
        }] as never);
        jest.spyOn(prisma.inventoryCountSheet, 'count').mockResolvedValue(1 as never);
        const findLines = jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue([
            { sheetId: 70, productId: 10, countedBaseQuantity: decimal(8), expectedAtCount: decimal(10), notCounted: false, adjustmentValue: null, movementId: null },
            { sheetId: 70, productId: 11, countedBaseQuantity: null, expectedAtCount: null, notCounted: true, adjustmentValue: null, movementId: null },
        ] as never);
        jest.spyOn(prisma.product, 'findMany').mockResolvedValue([{ id: 10, ...costed }, { id: 11, ...costed }] as never);

        const res = await request(app).get('/api/v1/inventory-counts/review?status=SUBMITTED');

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
            total: 1,
            items: [{
                id: 70, branchName: 'Centro', warehouseName: 'Cocina', startedByName: 'Ana',
                startedAt: '2026-11-24T09:00:00.000Z', submittedAt: '2026-11-24T10:00:00.000Z',
                status: 'SUBMITTED', displayStatus: 'EN_REVISION', productCount: 2, countedCount: 1, differences: 1, netValue: -4,
            }],
        });
        expect(findLines).toHaveBeenCalled();
        expect((await request(app).get('/api/v1/inventory-counts/review?status=bogus')).status).toBe(400);
        expect((await request(app).get('/api/v1/inventory-counts/review?dateFrom=nope')).status).toBe(400);
    });

    it('non-admin cannot reach review routes', async () => {
        const { apply } = setup();
        currentUser = bodega;
        expect((await request(app).get('/api/v1/inventory-counts/review')).status).toBe(403);
        expect((await request(app).get('/api/v1/inventory-counts/70/review')).status).toBe(403);
        expect((await request(app).post('/api/v1/inventory-counts/70/recount').send({ productIds: [10] })).status).toBe(403);
        expect((await request(app).post('/api/v1/inventory-counts/70/reject').send({ reason: 'abc' })).status).toBe(403);
        expect((await request(app).post('/api/v1/inventory-counts/70/approve').set(KEY).send({})).status).toBe(403);
        expect(apply).not.toHaveBeenCalled();
    });
});

describe('line save clock cap', () => {
    it('a device clock far in the future is replaced by server time so later saves are not blocked', async () => {
        currentUser = bodega;
        jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([] as never);
        jest.spyOn(prisma.inventoryCountSheet, 'findFirst').mockResolvedValue({
            id: 70, companyId: 5, branchId: 1, warehouseId: 3, status: 'DRAFT', returnedAt: null, returnNote: null,
            startedAt: new Date(), scopeCategoryIds: null, warehouse: { id: 3, name: 'Cocina' }, startedBy: { name: 'Ana' },
        } as never);
        jest.spyOn(prisma.inventoryCountLine, 'findUnique').mockResolvedValue({ id: 1, countedBaseQuantity: null, clientCountedAt: null } as never);
        jest.spyOn(prisma.stock, 'findFirst').mockResolvedValue({ quantity: 7 } as never);
        jest.spyOn(UnitConversionService, 'getAllowedUnitsForProducts').mockResolvedValue(new Map([[10, units()]]) as never);
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({ baseQuantity: 2 } as never);
        const updateLine = jest.spyOn(prisma.inventoryCountLine, 'updateMany').mockResolvedValue({ count: 1 } as never);

        const before = Date.now();
        const res = await request(app).put('/api/v1/inventory-counts/70/lines/10').set({ 'X-Idempotency-Key': 'count-70-10-9999999999999' })
            .send({ unit: 'kg', countedQuantity: 2, clientCountedAt: '2099-01-01T00:00:00.000Z' });

        expect(res.status).toBe(200);
        const stored = (updateLine.mock.calls[0][0] as { data: { clientCountedAt: Date } }).data.clientCountedAt;
        expect(stored.getTime()).toBeGreaterThanOrEqual(before);
        expect(stored.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });
});
