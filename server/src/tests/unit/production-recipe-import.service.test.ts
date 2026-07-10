import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '@prisma/client';

import {
    MenuRecipeImportService,
    parseNormalizedMenuRecipes
} from '../../services/menu-recipe-import.service';
import {
    NormalizedProductionRecipe,
    ProductionRecipeImportService
} from '../../services/production-recipe-import.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

const productionRecipe: NormalizedProductionRecipe = {
    sourceKey: 'Salsas!C5',
    sourceRow: 5,
    status: 'ACTIVE',
    output: { name: 'Salsa Roja', sku: 'PRD-001', productSku: 'PRD-001' },
    yield: { quantity: 1000, unit: 'g' },
    components: [{
        name: 'Tomate',
        sourceName: 'Tomate',
        sku: 'VEG-001',
        productSku: 'VEG-001',
        quantity: 800,
        unit: 'g',
        sourceRow: 10
    }]
};

function makeDb(options?: {
    products?: Array<{ id: number; name: string; sku: string | null; unit: string; type: string; active: boolean }>;
    existingRecipes?: Array<{
        id: number;
        productId: number;
        name: string;
        version: number;
        status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
        yieldQuantity: number;
        yieldUnitId: number | null;
        components: Array<{ componentProductId: number; quantity: number; unitId: number | null; unit: string | null }>;
    }>;
}) {
    return {
        product: {
            findMany: jest.fn(async () => options?.products ?? [
                { id: 1, name: 'Salsa Roja', sku: 'PRD-001', unit: 'g', type: 'INTERMEDIATE', active: true },
                { id: 2, name: 'Tomate', sku: 'VEG-001', unit: 'g', type: 'INGREDIENT', active: true }
            ])
        },
        unitOfMeasure: {
            findMany: jest.fn(async () => [{ id: 10, name: 'Gramo', abbreviation: 'g', active: true }])
        },
        productionRecipe: {
            findMany: jest.fn(async () => options?.existingRecipes ?? []),
            updateMany: jest.fn(),
            create: jest.fn()
        },
        auditLog: { create: jest.fn() }
    };
}

