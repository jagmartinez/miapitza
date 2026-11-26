import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { MenuItemController } from '../../controllers/menu-item.controller';
import { MenuItemService } from '../../services/menu-item.service';
import prisma from '../../utils/prisma';
import { BranchScopeError } from '../../utils/branch-scope';

afterEach(() => { jest.restoreAllMocks(); });

const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response);
const waiter = { userId: 8, companyId: 3, branchId: 10, role: 'MESERO', roles: ['MESERO'] };

describe('MenuItemService.getTopSellers', () => {
    it('orders by sold quantity within the window', async () => {
        const groupBy = jest.spyOn(prisma.orderItem, 'groupBy').mockResolvedValue([
            { menuItemId: 1, _sum: { quantity: 5 } },
            { menuItemId: 2, _sum: { quantity: 40 } },
            { menuItemId: 3, _sum: { quantity: 12 } },
        ] as never);
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }] as never);

        const before = Date.now();
        const result = await MenuItemService.getTopSellers(3, 10, 30, 2);

        expect(result).toEqual([
            { menuItemId: 2, quantity: 40 },
            { menuItemId: 3, quantity: 12 },
        ]);
        const where = (groupBy.mock.calls[0][0] as { where: { createdAt: { gte: Date }; order: Record<string, unknown> } }).where;
        const windowMs = before - where.createdAt.gte.getTime();
        expect(windowMs).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
        expect(windowMs).toBeLessThan(30 * 86_400_000 + 5000);
        expect(where.order).toMatchObject({ companyId: 3, branchId: 10 });
    });

    it('excludes cancelled orders and voided quantity', async () => {
        const groupBy = jest.spyOn(prisma.orderItem, 'groupBy').mockResolvedValue([] as never);
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);

        await MenuItemService.getTopSellers(3, 10, 30, 12);

        const where = (groupBy.mock.calls[0][0] as { where: Record<string, any> }).where;
        expect(where.order.status).toEqual({ not: 'CANCELLED' });
        // Voided lines are stored with quantity 0, so a positive-quantity filter drops them.
        expect(where.quantity).toEqual({ gt: 0 });
    });

    it('only returns active items', async () => {
        jest.spyOn(prisma.orderItem, 'groupBy').mockResolvedValue([
            { menuItemId: 1, _sum: { quantity: 9 } },
            { menuItemId: 2, _sum: { quantity: 3 } },
        ] as never);
        const findMany = jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([{ id: 2 }] as never);

        const result = await MenuItemService.getTopSellers(3, 10, 30, 12);

        expect(result).toEqual([{ menuItemId: 2, quantity: 3 }]);
        expect(findMany.mock.calls[0][0]).toMatchObject({ where: { companyId: 3, active: true, id: { in: [1, 2] } } });
    });
});

describe('MenuItemController.getTopSellers', () => {
    it('a branch-pinned user cannot read another branch (request is pinned to their own)', async () => {
        const svc = jest.spyOn(MenuItemService, 'getTopSellers').mockResolvedValue([]);
        await MenuItemController.getTopSellers(
            { query: { branchId: '11' }, user: waiter } as unknown as Request, response(), jest.fn() as unknown as NextFunction);
        expect(svc).toHaveBeenCalledTimes(1);
        expect(svc.mock.calls[0][1]).toBe(10);
    });

    it('a user without an active branch is rejected', async () => {
        const svc = jest.spyOn(MenuItemService, 'getTopSellers');
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        await MenuItemController.getTopSellers(
            { query: {}, user: { ...waiter, branchId: null } } as unknown as Request, response(), next);
        expect(svc).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(BranchScopeError));
    });

    it('uses own branch and defaults days=30 limit=12', async () => {
        const svc = jest.spyOn(MenuItemService, 'getTopSellers').mockResolvedValue([{ menuItemId: 1, quantity: 2 }]);
        const res = response();
        await MenuItemController.getTopSellers(
            { query: {}, user: waiter } as unknown as Request, res, jest.fn() as unknown as NextFunction);
        expect(svc).toHaveBeenCalledWith(3, 10, 30, 12);
        expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ menuItemId: 1, quantity: 2 }] });
    });

    it.each([['days', '0'], ['days', '91'], ['days', 'x'], ['limit', '0'], ['limit', '31']])(
        'rejects %s=%s with 400', async (key, value) => {
            const svc = jest.spyOn(MenuItemService, 'getTopSellers');
            const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
            await MenuItemController.getTopSellers(
                { query: { [key]: value }, user: waiter } as unknown as Request, response(), next);
            expect(svc).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        });
});
