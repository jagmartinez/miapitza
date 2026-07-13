import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ProductService } from '../../services/product.service';

afterEach(() => { jest.restoreAllMocks(); });

describe('Product reference cost isolation', () => {
    it('updates the reference cost without rewriting transactional costs', async () => {
        jest.spyOn(ProductService, 'getById').mockResolvedValue({
            id: 8,
            companyId: 1,
            name: 'Harina',
            sku: 'ING-8',
            categoryId: null,
            unit: 'g',
            type: 'INGREDIENT',
            cost: 0,
            currentAverageCost: 12.5,
            lastPurchaseCost: 14
        } as never);
        const update = jest.spyOn(prisma.product, 'update').mockResolvedValue({ id: 8, cost: 7 } as never);

        await ProductService.update(8, 1, { cost: 7 });

        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 8 },
            data: { cost: 7 }
        }));
        const data = update.mock.calls[0][0].data as Record<string, unknown>;
        expect(data.currentAverageCost).toBeUndefined();
        expect(data.lastPurchaseCost).toBeUndefined();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects invalid reference cost %s', async (cost) => {
        const lookup = jest.spyOn(ProductService, 'getById');

        await expect(ProductService.update(8, 1, { cost })).rejects.toThrow(/costo de referencia/i);

        expect(lookup).not.toHaveBeenCalled();
    });
});
