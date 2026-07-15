import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../../utils/prisma';
import { AuditLogService } from '../../services/audit-log.service';
import { RoleController } from '../../controllers/role.controller';
import { RoleService, RoleServiceError } from '../../services/role.service';

function actor(primaryRoleId: number, primaryRoleName: string, primaryPermissionIds: number[], secondary: Array<{ roleId: number; permissionIds: number[] }> = []) {
    return {
        roleId: primaryRoleId,
        role: {
            name: primaryRoleName,
            permissions: primaryPermissionIds.map((id) => ({ id }))
        },
        userRoles: secondary.map((entry) => ({
            roleId: entry.roleId,
            role: { permissions: entry.permissionIds.map((id) => ({ id })) }
        }))
    };
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe('RoleService privilege delegation boundary', () => {
    it('rejects creating a role with a permission the ADMIN actor does not possess', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(actor(10, 'ADMIN', [1]) as never);
        jest.spyOn(prisma.permission, 'findMany').mockResolvedValue([{ id: 99 }] as never);
        const create = jest.spyOn(prisma.role, 'create');

        await expect(RoleService.create(3, { name: 'SUPERVISOR', permissionIds: [99] }, 7, ['ADMIN']))
            .rejects.toMatchObject({
                statusCode: 403,
                code: 'ROLE_PERMISSION_ESCALATION_FORBIDDEN'
            });

        expect(create).not.toHaveBeenCalled();
    });

    it('rejects a permission that the ADMIN actor does not possess', async () => {
        jest.spyOn(prisma.role, 'findFirst').mockResolvedValue({ id: 20, name: 'SUPERVISOR' } as never);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(actor(10, 'ADMIN', [1]) as never);
        jest.spyOn(prisma.permission, 'findMany').mockResolvedValue([{ id: 1 }, { id: 99 }] as never);
        const update = jest.spyOn(prisma.role, 'update');

        await expect(RoleService.update(20, 3, { permissionIds: [1, 99] }, 7, ['ADMIN']))
            .rejects.toMatchObject({
                statusCode: 403,
                code: 'ROLE_PERMISSION_ESCALATION_FORBIDDEN'
            });

        expect(update).not.toHaveBeenCalled();
    });

    it('rejects an ADMIN editing privileges of any role assigned to itself', async () => {
        jest.spyOn(prisma.role, 'findFirst').mockResolvedValue({ id: 10, name: 'ADMIN' } as never);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(actor(10, 'ADMIN', [1, 2]) as never);
        const findPermissions = jest.spyOn(prisma.permission, 'findMany');
        const update = jest.spyOn(prisma.role, 'update');

        await expect(RoleService.update(10, 3, { permissionIds: [1] }, 7, ['ADMIN']))
            .rejects.toMatchObject({
                statusCode: 403,
                code: 'ROLE_SELF_PRIVILEGE_EDIT_FORBIDDEN'
            });

        expect(findPermissions).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });

    it('allows an ADMIN to delegate a permission it possesses to another role', async () => {
        jest.spyOn(prisma.role, 'findFirst').mockResolvedValue({ id: 20, name: 'SUPERVISOR' } as never);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(actor(10, 'ADMIN', [1, 2]) as never);
        jest.spyOn(prisma.permission, 'findMany').mockResolvedValue([{ id: 2 }] as never);
        jest.spyOn(prisma.role, 'update').mockResolvedValue({ id: 20, name: 'SUPERVISOR', permissions: [{ id: 2 }] } as never);
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({ id: 1 } as never);

        await expect(RoleService.update(20, 3, { permissionIds: [2] }, 7, ['ADMIN']))
            .resolves.toMatchObject({ id: 20 });

        expect(prisma.role.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 20 },
            data: expect.objectContaining({ permissions: { set: [{ id: 2 }] } })
        }));
    });

    it('allows a verified SUPERADMIN to edit privileges of its own role', async () => {
        jest.spyOn(prisma.role, 'findFirst').mockResolvedValue({ id: 10, name: 'SUPERADMIN' } as never);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(actor(10, 'SUPERADMIN', []) as never);
        jest.spyOn(prisma.permission, 'findMany').mockResolvedValue([{ id: 99 }] as never);
        jest.spyOn(prisma.role, 'update').mockResolvedValue({ id: 10, name: 'SUPERADMIN', permissions: [{ id: 99 }] } as never);
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({ id: 1 } as never);

        await expect(RoleService.update(10, 3, { permissionIds: [99] }, 7, ['SUPERADMIN']))
            .resolves.toMatchObject({ id: 10 });

        expect(prisma.role.update).toHaveBeenCalled();
    });
});

describe('Role authorization HTTP contract', () => {
    it('preserves authorization errors as 403-capable service errors in the controller', async () => {
        const error = new RoleServiceError(
            'No autorizado: no puede otorgar permisos que su usuario no posee',
            403,
            'ROLE_PERMISSION_ESCALATION_FORBIDDEN'
        );
        jest.spyOn(RoleService, 'update').mockRejectedValue(error);
        const next = jest.fn() as unknown as jest.MockedFunction<NextFunction>;
        const req = {
            params: { id: '20' },
            body: { permissionIds: [99] },
            user: { userId: 7, companyId: 3, role: 'ADMIN', roles: ['ADMIN'] }
        } as unknown as Request;

        await RoleController.update(req, { json: jest.fn() } as unknown as Response, next);

        expect(next).toHaveBeenCalledWith(error);
        expect(error.statusCode).toBe(403);
    });

    it('uses the body-aware role update validator at the route boundary', () => {
        const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/role.routes.ts'), 'utf8');
        const schemas = fs.readFileSync(path.resolve(__dirname, '../../middlewares/validate-schemas.ts'), 'utf8');

        expect(routes).toContain("router.put('/:id', requireRole(...ADMINS), validate(s.updateRole)");
        expect(schemas.slice(schemas.indexOf('export const updateRole'))).toContain('permissionIds');
    });
});
