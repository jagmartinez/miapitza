import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { InventoryEngineService } from '../../services/inventory-engine.service';
import { InventoryConsumptionService, ORDER_CONSUMPTION_SNAPSHOT_ACTION } from '../../services/inventory-consumption.service';
import type { OrderConsumptionSnapshot } from '../../services/inventory-consumption.service';
import { CostingService } from '../../services/costing.service';
import { UnitConversionService } from '../../services/unit-conversion.service';
import { WarehouseRouteService } from '../../services/warehouse-route.service';
import { MenuAvailabilityService } from '../../services/menu-availability.service';
import prisma from '../../utils/prisma';
import { makeInventoryLedger } from './support/fake-inventory-ledger';

type Tx = Parameters<typeof InventoryEngineService.applyMovement>[0];

// Branch 1: Cocina (1, sale warehouse) and Barra (2). Branch 2: warehouse 3.
const COCINA = 1;
const BARRA = 2;
const OTHER_BRANCH = 3;
const BEBIDAS = 10;
const ALIMENTOS = 20;
// Products: 5 = gaseosa (Bebidas), 6 = carne (Alimentos), 7 = limón (Bebidas, ADD modifier),
// 8 = hielo (Bebidas, but a product rule keeps it in Cocina), 9 = cebolla (Alimentos, "sin cebolla").
const GASEOSA = 5;
const CARNE = 6;
const LIMON = 7;
const HIELO = 8;
const CEBOLLA = 9;

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(CostingService, 'syncFifoCurrentAverageCost').mockResolvedValue(undefined as never);
    jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue(undefined as never);
    jest.spyOn(CostingService, 'reverseInventoryMovementCost').mockResolvedValue(undefined as never);
    jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (_p: number, _c: number, quantity: number, unit: string) => ({
        baseQuantity: quantity, originalQuantity: quantity, originalUnit: unit, conversionFactor: 1, baseUnit: unit
    })) as never);
});
afterEach(() => {
    jest.restoreAllMocks();
});

function makeLedger(costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE' = 'FIFO', routes?: Array<{ warehouseId: number; categoryId?: number; productId?: number; branchId: number }>) {
    return makeInventoryLedger({
        costingMethod,
        avgCost: 2,
        routing: {
            warehouses: [
                { id: COCINA, branchId: 1, type: 'BRANCH' },
                { id: BARRA, branchId: 1, type: 'BRANCH' },
                { id: OTHER_BRANCH, branchId: 2, type: 'BRANCH' }
            ],
            routes: routes ?? [
                { branchId: 1, warehouseId: BARRA, categoryId: BEBIDAS },
                { branchId: 1, warehouseId: COCINA, productId: HIELO }
            ],
            productCategories: { [GASEOSA]: BEBIDAS, [CARNE]: ALIMENTOS, [LIMON]: BEBIDAS, [HIELO]: BEBIDAS, [CEBOLLA]: ALIMENTOS },
            orderItemModifiers: [
                {
                    modifier: {
                        name: 'Extra limón', productId: LIMON, consumeQuantity: 1, inventoryEffect: 'ADD',
                        unit: null, product: { id: LIMON, name: 'Limón', unit: 'u' }
                    },
                    orderItem: { id: 31, quantity: 2 }
                },
                {
                    modifier: {
                        name: 'Sin cebolla', productId: CEBOLLA, consumeQuantity: null, inventoryEffect: 'REMOVE',
                        unit: null, product: { id: CEBOLLA, name: 'Cebolla', unit: 'g' }
                    },
                    orderItem: { id: 32, quantity: 1 }
                }
            ]
        }
    });
}

type Ledger = ReturnType<typeof makeLedger>;

async function stockUp(ledger: Ledger, warehouseId: number, productId: number, quantity: number, unitCost: number) {
    await InventoryEngineService.applyMovement(ledger.tx as unknown as Tx, {
        type: 'IN', companyId: 1, warehouseId, productId, userId: 9, quantity, unitCost,
        reference: `PO-${warehouseId}-${productId}`, sourceType: 'PURCHASE'
    });
}

const recipe = (productId: number, quantity: number, name: string) =>
    ({ productId, quantity, unit: 'u', product: { name, unit: 'u' } });

