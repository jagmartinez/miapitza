import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { BranchController } from '../../controllers/branch.controller';
import { MenuItemController } from '../../controllers/menu-item.controller';
import { BranchService } from '../../services/branch.service';
import { MenuItemService } from '../../services/menu-item.service';
import { BranchScopeError } from '../../utils/branch-scope';

afterEach(() => { jest.restoreAllMocks(); });

const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response);
const branchUser = {
    userId: 7,
    companyId: 3,
    branchId: 10,
    role: 'ADMIN',
    roles: ['ADMIN']
};

describe('branch IDOR boundaries', () => {
    it('does not expose another branch through GET /branches/:id', async () => {
        jest.spyOn(BranchService, 'getById').mockResolvedValue({ id: 11 } as never);
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        await BranchController.getById({
            params: { id: '11' },
            user: branchUser
        } as unknown as Request, response(), next);

        expect(next).toHaveBeenCalledWith(expect.any(BranchScopeError));
    });

    it('pins a branch ADMIN menu creation to the active branch', async () => {
        const create = jest.spyOn(MenuItemService, 'create').mockResolvedValue({ id: 1 } as never);
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        await MenuItemController.create({
            body: { branchId: 11, name: 'Item', price: 1, categoryId: 2 },
            user: branchUser
        } as unknown as Request, response(), next);

        expect(create).toHaveBeenCalledWith(3, expect.objectContaining({ branchId: 10 }));
        expect(next).not.toHaveBeenCalled();
    });

    it('denies mutation of a menu item owned by another branch', async () => {
        jest.spyOn(MenuItemService, 'getOwnerBranch').mockResolvedValue(11);
        const update = jest.spyOn(MenuItemService, 'update');
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        await MenuItemController.update({
            params: { id: '5' },
            body: { name: 'Ataque' },
            user: branchUser
        } as unknown as Request, response(), next);

        expect(update).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(BranchScopeError));
    });
});
