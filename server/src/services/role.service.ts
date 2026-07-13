import prisma from '../utils/prisma';
import { AuditLogService } from './audit-log.service';
import { invalidatePermissionCache } from '../middlewares/auth';
import { ROLES } from '../constants/roles';

export class RoleService {
    static async getAll(companyId: number) {
        return await prisma.role.findMany({
            where: { companyId },
            include: {
                permissions: true,
                _count: {
                    select: {
                        users: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
    }

    static async getById(id: number, companyId: number) {
        return await prisma.role.findFirst({
            where: { id, companyId },
            include: {
                permissions: true,
                users: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });
    }

    static async create(companyId: number, data: {
        name: string;
        description?: string;
        permissionIds?: number[];
    }, userId?: number, actingRoles: string[] = []) {
        const { permissionIds } = data;
        const name = data.name.trim();
        if (!name) throw new Error('El nombre del rol es requerido');
        if (name === ROLES.SUPERADMIN && !actingRoles.includes(ROLES.SUPERADMIN)) {
            throw new Error('No autorizado para crear o modificar el rol SUPERADMIN');
        }

        const role = await prisma.role.create({
            data: {
                name,
                description: data.description,
                companyId,
                permissions: permissionIds ? {
                    connect: permissionIds.map(id => ({ id }))
                } : undefined
            },
            include: {
                permissions: true
            }
        });

        if (userId) {
            AuditLogService.log({
                companyId, userId, entityType: 'Role', entityId: role.id,
                action: 'CREATE', details: { name: role.name, permissionIds }
            }).catch(() => {});
        }

        return role;
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        description?: string;
        permissionIds?: number[];
    }, userId?: number, actingRoles: string[] = []) {
        const { permissionIds } = data;

        // Tenant scoping: ensure the role belongs to this company before mutating it.
        const existing = await prisma.role.findFirst({
            where: { id, companyId },
            select: { id: true, name: true }
        });
        if (!existing) {
            throw new Error('Role not found');
        }
        const requestedName = data.name?.trim();
        if (data.name !== undefined && !requestedName) {
            throw new Error('El nombre del rol es requerido');
        }
        if (
            (existing.name === ROLES.SUPERADMIN || requestedName === ROLES.SUPERADMIN) &&
            !actingRoles.includes(ROLES.SUPERADMIN)
        ) {
            throw new Error('No autorizado para crear o modificar el rol SUPERADMIN');
        }

        const role = await prisma.role.update({
            where: { id },
            data: {
                ...(requestedName !== undefined ? { name: requestedName } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                permissions: permissionIds ? {
                    set: permissionIds.map(id => ({ id }))
                } : undefined
            },
            include: {
                permissions: true
            }
        });

        // Role/permission links changed — drop cached permissions for affected users.
        invalidatePermissionCache();

        if (userId) {
            AuditLogService.log({
                companyId, userId, entityType: 'Role', entityId: id,
                action: permissionIds ? 'PERMISSION_CHANGE' : 'UPDATE',
                details: { name: data.name, permissionIds }
            }).catch(() => {});
        }

        return role;
    }

    static async delete(id: number, companyId: number) {
        // Check if role is in use
        const roleWithUsers = await prisma.role.findFirst({
            where: { id, companyId },
            include: {
                _count: {
                    select: {
                        users: true
                    }
                }
            }
        });

        if (!roleWithUsers) {
            throw new Error('Role not found');
        }

        if (roleWithUsers._count.users > 0) {
            throw new Error('Cannot delete role with assigned users');
        }

        const deleted = await prisma.role.delete({
            where: { id }
        });

        // Role removed — drop cached permissions for any affected users.
        invalidatePermissionCache();

        return deleted;
    }
}
