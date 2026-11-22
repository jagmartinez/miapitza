import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import prisma from '../../utils/prisma';
import { InventoryMovementService } from '../../services/inventory-movement.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { UnitConversionService } from '../../services/unit-conversion.service';
import { CostingService } from '../../services/costing.service';
import { AuditLogService } from '../../services/audit-log.service';
import { requireIdempotencyKey } from '../../routes/inventory-movement.routes';

afterEach(() => {
    jest.restoreAllMocks();
});

function setup(opts: { stock: number | null; avgCost?: number; averageCostKnown?: boolean; lastPurchaseCost?: number; factor?: number }) {
    jest.spyOn(prisma.warehouse, 'findFirst').mockResolvedValue({ id: 4 } as never);
    jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
        id: 7, name: 'Harina', unit: 'g', baseUnit: { abbreviation: 'g' }
    } as never);
    const factor = opts.factor ?? 1;
    jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (_p: number, _c: number, quantity: number, unit: string) => ({
        baseQuantity: quantity * factor, conversionFactor: factor, originalQuantity: quantity, originalUnit: unit, baseUnit: 'g'
    })) as never);
    const tx = {
        inventoryCountSheet: { findFirst: jest.fn(async () => null) },
        stock: {
            findUnique: jest.fn(async () => (opts.stock == null ? null : { id: 3, quantity: opts.stock })),
            aggregate: jest.fn(async () => ({ _sum: { quantity: opts.stock ?? 0 } }))
        },
        product: {
            findFirst: jest.fn(async () => ({
                currentAverageCost: opts.avgCost ?? 0,
                averageCostKnown: opts.averageCostKnown ?? false,
                cost: 0,
                referenceCostKnown: false,
                lastPurchaseCost: opts.lastPurchaseCost ?? 0,
                lastPurchaseCostKnown: (opts.lastPurchaseCost ?? 0) > 0
            }))
        }
    };
    jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
    );
    const lock = jest.spyOn(InventoryEngineService, 'lockInventoryScope').mockResolvedValue(undefined as never);
    const apply = jest.spyOn(InventoryEngineService, 'applyMovement').mockImplementation((async (_tx: unknown, params: { unitCost?: number }) => ({
        movementId: 55, unitCost: params.unitCost ?? 2, totalCost: 0, balanceQty: 0, balanceCost: 0
    })) as never);
    const fold = jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();
    const audit = jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);
    return { tx, lock, apply, fold, audit };
}

const base = { warehouseId: 4, productId: 7, userId: 9, reason: 'Inventario mensual' };

