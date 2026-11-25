import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CostingService } from '../../services/costing.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { InventoryMovementService } from '../../services/inventory-movement.service';

type Original = {
    id: number;
    companyId: number;
    warehouseId: number;
    productId: number;
    userId: number;
    type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
    transferGroupId: string | null;
    direction: 'IN' | 'OUT';
    origin: 'MANUAL' | 'WASTE' | 'TRANSFER';
    quantity: number;
    unitCost: number;
    totalCost: number;
    reason: string;
    reference: string | null;
    consumedLayers: unknown;
    reversalOfId: null;
    warehouse: { branchId: number | null };
};

function movement(overrides: Partial<Original> = {}): Original {
    return {
        id: 10, companyId: 1, warehouseId: 2, productId: 3, userId: 4,
        type: 'OUT', transferGroupId: null, direction: 'OUT', origin: 'WASTE',
        quantity: 2, unitCost: 5, totalCost: 10, reason: 'WASTE: Deterioro',
        reference: null,
        consumedLayers: [{ quantity: 2, unitCost: 5, sourceRef: 'PO-1', sourceType: 'PURCHASE' }],
        reversalOfId: null, warehouse: { branchId: 7 },
        ...overrides
    };
}

function mockTransaction(originals: Original[], already: unknown[] = []) {
    const selected = originals[0];
    const findFirst = jest.fn(async (..._args: unknown[]): Promise<unknown> => null)
        .mockResolvedValueOnce({ id: selected.id, transferGroupId: selected.transferGroupId })
        .mockResolvedValueOnce(null);
    const findMany = jest.fn(async (..._args: unknown[]): Promise<unknown> => [])
        .mockResolvedValueOnce(originals.map(({ id }) => ({ id })))
        .mockResolvedValueOnce(originals)
        .mockResolvedValueOnce(already)
        .mockResolvedValueOnce([]);
    const tx = {
        inventoryMovement: { findFirst, findMany },
        company: { findUnique: jest.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
        stock: { aggregate: jest.fn(async (_args: unknown) => ({ _sum: { quantity: 12 } })) },
        $queryRaw: jest.fn(async () => [])
    };
    jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
    );
    return tx;
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe('InventoryMovementService immutable reversal', () => {
    it('reverses waste with exact layers, cost and durable lineage', async () => {
        mockTransaction([movement()]);
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 101, unitCost: 5, totalCost: 10, balanceQty: 9, balanceCost: 45
        });
        const applyCost = jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();

        const result = await InventoryMovementService.reverse(1, 10, {
            userId: 8, reason: 'Registro duplicado', reversalKey: 'waste-reversal-10', branchId: 7
        });

        expect(result.idempotent).toBe(false);
        expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            direction: 'IN', origin: 'REVERSAL', quantity: 2, unitCost: 5,
            inboundLayers: [expect.objectContaining({ sourceRef: 'PO-1', unitCost: 5 })],
            reversalOfId: 10, reversalKey: 'waste-reversal-10'
        }));
        expect(applyCost).toHaveBeenCalledWith(expect.anything(), 3, 1, 2, 5, 10, undefined, 101);
    });

    it('reverses MANUAL OUT as a valued WA inbound after later receipts', async () => {
        const tx = mockTransaction([movement({ origin: 'MANUAL', reason: 'Ajuste manual de salida' })]);
        jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 103, unitCost: 5, totalCost: 10, balanceQty: 12, balanceCost: 70
        });
        const applyCost = jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();

        await InventoryMovementService.reverse(1, 10, {
            userId: 8, reason: 'Salida manual incorrecta', reversalKey: 'manual-out-reversal-10', branchId: 7
        });

        expect(tx.stock.aggregate).toHaveBeenCalledWith({
            where: { productId: 3, companyId: 1 }, _sum: { quantity: true }
        });
        // Current stock after physical restore is 12, so WA must append 2@5 over
        // the previous 10 units (e.g. 10@6 -> 70/12 = 5.833333).
        expect(applyCost).toHaveBeenCalledWith(expect.anything(), 3, 1, 2, 5, 10, undefined, 103);
    });

    it('reverses a manual inbound only from its own batches and compensates its linked cost event', async () => {
        mockTransaction([movement({
            type: 'IN', direction: 'IN', origin: 'MANUAL', reason: 'Conteo fisico',
            consumedLayers: null
        })]);
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement').mockResolvedValue({
            movementId: 102, unitCost: 5, totalCost: 10, balanceQty: 0, balanceCost: 0
        });
        const reverseCost = jest.spyOn(CostingService, 'reverseInventoryMovementCost').mockResolvedValue();

        await InventoryMovementService.reverse(1, 10, {
            userId: 8, reason: 'Conteo incorrecto', reversalKey: 'manual-reversal-10', branchId: 7
        });

        expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            direction: 'OUT', consumeSourceMovementId: 10, reversalOfId: 10
        }));
        expect(reverseCost).toHaveBeenCalledWith(expect.anything(), 10, 102, 1);
    });

    it('reverses both transfer legs in safe order and restores source layers', async () => {
        const source = movement({
            id: 20, warehouseId: 2, type: 'TRANSFER', direction: 'OUT', origin: 'TRANSFER',
            transferGroupId: 'TRF-1', reason: 'Transfer out', warehouse: { branchId: null }
        });
        const destination = movement({
            id: 21, warehouseId: 3, type: 'TRANSFER', direction: 'IN', origin: 'TRANSFER',
            transferGroupId: 'TRF-1', reason: 'Transfer in', consumedLayers: null,
            warehouse: { branchId: 7 }
        });
        mockTransaction([source, destination]);
        const restoredLayers = [{ quantity: 2, unitCost: 5, sourceRef: 'PO-1', sourceType: 'PURCHASE' as const }];
        const apply = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValueOnce({ movementId: 201, unitCost: 5, totalCost: 10, balanceQty: 0, balanceCost: 0, consumedLayers: restoredLayers })
            .mockResolvedValueOnce({ movementId: 202, unitCost: 5, totalCost: 10, balanceQty: 2, balanceCost: 10 });

        await InventoryMovementService.reverse(1, 20, {
            userId: 8, reason: 'Destino incorrecto', reversalKey: 'transfer-reversal-20'
        });

        expect(apply.mock.calls[0][1]).toEqual(expect.objectContaining({
            warehouseId: 3, direction: 'OUT', consumeSourceMovementId: 21, reversalOfId: 21
        }));
        expect(apply.mock.calls[1][1]).toEqual(expect.objectContaining({
            warehouseId: 2, direction: 'IN', inboundLayers: restoredLayers, reversalOfId: 20
        }));
    });

    it('returns the same result for the same domain key and blocks a different double reversal', async () => {
        const original = movement();
        const prior = [{ id: 101, reversalOfId: 10, reversalKey: 'same-reversal-key', reversalGroupId: 'REV-1' }];
        mockTransaction([original], prior);
        const same = await InventoryMovementService.reverse(1, 10, {
            userId: 8, reason: 'Registro duplicado', reversalKey: 'same-reversal-key', branchId: 7
        });
        expect(same).toEqual(expect.objectContaining({ idempotent: true, reversalGroupId: 'REV-1' }));

        jest.restoreAllMocks();
        mockTransaction([original], prior);
        await expect(InventoryMovementService.reverse(1, 10, {
            userId: 8, reason: 'Otro intento', reversalKey: 'different-key-10', branchId: 7
        })).rejects.toThrow(/ya fue reversado/i);
    });

    it('fails closed for another branch and for an unreconciled historical cost', async () => {
        mockTransaction([movement({ warehouse: { branchId: 99 } })]);
        await expect(InventoryMovementService.reverse(1, 10, {
            userId: 8, reason: 'Registro duplicado', reversalKey: 'branch-reversal-10', branchId: 7
        })).rejects.toThrow(/otra sucursal/i);

        jest.restoreAllMocks();
        mockTransaction([movement({ totalCost: 999 })]);
        await expect(InventoryMovementService.reverse(1, 10, {
            userId: 8, reason: 'Registro duplicado', reversalKey: 'cost-reversal-10', branchId: 7
        })).rejects.toThrow(/MOVEMENT_COST_INTEGRITY_ERROR/);
    });
});

