import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { AutoPurchaseOrderService } from '../../services/auto-purchase-order.service';
import { StockAlertService } from '../../services/stock-alert.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { CostingService } from '../../services/costing.service';
import { createRecipeRemovalApplier } from '../../services/inventory-consumption.service';
import { baseUnitFactor, type UnitLike } from '../../services/menu-availability.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('#3 POS availability resolves units like UnitConversionService', () => {
    const und: UnitLike = { id: 1, abbreviation: 'und', name: 'unidad', measurementType: 'PACKAGE', systemFactor: 1, active: true, companyId: 1 };
    const cja: UnitLike = { id: 2, abbreviation: 'cja', name: 'caja', measurementType: 'PACKAGE', systemFactor: 1, active: true, companyId: 1 };
    const units = [und, cja];
    const byAbbr = new Map(units.map((unit) => [unit.abbreviation, unit]));
    const product = { unit: 'und', baseUnit: und, allowedUnits: [{ conversionFactor: 12, active: true, unit: cja }] };

    it('matches raw alias abbreviations of the base and allowed units (cja x12)', () => {
        expect(baseUnitFactor(1, product, 'cja', byAbbr, units)).toBe(12);
        expect(baseUnitFactor(1, product, 'und', byAbbr, units)).toBe(1);
        // Normalised alias still resolves when unambiguous.
        expect(baseUnitFactor(1, product, 'caja', byAbbr, units)).toBe(12);
        expect(baseUnitFactor(1, product, 'unidad', byAbbr, units)).toBe(1);
    });

    it('looks dynamic company units up by raw then normalised abbreviation', () => {
        const g: UnitLike = { id: 3, abbreviation: 'g', name: 'gramo', measurementType: 'WEIGHT', systemFactor: 1, active: true, companyId: 1 };
        const kg: UnitLike = { id: 4, abbreviation: 'kg', name: 'kilogramo', measurementType: 'WEIGHT', systemFactor: 1000, active: true, companyId: 1 };
        const weightUnits = [g, kg];
        const map = new Map(weightUnits.map((unit) => [unit.abbreviation, unit]));
        const flour = { unit: 'g', baseUnit: g, allowedUnits: [] };
        expect(baseUnitFactor(1, flour, 'kilos', map, weightUnits)).toBe(1000);
    });
});

describe('#8 partial "sin X" removal applies once per product across recipe lines', () => {
    it('two 30 g lines minus 20 g -> 10 g + 30 g', () => {
        const apply = createRecipeRemovalApplier();
        const removal = { full: false, baseQuantity: 20 };
        expect(apply('5:1', 30, removal)).toBe(10);
        expect(apply('5:1', 30, removal)).toBe(30);
    });

    it('clamps at 0 and keeps dish lines independent', () => {
        const apply = createRecipeRemovalApplier();
        const removal = { full: false, baseQuantity: 50 };
        expect(apply('5:1', 30, removal)).toBe(0);
        expect(apply('5:1', 30, removal)).toBe(10);
        expect(apply('6:1', 30, removal)).toBe(0);
        expect(apply('7:1', 30, { full: true, baseQuantity: 0 })).toBe(0);
        expect(apply('7:2', 30, undefined)).toBe(30);
    });
});

describe('#9 auto-purchase urgency', () => {
    it('classifies a negative balance as URGENT', async () => {
        jest.spyOn(StockAlertService, 'getLowStockProducts').mockResolvedValue([
            { productId: 7, productName: 'Harina', unit: 'g', currentStock: -5, minStock: 10, warehouseId: 1, warehouseName: 'Central' }
        ] as never);
        jest.spyOn(prisma.productionRecipe, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7, name: 'Harina', unit: 'g', cost: 1, currentAverageCost: 1, minStock: 10,
            averageCostKnown: true, referenceCostKnown: true, baseUnitId: 1,
            baseUnit: { abbreviation: 'g', measurementType: 'MASS' }, allowedUnits: []
        } as never);

        const result = await AutoPurchaseOrderService.generateSuggestions(1);

        expect(result.suggestions[0].priority).toBe('URGENT');
        expect(result.summary.urgentProducts).toBe(1);
    });
});

/** Raw-query double: answers each locking SELECT from `rows` by table name. */
function lockingTx(opts: {
    rawStock?: { quantity: number; negativeBalanceCost: number };
    plainStockQuantity: number;
    warehouseMethod?: 'FIFO' | 'WEIGHTED_AVERAGE';
    companyMethod: 'FIFO' | 'WEIGHTED_AVERAGE';
    rawLayers?: Array<Record<string, unknown>>;
    plainLayers?: Array<Record<string, unknown>>;
}) {
    const stockUpdates: Array<Record<string, unknown>> = [];
    const batchUpdates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
    const tx = {
        $queryRaw: jest.fn(async (strings: unknown) => {
            const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
            if (sql.includes('FROM `Warehouse`') && opts.warehouseMethod) return [{ id: 1, costingMethod: opts.warehouseMethod }];
            if (sql.includes('FROM `Product`')) {
                return [{ id: 1, currentAverageCost: 2, averageCostKnown: 1, cost: 2, referenceCostKnown: 1 }];
            }
            if (sql.includes('quantity, negativeBalanceCost FROM `Stock`') && opts.rawStock) return [opts.rawStock];
            if (sql.includes('SELECT id, unitCost, remainingQty') && opts.rawLayers) return opts.rawLayers;
            if (sql.includes('COUNT(*)')) return [{ n: 0 }];
            return [];
        }),
        warehouse: { findFirst: jest.fn(async () => ({ id: 1 })) },
        product: { findFirst: jest.fn(async () => ({ currentAverageCost: 2, averageCostKnown: true, cost: 2, referenceCostKnown: true })) },
        company: { findUnique: jest.fn(async () => ({ costingMethod: opts.companyMethod })) },
        stock: {
            // Plain reads return the (stale) REPEATABLE READ snapshot.
            findUnique: jest.fn(async () => ({ id: 1, quantity: opts.plainStockQuantity, negativeBalanceCost: 0 })),
            create: jest.fn(async () => ({ id: 1, quantity: 0 })),
            update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                stockUpdates.push(args.data);
                return {};
            })
        },
        inventoryBatch: {
            findMany: jest.fn(async () => opts.plainLayers ?? []),
            create: jest.fn(async () => ({ id: 50 })),
            update: jest.fn(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
                batchUpdates.push(args);
                return {};
            }),
            updateMany: jest.fn(async () => ({ count: 1 }))
        },
        inventoryMovement: { create: jest.fn(async () => ({ id: 77 })) }
    };
    return { tx: tx as unknown as Parameters<typeof InventoryEngineService.applyMovement>[0], stockUpdates, batchUpdates };
}

