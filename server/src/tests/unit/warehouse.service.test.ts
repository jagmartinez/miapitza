import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { WarehouseService } from '../../services/warehouse.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('WarehouseService historical scope invariants', () => {
    it('blocks changing branch/type after movements exist', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            warehouse: {
                findFirst: jest.fn(async () => ({ id: 5, companyId: 1, branchId: 2, type: 'BRANCH' })),
                update: jest.fn()
            },
            branch: { findFirst: jest.fn(async () => ({ id: 3, companyId: 1 })) },
            inventoryMovement: { count: jest.fn(async () => 1) },
            productionOrder: { count: jest.fn(async () => 0) },
            stock: { count: jest.fn(async () => 0) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(WarehouseService.update(5, 1, { branchId: 3 }))
            .rejects.toThrow(/historial o existencias/i);
        expect(tx.warehouse.update).not.toHaveBeenCalled();
    });

    it('allows renaming without treating it as a historical scope change', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            warehouse: {
                findFirst: jest.fn(async () => ({ id: 5, companyId: 1, branchId: 2, type: 'BRANCH' })),
                update: jest.fn(async (_args: unknown) => ({ id: 5, name: 'Nueva' }))
            },
            branch: { findFirst: jest.fn(async () => ({ id: 2, companyId: 1 })) },
            inventoryMovement: { count: jest.fn() },
            productionOrder: { count: jest.fn() },
            stock: { count: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await WarehouseService.update(5, 1, { name: 'Nueva' });

        expect(tx.inventoryMovement.count).not.toHaveBeenCalled();
        expect(tx.warehouse.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 5 },
            data: expect.objectContaining({ name: 'Nueva', branchId: 2, type: 'BRANCH' })
        }));
    });
});
