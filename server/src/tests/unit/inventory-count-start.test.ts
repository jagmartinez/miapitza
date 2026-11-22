import express from 'express';
import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

let currentUser: Record<string, unknown> = {};
jest.mock('../../middlewares/auth', () => ({
    authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = currentUser; next(); },
    extractAuthToken: () => 'session-token',
    requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const prisma = require('../../utils/prisma').default as typeof import('../../utils/prisma').default;
const inventoryCountRoutes = require('../../routes/inventory-count.routes').default as import('express').Router;
const { errorHandler } = require('../../middlewares/errorHandler') as typeof import('../../middlewares/errorHandler');

const app = express();
app.use(express.json());
app.use('/api/v1/inventory-counts', inventoryCountRoutes);
app.use(errorHandler);

const admin = { userId: 1, companyId: 5, branchId: 1, role: 'ADMIN', roles: ['ADMIN'], permissions: [] };
const bodega = { userId: 9, companyId: 5, branchId: 1, role: 'BODEGA', roles: ['BODEGA'], permissions: [] };
const warehouse = { id: 3, companyId: 5, branchId: 1, type: 'BRANCH', name: 'Cocina' };

function setup(over: { user?: Record<string, unknown>; warehouse?: unknown; products?: unknown[] } = {}) {
    currentUser = over.user ?? bodega;
    jest.spyOn(console, 'error').mockImplementation(() => undefined); // the shared handler logs expected 403s
    jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    const findWarehouse = jest.spyOn(prisma.warehouse, 'findFirst').mockResolvedValue(('warehouse' in over ? over.warehouse : warehouse) as never);
    const products = jest.spyOn(prisma.product, 'findMany').mockResolvedValue((over.products ?? [
        { id: 10, categoryId: 1 }, { id: 11, categoryId: null },
    ]) as never);
    const createSheet = jest.spyOn(prisma.inventoryCountSheet, 'create').mockResolvedValue({ id: 70 } as never);
    const createLines = jest.spyOn(prisma.inventoryCountLine, 'createMany').mockResolvedValue({ count: 2 } as never);
    return { findWarehouse, products, createSheet, createLines };
}

const start = (body: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/inventory-counts').send({ warehouseId: 3, categoryIds: null, ...body });

describe('POST /inventory-counts', () => {
    it('creates sheet with one line per active stocked product in scope', async () => {
        const { products, createSheet, createLines } = setup();
        const res = await start({ categoryIds: [1] }).expect(201);
        expect(res.body).toEqual({ success: true, data: { id: 70, status: 'DRAFT', warehouseId: 3, productCount: 2 } });
        // inactive products, products without Stock in the warehouse and showInInventory:false categories are excluded by the query
        const where = (products.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect((where.AND as unknown[])[0]).toMatchObject({ companyId: 5, active: true, stocks: { some: { warehouseId: 3 } } });
        expect(JSON.stringify(where)).toContain('"showInInventory":true');
        expect(JSON.stringify(where)).toContain('"categoryId":{"in":[1]}');
        const data = (createSheet.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data).toMatchObject({
            companyId: 5, branchId: 1, warehouseId: 3, status: 'DRAFT', openWarehouseId: 3, startedById: 9, scopeCategoryIds: [1],
        });
        expect((createLines.mock.calls[0][0] as { data: unknown[] }).data).toEqual([
            { sheetId: 70, productId: 10, categoryId: 1 },
            { sheetId: 70, productId: 11, categoryId: null },
        ]);
    });

    it('categoryIds null means whole warehouse; null category grouped as Sin categoria', async () => {
        const { products, createSheet, createLines } = setup();
        await start({ categoryIds: null }).expect(201);
        expect(JSON.stringify((products.mock.calls[0][0] as { where: unknown }).where)).not.toContain('"in"');
        const data = (createSheet.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data.scopeCategoryIds).toBe(Prisma.JsonNull);
        const lines = (createLines.mock.calls[0][0] as { data: Array<{ categoryId: number | null }> }).data;
        expect(lines.map((l) => l.categoryId)).toEqual([1, null]);
    });

    it('a scope with no products is INVENTORY_COUNT_INVALID', async () => {
        const { createSheet } = setup({ products: [] });
        const res = await start().expect(400);
        expect(res.body.code).toBe('INVENTORY_COUNT_INVALID');
        expect(createSheet).not.toHaveBeenCalled();
    });

    it('second open sheet for same warehouse returns WAREHOUSE_BUSY with sheetId', async () => {
        const { createSheet, createLines } = setup();
        createSheet.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
        const open = jest.spyOn(prisma.inventoryCountSheet, 'findFirst').mockResolvedValue({ id: 66 } as never);
        const res = await start().expect(409);
        expect(res.body).toMatchObject({ success: false, code: 'INVENTORY_COUNT_WAREHOUSE_BUSY', details: { sheetId: 66 } });
        expect(createLines).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ warehouseId: 3, openWarehouseId: 3 }) }));
    });

    it('warehouse of other branch is forbidden for branch-pinned user', async () => {
        const { createSheet } = setup({ warehouse: { ...warehouse, branchId: 2 } });
        await start().expect(403);
        expect(createSheet).not.toHaveBeenCalled();
    });

    it('central warehouse (null branch) is allowed for a pinned user and stored with null branch', async () => {
        const { createSheet } = setup({ warehouse: { ...warehouse, branchId: null, type: 'CENTRAL' } });
        await start().expect(201);
        expect((createSheet.mock.calls[0][0] as { data: Record<string, unknown> }).data.branchId).toBeNull();
    });

    it('warehouse of another company is not found', async () => {
        const { findWarehouse } = setup({ warehouse: null });
        const res = await start().expect(404);
        expect(res.body.code).toBe('INVENTORY_COUNT_NOT_FOUND');
        expect(findWarehouse).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3, companyId: 5 } }));
    });

    it.each([
        ['missing warehouseId', { warehouseId: undefined }],
        ['categoryIds not an array', { categoryIds: 'x' }],
        ['empty categoryIds', { categoryIds: [] }],
        ['fractional category id', { categoryIds: [1.5] }],
    ])('validates body: %s', async (_label, body) => {
        const { createSheet } = setup();
        await start(body).expect(400);
        expect(createSheet).not.toHaveBeenCalled();
    });
});