// Line 31: cuba libre x2 (gaseosa 1 + hielo 3) + "extra limón" (1 per unit).
// Line 32: hamburguesa x1 (carne 1 + cebolla 50, "sin cebolla").
const order = {
    id: 1,
    userId: 9,
    items: [
        { id: 31, quantity: 2, menuItem: { recipes: [recipe(GASEOSA, 1, 'Gaseosa'), recipe(HIELO, 3, 'Hielo')] } },
        { id: 32, quantity: 1, menuItem: { recipes: [recipe(CARNE, 1, 'Carne'), recipe(CEBOLLA, 50, 'Cebolla')] } }
    ]
};

function outsOf(ledger: Ledger, reference: string) {
    return ledger.movements
        .filter((m) => m.reference === reference && m.type === 'OUT' && m.origin !== 'COST_TRUE_UP')
        .map((m) => ({ productId: m.productId, warehouseId: m.warehouseId, quantity: Number(m.quantity) }))
        .sort((a, b) => Number(a.productId) - Number(b.productId));
}

/** Ledger invariant per (warehouse, product): movement values = layers - open deficit. */
function expectInvariant(ledger: Ledger) {
    const scopes = new Set(ledger.movements.map((m) => `${m.warehouseId}|${m.productId}`));
    for (const scope of scopes) {
        const [warehouseId, productId] = scope.split('|').map(Number);
        expect(ledger.ledgerSum(warehouseId, productId))
            .toBeCloseTo(ledger.layerValue(warehouseId, productId) - ledger.openDeficitCost(warehouseId, productId), 6);
        expect(ledger.openDeficitCost(warehouseId, productId)).toBeCloseTo(ledger.openSliceValue(warehouseId, productId), 6);
    }
}

describe('WarehouseRouteService.resolveFromRules', () => {
    it('product rule > category rule > fallback', () => {
        const resolved = WarehouseRouteService.resolveFromRules(
            [
                { warehouseId: BARRA, categoryId: BEBIDAS, productId: null },
                { warehouseId: COCINA, categoryId: null, productId: HIELO }
            ],
            [
                { id: GASEOSA, categoryId: BEBIDAS },
                { id: HIELO, categoryId: BEBIDAS },
                { id: CARNE, categoryId: ALIMENTOS },
                { id: 99, categoryId: null }
            ],
            COCINA
        );
        expect(Object.fromEntries(resolved)).toEqual({ [GASEOSA]: BARRA, [HIELO]: COCINA, [CARNE]: COCINA, 99: COCINA });
    });

    it('ignores stale rules whose warehouse moved to another branch or a CENTRAL warehouse type', async () => {
        const ledger = makeLedger('FIFO', [{ branchId: 1, warehouseId: OTHER_BRANCH, categoryId: BEBIDAS }]);
        const resolved = await WarehouseRouteService.resolveForWarehouse(ledger.tx as never, 1, COCINA, [GASEOSA]);
        expect(resolved.get(GASEOSA)).toBe(COCINA);
    });

    it('a client without the routing delegate keeps every line on the fallback warehouse', async () => {
        const resolved = await WarehouseRouteService.resolveForWarehouse({} as never, 1, COCINA, [GASEOSA, CARNE]);
        expect([...resolved.values()]).toEqual([COCINA, COCINA]);
    });
});

