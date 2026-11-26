import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { SaleWarehouseService } from '../../services/sale-warehouse.service';
import { ModifierService } from '../../services/modifier.service';
import {
    applyRecipeRemoval,
    InventoryConsumptionService,
    ORDER_CONSUMPTION_SNAPSHOT_ACTION,
    splitConsumedLayers
} from '../../services/inventory-consumption.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { UnitConversionService } from '../../services/unit-conversion.service';
import { baseUnitFactor, computeItemAvailability, type UnitLike } from '../../services/menu-availability.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;
const fn = <T extends AnyFn = AnyFn>(impl?: T) => jest.fn(impl as any) as unknown as jest.Mock<AnyFn>;

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Branch default sale warehouse validation', () => {
    const db = (warehouse: Record<string, unknown> | null) => ({ warehouse: { findFirst: fn(async () => warehouse) } });

    it('accepts a BRANCH warehouse of the same branch and clears with null', async () => {
        await expect(SaleWarehouseService.assertValidDefault(db({ id: 6, branchId: 2, type: 'BRANCH' }) as never, 1, 2, 6)).resolves.toBe(6);
        await expect(SaleWarehouseService.assertValidDefault(db(null) as never, 1, 2, null)).resolves.toBeNull();
    });

    it('rejects warehouses of another branch, CENTRAL warehouses and other tenants', async () => {
        await expect(SaleWarehouseService.assertValidDefault(db({ id: 6, branchId: 3, type: 'BRANCH' }) as never, 1, 2, 6)).rejects.toThrow(/misma sucursal/);
        await expect(SaleWarehouseService.assertValidDefault(db({ id: 6, branchId: 2, type: 'CENTRAL' }) as never, 1, 2, 6)).rejects.toThrow(/misma sucursal/);
        const tenantDb = db(null);
        await expect(SaleWarehouseService.assertValidDefault(tenantDb as never, 1, 2, 6)).rejects.toThrow(/no encontrada/);
        expect(tenantDb.warehouse.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 6, companyId: 1 } }));
    });
});

describe('"Sin X" (REMOVE) modifiers in sale consumption', () => {
    function consumeTx(modifierRows: unknown[]) {
        return {
            inventoryMovement: { findMany: fn(async () => []) },
            orderItemModifier: { findMany: fn(async () => modifierRows) },
            auditLog: { create: fn(async () => ({})) }
        };
    }
    const order = {
        id: 9, userId: 7,
        items: [{
            id: 31, quantity: 2,
            menuItem: {
                recipes: [
                    { productId: 4, quantity: 100, unit: 'g', product: { name: 'Cebolla', unit: 'g' } },
                    { productId: 5, quantity: 1, unit: 'u', product: { name: 'Pan', unit: 'u' } }
                ]
            }
        }]
    };
    const removeModifier = (consumeQuantity: number | null, productId = 4) => ({
        modifier: {
            name: 'Sin cebolla', productId, consumeQuantity, inventoryEffect: 'REMOVE',
            unit: null, product: { id: productId, name: 'Cebolla', unit: 'g' }
        },
        orderItem: { id: 31, quantity: 2 }
    });

    function spies() {
        jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue();
        jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (_p: number, _c: number, quantity: number, unit: string) => ({
            baseQuantity: quantity, originalQuantity: quantity, originalUnit: unit, conversionFactor: 1, baseUnit: unit
        })) as never);
        return jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({ movementId: 1, unitCost: 1, totalCost: 1, balanceQty: 10, balanceCost: 10 });
    }

    it('drops the whole recipe line when the REMOVE modifier has no quantity, and never consumes the modifier product', async () => {
        const apply = spies();
        const tx = consumeTx([removeModifier(null)]);

        await InventoryConsumptionService.consumeForOrder(tx as never, { order, warehouseId: 5, userId: 7, companyId: 1 });

        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply.mock.calls[0][1]).toEqual(expect.objectContaining({ productId: 5, quantity: 2 }));
        // Snapshot keeps a zero entry so a later credit note never falls back to the full recipe.
        const call = tx.auditLog.create.mock.calls[0][0] as { data: { action: string; details: any } };
        expect(call.data.action).toBe(ORDER_CONSUMPTION_SNAPSHOT_ACTION);
        expect(call.data.details.items[0].products).toEqual(expect.arrayContaining([
            { productId: 4, quantity: 0, warehouseId: 5 }, { productId: 5, quantity: 2, warehouseId: 5 }
        ]));
    });

    it('reduces the line by consumeQuantity per dish unit and clamps at 0', async () => {
        const apply = spies();
        await InventoryConsumptionService.consumeForOrder(consumeTx([removeModifier(30)]) as never, { order, warehouseId: 5, userId: 7, companyId: 1 });
        expect(apply.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining([
            expect.objectContaining({ productId: 4, quantity: 140, originalQuantity: 140 })
        ]));

        apply.mockClear();
        await InventoryConsumptionService.consumeForOrder(consumeTx([removeModifier(70), removeModifier(80)]) as never, { order, warehouseId: 5, userId: 7, companyId: 1 });
        expect(apply.mock.calls.map((c) => (c[1] as { productId: number }).productId)).toEqual([5]);
    });

    it('ignores a REMOVE modifier whose product is not in the recipe', async () => {
        const apply = spies();
        await InventoryConsumptionService.consumeForOrder(consumeTx([removeModifier(null, 99)]) as never, { order, warehouseId: 5, userId: 7, companyId: 1 });
        expect(apply.mock.calls.map((c) => (c[1] as { productId: number; quantity: number }).quantity)).toEqual([200, 2]);
    });

    it('applyRecipeRemoval never goes negative', () => {
        expect(applyRecipeRemoval(1, { full: false, baseQuantity: 3 })).toBe(0);
        expect(applyRecipeRemoval(1, { full: true, baseQuantity: 0 })).toBe(0);
        expect(applyRecipeRemoval(1, undefined)).toBe(1);
    });
});

