import { describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '@prisma/client';

import {
    RecipeCatalogMap,
    RecipeCatalogPreparationService,
    parseRecipeCatalogMap
} from '../../services/recipe-catalog-preparation.service';

const map: RecipeCatalogMap = {
    schemaVersion: 1,
    source: { file: 'Recetas Menu.xlsx', sha256: 'a'.repeat(64) },
    defaultCategory: 'Producción',
    entries: [
        {
            sourceName: 'Masa precocida',
            productSku: 'PRD-000002',
            mode: 'EXISTING',
            catalogName: 'Masa precocida',
            baseUnit: 'g',
            productType: 'INTERMEDIATE',
            storageType: null,
            referenceCost: null,
            activate: true,
            recipeUnitOverride: null
        },
        {
            sourceName: 'Salsa roja',
            productSku: 'RCP-000001',
            mode: 'CREATE',
            catalogName: 'Salsa roja',
            baseUnit: 'g',
            productType: 'INTERMEDIATE',
            storageType: 'PERISHABLE',
            referenceCost: 0.113364,
            activate: true,
            recipeUnitOverride: null
        }
    ]
};

type StateProduct = {
    id: number;
    sku: string;
    name: string;
    active: boolean;
    type: 'INGREDIENT' | 'INTERMEDIATE';
    unit: string;
    baseUnitId: number;
    allowedUnits: Array<{ unitId: number; conversionFactor: number; isDefault: boolean; active: boolean }>;
};

function makeDb() {
    const state: StateProduct[] = [{
        id: 10,
        sku: 'PRD-000002',
        name: 'Masa precocida',
        active: false,
        type: 'INGREDIENT',
        unit: 'g',
        baseUnitId: 9,
        allowedUnits: []
    }];
    let nextId = 20;
    const db = {
        company: { findFirst: jest.fn(async () => ({ id: 1, name: 'La Mia Pitza' })) },
        user: { findMany: jest.fn(async () => [{ id: 7, name: 'Admin' }]) },
        category: { findMany: jest.fn(async () => [{ id: 3, name: 'Producción', active: true }]) },
        unitOfMeasure: {
            findMany: jest.fn(async () => [{
                id: 9,
                abbreviation: 'g',
                measurementType: 'MASS' as const,
                systemFactor: 1,
                active: true
            }])
        },
        product: {
            findMany: jest.fn(async () => state.map((product) => ({ ...product, allowedUnits: [...product.allowedUnits] }))),
            create: jest.fn(async (args: unknown) => {
                const data = (args as { data: Record<string, unknown> }).data;
                const product: StateProduct = {
                    id: nextId++,
                    sku: String(data.sku),
                    name: String(data.name),
                    active: Boolean(data.active),
                    type: data.type as StateProduct['type'],
                    unit: String(data.unit),
                    baseUnitId: Number(data.baseUnitId),
                    allowedUnits: []
                };
                state.push(product);
                return product;
            }),
            update: jest.fn(async (args: unknown) => {
                const parsed = args as { where: { id: number }; data: Partial<StateProduct> };
                const product = state.find((candidate) => candidate.id === parsed.where.id)!;
                Object.assign(product, parsed.data);
                return product;
            })
        },
        productUnit: {
            upsert: jest.fn(async (args: unknown) => {
                const parsed = args as {
                    where: { productId_unitId: { productId: number; unitId: number } };
                    update: { conversionFactor: number; isDefault: boolean; active: boolean };
                    create: { productId: number; unitId: number; conversionFactor: number; isDefault: boolean; active: boolean };
                };
                const key = parsed.where.productId_unitId;
                const product = state.find((candidate) => candidate.id === key.productId)!;
                const existing = product.allowedUnits.find((unit) => unit.unitId === key.unitId);
                if (existing) Object.assign(existing, parsed.update);
                else product.allowedUnits.push({
                    unitId: parsed.create.unitId,
                    conversionFactor: Number(parsed.create.conversionFactor),
                    isDefault: parsed.create.isDefault,
                    active: parsed.create.active
                });
                return existing ?? product.allowedUnits[product.allowedUnits.length - 1];
            })
        },
        auditLog: { create: jest.fn(async () => ({ id: 1 })) }
    };
    return { db, state };
}

describe('parseRecipeCatalogMap', () => {
    it('rejects duplicate SKU ownership', () => {
        const parsed = parseRecipeCatalogMap({
            ...map,
            entries: [map.entries[0], { ...map.entries[1], productSku: map.entries[0].productSku }]
        });
        expect(parsed.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'PRODUCT_SKU_DUPLICATE', severity: 'ERROR' })
        ]));
    });
});

