import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import { UserController } from '../../controllers/user.controller';
import { UserService } from '../../services/user.service';

describe('UserController profile isolation', () => {
    const json = jest.fn();
    const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('loads /profile from the authenticated identity instead of a route parameter', async () => {
        const profile = { id: 17, companyId: 4 };
        const getById = jest.spyOn(UserService, 'getById').mockResolvedValue(profile as never);
        const req = { user: { userId: 17, companyId: 4 } } as Request;
        const res = { json } as unknown as Response;

        await UserController.getProfile(req, res, next);

        expect(getById).toHaveBeenCalledWith(17, 4);
        expect(json).toHaveBeenCalledWith({ success: true, data: profile });
        expect(next).not.toHaveBeenCalled();
    });

    it('drops privileged and password fields from self-service profile updates', async () => {
        const update = jest.spyOn(UserService, 'update').mockResolvedValue({ id: 17 } as never);
        const req = {
            user: { userId: 17, companyId: 4 },
            body: {
                name: 'Nombre seguro',
                password: 'Bypass123!',
                roleId: 1,
                roleIds: [1],
                branchId: 9,
                branchIds: [9],
                status: 'INACTIVE',
                companyId: 99,
            },
        } as unknown as Request;
        const res = { json } as unknown as Response;

        await UserController.updateMe(req, res, next);

        expect(update).toHaveBeenCalledWith(17, 4, { name: 'Nombre seguro' });
        expect(next).not.toHaveBeenCalled();
    });

    it('denies a non-admin attempting to read another user by id', async () => {
        const getById = jest.spyOn(UserService, 'getById');
        const req = {
            params: { id: '18' },
            user: { userId: 17, companyId: 4, role: 'MESERO', roles: ['MESERO'] },
        } as unknown as Request;
        const res = { json } as unknown as Response;

        await UserController.getById(req, res, next);

        expect(getById).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith({
            statusCode: 403,
            message: 'No autorizado para consultar otro usuario',
        });
    });
});
