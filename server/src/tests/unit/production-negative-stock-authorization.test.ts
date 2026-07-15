import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import { ProductionOrderController } from '../../controllers/production-order.controller';
import { ProductionOrderService } from '../../services/production-order.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Production negative-stock authorization', () => {
    it('rejects a warehouse role attempting an administrative negative-stock override', async () => {
        jest.spyOn(ProductionOrderService, 'getById').mockResolvedValue({ id: 8, branchId: 2 } as never);
        const finish = jest.spyOn(ProductionOrderService, 'finish');
        const next = jest.fn() as unknown as NextFunction;
        const req = {
            params: { id: '8' },
            body: { allowNegative: true, producedQuantity: 1 },
            user: {
                userId: 9,
                companyId: 1,
                branchId: 2,
                role: 'BODEGA',
                roles: ['BODEGA'],
                timezone: 'America/Managua'
            }
        } as unknown as Request;

        await ProductionOrderController.finish(req, {} as Response, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
        expect(finish).not.toHaveBeenCalled();
    });
});
