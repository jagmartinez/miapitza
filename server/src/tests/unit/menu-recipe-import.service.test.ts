import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '@prisma/client';

import {
    MenuRecipeImportService,
    NormalizedMenuRecipeDocument,
    parseNormalizedMenuRecipes
} from '../../services/menu-recipe-import.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

const document: NormalizedMenuRecipeDocument = {
    schemaVersion: 1,
    source: { file: 'Recetas Menu.xlsx', sheet: 'Recetas' },
    productionRecipes: [],
    reviewRequired: [],
    recipes: [{
        code: 'REC-001',
        sourceRow: 2,
        menuItem: { name: 'Pizza Margherita', category: 'Pizzas', brand: 'Mia Pitza' },
        ingredients: [{ name: 'Harina', sku: 'MPR-001', quantity: 200, unit: 'gr', sourceRow: 3 }]
    }]
};

type ExistingRecipe = {
    id: number;
    menuItemId: number;
    productId: number;
    quantity: number;
    unit: string | null;
    unitId: number | null;
    product: { id: number; name: string; sku: string | null };
};

function makeReadDb(options?: {
    products?: Array<{ id: number; name: string; sku: string | null; unit: string; active: boolean }>;
    menuItems?: Array<{
        id: number;
        name: string;
        active: boolean;
        category: { name: string };
        brand: { name: string } | null;
        branch: { code: string } | null;
    }>;
    existingRecipes?: ExistingRecipe[];
    units?: Array<{ id: number; name: string; abbreviation: string; active: boolean }>;
}) {
    return {
        company: { findFirst: jest.fn(async () => ({ id: 1, name: 'La Mia Pitza' })) },
        user: { findMany: jest.fn(async () => [{ id: 7, name: 'Admin' }]) },
        menuItem: {
            findMany: jest.fn(async () => options?.menuItems ?? [{
                id: 10,
                name: 'Pizza Margherita',
                active: true,
                category: { name: 'Pizzas' },
                brand: { name: 'Mia Pitza' },
                branch: null
            }])
        },
        product: {
            findMany: jest.fn(async () => options?.products ?? [{
                id: 20,
                name: 'Harina',
                sku: 'MPR-001',
                unit: 'g',
                active: true
            }])
        },
        unitOfMeasure: {
            findMany: jest.fn(async () => options?.units ?? [{ id: 30, name: 'Gramo', abbreviation: 'g', active: true }])
        },
        recipe: {
            findMany: jest.fn(async () => options?.existingRecipes ?? []),
            upsert: jest.fn(),
            createMany: jest.fn(),
            update: jest.fn(),
            deleteMany: jest.fn()
        },
        auditLog: { create: jest.fn(), createMany: jest.fn() }
    };
}

describe('parseNormalizedMenuRecipes', () => {
    it('returns a structured validation issue for undefined instead of throwing while fingerprinting', () => {
        expect(() => parseNormalizedMenuRecipes(undefined)).not.toThrow();
        const parsed = parseNormalizedMenuRecipes(undefined);
        expect(parsed.document).toBeNull();
        expect(parsed.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'DOCUMENT_INVALID' })
        ]));
        expect(parsed.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does not coerce string quantities into numbers', () => {
        const parsed = parseNormalizedMenuRecipes({
            ...document,
            recipes: [{
                ...document.recipes[0],
                ingredients: [{ name: 'Harina', sku: 'MPR-001', quantity: '200', unit: 'g' }]
            }]
        });
        expect(parsed.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'INGREDIENT_QUANTITY_INVALID' })
        ]));
    });
});

