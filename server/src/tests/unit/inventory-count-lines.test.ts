import express from 'express';
import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';

let currentUser: Record<string, unknown> = {};
jest.mock('../../middlewares/auth', () => ({
    authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = currentUser; next(); },
    extractAuthToken: () => 'session-token',
    requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const prisma = require('../../utils/prisma').default as typeof import('../../utils/prisma').default;
const inventoryCountRoutes = require('../../routes/inventory-count.routes').default as import('express').Router;
const { errorHandler } = require('../../middlewares/errorHandler') as typeof import('../../middlewares/errorHandler');
const { UnitConversionService } = require('../../services/unit-conversion.service') as typeof import('../../services/unit-conversion.service');

const app = express();
app.use(express.json());
app.use('/api/v1/inventory-counts', inventoryCountRoutes);
app.use(errorHandler);

const bodega = { userId: 9, companyId: 5, branchId: 1, role: 'BODEGA', roles: ['BODEGA'], permissions: [] };
const T1 = '2026-11-24T10:00:00.000Z';
const T2 = '2026-11-24T10:05:00.000Z';
const KEY = { 'X-Idempotency-Key': 'count-70-10-1234567890' };

const units = [
    { unitId: 1, abbreviation: 'kg', name: 'Kilogramo', conversionFactor: 1, isBase: true, isDefault: true },
    { unitId: 2, abbreviation: 'bolsa', name: 'Bolsa 5 kg', conversionFactor: 5, isBase: false, isDefault: false },
];

const sheetRow = (over: Record<string, unknown> = {}) => ({
    id: 70, companyId: 5, branchId: 1, warehouseId: 3, status: 'DRAFT', returnNote: null, startedAt: new Date('2026-11-24T09:00:00.000Z'),
    scopeCategoryIds: null, warehouse: { id: 3, name: 'Cocina' }, startedBy: { name: 'Ana' }, ...over,
});
const lineRow = (over: Record<string, unknown> = {}) => ({
    id: 1, sheetId: 70, productId: 10, categoryId: 1, unit: null, countedQuantity: null, countedBaseQuantity: null,
    clientCountedAt: null, recountRequested: false, ...over,
});
const decimal = (value: string) => ({ toString: () => value });

function setup(over: { sheet?: unknown; line?: unknown; stock?: unknown; updated?: number } = {}) {
    currentUser = bodega;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    const lock = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([] as never);
    const findSheet = jest.spyOn(prisma.inventoryCountSheet, 'findFirst').mockResolvedValue(('sheet' in over ? over.sheet : sheetRow()) as never);
    const findLine = jest.spyOn(prisma.inventoryCountLine, 'findUnique').mockResolvedValue(('line' in over ? over.line : lineRow()) as never);
    const findStock = jest.spyOn(prisma.stock, 'findFirst').mockResolvedValue(('stock' in over ? over.stock : { quantity: 7.5 }) as never);
    const updateLine = jest.spyOn(prisma.inventoryCountLine, 'updateMany').mockResolvedValue({ count: over.updated ?? 1 } as never);
    jest.spyOn(UnitConversionService, 'getAllowedUnitsForProducts').mockResolvedValue(new Map([[10, units]]) as never);
    const convert = jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (_p: number, _c: number, qty: number, unit: string) => ({
        baseQuantity: qty * (unit === 'bolsa' ? 5 : 1),
    })) as never);
    return { lock, findSheet, findLine, findStock, updateLine, convert };
}

const put = (body: Record<string, unknown> = {}, productId = 10) =>
    request(app).put(`/api/v1/inventory-counts/70/lines/${productId}`).set(KEY)
        .send({ unit: 'bolsa', countedQuantity: 2, clientCountedAt: T1, ...body });

const dataOf = (mock: { mock: { calls: unknown[][] } }) => (mock.mock.calls[0][0] as { data: Record<string, unknown> }).data;

afterEach(() => { jest.restoreAllMocks(); });

