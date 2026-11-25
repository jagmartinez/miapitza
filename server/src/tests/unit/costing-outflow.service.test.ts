import { describe, expect, it, jest } from '@jest/globals';

import { CostingService } from '../../services/costing.service';

type OutflowDb = Parameters<typeof CostingService.getOutflowUnitCost>[0];

function makeDb(
    product: { currentAverageCost: number | null; cost: number | null } | null,
    costingMethod: 'WEIGHTED_AVERAGE' | 'FIFO'
): OutflowDb {
    return {
        product: {
            findFirst: jest.fn(async () => product)
        },
        company: {
            findUnique: jest.fn(async () => ({ costingMethod }))
        }
    } as unknown as OutflowDb;
}

describe('CostingService.getOutflowUnitCost', () => {
    it('uses currentAverageCost under WEIGHTED_AVERAGE', async () => {
        const db = makeDb({ currentAverageCost: 8, cost: 5 }, 'WEIGHTED_AVERAGE');
        expect(await CostingService.getOutflowUnitCost(db, 1, 1)).toBe(8);
    });

    it('falls back to legacy cost when no average is set', async () => {
        const db = makeDb({ currentAverageCost: null, cost: 5 }, 'WEIGHTED_AVERAGE');
        expect(await CostingService.getOutflowUnitCost(db, 1, 1)).toBe(5);
    });

    it('fails closed when the product has no confirmed cost data', async () => {
        const db = makeDb(null, 'WEIGHTED_AVERAGE');
        await expect(CostingService.getOutflowUnitCost(db, 1, 1))
            .rejects.toThrow(/PRODUCT_COST_MISSING/);
    });

    it('values the outflow at the oldest remaining batch under FIFO', async () => {
        const db = makeDb({ currentAverageCost: 8, cost: 5 }, 'FIFO');
        const spy = jest
            .spyOn(CostingService, 'getFifoBatches')
            .mockResolvedValue([
                { quantity: 3, unitCost: 6 },
                { quantity: 5, unitCost: 9 }
            ] as never);

        expect(await CostingService.getOutflowUnitCost(db, 1, 1)).toBe(6);
        spy.mockRestore();
    });

    it('falls back to the average when FIFO has no usable batch', async () => {
        const db = makeDb({ currentAverageCost: 8, cost: 5 }, 'FIFO');
        const spy = jest
            .spyOn(CostingService, 'getFifoBatches')
            .mockResolvedValue([] as never);

        expect(await CostingService.getOutflowUnitCost(db, 1, 1)).toBe(8);
        spy.mockRestore();
    });
});