describe('GET /inventory-counts/warehouses', () => {
    it('warehouses list marks openSheet and lastCountAt', async () => {
        setup({ user: admin });
        const find = jest.spyOn(prisma.warehouse, 'findMany').mockResolvedValue([
            { id: 3, name: 'Cocina', type: 'BRANCH' }, { id: 4, name: 'Bar', type: 'BRANCH' },
        ] as never);
        jest.spyOn(prisma.stock, 'groupBy').mockResolvedValue([
            { warehouseId: 3, _count: { _all: 12 } },
        ] as never);
        jest.spyOn(prisma.inventoryCountSheet, 'findMany').mockResolvedValue([
            { id: 66, warehouseId: 3, status: 'SUBMITTED' },
        ] as never);
        jest.spyOn(prisma.inventoryCountSheet, 'groupBy').mockResolvedValue([
            { warehouseId: 4, _max: { approvedAt: new Date('2026-11-01T10:00:00.000Z') } },
        ] as never);
        const res = await request(app).get('/api/v1/inventory-counts/warehouses').expect(200);
        expect(res.body.data).toEqual([
            { id: 3, name: 'Cocina', type: 'BRANCH', productCount: 12, lastCountAt: null, openSheet: { id: 66, status: 'SUBMITTED' } },
            { id: 4, name: 'Bar', type: 'BRANCH', productCount: 0, lastCountAt: '2026-11-01T10:00:00.000Z', openSheet: null },
        ]);
        // company-wide admin: no branch filter
        expect((find.mock.calls[0][0] as { where: Record<string, unknown> }).where).toEqual({ companyId: 5 });
    });

    it('a pinned user only sees warehouses of their branch and the central one', async () => {
        setup();
        const find = jest.spyOn(prisma.warehouse, 'findMany').mockResolvedValue([] as never);
        await request(app).get('/api/v1/inventory-counts/warehouses').expect(200);
        expect((find.mock.calls[0][0] as { where: unknown }).where).toEqual({ companyId: 5, OR: [{ branchId: 1 }, { branchId: null }] });
    });
});

describe('GET /inventory-counts/warehouses/:id/categories', () => {
    it('lists categories by sortOrder then name with Sin categoria last', async () => {
        setup();
        jest.spyOn(prisma.product, 'groupBy').mockResolvedValue([
            { categoryId: null, _count: { _all: 2 } },
            { categoryId: 2, _count: { _all: 5 } },
            { categoryId: 1, _count: { _all: 3 } },
            { categoryId: 7, _count: { _all: 1 } },
        ] as never);
        jest.spyOn(prisma.category, 'findMany').mockResolvedValue([
            { id: 1, name: 'Lacteos', sortOrder: 2 },
            { id: 2, name: 'Carnes', sortOrder: 2 },
            { id: 7, name: 'Abarrotes', sortOrder: 1 },
        ] as never);
        const res = await request(app).get('/api/v1/inventory-counts/warehouses/3/categories').expect(200);
        expect(res.body.data).toEqual([
            { categoryId: 7, name: 'Abarrotes', productCount: 1 },
            { categoryId: 2, name: 'Carnes', productCount: 5 },
            { categoryId: 1, name: 'Lacteos', productCount: 3 },
            { categoryId: null, name: 'Sin categoría', productCount: 2 },
        ]);
    });

    it('is forbidden for a warehouse of another branch', async () => {
        setup({ warehouse: { ...warehouse, branchId: 2 } });
        await request(app).get('/api/v1/inventory-counts/warehouses/3/categories').expect(403);
    });
});

