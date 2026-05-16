import prisma from '../utils/prisma';
import { AuditLogService } from './audit-log.service';

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
    }, userId?: number) {
        const { permissionIds, ...roleData } = data;

        const role = await prisma.role.create({
            data: {
                ...roleData,
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
    }, userId?: number) {
        const { permissionIds, ...roleData } = data;

        const role = await prisma.role.update({
            where: { id },
            data: {
                ...roleData,
                permissions: permissionIds ? {
                    set: permissionIds.map(id => ({ id }))
                } : undefined
            },
            include: {
                permissions: true
            }
        });

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

        return await prisma.role.delete({
            where: { id }
        });
    }
}