describe('GET /inventory-counts/:id (blind sheet)', () => {
    it('counter payloads never contain expected or stock', async () => {
        setup();
        jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue([
            {
                productId: 10, categoryId: 1, unit: 'bolsa', countedQuantity: decimal('2'), countedBaseQuantity: decimal('10'), recountRequested: false,
                product: { name: 'Arroz', sku: 'ARR', unit: 'kg' },
            },
            {
                productId: 11, categoryId: null, unit: null, countedQuantity: null, countedBaseQuantity: null, recountRequested: true,
                product: { name: 'Sal', sku: null, unit: 'kg' },
            },
        ] as never);
        jest.spyOn(prisma.category, 'findMany').mockResolvedValue([{ id: 1, name: 'Granos', sortOrder: 1 }] as never);
        jest.spyOn(UnitConversionService, 'getAllowedUnitsForProducts').mockResolvedValue(new Map([[10, units], [11, units.slice(0, 1)]]) as never);
        const res = await request(app).get('/api/v1/inventory-counts/70').expect(200);
        const data = res.body.data;
        expect(Object.keys(data).sort()).toEqual([
            'categories', 'displayStatus', 'id', 'lines', 'returnNote', 'scopeLabel', 'startedAt', 'startedByName', 'status', 'warehouse',
        ]);
        expect(data.warehouse).toEqual({ id: 3, name: 'Cocina' });
        expect(data.categories).toEqual([{ categoryId: 1, name: 'Granos' }, { categoryId: null, name: 'Sin categoría' }]);
        for (const line of data.lines) {
            expect(Object.keys(line).sort()).toEqual([
                'baseUnit', 'categoryId', 'counted', 'countedQuantity', 'name', 'productId', 'recountRequested', 'sku', 'unit', 'units',
            ]);
            for (const unit of line.units) expect(Object.keys(unit).sort()).toEqual(['abbreviation', 'factor', 'name']);
        }
        expect(data.lines[0]).toMatchObject({
            productId: 10, baseUnit: 'kg', unit: 'bolsa', countedQuantity: 2, counted: true,
            units: [{ abbreviation: 'kg', name: 'Kilogramo', factor: 1 }, { abbreviation: 'bolsa', name: 'Bolsa 5 kg', factor: 5 }],
        });
        expect(data.lines[1]).toMatchObject({ counted: false, countedQuantity: null, recountRequested: true });
        expect(JSON.stringify(res.body)).not.toMatch(/expected|stock|cost/i);
    });

    it('units loaded in one query for the whole sheet', async () => {
        currentUser = bodega;
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(prisma.inventoryCountSheet, 'findFirst').mockResolvedValue(sheetRow() as never);
        jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue([10, 11, 12].map((id) => ({
            productId: id, categoryId: 1, unit: null, countedQuantity: null, countedBaseQuantity: null, recountRequested: false,
            product: { name: `P${id}`, sku: null, unit: 'kg' },
        })) as never);
        jest.spyOn(prisma.category, 'findMany').mockResolvedValue([{ id: 1, name: 'Granos', sortOrder: 1 }] as never);
        const kg = { id: 1, companyId: 5, active: true, abbreviation: 'kg', name: 'Kilogramo', measurementType: 'MASS', systemFactor: 1000 };
        const products = jest.spyOn(prisma.product, 'findMany').mockResolvedValue([10, 11, 12].map((id) => ({
            id, name: `P${id}`, unit: 'kg', baseUnitId: 1, baseUnit: kg, allowedUnits: [],
        })) as never);
        jest.spyOn(prisma.unitOfMeasure, 'findMany').mockResolvedValue([
            kg, { id: 3, companyId: 5, active: true, abbreviation: 'g', name: 'Gramo', measurementType: 'MASS', systemFactor: 1 },
        ] as never);
        const res = await request(app).get('/api/v1/inventory-counts/70').expect(200);
        expect(products).toHaveBeenCalledTimes(1);
        expect(res.body.data.lines).toHaveLength(3);
        expect(res.body.data.lines[0].units.map((u: { abbreviation: string }) => u.abbreviation)).toEqual(['kg', 'g']);
    });

    it('sheet of another company is not found and of another branch is forbidden', async () => {
        setup({ sheet: null });
        await request(app).get('/api/v1/inventory-counts/70').expect(404);
        jest.restoreAllMocks();
        setup({ sheet: sheetRow({ branchId: 2 }) });
        await request(app).get('/api/v1/inventory-counts/70').expect(403);
    });
});

