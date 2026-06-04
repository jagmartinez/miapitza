import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from './auth.service';
import { ROLES } from '../constants/roles';
import { invalidatePermissionCache } from '../middlewares/auth';

export class UserService {
    private static validatePassword(password: string) {
        if (!password || password.length < 8) {
            throw new Error('La contraseña debe tener al menos 8 caracteres');
        }
        if (!/[A-Z]/.test(password)) {
            throw new Error('La contraseña debe contener al menos una letra mayúscula');
        }
        if (!/[a-z]/.test(password)) {
            throw new Error('La contraseña debe contener al menos una letra minúscula');
        }
        if (!/[0-9]/.test(password)) {
            throw new Error('La contraseña debe contener al menos un número');
        }
    }

    /**
     * Ensure every role being assigned is safe for the acting user to grant:
     *  - the role must belong to the target company (global roles only for SUPERADMIN)
     *  - the SUPERADMIN role can only be granted by a SUPERADMIN
     */
    private static async assertRolesAssignable(companyId: number, roleIds: number[], actingRoles: string[]) {
        const uniqueIds = Array.from(new Set(roleIds));
        if (uniqueIds.length === 0) return;

        const roles = await prisma.role.findMany({
            where: { id: { in: uniqueIds } },
            select: { id: true, companyId: true, name: true }
        });

        const isSuperAdmin = actingRoles.includes(ROLES.SUPERADMIN);
        for (const id of uniqueIds) {
            const role = roles.find(r => r.id === id);
            if (!role) {
                throw new Error('Rol no encontrado');
            }
            const isGlobal = role.companyId === null;
            if (!isGlobal && role.companyId !== companyId) {
                throw new Error('El rol no pertenece a esta empresa');
            }
            if (isGlobal && !isSuperAdmin) {
                throw new Error('No autorizado para asignar un rol global');
            }
            if (role.name === ROLES.SUPERADMIN && !isSuperAdmin) {
                throw new Error('No autorizado para asignar el rol SUPERADMIN');
            }
        }
    }

    /** Ensure every branch in the permitted set belongs to the target company. */
    private static async assertBranchesAssignable(companyId: number, branchIds: number[]) {
        const unique = Array.from(new Set(branchIds));
        if (unique.length === 0) return;
        const found = await prisma.branch.findMany({
            where: { id: { in: unique }, companyId },
            select: { id: true }
        });
        if (found.length !== unique.length) {
            throw new Error('Una o más sucursales no pertenecen a esta empresa');
        }
    }

    /** Resolve a sane default role for the company when none is supplied. */
    private static async resolveDefaultRoleId(companyId: number): Promise<number> {
        const role = await prisma.role.findFirst({
            where: { companyId, name: ROLES.MESERO },
            select: { id: true }
        });
        if (!role) {
            throw new Error('No se encontró un rol por defecto para la empresa');
        }
        return role.id;
    }

    static async getAll(companyId: number) {
        return await prisma.user.findMany({
            where: { companyId },
            select: {
                id: true,
                name: true,
                email: true,
                username: true,
                roleId: true,
                branchId: true,
                status: true,
                color: true,
                createdAt: true,
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                userRoles: {
                    select: {
                        role: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                allowedBranches: {
                    select: { branch: { select: { id: true, name: true, code: true } } }
                },
                company: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const user = await prisma.user.findFirst({
            where: { id, companyId },
            select: {
                id: true,
                name: true,
                email: true,
                username: true,
                roleId: true,
                branchId: true,
                status: true,
                color: true,
                nif: true,
                address: true,
                phone: true,
                createdAt: true,
                updatedAt: true,
                role: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        permissions: {
                            select: {
                                id: true,
                                name: true,
                                description: true
                            }
                        }
                    }
                },
                userRoles: {
                    select: {
                        role: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        address: true
                    }
                },
                allowedBranches: {
                    select: { branch: { select: { id: true, name: true, code: true } } }
                },
                company: {
                    select: {
                        id: true,
                        name: true,
                        ruc: true
                    }
                }
            }
        });

        if (!user) {
            throw new Error('User not found');
        }

        return user;
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        email?: string;
        password?: string;
        roleId?: number;
        roleIds?: number[];
        branchId?: number;
        branchIds?: number[];
        status?: 'ACTIVE' | 'INACTIVE';
        color?: string | null;
        nif?: string;
        address?: string;
        phone?: string;
    }, actingRoles: string[] = []) {
        if (data.password) {
            this.validatePassword(data.password);
            data.password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
        }

        await this.getById(id, companyId);

        const { roleIds, branchIds, ...rest } = data;

        const isSuperAdmin = actingRoles.includes(ROLES.SUPERADMIN);

        // Branch assignment / rotation (active branch + permitted set) is a
        // SUPERADMIN-only action.
        if ((rest.branchId !== undefined || branchIds !== undefined) && !isSuperAdmin) {
            throw new Error('No autorizado para asignar o rotar la sucursal del usuario');
        }

        if (branchIds !== undefined) {
            await this.assertBranchesAssignable(companyId, branchIds);
        }

        // The active branch must be one of the user's permitted branches.
        if (rest.branchId !== undefined && rest.branchId !== null) {
            const permitted = branchIds !== undefined
                ? branchIds
                : (await prisma.userBranch.findMany({ where: { userId: id }, select: { branchId: true } })).map((b) => b.branchId);
            if (!permitted.includes(rest.branchId)) {
                throw new Error('La sucursal activa debe estar dentro de las sucursales permitidas del usuario');
            }
        }

        // Guard any role assignment (single roleId or roleIds) against cross-tenant
        // and privilege-escalation attempts.
        const roleIdsToValidate = [
            ...(rest.roleId !== undefined ? [rest.roleId] : []),
            ...(roleIds ?? [])
        ];
        if (roleIdsToValidate.length > 0) {
            await this.assertRolesAssignable(companyId, roleIdsToValidate, actingRoles);
        }

        const updateData = Object.fromEntries(
            Object.entries({
                name: rest.name,
                email: rest.email,
                password: rest.password,
                roleId: rest.roleId,
                branchId: rest.branchId,
                status: rest.status,
                color: rest.color,
                nif: rest.nif,
                address: rest.address,
                phone: rest.phone
            }).filter(([, v]) => v !== undefined)
        ) as Prisma.UserUpdateInput;

        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const user = await tx.user.update({
                where: { id },
                data: updateData,
                select: {
                    id: true,
                    name: true,
                    email: true,
                    username: true,
                    roleId: true,
                    branchId: true,
                    status: true,
                    color: true,
                    role: { select: { id: true, name: true } },
                    userRoles: { select: { role: { select: { id: true, name: true } } } }
                }
            });

            // Replace the permitted branch set when provided.
            if (branchIds !== undefined) {
                await tx.userBranch.deleteMany({ where: { userId: id } });
                if (branchIds.length > 0) {
                    await tx.userBranch.createMany({
                        data: Array.from(new Set(branchIds)).map((branchId: number) => ({ userId: id, branchId }))
                    });
                }
            }

            if (roleIds && roleIds.length > 0) {
                await tx.userRole.deleteMany({ where: { userId: id } });
                await tx.userRole.createMany({
                    data: roleIds.map((roleId: number) => ({ userId: id, roleId }))
                });
                const updated = await tx.user.findUnique({
                    where: { id },
                    select: {
                        id: true, name: true, email: true, username: true,
                        roleId: true, branchId: true, status: true, color: true,
                        role: { select: { id: true, name: true } },
                        userRoles: { select: { role: { select: { id: true, name: true } } } }
                    }
                });
                return updated;
            }

            return user;
        });

        // Roles/permissions may have changed — drop the user's cached permissions.
        invalidatePermissionCache(id);

        return result;
    }