describe('#10 the engine writes from its locking reads, not the RR snapshot', () => {
    it('derives the new quantity from the locked Stock row', async () => {
        const { tx, stockUpdates } = lockingTx({
            rawStock: { quantity: 5, negativeBalanceCost: 0 },
            plainStockQuantity: 10,
            warehouseMethod: 'WEIGHTED_AVERAGE',
            companyMethod: 'WEIGHTED_AVERAGE'
        });
        jest.spyOn(CostingService, 'getOutflowUnitCost').mockResolvedValue(2);

        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'OUT', companyId: 1, warehouseId: 1, productId: 1, userId: 1, quantity: 3
        });

        // A concurrent sale already took 5 of the snapshot's 10: 5 - 3, not 10 - 3.
        expect(stockUpdates[0]).toEqual(expect.objectContaining({ quantity: 2 }));
        expect(result.balanceQty).toBe(2);
    });

    it('consumes layers with the remainingQty returned by the locking read', async () => {
        const { tx, batchUpdates } = lockingTx({
            rawStock: { quantity: 4, negativeBalanceCost: 0 },
            plainStockQuantity: 10,
            warehouseMethod: 'FIFO',
            companyMethod: 'FIFO',
            rawLayers: [{ id: 9, unitCost: 3, remainingQty: 4, sourceRef: 'PO-1', sourceType: 'PURCHASE', sourceMovementId: 1, createdAt: new Date() }],
            plainLayers: [{ id: 9, unitCost: 3, remainingQty: 10, sourceRef: 'PO-1', sourceType: 'PURCHASE', sourceMovementId: 1, createdAt: new Date() }]
        });
        jest.spyOn(CostingService, 'syncFifoCurrentAverageCost').mockResolvedValue(undefined as never);

        await InventoryEngineService.applyMovement(tx, {
            type: 'OUT', companyId: 1, warehouseId: 1, productId: 1, userId: 1, quantity: 3
        });

        expect(batchUpdates).toEqual([{ where: { id: 9 }, data: { remainingQty: 1 } }]);
    });

    it('treats an empty locked layer set as authoritative (no stale snapshot layers)', async () => {
        const { tx, batchUpdates } = lockingTx({
            rawStock: { quantity: 0, negativeBalanceCost: 0 },
            plainStockQuantity: 10,
            warehouseMethod: 'WEIGHTED_AVERAGE',
            companyMethod: 'WEIGHTED_AVERAGE',
            rawLayers: [],
            plainLayers: [{ id: 9, unitCost: 3, remainingQty: 10, sourceRef: 'PO-1', sourceType: 'PURCHASE', sourceMovementId: 1, createdAt: new Date() }]
        });

        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'OUT', companyId: 1, warehouseId: 1, productId: 1, userId: 1, quantity: 3, allowNegative: true
        });

        expect(batchUpdates).toEqual([]);
        expect(result.consumedLayers).toEqual([expect.objectContaining({ quantity: 3, sourceRef: null })]);
    });
});

describe('#11 the engine takes the costing method from its Warehouse locking read', () => {
    it('applies FIFO when the locked warehouse says FIFO although the company snapshot says WA', async () => {
        const { tx } = lockingTx({
            rawStock: { quantity: 2, negativeBalanceCost: 0 },
            plainStockQuantity: 2,
            warehouseMethod: 'FIFO',
            companyMethod: 'WEIGHTED_AVERAGE',
            rawLayers: [{ id: 9, unitCost: 5, remainingQty: 2, sourceRef: 'PO-1', sourceType: 'PURCHASE', sourceMovementId: 1, createdAt: new Date() }]
        });
        const sync = jest.spyOn(CostingService, 'syncFifoCurrentAverageCost').mockResolvedValue(undefined as never);
        const waCost = jest.spyOn(CostingService, 'getOutflowUnitCost').mockResolvedValue(2);

        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'OUT', companyId: 1, warehouseId: 1, productId: 1, userId: 1, quantity: 2
        });

        expect(result.totalCost).toBeCloseTo(10, 6);
        expect(waCost).not.toHaveBeenCalled();
        expect(sync).toHaveBeenCalled();
        expect(tx.company.findUnique).not.toHaveBeenCalled();
    });
});