describe('PUT /inventory-counts/:id/lines/:productId', () => {
    it('save converts unit to base and captures expected at save time', async () => {
        const { updateLine, convert, findStock } = setup();
        const res = await put().expect(200);
        expect(res.body).toEqual({ success: true, data: { productId: 10, counted: true, applied: true } });
        expect(convert).toHaveBeenCalledWith(10, 5, 2, 'bolsa', expect.anything());
        expect(findStock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ warehouseId: 3, productId: 10, companyId: 5 }) }));
        expect(dataOf(updateLine)).toMatchObject({
            unit: 'bolsa', countedQuantity: 2, countedBaseQuantity: 10, expectedAtCount: 7.5, countedById: 9,
            clientCountedAt: new Date(T1), recountRequested: false, notCounted: false,
        });
        expect(dataOf(updateLine).countedAt).toBeInstanceOf(Date);
    });

    it('expected captured at save time and recaptured on recount', async () => {
        const first = setup({ stock: { quantity: 10 } });
        await put({ unit: 'kg', countedQuantity: 8 }).expect(200);
        expect(dataOf(first.updateLine).expectedAtCount).toBe(10);
        jest.restoreAllMocks();
        // 2 units were sold meanwhile and the line was returned for recount
        const second = setup({
            stock: { quantity: 8 },
            line: lineRow({ unit: 'kg', countedQuantity: decimal('8'), countedBaseQuantity: decimal('8'), clientCountedAt: new Date(T1), recountRequested: true }),
        });
        await put({ unit: 'kg', countedQuantity: 8, clientCountedAt: T2 }).expect(200);
        expect(dataOf(second.updateLine)).toMatchObject({ expectedAtCount: 8, countedBaseQuantity: 8, recountRequested: false });
    });

    it('older clientCountedAt is ignored', async () => {
        const { updateLine } = setup({ line: lineRow({ unit: 'kg', countedQuantity: decimal('3'), countedBaseQuantity: decimal('3'), clientCountedAt: new Date(T2) }) });
        const res = await put({ clientCountedAt: T1 }).expect(200);
        expect(res.body.data).toEqual({ productId: 10, counted: true, applied: false });
        const same = await put({ clientCountedAt: T2 }).expect(200);
        expect(same.body.data.applied).toBe(false);
        expect(updateLine).not.toHaveBeenCalled();
    });

    it('losing a race against a newer save reports applied false', async () => {
        setup({ updated: 0 });
        const res = await put().expect(200);
        expect(res.body.data.applied).toBe(false);
    });

    it('null quantity clears the line', async () => {
        const { updateLine, findStock } = setup({
            line: lineRow({ unit: 'kg', countedQuantity: decimal('3'), countedBaseQuantity: decimal('3'), clientCountedAt: new Date(T1) }),
        });
        const res = await put({ countedQuantity: null, clientCountedAt: T2 }).expect(200);
        expect(res.body.data).toEqual({ productId: 10, counted: false, applied: true });
        expect(dataOf(updateLine)).toMatchObject({
            unit: null, countedQuantity: null, countedBaseQuantity: null, expectedAtCount: null, countedById: null,
            clientCountedAt: new Date(T2), recountRequested: false,
        });
        expect(findStock).not.toHaveBeenCalled();
    });

    it('zero is a valid count', async () => {
        const { updateLine } = setup();
        await put({ unit: 'kg', countedQuantity: 0 }).expect(200);
        expect(dataOf(updateLine)).toMatchObject({ countedQuantity: 0, countedBaseQuantity: 0, expectedAtCount: 7.5 });
    });

    it('unit not allowed for product is UNIT_INVALID', async () => {
        const { updateLine } = setup();
        const res = await put({ unit: 'caja' }).expect(400);
        expect(res.body.code).toBe('INVENTORY_COUNT_UNIT_INVALID');
        expect(updateLine).not.toHaveBeenCalled();
    });

    it.each([
        ['more than 3 decimals', { countedQuantity: 1.2345 }],
        ['negative', { countedQuantity: -1 }],
        ['string quantity', { countedQuantity: '5' }],
        ['huge quantity', { countedQuantity: 1e12 }],
    ])('%s is INVALID', async (_label, body) => {
        const { updateLine } = setup();
        const res = await put(body).expect(400);
        expect(res.body.code).toBe('INVENTORY_COUNT_INVALID');
        expect(updateLine).not.toHaveBeenCalled();
    });

    it('missing unit or bad clientCountedAt is rejected', async () => {
        const { updateLine } = setup();
        await put({ unit: undefined }).expect(400);
        await put({ clientCountedAt: 'yesterday' }).expect(400);
        expect(updateLine).not.toHaveBeenCalled();
    });

    it('requires an idempotency key', async () => {
        setup();
        await request(app).put('/api/v1/inventory-counts/70/lines/10').send({ unit: 'kg', countedQuantity: 1, clientCountedAt: T1 }).expect(428);
    });

    it('product outside the sheet is NOT_FOUND', async () => {
        const { updateLine } = setup({ line: null });
        const res = await put({}, 99).expect(404);
        expect(res.body.code).toBe('INVENTORY_COUNT_NOT_FOUND');
        expect(updateLine).not.toHaveBeenCalled();
    });

    it('save on submitted sheet is NOT_EDITABLE', async () => {
        const { updateLine } = setup({ sheet: sheetRow({ status: 'SUBMITTED' }) });
        const res = await put().expect(409);
        expect(res.body.code).toBe('INVENTORY_COUNT_NOT_EDITABLE');
        expect(updateLine).not.toHaveBeenCalled();
    });
});