describe('MenuRecipeImportService planning', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 200,
            conversionFactor: 1,
            originalQuantity: 200,
            originalUnit: 'g',
            baseUnit: 'g'
        });
    });

    it('reports every exact-name candidate and refuses to pick an ambiguous product', async () => {
        const db = makeReadDb({
            products: [
                { id: 20, name: 'Miel', sku: 'MPR-020', unit: 'g', active: true },
                { id: 21, name: 'Miel', sku: 'MIS-021', unit: 'g', active: true }
            ]
        });
        const ambiguousDocument: NormalizedMenuRecipeDocument = {
            ...document,
            recipes: [{
                ...document.recipes[0],
                ingredients: [{ name: 'Miel', quantity: 10, unit: 'g' }]
            }]
        };

        const report = await MenuRecipeImportService.plan(
            ambiguousDocument,
            { companyId: 1, dryRun: true },
            db as unknown as Prisma.TransactionClient
        );

        expect(report.valid).toBe(false);
        const ambiguity = report.issues.find((entry) => entry.code === 'PRODUCT_AMBIGUOUS');
        expect(ambiguity?.context?.candidates).toEqual([
            { id: 20, sku: 'MPR-020', name: 'Miel' },
            { id: 21, sku: 'MIS-021', name: 'Miel' }
        ]);
        expect(UnitConversionService.convert).not.toHaveBeenCalled();
    });

    it('uses an exact SKU explicitly and keeps a warning when the source name differs', async () => {
        const db = makeReadDb({
            products: [{ id: 20, name: 'Harina de trigo', sku: 'MPR-001', unit: 'g', active: true }]
        });

        const report = await MenuRecipeImportService.plan(
            document,
            { companyId: 1, dryRun: true },
            db as unknown as Prisma.TransactionClient
        );

        expect(report.valid).toBe(true);
        expect(report.recipes[0].lines[0]).toEqual(expect.objectContaining({ productId: 20, productSku: 'MPR-001' }));
        expect(report.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                severity: 'WARNING',
                code: 'PRODUCT_NAME_DIFFERS_FROM_CATALOG',
                context: expect.objectContaining({ sourceName: 'Harina', catalogName: 'Harina de trigo' })
            })
        ]));
    });

    it('prefers the active exact abbreviation over an inactive legacy alias', async () => {
        const db = makeReadDb({
            units: [
                { id: 7, name: 'gramo', abbreviation: 'gr', active: false },
                { id: 9, name: 'Gramo', abbreviation: 'g', active: true }
            ]
        });

        const report = await MenuRecipeImportService.plan(
            document,
            { companyId: 1, dryRun: true },
            db as unknown as Prisma.TransactionClient
        );

        expect(report.valid).toBe(true);
        expect(report.recipes[0].lines[0]).toEqual(expect.objectContaining({ unitId: 9, unit: 'g' }));
        expect(report.issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'UNIT_AMBIGUOUS' })
        ]));
    });

    it('checks product-unit compatibility once for repeated lines', async () => {
        const repeatedDocument: NormalizedMenuRecipeDocument = {
            ...document,
            recipes: [
                document.recipes[0],
                {
                    ...document.recipes[0],
                    code: 'REC-002',
                    sourceKey: 'Recetas!A20',
                    menuItem: { name: 'Pizza Pepperoni', category: 'Pizzas', brand: 'Mia Pitza' }
                }
            ]
        };
        const db = makeReadDb({
            menuItems: [
                {
                    id: 10,
                    name: 'Pizza Margherita',
                    active: true,
                    category: { name: 'Pizzas' },
                    brand: { name: 'Mia Pitza' },
                    branch: null
                },
                {
                    id: 11,
                    name: 'Pizza Pepperoni',
                    active: true,
                    category: { name: 'Pizzas' },
                    brand: { name: 'Mia Pitza' },
                    branch: null
                }
            ]
        });

        const report = await MenuRecipeImportService.plan(
            repeatedDocument,
            { companyId: 1, dryRun: true },
            db as unknown as Prisma.TransactionClient
        );

        expect(report.valid).toBe(true);
        expect(report.recipes).toHaveLength(2);
        expect(UnitConversionService.convert).toHaveBeenCalledTimes(1);
    });

    it('only plans deletions when replace is explicit', async () => {
        const oldLine: ExistingRecipe = {
            id: 99,
            menuItemId: 10,
            productId: 21,
            quantity: 5,
            unit: 'g',
            unitId: 30,
            product: { id: 21, name: 'Ingrediente anterior', sku: 'OLD-001' }
        };
        const products = [
            { id: 20, name: 'Harina', sku: 'MPR-001', unit: 'g', active: true },
            { id: 21, name: 'Ingrediente anterior', sku: 'OLD-001', unit: 'g', active: true }
        ];

        const mergeReport = await MenuRecipeImportService.plan(
            document,
            { companyId: 1, dryRun: true, replace: false },
            makeReadDb({ products, existingRecipes: [oldLine] }) as unknown as Prisma.TransactionClient
        );
        const replaceReport = await MenuRecipeImportService.plan(
            document,
            { companyId: 1, dryRun: true, replace: true },
            makeReadDb({ products, existingRecipes: [oldLine] }) as unknown as Prisma.TransactionClient
        );

        expect(mergeReport.summary).toEqual(expect.objectContaining({ deletes: 0, preserved: 1 }));
        expect(mergeReport.recipes[0].deletions).toHaveLength(0);
        expect(replaceReport.summary).toEqual(expect.objectContaining({ deletes: 1, preserved: 0 }));
        expect(replaceReport.recipes[0].deletions[0].recipeId).toBe(99);
    });
});