describe('GET /inventory-counts', () => {
    const base = {
        warehouse: { name: 'Cocina' },
        startedBy: { name: 'Ana' },
        scopeCategoryIds: null,
        startedAt: new Date('2026-11-10T09:00:00.000Z'),
    };

    it('recent list hides result until approved', async () => {
        setup({ user: admin });
        jest.spyOn(prisma.inventoryCountSheet, 'findMany').mockResolvedValue([
            { ...base, id: 4, status: 'APPROVED', returnedAt: null },
            { ...base, id: 3, status: 'SUBMITTED', returnedAt: null },
            { ...base, id: 2, status: 'DRAFT', returnedAt: new Date('2026-11-10T11:00:00.000Z') },
            { ...base, id: 1, status: 'DRAFT', returnedAt: null },
        ] as never);
        jest.spyOn(prisma.inventoryCountSheet, 'count').mockResolvedValue(4 as never);
        const groups = [
            { sheetId: 4, _count: { _all: 10, countedBaseQuantity: 10 } },
            { sheetId: 3, _count: { _all: 8, countedBaseQuantity: 8 } },
            { sheetId: 2, _count: { _all: 6, countedBaseQuantity: 6 } },
            { sheetId: 1, _count: { _all: 5, countedBaseQuantity: 2 } },
        ];
        jest.spyOn(prisma.inventoryCountLine, 'groupBy').mockImplementation((async (args: { where: Record<string, unknown> }) => {
            if (args.where.recountRequested) return [{ sheetId: 2, _count: { _all: 3 } }];
            if (args.where.movementId) return [{ sheetId: 4, _count: { _all: 2 }, _sum: { adjustmentValue: new Prisma.Decimal('-35.50') } }];
            return groups;
        }) as never);
        const res = await request(app).get('/api/v1/inventory-counts?status=all').expect(200);
        const byId = Object.fromEntries((res.body.data.items as Array<{ id: number }>).map((i) => [i.id, i]));
        expect(res.body.data.total).toBe(4);
        expect(byId[4]).toMatchObject({ displayStatus: 'APROBADO', result: { differences: 2, value: -35.5 }, warehouseName: 'Cocina', startedByName: 'Ana', productCount: 10, countedCount: 10, scopeLabel: 'Todo' });
        expect(byId[3]).toMatchObject({ status: 'SUBMITTED', displayStatus: 'EN_REVISION', result: null });
        expect(byId[2]).toMatchObject({ status: 'DRAFT', displayStatus: 'DEVUELTO', result: { recount: 3 } });
        expect(byId[1]).toMatchObject({ displayStatus: 'EN_CURSO', result: null, productCount: 5, countedCount: 2 });
        // blind: the DTO is a whitelist
        for (const item of Object.values(byId)) {
            expect(Object.keys(item).sort()).toEqual([
                'countedCount', 'displayStatus', 'id', 'productCount', 'result', 'scopeLabel', 'startedAt', 'startedByName', 'status', 'warehouseName',
            ]);
        }
    });

    it('filters by status group, caps pageSize at 50 and scopes by branch', async () => {
        setup();
        const find = jest.spyOn(prisma.inventoryCountSheet, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.inventoryCountSheet, 'count').mockResolvedValue(0 as never);
        await request(app).get('/api/v1/inventory-counts?status=review&page=2&pageSize=500').expect(200);
        const args = find.mock.calls[0][0] as { where: Record<string, unknown>; skip: number; take: number; orderBy: unknown };
        expect(args.where).toMatchObject({ companyId: 5, status: 'SUBMITTED', OR: [{ branchId: 1 }, { branchId: null }] });
        expect(args.take).toBe(50);
        expect(args.skip).toBe(50);
        expect(args.orderBy).toEqual([{ startedAt: 'desc' }, { id: 'desc' }]);
    });

    it('rejects an unknown status', async () => {
        setup();
        const res = await request(app).get('/api/v1/inventory-counts?status=zzz').expect(400);
        expect(res.body.code).toBe('INVENTORY_COUNT_INVALID');
    });
});