describe('POST /inventory-counts/:id/submit', () => {
    const submit = () => request(app).post('/api/v1/inventory-counts/70/submit').send({});

    function setupSubmit(lines: Array<{ countedBaseQuantity: unknown; recountRequested: boolean }>, sheet: unknown = sheetRow()) {
        const base = setup({ sheet });
        const findLines = jest.spyOn(prisma.inventoryCountLine, 'findMany').mockResolvedValue(lines as never);
        const updateLines = jest.spyOn(prisma.inventoryCountLine, 'updateMany').mockResolvedValue({ count: 1 } as never);
        const updateSheet = jest.spyOn(prisma.inventoryCountSheet, 'update').mockResolvedValue({} as never);
        return { ...base, findLines, updateLines, updateSheet };
    }

    it('submit marks uncounted lines notCounted and rejects empty sheet', async () => {
        const empty = setupSubmit([{ countedBaseQuantity: null, recountRequested: false }]);
        const res = await submit().expect(409);
        expect(res.body.code).toBe('INVENTORY_COUNT_EMPTY');
        expect(empty.updateSheet).not.toHaveBeenCalled();
        expect(empty.updateLines).not.toHaveBeenCalled();
        jest.restoreAllMocks();

        const ok = setupSubmit([
            { countedBaseQuantity: decimal('4'), recountRequested: false },
            { countedBaseQuantity: null, recountRequested: false },
            { countedBaseQuantity: null, recountRequested: false },
        ]);
        const done = await submit().expect(200);
        expect(done.body.data).toEqual({ id: 70, status: 'SUBMITTED', counted: 1, notCounted: 2 });
        expect(ok.lock).toHaveBeenCalled();
        expect(ok.updateLines).toHaveBeenCalledWith({ where: { sheetId: 70, countedBaseQuantity: null }, data: { notCounted: true } });
        expect(dataOf(ok.updateSheet)).toMatchObject({ status: 'SUBMITTED', submittedById: 9, returnNote: null });
    });

    it('submit with pending recount is RECOUNT_PENDING', async () => {
        const { updateSheet } = setupSubmit([
            { countedBaseQuantity: decimal('4'), recountRequested: false },
            { countedBaseQuantity: decimal('2'), recountRequested: true },
        ]);
        const res = await submit().expect(409);
        expect(res.body.code).toBe('INVENTORY_COUNT_RECOUNT_PENDING');
        expect(updateSheet).not.toHaveBeenCalled();
    });

    it('submit on a sheet already in review is NOT_EDITABLE', async () => {
        setupSubmit([], sheetRow({ status: 'SUBMITTED' }));
        const res = await submit().expect(409);
        expect(res.body.code).toBe('INVENTORY_COUNT_NOT_EDITABLE');
    });
});

describe('list status filter', () => {
    it('?status=constructor is a 400, not a 500', async () => {
        setup();
        const res = await request(app).get('/api/v1/inventory-counts?status=constructor').expect(400);
        expect(res.body.code).toBe('INVENTORY_COUNT_INVALID');
    });
});
