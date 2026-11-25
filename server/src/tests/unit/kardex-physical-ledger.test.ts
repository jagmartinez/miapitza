import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { KardexService } from '../../services/kardex.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Kardex physical ledger integrity', () => {
    it('keeps persisted zero costs and orders same-millisecond movements by id', async () => {
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7,
            name: 'Agua',
            sku: 'AGUA',
            unit: 'l',
            currentAverageCost: 9,
            baseUnit: { abbreviation: 'l' }
        } as never);
        const findMany = jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            {
                id: 41,
                companyId: 1,
                productId: 7,
                warehouseId: 2,
                userId: 8,
                type: 'IN',
                quantity: 3,
                unitCost: 0,
                totalCost: 0,
                balanceQty: 3,
                balanceCost: 0,
                createdAt: new Date('2026-07-14T12:00:00.000Z'),
                reference: 'DONACION-1',
                reason: 'Producto recibido sin costo',
                originalUnit: 'l',
                originalQuantity: 3,
                warehouse: { id: 2, name: 'Central', branch: null },
                user: { name: 'Operador' }
            }
        ] as never);

        const kardex = await KardexService.generateKardex(1, { productId: 7 });

        expect(kardex.movements[0]).toEqual(expect.objectContaining({
            unitCost: 0,
            totalCost: 0,
            balanceCost: 0
        }));
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        }));
    });

    it('uses the final deterministic movement per warehouse for an opening balance', async () => {
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7,
            name: 'Agua',
            sku: 'AGUA',
            unit: 'l',
            currentAverageCost: 1,
            baseUnit: { abbreviation: 'l' }
        } as never);
        const findMany = jest.spyOn(prisma.inventoryMovement, 'findMany');
        findMany
            .mockResolvedValueOnce([] as never)
            .mockResolvedValueOnce([
                { warehouseId: 2, balanceQty: 8, balanceCost: 8 },
                { warehouseId: 2, balanceQty: 5, balanceCost: 5 },
                { warehouseId: 3, balanceQty: 2, balanceCost: 4 }
            ] as never);

        const kardex = await KardexService.generateKardex(1, {
            productId: 7,
            dateFrom: new Date('2026-07-14T00:00:00.000Z')
        });

        expect(kardex.openingBalance).toEqual({ quantity: 7, cost: 9 });
        expect(findMany.mock.calls[1][0]).toEqual(expect.objectContaining({
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        }));
    });

    it('does not rewrite a missing historical movement cost with the current product average', async () => {
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7, name: 'Queso', sku: 'QUESO', unit: 'kg',
            currentAverageCost: 99, baseUnit: { abbreviation: 'kg' }
        } as never);
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([{
            id: 51,
            warehouseId: 2,
            type: 'OUT',
            quantity: 1,
            unitCost: null,
            totalCost: null,
            balanceQty: 4,
            balanceCost: 20,
            createdAt: new Date(),
            reference: 'LEGACY',
            reason: 'Legacy',
            originalUnit: 'kg',
            originalQuantity: 1,
            warehouse: { id: 2, name: 'Central', branch: null },
            user: { name: 'Operador' }
        }] as never);

        await expect(KardexService.generateKardex(1, { productId: 7 }))
            .rejects.toThrow(/movimiento 51.*costo histórico.*no se sustituye/i);
    });

    it('fails closed when the opening movement has no persisted balance', async () => {
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7, name: 'Agua', sku: 'AGUA', unit: 'l',
            currentAverageCost: 1, baseUnit: { abbreviation: 'l' }
        } as never);
        const findMany = jest.spyOn(prisma.inventoryMovement, 'findMany');
        findMany
            .mockResolvedValueOnce([] as never)
            .mockResolvedValueOnce([{
                id: 44, warehouseId: 2, balanceQty: null, balanceCost: null
            }] as never);

        await expect(KardexService.generateKardex(1, {
            productId: 7, dateFrom: new Date('2026-07-14T00:00:00.000Z')
        })).rejects.toThrow(/movimiento 44.*saldo histórico íntegro/i);
    });
});