describe('normalized production recipe parsing', () => {
    it('rejects reviewRequired before any database planning can occur', async () => {
        const input = {
            schemaVersion: 1,
            source: { file: 'Recetas Menu.xlsx' },
            counts: {
                menuRecipes: 0,
                menuIngredientLines: 0,
                productionRecipes: 0,
                productionComponentLines: 0,
                reviewRequired: 1
            },
            recipes: [],
            productionRecipes: [],
            reviewRequired: [{
                sourceKey: 'Pitzas!Y3',
                sourceRow: 3,
                candidateDomain: 'MENU',
                reasonCodes: ['AMBIGUOUS_VARIANT']
            }]
        };
        const parsed = parseNormalizedMenuRecipes(input);
        const transaction = jest.fn();
        const companyFind = jest.fn();

        expect(parsed.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'REVIEW_REQUIRED', path: '$.reviewRequired[0]' })
        ]));
        const report = await MenuRecipeImportService.importDocument(input, {
            companyId: 1,
            dryRun: true,
            client: { $transaction: transaction, company: { findFirst: companyFind } } as never
        });
        expect(report.valid).toBe(false);
        expect(report.summary.reviewRequired).toBe(1);
        expect(companyFind).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it('strictly validates unique sourceKey, status, yield, and component quantities', () => {
        const raw = {
            schemaVersion: 1,
            source: { file: 'Recetas Menu.xlsx' },
            recipes: [],
            reviewRequired: [],
            productionRecipes: [
                {
                    ...productionRecipe,
                    status: 'INACTIVE',
                    yield: { quantity: 0, unit: 'g' },
                    components: [{ ...productionRecipe.components[0], quantity: Number.NaN }]
                },
                { ...productionRecipe }
            ]
        };
        const parsed = parseNormalizedMenuRecipes(raw);
        const codes = parsed.issues.map((entry) => entry.code);
        expect(codes).toEqual(expect.arrayContaining([
            'PRODUCTION_RECIPE_DUPLICATE',
            'PRODUCTION_STATUS_INVALID',
            'PRODUCTION_YIELD_QUANTITY_INVALID',
            'PRODUCTION_COMPONENT_QUANTITY_INVALID'
        ]));
    });
});
describe('ProductionRecipeImportService planning', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 1,
            conversionFactor: 1,
            originalQuantity: 1,
            originalUnit: 'g',
            baseUnit: 'g'
        });
    });

    it('creates a new ACTIVE version and deactivates the previous one when the BOM changes', async () => {
        const db = makeDb({
            existingRecipes: [{
                id: 50,
                productId: 1,
                name: 'Receta anterior',
                version: 3,
                status: 'ACTIVE',
                yieldQuantity: 1000,
                yieldUnitId: 10,
                components: [{ componentProductId: 2, quantity: 700, unitId: 10, unit: 'g' }]
            }]
        });

        const plan = await ProductionRecipeImportService.plan(
            [productionRecipe],
            1,
            db as unknown as Prisma.TransactionClient
        );

        expect(plan.valid).toBe(true);
        expect(plan.recipes[0]).toEqual(expect.objectContaining({
            action: 'CREATE_VERSION',
            version: 4,
            status: 'ACTIVE',
            deactivateRecipeIds: [50]
        }));
        expect(plan.summary).toEqual(expect.objectContaining({
            productionVersionsCreated: 1,
            productionRecipesDeactivated: 1
        }));
    });

    it('is unchanged when the requested ACTIVE recipe already matches exactly', async () => {
        const db = makeDb({
            existingRecipes: [{
                id: 50,
                productId: 1,
                name: 'Receta vigente',
                version: 3,
                status: 'ACTIVE',
                yieldQuantity: 1000,
                yieldUnitId: 10,
                components: [{ componentProductId: 2, quantity: 800, unitId: 10, unit: 'g' }]
            }]
        });

        const plan = await ProductionRecipeImportService.plan(
            [productionRecipe],
            1,
            db as unknown as Prisma.TransactionClient
        );

        expect(plan.valid).toBe(true);
        expect(plan.recipes[0]).toEqual(expect.objectContaining({
            action: 'UNCHANGED',
            existingRecipeId: 50,
            version: 3,
            deactivateRecipeIds: []
        }));
        expect(plan.summary.productionVersionsCreated).toBe(0);
    });

    it('attributes a downstream legacy cycle to the ACTIVE plan that can reach it', async () => {
        const products = [
            { id: 1, name: 'Producto A', sku: 'PRD-A', unit: 'g', type: 'INTERMEDIATE', active: true },
            { id: 2, name: 'Producto B', sku: 'PRD-B', unit: 'g', type: 'INTERMEDIATE', active: true },
            { id: 3, name: 'Producto C', sku: 'PRD-C', unit: 'g', type: 'INTERMEDIATE', active: true }
        ];
        const db = makeDb({
            products,
            existingRecipes: [
                {
                    id: 60,
                    productId: 2,
                    name: 'B -> C',
                    version: 1,
                    status: 'ACTIVE',
                    yieldQuantity: 1,
                    yieldUnitId: 10,
                    components: [{ componentProductId: 3, quantity: 1, unitId: 10, unit: 'g' }]
                },
                {
                    id: 61,
                    productId: 3,
                    name: 'C -> B',
                    version: 1,
                    status: 'ACTIVE',
                    yieldQuantity: 1,
                    yieldUnitId: 10,
                    components: [{ componentProductId: 2, quantity: 1, unitId: 10, unit: 'g' }]
                }
            ]
        });
        const rootPlan: NormalizedProductionRecipe = {
            sourceKey: 'Produccion!A1',
            status: 'ACTIVE',
            output: { name: 'Producto A', productSku: 'PRD-A' },
            yield: { quantity: 1, unit: 'g' },
            components: [{ name: 'Producto B', productSku: 'PRD-B', quantity: 1, unit: 'g' }]
        };

        const plan = await ProductionRecipeImportService.plan(
            [rootPlan],
            1,
            db as unknown as Prisma.TransactionClient
        );

        expect(plan.valid).toBe(false);
        expect(plan.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'PRODUCTION_CIRCULAR_DEPENDENCY',
                path: '$.productionRecipes[0]',
                context: expect.objectContaining({ rootProductId: 1, productIds: [2, 3, 2] })
            })
        ]));
    });
});
