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
    const sqlOf = (strings: unknown) => (Array.isArray(strings) ? strings.join('?') : String(strings));
    const tx = {
        company: {
            findUnique: jest.fn(async () => ({ id: 1, name: 'Tenant', costingMethod: currentMethod })),
            update: jest.fn(async (_args: unknown) => ({ id: 1, name: 'Tenant', costingMethod: 'FIFO' }))
        },
        warehouse: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
        product: {
            findMany: jest.fn(async () => ([{
                id: 3,
                currentAverageCost: averageCost,
                averageCostKnown,
                cost: referenceCost,
                referenceCostKnown
            }]))
        },
        inventoryBatch: {
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                createdLayers.push(args.data);
                return {};
            })
        },
        // Stock and layers are read WITH their row locks (latest committed).
        $queryRaw: jest.fn(async (strings: unknown) => {
            const sql = sqlOf(strings);
            if (sql.includes('FROM `Stock`')) return [{ warehouseId: 2, productId: 3, quantity: stockQuantity }];
            if (sql.includes('FROM `InventoryBatch`')) {
                return layerQuantity > 0 ? [{ warehouseId: 2, productId: 3, remainingQty: layerQuantity }] : [];
            }
            return [];
        })
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

    it('switches every warehouse copy under Company -> Warehouse X locks in both directions', async () => {
        for (const target of ['FIFO', 'WEIGHTED_AVERAGE'] as const) {
            const { tx } = makeTx(5, 5, 7, 5, target === 'FIFO' ? 'WEIGHTED_AVERAGE' : 'FIFO');
            jest.spyOn(prisma, '$transaction').mockImplementation(
                (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
            );

            await CostingService.updateCostingMethod(1, target);

            const sql = tx.$queryRaw.mock.calls.map((call) => (call[0] as string[]).join('?'));
            expect(sql[0]).toMatch(/FROM `Company`.*FOR UPDATE/);
            expect(sql[1]).toMatch(/FROM `Warehouse`.*FOR UPDATE/);
            expect(tx.warehouse.updateMany).toHaveBeenCalledWith({
                where: { companyId: 1 }, data: { costingMethod: target }
            });
        }
    });
});
