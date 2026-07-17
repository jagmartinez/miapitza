import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import { BranchController } from '../../controllers/branch.controller';
import { UserController } from '../../controllers/user.controller';
import { CompanyController } from '../../controllers/company.controller';
import { BranchService } from '../../services/branch.service';
import { UserService } from '../../services/user.service';
import { CompanyService } from '../../services/company.service';
import prisma from '../../utils/prisma';
import {
    isPlatformOperator,
    parseCompanyIdInput,
    resolveActingCompanyId,
    TenantScopeError,
} from '../../utils/tenant-scope';

afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.PLATFORM_TENANCY_MODE;
    delete process.env.PLATFORM_ADMIN_COMPANY_ID;
});

function enableMultiTenantPlatform() {
    process.env.PLATFORM_TENANCY_MODE = 'multi';
    process.env.PLATFORM_ADMIN_COMPANY_ID = '1';
}

const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response);

const platformUser = {
    userId: 1,
    companyId: 1,
    branchId: 10,
    role: 'SUPERADMIN',
    roles: ['SUPERADMIN'],
};

const tenantSuperAdmin = {
    userId: 2,
    companyId: 2,
    branchId: 20,
    role: 'SUPERADMIN',
    roles: ['SUPERADMIN'],
};

const adminUser = {
    userId: 3,
    companyId: 1,
    branchId: 10,
    role: 'ADMIN',
    roles: ['ADMIN'],
};

describe('tenant-scope helpers', () => {
    it('rejects non-integer company ids', () => {
        expect(() => parseCompanyIdInput('abc')).toThrow(TenantScopeError);
        expect(() => parseCompanyIdInput(0)).toThrow(TenantScopeError);
        expect(parseCompanyIdInput(undefined)).toBeUndefined();
        expect(parseCompanyIdInput('7')).toBe(7);
    });

    it('fails closed when platform tenancy configuration is unset', () => {
        expect(isPlatformOperator(platformUser as never)).toBe(false);
        expect(isPlatformOperator(tenantSuperAdmin as never)).toBe(false);
        expect(isPlatformOperator(adminUser as never)).toBe(false);
    });

    it('keeps every actor tenant-bound in explicit single mode', () => {
        process.env.PLATFORM_TENANCY_MODE = 'single';
        expect(isPlatformOperator(platformUser as never)).toBe(false);
    });

    it('pins platform operator to PLATFORM_ADMIN_COMPANY_ID when configured', () => {
        enableMultiTenantPlatform();
        expect(isPlatformOperator(platformUser as never)).toBe(true);
        expect(isPlatformOperator(tenantSuperAdmin as never)).toBe(false);
    });

    it('blocks cross-tenant overrides for non-platform actors', async () => {
        enableMultiTenantPlatform();
        await expect(resolveActingCompanyId(tenantSuperAdmin as never, 1))
            .rejects.toBeInstanceOf(TenantScopeError);
        await expect(resolveActingCompanyId(adminUser as never, 9))
            .rejects.toBeInstanceOf(TenantScopeError);
    });

    it('allows platform operators to target another active company', async () => {
        enableMultiTenantPlatform();
        jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ id: 9, active: true } as never);
        await expect(resolveActingCompanyId(platformUser as never, 9, { requireActiveTarget: true }))
            .resolves.toBe(9);
    });
});

describe('branch/user cross-tenant IDOR boundaries', () => {
    it('denies ADMIN listing another company via ?companyId=', async () => {
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        const getAll = jest.spyOn(BranchService, 'getAll');
        await BranchController.getAll({
            query: { companyId: '9' },
            user: adminUser,
        } as unknown as Request, response(), next);

        expect(getAll).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(TenantScopeError));
    });

    it('denies non-platform SUPERADMIN listing another company when pin is set', async () => {
        enableMultiTenantPlatform();
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        const getAll = jest.spyOn(UserService, 'getAll');
        await UserController.getAll({
            query: { companyId: '1' },
            user: tenantSuperAdmin,
        } as unknown as Request, response(), next);

        expect(getAll).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(TenantScopeError));
    });

    it('lets platform SUPERADMIN create a branch in another company', async () => {
        enableMultiTenantPlatform();
        jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ id: 9, active: true } as never);
        const create = jest.spyOn(BranchService, 'create').mockResolvedValue({ id: 55 } as never);
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        const res = response();

        await BranchController.create({
            body: {
                companyId: 9,
                name: 'Norte',
                code: 'NRT',
                latitude: 12,
                longitude: -86,
                geofenceRadiusM: 100,
                maxLocationAccuracyM: 50,
            },
            user: platformUser,
        } as unknown as Request, res, next);

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 9 }), 1);
        expect(next).not.toHaveBeenCalled();
    });

    it('lets platform SUPERADMIN update a foreign branch by resolving its owner company', async () => {
        enableMultiTenantPlatform();
        jest.spyOn(BranchService, 'getCompanyIdById').mockResolvedValue(9);
        jest.spyOn(prisma.company, 'findUnique').mockResolvedValue({ id: 9, active: true } as never);
        jest.spyOn(BranchService, 'getById').mockResolvedValue({ id: 55 } as never);
        const update = jest.spyOn(BranchService, 'update').mockResolvedValue({ id: 55 } as never);
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;

        await BranchController.update({
            params: { id: '55' },
            query: {},
            body: { name: 'Norte 2' },
            user: platformUser,
        } as unknown as Request, response(), next);

        expect(next.mock.calls).toEqual([]);
        expect(update).toHaveBeenCalledWith(55, 9, expect.objectContaining({ name: 'Norte 2' }), 1);
    });

    it('limits a non-platform SUPERADMIN company listing to its home tenant', async () => {
        enableMultiTenantPlatform();
        const getAll = jest.spyOn(CompanyService, 'getAll').mockResolvedValue([] as never);
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;

        await CompanyController.getAll({
            user: tenantSuperAdmin,
        } as unknown as Request, response(), next);

        expect(getAll).toHaveBeenCalledWith(2);
        expect(next).not.toHaveBeenCalled();
    });

    it('denies a tenant ADMIN reading a foreign company by id', async () => {
        const getById = jest.spyOn(CompanyService, 'getById');
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;

        await CompanyController.getById({
            params: { id: '9' },
            user: adminUser,
        } as unknown as Request, response(), next);

        expect(getById).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(TenantScopeError));
    });
});