describe('InventoryMovementService.physicalCount (D10)', () => {
    it('posts an OUT for the shortage, valued by the engine at current cost', async () => {
        const { apply, fold, lock, audit } = setup({ stock: 1200, avgCost: 2, averageCostKnown: true });

        const result = await InventoryMovementService.physicalCount(1, { ...base, countedQuantity: 1 });
        expect(result.delta).toBeCloseTo(-1199, 9);
        expect(lock).toHaveBeenCalled();
        expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            type: 'ADJUSTMENT', direction: 'OUT', quantity: 1199, unitCost: undefined, origin: 'MANUAL'
        }));
        expect(fold).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            details: expect.objectContaining({ kind: 'PHYSICAL_COUNT', previousQuantity: 1200, movementId: 55 })
        }), expect.anything());
    });

    it('converts the counted quantity from the entered unit before computing the delta', async () => {
        const { apply } = setup({ stock: 1200, avgCost: 2, averageCostKnown: true, factor: 1000 });

        const result = await InventoryMovementService.physicalCount(1, { ...base, countedQuantity: 1.5, unit: 'kg' });

        expect(result.countedQuantity).toBe(1500);
        expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            direction: 'IN', quantity: 300, unitCost: 2, originalQuantity: 0.3, originalUnit: 'kg', conversionFactor: 1000
        }));
    });

    it('values a surplus at the last purchase cost when there is no average and folds it into the average', async () => {
        const { apply, fold } = setup({ stock: 0, lastPurchaseCost: 3 });

        await InventoryMovementService.physicalCount(1, { ...base, countedQuantity: 10 });

        expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ direction: 'IN', quantity: 10, unitCost: 3 }));
        expect(fold).toHaveBeenCalledWith(expect.anything(), 7, 1, 10, 3, 0, undefined, 55);
    });

    it('refuses a surplus when the product has no known cost', async () => {
        const { apply } = setup({ stock: 0 });
        await expect(InventoryMovementService.physicalCount(1, { ...base, countedQuantity: 10 }))
            .rejects.toThrow(/PRODUCT_COST_MISSING/);
        expect(apply).not.toHaveBeenCalled();
    });

    it('accepts a count of zero and empties the warehouse', async () => {
        const { apply } = setup({ stock: 4, avgCost: 2, averageCostKnown: true });
        const result = await InventoryMovementService.physicalCount(1, { ...base, countedQuantity: 0 });
        expect(result.countedQuantity).toBe(0);
        expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ direction: 'OUT', quantity: 4 }));
    });

    it('audits a matching count without posting a movement', async () => {
        const { apply, audit } = setup({ stock: 5, avgCost: 2, averageCostKnown: true });
        const result = await InventoryMovementService.physicalCount(1, { ...base, countedQuantity: 5 });
        expect(result.adjusted).toBe(false);
        expect(apply).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            details: expect.objectContaining({ delta: 0, movementId: null })
        }), expect.anything());
    });

    it('rejects a negative count and a missing reason', async () => {
        await expect(InventoryMovementService.physicalCount(1, { ...base, countedQuantity: -1 })).rejects.toThrow(/mayor o igual a 0/);
        await expect(InventoryMovementService.physicalCount(1, { ...base, reason: '  ', countedQuantity: 1 })).rejects.toThrow(/motivo/);
    });
});

describe('requireIdempotencyKey on stock-posting routes (D14)', () => {
    function run(headers: Record<string, unknown>) {
        const status = jest.fn();
        const json = jest.fn();
        const res = { status: status.mockReturnValue({ json }) } as unknown as Response;
        const next = jest.fn() as unknown as NextFunction;
        requireIdempotencyKey({ headers } as unknown as Request, res, next);
        return { status, next: next as unknown as ReturnType<typeof jest.fn> };
    }

    it('rejects a request without a key with 428', () => {
        const { status, next } = run({});
        expect(status).toHaveBeenCalledWith(428);
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects duplicated header values and too-short keys', () => {
        expect(run({ 'x-idempotency-key': ['a', 'b'] }).status).toHaveBeenCalledWith(428);
        expect(run({ 'x-idempotency-key': 'short' }).status).toHaveBeenCalledWith(428);
    });

    it('lets a keyed request through to the global idempotency replay', () => {
        const { next, status } = run({ 'x-idempotency-key': '7f3c2a1e-0000-4000-8000-000000000001' });
        expect(next).toHaveBeenCalled();
        expect(status).not.toHaveBeenCalled();
    });
});

describe('reserved DSLICE references', () => {
    it('rejects manual movements, counts and transfers that mimic internal DSLICE layers', async () => {
        const { InventoryMovementService } = await import('../../services/inventory-movement.service');
        const base = { warehouseId: 1, productId: 2, userId: 3 };
        await expect(InventoryMovementService.create(1, { ...base, type: 'IN', quantity: 5, reference: 'DSLICE-2' }))
            .rejects.toThrow(/reservada/);
        await expect(InventoryMovementService.physicalCount(1, { ...base, countedQuantity: 5, reason: 'conteo', reference: ' dslice-9' }))
            .rejects.toThrow(/reservada/);
        await expect(InventoryMovementService.transfer(1, { fromWarehouseId: 1, toWarehouseId: 2, productId: 2, userId: 3, quantity: 1, reference: 'DSLICE-1' }))
            .rejects.toThrow(/reservada/);
    });
});