describe('WarehouseRouteService.validateRules', () => {
    const db = (
        warehouses: Array<{ id: number; branchId: number | null; type: string }>,
        count = 1,
        categoryRows: Array<{ id: number; name: string; showInInventory: boolean }> = [{ id: BEBIDAS, name: 'Bebidas', showInInventory: true }]
    ) => ({
        warehouse: { findMany: jest.fn(async () => warehouses) },
        product: { count: jest.fn(async () => count) },
        category: { findMany: jest.fn(async () => (count > 0 ? categoryRows : [])) }
    });

    it('rejects a category that is not an inventory category (showInInventory false)', async () => {
        await expect(WarehouseRouteService.validateRules(
            db([{ id: BARRA, branchId: 1, type: 'BRANCH' }], 1, [{ id: 50, name: 'Postres menú', showInInventory: false }]) as never,
            1, 1, [{ warehouseId: BARRA, categoryId: 50 }]
        )).rejects.toThrow(/no es una categoría de inventario/);
        await expect(WarehouseRouteService.validateRules(
            db([{ id: BARRA, branchId: 1, type: 'BRANCH' }], 0) as never,
            1, 1, [{ warehouseId: BARRA, categoryId: 51 }]
        )).rejects.toThrow(/Categoría de la regla no encontrada/);
    });

    it('accepts a BRANCH warehouse of the same branch', async () => {
        await expect(WarehouseRouteService.validateRules(db([{ id: BARRA, branchId: 1, type: 'BRANCH' }]) as never, 1, 1, [
            { warehouseId: BARRA, categoryId: BEBIDAS }
        ])).resolves.toEqual([{ warehouseId: BARRA, categoryId: BEBIDAS, productId: null }]);
    });

    it('rejects another branch, CENTRAL, other tenants, ambiguous and duplicated rules', async () => {
        await expect(WarehouseRouteService.validateRules(db([{ id: 3, branchId: 2, type: 'BRANCH' }]) as never, 1, 1, [
            { warehouseId: 3, categoryId: BEBIDAS }
        ])).rejects.toThrow(/misma sucursal/);
        await expect(WarehouseRouteService.validateRules(db([{ id: 4, branchId: null, type: 'CENTRAL' }]) as never, 1, 1, [
            { warehouseId: 4, productId: GASEOSA }
        ])).rejects.toThrow(/misma sucursal/);
        await expect(WarehouseRouteService.validateRules(db([]) as never, 1, 1, [
            { warehouseId: 77, productId: GASEOSA }
        ])).rejects.toThrow(/no encontrado/);
        await expect(WarehouseRouteService.validateRules(db([{ id: BARRA, branchId: 1, type: 'BRANCH' }]) as never, 1, 1, [
            { warehouseId: BARRA, productId: GASEOSA, categoryId: BEBIDAS }
        ])).rejects.toThrow(/solo uno/);
        await expect(WarehouseRouteService.validateRules(db([{ id: BARRA, branchId: 1, type: 'BRANCH' }]) as never, 1, 1, [
            { warehouseId: BARRA, categoryId: BEBIDAS }, { warehouseId: COCINA, categoryId: BEBIDAS }
        ])).rejects.toThrow(/duplicadas/);
        await expect(WarehouseRouteService.validateRules(db([{ id: BARRA, branchId: 1, type: 'BRANCH' }], 0) as never, 1, 1, [
            { warehouseId: BARRA, productId: 12345 }
        ])).rejects.toThrow(/Producto de la regla no encontrado/);
    });
});