describe('POS availability computation', () => {
    const units: UnitLike[] = [
        { id: 1, abbreviation: 'kg', name: 'kilogramo', measurementType: 'WEIGHT', systemFactor: 1000, active: true, companyId: 1 },
        { id: 2, abbreviation: 'g', name: 'gramo', measurementType: 'WEIGHT', systemFactor: 1, active: true, companyId: 1 },
        { id: 3, abbreviation: 'caja', name: 'caja', measurementType: 'PACKAGE', systemFactor: 1, active: true, companyId: 1 },
        { id: 4, abbreviation: 'unidad', name: 'unidad', measurementType: 'PACKAGE', systemFactor: 1, active: true, companyId: 1 }
    ];
    const byAbbr = new Map(units.map((u) => [u.abbreviation, u]));
    const kgProduct = { unit: 'kg', baseUnit: units[0], allowedUnits: [] };

    it('converts recipe units to the product base unit like UnitConversionService', () => {
        expect(baseUnitFactor(1, kgProduct, 'g', byAbbr, units)).toBeCloseTo(0.001);
        expect(baseUnitFactor(1, kgProduct, 'kg', byAbbr, units)).toBe(1);
        const box = { unit: 'unidad', baseUnit: units[3], allowedUnits: [{ conversionFactor: 12, active: true, unit: units[2] }] };
        expect(baseUnitFactor(1, box, 'caja', byAbbr, units)).toBe(12);
        // PACKAGE without an explicit factor is rejected, never assumed 1:1.
        expect(baseUnitFactor(1, { ...box, allowedUnits: [] }, 'caja', byAbbr, units)).toBeNull();
        // Legacy product without base unit: inferred from the free-text unit.
        expect(baseUnitFactor(1, { unit: 'Kilos', baseUnit: null, allowedUnits: [] }, 'g', byAbbr, units)).toBeCloseTo(0.001);
    });

    it('returns min portions over recipe lines with LOW/OUT/UNTRACKED/UNKNOWN status', () => {
        const recipes = [
            { productId: 4, quantity: 200, unit: 'g', product: kgProduct },
            { productId: 5, quantity: 1, unit: 'kg', product: kgProduct }
        ];
        const stock = new Map([[4, 1.0], [5, 30]]);
        expect(computeItemAvailability(1, 10, recipes, stock, byAbbr, units)).toEqual({
            menuItemId: 10, status: 'LOW', portions: 5, limitingProductId: 4
        });
        expect(computeItemAvailability(1, 10, recipes, new Map([[4, -2], [5, 30]]), byAbbr, units).status).toBe('OUT');
        expect(computeItemAvailability(1, 10, recipes, new Map([[4, 100], [5, 100]]), byAbbr, units)).toEqual(
            expect.objectContaining({ status: 'AVAILABLE', portions: 100 })
        );
        expect(computeItemAvailability(1, 10, [], stock, byAbbr, units).status).toBe('UNTRACKED');
        expect(computeItemAvailability(1, 10, [{ productId: 4, quantity: 1, unit: 'lt', product: kgProduct }], stock, byAbbr, units).status).toBe('UNKNOWN');
    });
});

