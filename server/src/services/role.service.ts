import prisma from '../utils/prisma';
import { AuditLogService } from './audit-log.service';
import { invalidatePermissionCache } from '../middlewares/auth';
import { ROLES } from '../constants/roles';

export class RoleServiceError extends Error {
    constructor(
        message: string,
        public readonly statusCode = 400,
        public readonly code = 'ROLE_INVALID_OPERATION'
    ) {
        super(message);
        this.name = 'RoleServiceError';
    }
}

type RoleMutationAuthority = {
    isSuperAdmin: boolean;
    assignedRoleIds: Set<number>;
    permissionIds: Set<number>;
};

function normalizedPermissionIds(value: unknown): number[] {
    if (!Array.isArray(value)) {
        throw new RoleServiceError('permissionIds debe ser un arreglo de identificadores');
    }
    const permissionIds = value.map((entry) => Number(entry));
    if (permissionIds.some((id) => !Number.isInteger(id) || id <= 0)) {
        throw new RoleServiceError('permissionIds contiene un identificador inválido');
    }
    return Array.from(new Set(permissionIds));
}

export class RoleService {
    private static async mutationAuthority(companyId: number, actorUserId?: number): Promise<RoleMutationAuthority> {
        if (!actorUserId) {
            throw new RoleServiceError(
                'No autorizado: se requiere un actor autenticado para modificar privilegios',
                403,
                'ROLE_ACTOR_REQUIRED'
            );
        }
        const actor = await prisma.user.findFirst({
            where: { id: actorUserId, companyId, status: 'ACTIVE' },
            select: {
                roleId: true,
                role: {
                    select: {
                        name: true,
                        permissions: { select: { id: true } }
                    }
                },
                userRoles: {
                    select: {
                        roleId: true,
                        role: {
                            select: {
                                permissions: { select: { id: true } }
                            }
                        }
                    }
                }
            }
        });
        if (!actor) {
            throw new RoleServiceError(
                'No autorizado: el actor no pertenece a la empresa o está inactivo',
                403,
                'ROLE_ACTOR_FORBIDDEN'
            );
        }
        return {
            // Match auth.ts: SUPERADMIN is authoritative only as the primary role.
            isSuperAdmin: actor.role.name === ROLES.SUPERADMIN,
            assignedRoleIds: new Set([actor.roleId, ...actor.userRoles.map((entry) => entry.roleId)]),
            permissionIds: new Set([
                ...actor.role.permissions.map((permission) => permission.id),
                ...actor.userRoles.flatMap((entry) => entry.role.permissions.map((permission) => permission.id))
            ])
        };
    }

    private static async assertPermissionGrantAllowed(
        companyId: number,
        actorUserId: number | undefined,
        permissionIds: number[],
        targetRoleId?: number
    ): Promise<void> {
        const authority = await this.mutationAuthority(companyId, actorUserId);
        if (!authority.isSuperAdmin && targetRoleId && authority.assignedRoleIds.has(targetRoleId)) {
            throw new RoleServiceError(
                'No autorizado: no puede modificar los privilegios de un rol asignado a su propio usuario',
                403,
                'ROLE_SELF_PRIVILEGE_EDIT_FORBIDDEN'
            );
        }

        const permissions = permissionIds.length > 0
            ? await prisma.permission.findMany({
                where: { id: { in: permissionIds } },
                select: { id: true }
            })
            : [];
        if (permissions.length !== permissionIds.length) {
            throw new RoleServiceError('Uno o más permisos no existen');
        }
        if (authority.isSuperAdmin) return;

        if (permissions.some((permission) => !authority.permissionIds.has(permission.id))) {
            throw new RoleServiceError(
                'No autorizado: no puede otorgar permisos que su usuario no posee',
                403,
                'ROLE_PERMISSION_ESCALATION_FORBIDDEN'
            );
        }
    }

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
    }, userId?: number, _actingRoles: string[] = []) {
        const permissionIds = data.permissionIds === undefined
            ? undefined
            : normalizedPermissionIds(data.permissionIds);
        const name = data.name.trim();
        if (!name) throw new Error('El nombre del rol es requerido');
        if (name === ROLES.SUPERADMIN) {
            if (!userId) {
                throw new RoleServiceError(
                    'No autorizado para crear o modificar el rol SUPERADMIN sin un actor autenticado',
                    403,
                    'ROLE_SUPERADMIN_REQUIRED'
                );
            }
            const authority = await this.mutationAuthority(companyId, userId);
            if (!authority.isSuperAdmin) {
                throw new RoleServiceError(
                    'No autorizado para crear o modificar el rol SUPERADMIN',
                    403,
                    'ROLE_SUPERADMIN_REQUIRED'
                );
            }
        }
        if (permissionIds !== undefined) {
            await this.assertPermissionGrantAllowed(companyId, userId, permissionIds);
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
            }).catch((error) => console.error('[RoleService] Failed to write CREATE audit log:', error));
        }

        return role;
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        description?: string;
        permissionIds?: number[];
    }, userId?: number, _actingRoles: string[] = []) {
        const permissionIds = data.permissionIds === undefined
            ? undefined
            : normalizedPermissionIds(data.permissionIds);

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
        let authority: RoleMutationAuthority | undefined;
        const changesRoleIdentity = requestedName !== undefined && requestedName !== existing.name;
        if ((existing.name === ROLES.SUPERADMIN || requestedName === ROLES.SUPERADMIN) && !userId) {
            throw new RoleServiceError(
                'No autorizado para crear o modificar el rol SUPERADMIN sin un actor autenticado',
                403,
                'ROLE_SUPERADMIN_REQUIRED'
            );
        }
        if (existing.name === ROLES.SUPERADMIN || requestedName === ROLES.SUPERADMIN || changesRoleIdentity) {
            authority = await this.mutationAuthority(companyId, userId);
        }
        if (
            (existing.name === ROLES.SUPERADMIN || requestedName === ROLES.SUPERADMIN) &&
            !authority?.isSuperAdmin
        ) {
            throw new RoleServiceError(
                'No autorizado para crear o modificar el rol SUPERADMIN',
                403,
                'ROLE_SUPERADMIN_REQUIRED'
            );
        }
        if (changesRoleIdentity && !authority?.isSuperAdmin && authority?.assignedRoleIds.has(id)) {
            throw new RoleServiceError(
                'No autorizado: no puede modificar la identidad de un rol asignado a su propio usuario',
                403,
                'ROLE_SELF_PRIVILEGE_EDIT_FORBIDDEN'
            );
        }
        if (permissionIds !== undefined) {
            await this.assertPermissionGrantAllowed(companyId, userId, permissionIds, id);
        }

        const role = await prisma.role.update({
            where: { id },
            data: {
                ...(requestedName !== undefined ? { name: requestedName } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                permissions: permissionIds !== undefined ? {
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
            }).catch((error) => console.error('[RoleService] Failed to write UPDATE audit log:', error));
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