describe('consumeForOrder with per-ingredient warehouse routing', () => {
    async function seeded(costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE' = 'FIFO') {
        const ledger = makeLedger(costingMethod);
        await stockUp(ledger, BARRA, GASEOSA, 10, 1);
        await stockUp(ledger, BARRA, LIMON, 10, 0.5);
        await stockUp(ledger, COCINA, HIELO, 20, 0.1);
        await stockUp(ledger, COCINA, CARNE, 5, 4);
        await stockUp(ledger, COCINA, CEBOLLA, 500, 0.01);
        return ledger;
    }

    it('consumes each line from its routed warehouse, locking every involved warehouse ascending first', async () => {
        const ledger = await seeded();
        const lock = jest.spyOn(InventoryEngineService, 'lockInventoryScope');
        await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order, warehouseId: COCINA, userId: 9, companyId: 1, allowNegative: true
        });

        expect(outsOf(ledger, 'ORD-1')).toEqual([
            { productId: GASEOSA, warehouseId: BARRA, quantity: 2 },
            { productId: CARNE, warehouseId: COCINA, quantity: 1 },
            { productId: LIMON, warehouseId: BARRA, quantity: 2 },
            { productId: HIELO, warehouseId: COCINA, quantity: 6 }
            // "Sin cebolla" removes the whole cebolla line: no movement.
        ]);
        // First lock of the consumption covers both warehouses and all products.
        const [, , warehouses, products] = lock.mock.calls[0];
        expect([...(warehouses as Iterable<number>)].sort()).toEqual([COCINA, BARRA].sort());
        expect([...new Set(products as Iterable<number>)].sort((a, b) => a - b)).toEqual([GASEOSA, CARNE, LIMON, HIELO, CEBOLLA].sort((a, b) => a - b));

        expect(Number(ledger.stockOf(BARRA, GASEOSA)!.quantity)).toBeCloseTo(8, 6);
        expect(Number(ledger.stockOf(BARRA, LIMON)!.quantity)).toBeCloseTo(8, 6);
        expect(Number(ledger.stockOf(COCINA, HIELO)!.quantity)).toBeCloseTo(14, 6);
        expect(Number(ledger.stockOf(COCINA, CARNE)!.quantity)).toBeCloseTo(4, 6);
        expect(Number(ledger.stockOf(COCINA, CEBOLLA)!.quantity)).toBeCloseTo(500, 6);
        expect(ledger.stockOf(COCINA, GASEOSA)).toBeUndefined();

        // The snapshot records where each line was consumed from.
        const snapshot = ledger.auditLogs.find((row) => row.action === ORDER_CONSUMPTION_SNAPSHOT_ACTION)!.details as OrderConsumptionSnapshot;
        expect(snapshot.warehouseId).toBe(COCINA);
        const line31 = snapshot.items.find((item) => item.orderItemId === 31)!;
        expect(line31.products).toEqual(expect.arrayContaining([
            { productId: GASEOSA, quantity: 2, warehouseId: BARRA },
            { productId: HIELO, quantity: 6, warehouseId: COCINA },
            { productId: LIMON, quantity: 2, warehouseId: BARRA }
        ]));
        expectInvariant(ledger);

        // Idempotent: a second call does not consume again.
        const again = await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order, warehouseId: COCINA, userId: 9, companyId: 1, allowNegative: true
        });
        expect(again.consumed).toBe(false);
    });

    it('reverseForOrder returns every line to the warehouse it was consumed from', async () => {
        const ledger = await seeded('WEIGHTED_AVERAGE');
        await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order, warehouseId: COCINA, userId: 9, companyId: 1, allowNegative: true
        });
        await InventoryConsumptionService.reverseForOrder(ledger.tx as never, {
            orderId: 1, userId: 9, companyId: 1, reason: 'Anulación', sourceType: 'ADJUSTMENT', reversalOrigin: 'TEST'
        });
        const ins = ledger.movements
            .filter((m) => m.reference === 'ORD-1' && m.type === 'IN')
            .map((m) => `${m.productId}@${m.warehouseId}`)
            .sort();
        expect(ins).toEqual([`${GASEOSA}@${BARRA}`, `${CARNE}@${COCINA}`, `${LIMON}@${BARRA}`, `${HIELO}@${COCINA}`].sort());
        expect(Number(ledger.stockOf(BARRA, GASEOSA)!.quantity)).toBeCloseTo(10, 6);
        expect(Number(ledger.stockOf(BARRA, LIMON)!.quantity)).toBeCloseTo(10, 6);
        expect(Number(ledger.stockOf(COCINA, HIELO)!.quantity)).toBeCloseTo(20, 6);
        expect(Number(ledger.stockOf(COCINA, CARNE)!.quantity)).toBeCloseTo(5, 6);
        expect(ledger.layerValue(BARRA, GASEOSA)).toBeCloseTo(10, 6);
        expectInvariant(ledger);
    });

    it('a partial credit note (snapshot warehouse) returns to the consumed-from warehouse, not the lowest id', async () => {
        const ledger = makeLedger('FIFO');
        await stockUp(ledger, COCINA, GASEOSA, 10, 1);
        await stockUp(ledger, BARRA, GASEOSA, 10, 3);
        // Same product consumed under ORD-1 from both warehouses (route changed between waves).
        for (const warehouseId of [COCINA, BARRA]) {
            await InventoryEngineService.applyMovement(ledger.tx as unknown as Tx, {
                type: 'OUT', companyId: 1, warehouseId, productId: GASEOSA, userId: 9, quantity: 4, reference: 'ORD-1'
            });
        }
        await InventoryConsumptionService.reverseQuantitiesForOrder(ledger.tx as never, {
            orderId: 1, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: 'CN-1',
            quantities: [{ productId: GASEOSA, quantity: 3, warehouseId: BARRA }]
        });
        const ins = ledger.movements.filter((m) => m.reference === 'ORD-1' && m.type === 'IN');
        expect(ins.map((m) => [m.warehouseId, Number(m.quantity)])).toEqual([[BARRA, 3]]);
        expect(Number(ledger.stockOf(BARRA, GASEOSA)!.quantity)).toBeCloseTo(9, 6);
        expect(Number(ledger.stockOf(COCINA, GASEOSA)!.quantity)).toBeCloseTo(6, 6);
        // Re-opened at the Barra cost (3), not Cocina's (1).
        expect(Number(ins[0].totalCost)).toBeCloseTo(9, 6);

        // Requests above the preferred warehouse's outstanding spill over ascending.
        await InventoryConsumptionService.reverseQuantitiesForOrder(ledger.tx as never, {
            orderId: 1, userId: 9, companyId: 1, reason: 'NC', sourceType: 'ADJUSTMENT', reversalOrigin: 'CN-2',
            quantities: [{ productId: GASEOSA, quantity: 3, warehouseId: BARRA }]
        });
        expect(Number(ledger.stockOf(BARRA, GASEOSA)!.quantity)).toBeCloseTo(10, 6);
        expect(Number(ledger.stockOf(COCINA, GASEOSA)!.quantity)).toBeCloseTo(8, 6);
        expectInvariant(ledger);
    });

    it('negative sales open deficit slices in the routed warehouse and the reversal closes them there', async () => {
        const ledger = makeLedger('FIFO');
        await stockUp(ledger, COCINA, HIELO, 20, 0.1);
        await stockUp(ledger, COCINA, CARNE, 5, 4);
        // Barra has no gaseosa / limón: the sale drives it negative there.
        const result = await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order, warehouseId: COCINA, userId: 9, companyId: 1, allowNegative: true
        });
        expect(result.negativeProductIds?.sort()).toEqual([GASEOSA, LIMON].sort());
        expect(Number(ledger.stockOf(BARRA, GASEOSA)!.quantity)).toBeCloseTo(-2, 6);
        expect(ledger.openSlices(BARRA, GASEOSA)).toHaveLength(1);
        expect(ledger.openSlices(COCINA, GASEOSA)).toHaveLength(0);
        // The negative-stock alert names the routed warehouse.
        const alerts = ledger.auditLogs.filter((row) => row.action !== ORDER_CONSUMPTION_SNAPSHOT_ACTION);
        expect(alerts).toHaveLength(1);
        expect((alerts[0].details as { warehouseId: number }).warehouseId).toBe(BARRA);
        expectInvariant(ledger);

        await InventoryConsumptionService.reverseForOrder(ledger.tx as never, {
            orderId: 1, userId: 9, companyId: 1, reason: 'Anulación', sourceType: 'ADJUSTMENT', reversalOrigin: 'TEST'
        });
        expect(Number(ledger.stockOf(BARRA, GASEOSA)!.quantity)).toBeCloseTo(0, 6);
        expect(ledger.openSlices(BARRA, GASEOSA)).toHaveLength(0);
        expect(ledger.openSlices(BARRA, LIMON)).toHaveLength(0);
        expectInvariant(ledger);
    });

    it('waste on cancel (WASTE-ORD) follows the same routing from the selected waste warehouse', async () => {
        const ledger = await seeded();
        await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order, warehouseId: COCINA, userId: 9, companyId: 1,
            orderItemIds: [31, 32], reference: 'WASTE-ORD-1', reason: 'WASTE', allowNegative: true
        });
        expect(outsOf(ledger, 'WASTE-ORD-1').map((row) => `${row.productId}@${row.warehouseId}`)).toEqual([
            `${GASEOSA}@${BARRA}`, `${CARNE}@${COCINA}`, `${LIMON}@${BARRA}`, `${HIELO}@${COCINA}`
        ]);
        // Waste never writes the sale snapshot.
        expect(ledger.auditLogs.some((row) => row.action === ORDER_CONSUMPTION_SNAPSHOT_ACTION)).toBe(false);
        expectInvariant(ledger);
    });

    it('route: false (user-selected waste warehouse) consumes every line from that warehouse', async () => {
        const ledger = await seeded();
        await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order, warehouseId: COCINA, userId: 9, companyId: 1,
            orderItemIds: [31, 32], reference: 'WASTE-ORD-1', reason: 'WASTE', allowNegative: true, route: false
        });
        expect(outsOf(ledger, 'WASTE-ORD-1').map((row) => row.warehouseId)).toEqual([COCINA, COCINA, COCINA, COCINA]);
        expect(ledger.stockOf(BARRA, GASEOSA) && Number(ledger.stockOf(BARRA, GASEOSA)!.quantity)).toBeCloseTo(10, 6);
        expectInvariant(ledger);
    });

    function recordQueries(ledger: Ledger, override?: (sql: string, values: unknown[]) => unknown) {
        const calls: Array<{ sql: string; values: unknown[] }> = [];
        (ledger.tx as unknown as { $queryRaw: jest.Mock }).$queryRaw.mockImplementation((async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const sql = strings.join('?');
            calls.push({ sql, values });
            return override?.(sql, values) ?? [];
        }) as never);
        return calls;
    }

    it('a routed warehouse with a LOWER id than the sale warehouse is locked first (ascending), all FOR SHARE', async () => {
        // Sale warehouse = Barra (2); food routes to Cocina (1).
        const ledger = makeLedger('FIFO', [{ branchId: 1, warehouseId: COCINA, categoryId: ALIMENTOS }]);
        (ledger.tx as unknown as { orderItemModifier: { findMany: jest.Mock } }).orderItemModifier.findMany.mockImplementation(async () => []);
        await stockUp(ledger, COCINA, CARNE, 5, 4);
        await stockUp(ledger, BARRA, GASEOSA, 10, 1);
        const calls = recordQueries(ledger);
        await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order: { id: 3, userId: 9, items: [{ id: 51, quantity: 1, menuItem: { recipes: [recipe(CARNE, 1, 'Carne'), recipe(GASEOSA, 1, 'Gaseosa')] } }] },
            warehouseId: BARRA, userId: 9, companyId: 1, allowNegative: true, expectedBranchId: 1
        });
        const warehouseStatements = calls.filter((call) => /`Warehouse`/.test(call.sql));
        expect(warehouseStatements.some((call) => /FOR UPDATE/.test(call.sql))).toBe(false);
        // First two warehouse locks are the scope lock: 1 then 2.
        expect(warehouseStatements.slice(0, 2).map((call) => call.values[0])).toEqual([COCINA, BARRA]);
        // No Product lock before the warehouse scope is fully locked.
        const firstProduct = calls.findIndex((call) => /`Product`/.test(call.sql));
        const secondWarehouse = calls.indexOf(warehouseStatements[1]);
        expect(firstProduct).toBeGreaterThan(secondWarehouse);
        expect(outsOf(ledger, 'ORD-3')).toEqual([
            { productId: GASEOSA, warehouseId: BARRA, quantity: 1 },
            { productId: CARNE, warehouseId: COCINA, quantity: 1 }
        ]);
    });

    it('a routed warehouse reassigned to another branch before the lock falls back to the (locked) sale warehouse', async () => {
        const ledger = await seeded();
        await stockUp(ledger, COCINA, GASEOSA, 10, 1);
        await stockUp(ledger, COCINA, LIMON, 10, 0.5);
        // Under the lock, Barra now belongs to branch 2 (rules were read before).
        recordQueries(ledger, (sql, values) => (/SELECT id, branchId, type FROM `Warehouse`/.test(sql) && values[0] === BARRA
            ? [{ id: BARRA, branchId: 2, type: 'BRANCH' }]
            : undefined));
        const lock = jest.spyOn(InventoryEngineService, 'lockInventoryScope');
        await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order, warehouseId: COCINA, userId: 9, companyId: 1, allowNegative: true, expectedBranchId: 1
        });
        // The lock set already covered the fallback (always included).
        expect([...(lock.mock.calls[0][2] as Iterable<number>)]).toEqual([COCINA, BARRA]);
        expect(outsOf(ledger, 'ORD-1').every((row) => row.warehouseId === COCINA)).toBe(true);
        expect(Number(ledger.stockOf(BARRA, GASEOSA)!.quantity)).toBeCloseTo(10, 6);
    });

    it('rejects when the fallback warehouse no longer belongs to the order branch under the lock', async () => {
        const ledger = await seeded();
        recordQueries(ledger, (sql, values) => (/SELECT id, branchId, type FROM `Warehouse`/.test(sql) && values[0] === COCINA
            ? [{ id: COCINA, branchId: 2, type: 'BRANCH' }]
            : undefined));
        await expect(InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order, warehouseId: COCINA, userId: 9, companyId: 1, allowNegative: true, expectedBranchId: 1
        })).rejects.toThrow(/ya no pertenece a la sucursal/);
        expect(outsOf(ledger, 'ORD-1')).toEqual([]);
    });

    it('without rules everything is consumed from the sale warehouse (legacy behaviour)', async () => {
        const ledger = makeLedger('FIFO', []);
        (ledger.tx as unknown as { orderItemModifier: { findMany: jest.Mock } }).orderItemModifier.findMany.mockImplementation(async () => []);
        await stockUp(ledger, COCINA, GASEOSA, 10, 1);
        await InventoryConsumptionService.consumeForOrder(ledger.tx as never, {
            order: { id: 2, userId: 9, items: [{ id: 41, quantity: 1, menuItem: { recipes: [recipe(GASEOSA, 1, 'Gaseosa')] } }] },
            warehouseId: COCINA, userId: 9, companyId: 1, allowNegative: true
        });
        expect(outsOf(ledger, 'ORD-2')).toEqual([{ productId: GASEOSA, warehouseId: COCINA, quantity: 1 }]);
    });
});