describe('Partial credit-note returns keep FIFO layer provenance', () => {
    const oldDate = new Date('2026-01-01T00:00:00Z');
    const layers = [
        { quantity: 3, unitCost: 2, sourceRef: 'PO-1', sourceType: 'PURCHASE', createdAt: oldDate.toISOString() },
        { quantity: 1, unitCost: 6, sourceRef: 'PO-2', sourceType: 'PURCHASE', createdAt: oldDate.toISOString() }
    ];

    it('splits consumed layers proportionally and exactly', () => {
        const parsed = layers.map((l) => ({ ...l, sourceType: 'PURCHASE' as const, createdAt: oldDate }));
        const shares = splitConsumedLayers(parsed, 4, 2)!;
        expect(shares.map((s) => s.quantity)).toEqual([1.5, 0.5]);
        expect(shares.map((s) => s.unitCost)).toEqual([2, 6]);
        expect(splitConsumedLayers(parsed, 5, 2)).toBeUndefined();
    });

    function reverseTx(costingMethod: 'FIFO' | 'WEIGHTED_AVERAGE') {
        return {
            inventoryMovement: {
                findMany: fn(async () => [{
                    id: 1, warehouseId: 5, productId: 4, type: 'OUT', quantity: 4,
                    unitCost: 3, totalCost: 12, consumedLayers: layers
                }])
            },
            company: { findUnique: fn(async () => ({ costingMethod })) },
            stock: { aggregate: fn(async () => ({ _sum: { quantity: 10 } })) },
            // Warehouse locking read of the costing method.
            $queryRaw: fn(async () => [{ costingMethod }])
        };
    }

    it('passes the proportional original layers under FIFO', async () => {
        jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue();
        jest.spyOn(InventoryEngineService, 'readCostingMethod').mockResolvedValue('FIFO');
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({ movementId: 0, unitCost: 3, totalCost: 6, balanceQty: 12, balanceCost: 36 });

        await InventoryConsumptionService.reverseQuantitiesForOrder(reverseTx('FIFO') as never, {
            orderId: 9, userId: 7, companyId: 1, reason: 'NC parcial', sourceType: 'ADJUSTMENT',
            reversalOrigin: 'CN-1', quantities: [{ productId: 4, quantity: 2 }]
        });

        const params = apply.mock.calls[0][1] as Record<string, any>;
        expect(params.unitCost).toBeUndefined();
        expect(params.inboundLayers).toEqual([
            expect.objectContaining({ quantity: 1.5, unitCost: 2, sourceRef: 'PO-1', createdAt: oldDate }),
            expect.objectContaining({ quantity: 0.5, unitCost: 6, sourceRef: 'PO-2', createdAt: oldDate })
        ]);
    });

    it('keeps the averaged single layer under weighted average', async () => {
        jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue();
        jest.spyOn(InventoryEngineService, 'readCostingMethod').mockResolvedValue('WEIGHTED_AVERAGE');
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValue({ movementId: 0, unitCost: 3, totalCost: 6, balanceQty: 12, balanceCost: 36 });

        await InventoryConsumptionService.reverseQuantitiesForOrder(reverseTx('WEIGHTED_AVERAGE') as never, {
            orderId: 9, userId: 7, companyId: 1, reason: 'NC parcial', sourceType: 'ADJUSTMENT',
            reversalOrigin: 'CN-1', quantities: [{ productId: 4, quantity: 2 }]
        });

        const params = apply.mock.calls[0][1] as Record<string, any>;
        expect(params.inboundLayers).toBeUndefined();
        expect(params.unitCost).toBe(3);
        expect(params.sourceType).toBe('ADJUSTMENT');
    });
});

describe('Modifier REMOVE configuration rules', () => {
    const check = (link: Record<string, unknown>) =>
        (ModifierService as any).assertCompleteInventoryLink(1, { productId: null, consumeQuantity: null, unitId: null, ...link });

    it('allows a REMOVE modifier without quantity (drops the whole recipe line)', async () => {
        await expect(check({ productId: 4, inventoryEffect: 'REMOVE' })).resolves.toBeUndefined();
    });

    it('requires a product for REMOVE and a quantity for a unit, and keeps ADD strict', async () => {
        await expect(check({ inventoryEffect: 'REMOVE' })).rejects.toThrow(/requiere el producto/);
        await expect(check({ productId: 4, unitId: 2, inventoryEffect: 'REMOVE' })).rejects.toThrow(/cantidad a quitar/);
        await expect(check({ productId: 4, inventoryEffect: 'ADD' })).rejects.toThrow(/mayor a 0/);
        expect(() => (ModifierService as any).normalizeInventoryEffect('DELETE')).toThrow(/ADD o REMOVE/);
    });
});