describe('MenuRecipeImportService execution', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 200,
            conversionFactor: 1,
            originalQuantity: 200,
            originalUnit: 'g',
            baseUnit: 'g'
        });
    });

    it('keeps dry-run read-only and never opens a transaction', async () => {
        const db = makeReadDb();
        const transaction = jest.fn();
        const client = { ...db, $transaction: transaction };

        const report = await MenuRecipeImportService.importDocument(document, {
            companyId: 1,
            dryRun: true,
            replace: true,
            client: client as never
        });

        expect(report.valid).toBe(true);
        expect(report.applied).toBe(false);
        expect(transaction).not.toHaveBeenCalled();
        expect(db.recipe.upsert).not.toHaveBeenCalled();
        expect(db.recipe.createMany).not.toHaveBeenCalled();
        expect(db.recipe.deleteMany).not.toHaveBeenCalled();
        expect(db.auditLog.create).not.toHaveBeenCalled();
        expect(db.auditLog.createMany).not.toHaveBeenCalled();
    });

    it('imports only the applicable subset when reviewRequired is explicitly allowed', async () => {
        const db = makeReadDb();
        const transaction = jest.fn();
        const client = { ...db, $transaction: transaction };
        const input = {
            ...document,
            reviewRequired: [{
                sourceKey: 'Pitzas nuevas!A1',
                sourceRow: 1,
                candidateDomain: 'MENU',
                reasonCodes: ['AMBIGUOUS_VARIANT']
            }]
        };

        const report = await MenuRecipeImportService.importDocument(input, {
            companyId: 1,
            dryRun: true,
            replace: true,
            allowReviewRequired: true,
            client: client as never
        });

        expect(report.valid).toBe(true);
        expect(report.allowReviewRequired).toBe(true);
        expect(report.summary.reviewRequired).toBe(1);
        expect(report.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ severity: 'WARNING', code: 'REVIEW_REQUIRED' })
        ]));
        expect(report.recipes).toHaveLength(1);
        expect(transaction).not.toHaveBeenCalled();
    });

    it('skips DRAFT production recipes only when the caller opts in explicitly', async () => {
        const db = makeReadDb();
        const transaction = jest.fn();
        const client = { ...db, $transaction: transaction };
        const input: NormalizedMenuRecipeDocument = {
            ...document,
            productionRecipes: [{
                sourceKey: 'Salsas!C5',
                sourceRow: 5,
                name: 'Salsa roja',
                status: 'DRAFT',
                output: { name: 'Salsa roja', productSku: 'RCP-000001' },
                yield: { quantity: 1000, unit: 'g' },
                components: [{ name: 'Tomate', productSku: 'VEG-001', quantity: 800, unit: 'g' }]
            }]
        };

        const report = await MenuRecipeImportService.importDocument(input, {
            companyId: 1,
            dryRun: true,
            replace: true,
            skipProductionRecipes: true,
            client: client as never
        });

        expect(report.valid).toBe(true);
        expect(report.skipProductionRecipes).toBe(true);
        expect(report.summary).toEqual(expect.objectContaining({
            productionRecipesInFile: 1,
            productionRecipesResolved: 0,
            productionComponentLines: 1,
            productionVersionsCreated: 0
        }));
        expect(report.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ severity: 'WARNING', code: 'PRODUCTION_RECIPE_SKIPPED' })
        ]));
        expect(transaction).not.toHaveBeenCalled();
    });

    it('applies atomically, verifies the postcondition, and is a no-op on the second run', async () => {
        const state: ExistingRecipe[] = [];
        let nextId = 1;
        const db = makeReadDb();
        db.recipe.findMany.mockImplementation(async () => [...state]);
        db.recipe.createMany.mockImplementation(async (args: unknown) => {
            const rows = (args as {
                data: Array<{ menuItemId: number; productId: number; quantity: number; unit: string; unitId: number }>;
            }).data;
            rows.forEach((row) => state.push({
                id: nextId++,
                ...row,
                product: { id: row.productId, name: 'Harina', sku: 'MPR-001' }
            }));
            return { count: rows.length };
        });
        db.recipe.update.mockImplementation(async (args: unknown) => {
            const parsed = args as {
                where: { menuItemId_productId: { menuItemId: number; productId: number } };
                data: { quantity: number; unit: string; unitId: number };
            };
            const key = parsed.where.menuItemId_productId;
            const existing = state.find((line) => line.menuItemId === key.menuItemId && line.productId === key.productId)!;
            Object.assign(existing, parsed.data);
            return existing;
        });
        db.recipe.deleteMany.mockResolvedValue({ count: 0 } as never);
        db.auditLog.createMany.mockImplementation(async (args: unknown) => ({
            count: (args as { data: unknown[] }).data.length
        }));

        const transaction = jest.fn(async (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
            _options: unknown
        ) => callback(db as unknown as Prisma.TransactionClient));
        const client = { ...db, $transaction: transaction };

        const first = await MenuRecipeImportService.importDocument(document, {
            companyId: 1,
            userId: 7,
            dryRun: false,
            replace: true,
            client: client as never
        });
        const second = await MenuRecipeImportService.importDocument(document, {
            companyId: 1,
            userId: 7,
            dryRun: false,
            replace: true,
            client: client as never
        });

        expect(first).toEqual(expect.objectContaining({ valid: true, applied: true }));
        expect(first.summary.creates).toBe(1);
        expect(second).toEqual(expect.objectContaining({ valid: true, applied: true }));
        expect(second.summary).toEqual(expect.objectContaining({ creates: 0, updates: 0, deletes: 0, unchanged: 1 }));
        expect(db.recipe.createMany).toHaveBeenCalledTimes(1);
        expect(db.recipe.update).not.toHaveBeenCalled();
        expect(db.auditLog.createMany).toHaveBeenCalledTimes(1);
        expect(transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
            isolationLevel: 'Serializable',
            maxWait: 10_000,
            timeout: 180_000
        });
    });
});