describe('POS availability per routed warehouse', () => {
    it('reads each recipe product from the warehouse its routing rule points to', async () => {
        const unit = { id: 1, abbreviation: 'u', name: 'unidad', measurementType: 'UNIT', systemFactor: 1, active: true, companyId: 1 };
        const line = (productId: number, quantity: number) => ({
            productId, quantity, unit: 'u', unitOfMeasure: null,
            product: { unit: 'u', baseUnit: unit, allowedUnits: [] }
        });
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 1, defaultSaleWarehouseId: COCINA } as never);
        jest.spyOn(prisma.warehouse, 'findFirst').mockResolvedValue({ id: COCINA } as never);
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([
            { id: 100, recipes: [line(GASEOSA, 1), line(HIELO, 2)] },
            { id: 101, recipes: [line(CARNE, 1)] }
        ] as never);
        jest.spyOn(prisma.unitOfMeasure, 'findMany').mockResolvedValue([unit] as never);
        jest.spyOn(prisma.inventoryWarehouseRoute, 'findMany').mockResolvedValue([
            { warehouseId: BARRA, categoryId: BEBIDAS, productId: null, warehouse: { companyId: 1, branchId: 1, type: 'BRANCH' } },
            { warehouseId: COCINA, categoryId: null, productId: HIELO, warehouse: { companyId: 1, branchId: 1, type: 'BRANCH' } }
        ] as never);
        jest.spyOn(prisma.product, 'findMany').mockResolvedValue([
            { id: GASEOSA, categoryId: BEBIDAS }, { id: HIELO, categoryId: BEBIDAS }, { id: CARNE, categoryId: ALIMENTOS }
        ] as never);
        const stockFind = jest.spyOn(prisma.stock, 'findMany').mockResolvedValue([
            // Gaseosa: 0 in Cocina (ignored), 7 in Barra (routed).
            { warehouseId: COCINA, productId: GASEOSA, quantity: 0 },
            { warehouseId: BARRA, productId: GASEOSA, quantity: 7 },
            // Hielo: product rule keeps it in Cocina.
            { warehouseId: COCINA, productId: HIELO, quantity: 100 },
            { warehouseId: BARRA, productId: HIELO, quantity: 0 },
            { warehouseId: COCINA, productId: CARNE, quantity: 3 }
        ] as never);

        const result = await MenuAvailabilityService.getForBranch(1, 1);
        expect(result.warehouseId).toBe(COCINA);
        expect(result.warehouseIds).toEqual([COCINA, BARRA]);
        expect(stockFind.mock.calls[0][0]).toEqual(expect.objectContaining({
            where: expect.objectContaining({ warehouseId: { in: [COCINA, BARRA] } })
        }));
        expect(result.items).toEqual([
            { menuItemId: 100, status: 'AVAILABLE', portions: 7, limitingProductId: GASEOSA },
            { menuItemId: 101, status: 'LOW', portions: 3, limitingProductId: CARNE }
        ]);
    });
});
