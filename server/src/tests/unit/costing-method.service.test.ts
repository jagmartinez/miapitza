import { describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CostingService } from '../../services/costing.service';

function makeTx(
    stockQuantity: number,
    layerQuantity: number,
    averageCost = 7,
    referenceCost = 5,
    currentMethod: 'WEIGHTED_AVERAGE' | 'FIFO' = 'WEIGHTED_AVERAGE',
    averageCostKnown = averageCost > 0,
    referenceCostKnown = referenceCost > 0
) {
    const createdLayers: Array<Record<string, unknown>> = [];
    const tx = {
        company: {
            findUnique: jest.fn(async () => ({ id: 1, name: 'Tenant', costingMethod: currentMethod })),
            update: jest.fn(async (_args: unknown) => ({ id: 1, name: 'Tenant', costingMethod: 'FIFO' }))
        },
        stock: {
            findMany: jest.fn(async () => ([{
                warehouseId: 2,
                productId: 3,
                quantity: stockQuantity,
                product: {
                    currentAverageCost: averageCost,
                    averageCostKnown,
                    cost: referenceCost,
                    referenceCostKnown
                }
            }]))
        },
        inventoryBatch: {
            findMany: jest.fn(async () => layerQuantity > 0 ? [{
                warehouseId: 2, productId: 3, remainingQty: layerQuantity
            }] : []),
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                createdLayers.push(args.data);
                return {};
            })
        },
        $queryRaw: jest.fn(async () => [])
    };
    return { tx, createdLayers };
}

describe('CostingService.updateCostingMethod', () => {
    it('creates an explicit opening layer for unrepresented legacy stock before FIFO', async () => {
        const { tx, createdLayers } = makeTx(10, 6);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await CostingService.updateCostingMethod(1, 'FIFO');

        expect(createdLayers).toEqual([expect.objectContaining({
            warehouseId: 2,
            productId: 3,
            originalQty: 4,
            remainingQty: 4,
            unitCost: 7,
            sourceType: 'OPENING'
        })]);
        expect(tx.company.update).toHaveBeenCalledWith(expect.objectContaining({
            data: { costingMethod: 'FIFO' }
        }));
    });

    it('refuses FIFO activation while negative stock exists', async () => {
        const { tx } = makeTx(-1, 0);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(CostingService.updateCostingMethod(1, 'FIFO'))
            .rejects.toThrow(/existencias negativas/i);
        expect(tx.company.update).not.toHaveBeenCalled();
    });

    it('refuses to invent a zero-valued FIFO opening layer', async () => {
        const { tx, createdLayers } = makeTx(4, 0, 0, 0, 'FIFO');
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);
        await expect(CostingService.updateCostingMethod(1, 'FIFO')).rejects.toThrow(/falta confirmar el costo unitario/i);
        expect(createdLayers).toHaveLength(0);
    });

    it('allows an explicitly confirmed zero-valued FIFO opening layer', async () => {
        const { tx, createdLayers } = makeTx(4, 0, 0, 0, 'FIFO', true, false);
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never
        );

        await CostingService.updateCostingMethod(1, 'FIFO');

        expect(createdLayers).toEqual([expect.objectContaining({
            productId: 3, originalQty: 4, remainingQty: 4, unitCost: 0
        })]);
    });
});