describe('RecipeCatalogPreparationService', () => {
    it('keeps dry-run read-only while reporting creates and updates', async () => {
        const { db } = makeDb();
        const transaction = jest.fn();
        const client = { ...db, $transaction: transaction };

        const report = await RecipeCatalogPreparationService.prepare(map, {
            companyId: 1,
            dryRun: true,
            client: client as never
        });

        expect(report.valid).toBe(true);
        expect(report.summary).toEqual({ entries: 2, creates: 1, updates: 1, unchanged: 0 });
        expect(transaction).not.toHaveBeenCalled();
        expect(db.product.create).not.toHaveBeenCalled();
        expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it('plans an explicit recipe-unit factor for a different compatible base unit', async () => {
        const { db, state } = makeDb();
        state[0].unit = 'lb';
        state[0].baseUnitId = 1;
        state[0].allowedUnits = [{ unitId: 1, conversionFactor: 1, isDefault: true, active: true }];
        db.unitOfMeasure.findMany.mockResolvedValue([
            { id: 1, abbreviation: 'lb', measurementType: 'MASS', systemFactor: 453.592, active: true },
            { id: 9, abbreviation: 'g', measurementType: 'MASS', systemFactor: 1, active: true }
        ]);
        const crossUnitMap: RecipeCatalogMap = {
            ...map,
            entries: [{ ...map.entries[0], baseUnit: 'lb', recipeUnits: ['g'] }]
        };

        const report = await RecipeCatalogPreparationService.prepare(crossUnitMap, {
            companyId: 1,
            dryRun: true,
            client: { ...db, $transaction: jest.fn() } as never
        });

        expect(report.valid).toBe(true);
        expect(report.actions[0].ensureProductUnits).toEqual([
            expect.objectContaining({
                unitId: 9,
                abbreviation: 'g',
                conversionFactor: expect.closeTo(1 / 453.592, 10),
                isDefault: false
            })
        ]);
    });

    it('applies atomically and the next pass is a no-op', async () => {
        const { db, state } = makeDb();
        const transaction = jest.fn(async (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
            _options: unknown
        ) => callback(db as unknown as Prisma.TransactionClient));
        const client = { ...db, $transaction: transaction };

        const first = await RecipeCatalogPreparationService.prepare(map, {
            companyId: 1,
            userId: 7,
            dryRun: false,
            client: client as never
        });
        const second = await RecipeCatalogPreparationService.prepare(map, {
            companyId: 1,
            userId: 7,
            dryRun: false,
            client: client as never
        });

        expect(first).toEqual(expect.objectContaining({ valid: true, applied: true }));
        expect(first.summary).toEqual({ entries: 2, creates: 1, updates: 1, unchanged: 0 });
        expect(second.summary).toEqual({ entries: 2, creates: 0, updates: 0, unchanged: 2 });
        expect(state).toHaveLength(2);
        expect(state[0]).toEqual(expect.objectContaining({ active: true, type: 'INTERMEDIATE' }));
        expect(state[1]).toEqual(expect.objectContaining({ sku: 'RCP-000001', active: true }));
        expect(db.product.create).toHaveBeenCalledTimes(1);
        expect(db.auditLog.create).toHaveBeenCalledTimes(2);
        expect(transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
            isolationLevel: 'Serializable',
            maxWait: 10_000,
            timeout: 120_000
        });
    });
});
