import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { BranchController } from '../../controllers/branch.controller';
import { MenuItemController } from '../../controllers/menu-item.controller';
import { BranchService } from '../../services/branch.service';
import { MenuItemService } from '../../services/menu-item.service';
import { BranchScopeError } from '../../utils/branch-scope';

afterEach(() => { jest.restoreAllMocks(); });

const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response);
const tenantAdmin = {
    userId: 7,
    companyId: 3,
    branchId: 10,
    role: 'ADMIN',
    roles: ['ADMIN']
};
const branchOperator = {
    userId: 8,
    companyId: 3,
    branchId: 10,
    role: 'CHEF',
    roles: ['CHEF']
};

describe('branch IDOR boundaries', () => {
    it('does not expose another branch to a branch-scoped operator', async () => {
        jest.spyOn(BranchService, 'getById').mockResolvedValue({ id: 11 } as never);
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        await BranchController.getById({
            params: { id: '11' },
            user: branchOperator
        } as unknown as Request, response(), next);

        expect(next).toHaveBeenCalledWith(expect.any(BranchScopeError));
    });

    it('allows a tenant-wide ADMIN to target another branch in the same company', async () => {
        const create = jest.spyOn(MenuItemService, 'create').mockResolvedValue({ id: 1 } as never);
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        await MenuItemController.create({
            body: { branchId: 11, name: 'Item', price: 1, categoryId: 2 },
            user: tenantAdmin
        } as unknown as Request, response(), next);

        expect(create).toHaveBeenCalledWith(3, expect.objectContaining({ branchId: 11 }));
        expect(next).not.toHaveBeenCalled();
    });

    it('denies mutation of another branch menu to a branch-scoped operator', async () => {
        jest.spyOn(MenuItemService, 'getOwnerBranch').mockResolvedValue(11);
        const update = jest.spyOn(MenuItemService, 'update');
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        await MenuItemController.update({
            params: { id: '5' },
            body: { name: 'Ataque' },
            user: branchOperator
        } as unknown as Request, response(), next);

        expect(update).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(BranchScopeError));
    });
});