    static async create(companyId: number, data: {
        name: string;
        email: string;
        username: string;
        password: string;
        roleId: number;
        roleIds?: number[];
        branchId?: number;
        branchIds?: number[];
        color?: string;
    }, actingRoles: string[] = []) {
        this.validatePassword(data.password);
        const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

        const isSuperAdmin = actingRoles.includes(ROLES.SUPERADMIN);
        // Only a SUPERADMIN may define a multi-branch permitted set.
        if (data.branchIds !== undefined && !isSuperAdmin) {
            throw new Error('No autorizado para asignar las sucursales permitidas del usuario');
        }

        // Permitted set: explicit list, or just the active branch when omitted.
        const permittedBranchIds = Array.from(new Set(
            data.branchIds && data.branchIds.length > 0
                ? data.branchIds
                : (data.branchId ? [data.branchId] : [])
        ));
        await this.assertBranchesAssignable(companyId, permittedBranchIds);

        if (data.branchId && permittedBranchIds.length > 0 && !permittedBranchIds.includes(data.branchId)) {
            throw new Error('La sucursal activa debe estar dentro de las sucursales permitidas del usuario');
        }

        // Replace the previous hardcoded fallback (roleId || 3), which could point at a
        // role in another tenant, with a company-scoped default role lookup.
        const primaryRoleId = data.roleId ?? await this.resolveDefaultRoleId(companyId);
        const roleIds = data.roleIds && data.roleIds.length > 0
            ? data.roleIds
            : [primaryRoleId];

        await this.assertRolesAssignable(companyId, [primaryRoleId, ...roleIds], actingRoles);

        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const user = await tx.user.create({
                data: {
                    name: data.name || '',
                    email: data.email || '',
                    username: data.username,
                    password: hashedPassword,
                    roleId: primaryRoleId,
                    branchId: data.branchId || null,
                    companyId: companyId,
                    color: data.color || null,
                    status: 'ACTIVE'
                },
                select: {
                    id: true, name: true, email: true, username: true,
                    roleId: true, branchId: true, status: true, color: true,
                    role: { select: { id: true, name: true } }
                }
            });

            await tx.userRole.createMany({
                data: roleIds.map((roleId: number) => ({ userId: user.id, roleId }))
            });

            if (permittedBranchIds.length > 0) {
                await tx.userBranch.createMany({
                    data: permittedBranchIds.map((branchId: number) => ({ userId: user.id, branchId }))
                });
            }

            return await tx.user.findUnique({
                where: { id: user.id },
                select: {
                    id: true, name: true, email: true, username: true,
                    roleId: true, branchId: true, status: true, color: true,
                    role: { select: { id: true, name: true } },
                    userRoles: { select: { role: { select: { id: true, name: true } } } }
                }
            });
        });

        if (result) {
            invalidatePermissionCache(result.id);
        }

        return result;
    }

    static async delete(id: number, companyId: number) {
        // Verify ownership
        await this.getById(id, companyId);

        // Soft delete by setting status to INACTIVE
        return await prisma.user.update({
            where: { id },
            data: { status: 'INACTIVE' }
        });
    }
}