describe('CostingService manual movement reversal audit trail', () => {
    it('marks linked cost history reversed instead of deleting it', async () => {
        const history = {
            id: 70, productId: 3, companyId: 1, inventoryMovementId: 10,
            quantity: 2, unitCost: 5, previousAvgCost: 4, previousAvgCostKnown: true,
            newAvgCost: 4.5, newAvgCostKnown: true, previousStock: 2, newStock: 4,
            reversedAt: null
        };
        const tx = {
            productCostHistory: {
                findFirst: jest.fn(async () => history),
                findMany: jest.fn(async () => [history]),
                update: jest.fn(async (_args: unknown) => ({ ...history, reversedAt: new Date(), reversalMovementId: 102 }))
            },
            company: { findUnique: jest.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
            product: { update: jest.fn(async () => ({})) }
        };

        await CostingService.reverseInventoryMovementCost(tx as never, 10, 102, 1);

        expect(tx.productCostHistory.update).toHaveBeenCalledWith({
            where: { id: 70 },
            data: { reversedAt: expect.any(Date), reversalMovementId: 102 }
        });
        expect((tx.productCostHistory as typeof tx.productCostHistory & { delete?: unknown }).delete).toBeUndefined();
    });

    it('replays a later purchase after removing an earlier MANUAL IN quantity', async () => {
        const target = {
            id: 70, productId: 3, companyId: 1, inventoryMovementId: 10,
            quantity: 2, unitCost: 5, previousAvgCost: 5, previousAvgCostKnown: true,
            newAvgCost: 5, newAvgCostKnown: true, previousStock: 10, newStock: 12,
            reversedAt: null, purchaseOrderItemId: null
        };
        const laterPurchase = {
            id: 71, productId: 3, companyId: 1, inventoryMovementId: null,
            quantity: 2, unitCost: 10, previousAvgCost: 5, previousAvgCostKnown: true,
            newAvgCost: 70 / 12, newAvgCostKnown: true, previousStock: 12, newStock: 14,
            reversedAt: null, purchaseOrderItemId: 99
        };
        const tx = {
            productCostHistory: {
                findFirst: jest.fn(async () => target),
                findMany: jest.fn(async () => [target, laterPurchase]),
                update: jest.fn(async (_args: unknown) => ({ ...target, reversedAt: new Date(), reversalMovementId: 102 }))
            },
            company: { findUnique: jest.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
            product: { update: jest.fn(async (_args: unknown) => ({})) }
        };

        await CostingService.reverseInventoryMovementCost(tx as never, 10, 102, 1);

        expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ currentAverageCost: 70 / 12, averageCostKnown: true })
        }));
    });
});
