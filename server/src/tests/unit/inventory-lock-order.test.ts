import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { InventoryConsumptionService } from '../../services/inventory-consumption.service';
import { InventoryMovementService } from '../../services/inventory-movement.service';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import { CostingService } from '../../services/costing.service';
import { AuditLogService } from '../../services/audit-log.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

/**
 * Canonical inventory lock order: Warehouse (asc) -> Product (asc) -> Stock.
 * Each test records the raw lock statements and asserts no flow takes a
 * Product lock before the Warehouse lock of the movement it is about to post.
 */
type LockCall = { table: string; ids: unknown[]; sql: string };

function recordingQueryRaw(calls: LockCall[]) {
    return jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        const table = /FROM `(\w+)`/.exec(sql)?.[1] ?? 'unknown';
        calls.push({ table, ids: values, sql });
        return [];
    });
}

function firstIndex(calls: LockCall[], table: string) {
    return calls.findIndex((call) => call.table === table);
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe('InventoryEngineService.lockInventoryScope', () => {
    it('locks warehouses ascending (shared) before products ascending (exclusive), deduplicated', async () => {
        const calls: LockCall[] = [];
        const tx = { $queryRaw: recordingQueryRaw(calls) };

        await InventoryEngineService.lockInventoryScope(tx as never, 1, [9, 3, 9], [8, 2, 8, 5]);

        expect(calls.map((call) => [call.table, call.ids[0]])).toEqual([
            ['Warehouse', 3], ['Warehouse', 9], ['Product', 2], ['Product', 5], ['Product', 8]
        ]);
        expect(calls.filter((call) => call.table === 'Warehouse').every((call) => call.sql.includes('LOCK IN SHARE MODE'))).toBe(true);
        expect(calls.filter((call) => call.table === 'Product').every((call) => call.sql.includes('FOR UPDATE'))).toBe(true);
    });
});

describe('lock order in reversal flows', () => {
    it('PurchaseOrderService.reverseReceipt locks the warehouse before any product', async () => {
        const calls: LockCall[] = [];
        const tx = {
            $queryRaw: recordingQueryRaw(calls),
            user: { findFirst: jest.fn(async () => ({ id: 9 })) },
            purchaseOrder: {
                findFirst: jest.fn(async () => ({ id: 10, status: 'RECEIVED', items: [{ id: 31 }] })),
                update: jest.fn(async () => ({ id: 10 }))
            },
            purchaseOrderPayment: { count: jest.fn(async () => 0) },
            purchaseOrderItem: { updateMany: jest.fn(async () => ({ count: 1 })) },
            purchaseOrderReceipt: { updateMany: jest.fn(async () => ({ count: 0 })) },
            inventoryMovement: { findMany: jest.fn(async () => []) },
            inventoryBatch: {
                findMany: jest.fn(async () => [
                    { warehouseId: 4, productId: 8, originalQty: 1 },
                    { warehouseId: 4, productId: 7, originalQty: 2 }
                ])
            },
            product: { findFirst: jest.fn(async () => ({ name: 'P' })) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 1, balanceQty: 0, balanceCost: 0, unitCost: 1, totalCost: 1, consumedLayers: []
        });
        jest.spyOn(CostingService, 'reversePurchaseCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        await PurchaseOrderService.reverseReceipt(10, 1, 9, 'Corrección');

        const warehouse = firstIndex(calls, 'Warehouse');
        const product = firstIndex(calls, 'Product');
        expect(warehouse).toBeGreaterThanOrEqual(0);
        expect(warehouse).toBeLessThan(product);
        expect(calls.filter((call) => call.table === 'Product').map((call) => call.ids[0])).toEqual([7, 8]);
    });

    it('InventoryConsumptionService.reverseForOrder locks warehouses before products', async () => {
        const calls: LockCall[] = [];
        const tx = {
            $queryRaw: recordingQueryRaw(calls),
            inventoryMovement: {
                findMany: jest.fn(async () => [
                    { id: 1, warehouseId: 6, productId: 9, type: 'OUT', quantity: 1, unitCost: 2, totalCost: 2, consumedLayers: null },
                    { id: 2, warehouseId: 2, productId: 4, type: 'OUT', quantity: 1, unitCost: 3, totalCost: 3, consumedLayers: null }
                ])
            },
            stock: { aggregate: jest.fn(async () => ({ _sum: { quantity: 0 } })) }
        };
        jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 5, balanceQty: 1, balanceCost: 1, unitCost: 2, totalCost: 2
        });
        jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue(undefined as never);

        await InventoryConsumptionService.reverseForOrder(tx as never, {
            orderId: 77, userId: 1, companyId: 1, reason: 'Devolución', sourceType: 'ADJUSTMENT', reversalOrigin: 'TEST'
        });

        expect(calls.map((call) => [call.table, call.ids[0]])).toEqual([
            ['Warehouse', 2], ['Warehouse', 6], ['Product', 4], ['Product', 9]
        ]);
    });

    it('InventoryMovementService.transfer locks the product before the stock rows', async () => {
        const calls: LockCall[] = [];
        const tx = {
            $queryRaw: recordingQueryRaw(calls),
            product: { findFirst: jest.fn(async () => ({ id: 5, name: 'Harina' })) },
            stock: { upsert: jest.fn(async () => ({})) },
            company: { findUnique: jest.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) }
        };
        jest.spyOn(prisma.warehouse, 'findMany').mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({ unit: 'kg', baseUnit: null } as never);
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 1, originalQuantity: 1, originalUnit: 'kg', conversionFactor: 1, baseUnit: 'kg'
        } as never);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 1, balanceQty: 0, balanceCost: 0, unitCost: 1, totalCost: 1, consumedLayers: []
        });

        await InventoryMovementService.transfer(1, {
            fromWarehouseId: 2, toWarehouseId: 1, productId: 5, userId: 1, quantity: 1
        });

        expect(calls.map((call) => call.table)).toEqual(['Warehouse', 'Product', 'Stock']);
    });
});
