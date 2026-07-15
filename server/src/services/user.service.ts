import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import bcrypt from 'bcryptjs';
import { assertStrongPassword, BCRYPT_ROUNDS } from '../utils/password-policy';
import { ROLES } from '../constants/roles';
import { invalidatePermissionCache } from '../middlewares/auth';
import { AuditLogService } from './audit-log.service';

type UserAccountTypeValue = 'INTERNAL' | 'EXTERNAL';

export class UserService {
    private static validatePassword(password: string) {
        assertStrongPassword(password);
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
                accountType: true,
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
                employee: {
                    select: { id: true, employeeCode: true, status: true }
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
                accountType: true,
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
                employee: {
                    select: { id: true, employeeCode: true, status: true }
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
        branchId?: number | null;
        branchIds?: number[];
        status?: 'ACTIVE' | 'INACTIVE';
        accountType?: UserAccountTypeValue;
        color?: string | null;
        nif?: string;
        address?: string;
        phone?: string;
    }, actingRoles: string[] = [], actorUserId?: number) {
        if (data.password) {
            this.validatePassword(data.password);
            data.password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
        }

        const existingUser = await this.getById(id, companyId);

        const isSuperAdmin = actingRoles.includes(ROLES.SUPERADMIN);
        const { roleIds, branchIds, ...rest } = data;

        if (rest.accountType !== undefined && !['INTERNAL', 'EXTERNAL'].includes(rest.accountType)) {
            throw new Error('Tipo de cuenta inválido');
        }
        if (rest.accountType !== undefined && rest.accountType !== existingUser.accountType && !isSuperAdmin) {
            throw new Error('Solo un SUPERADMIN puede cambiar el tipo de cuenta');
        }
        if (rest.accountType === 'EXTERNAL' && existingUser.employee) {
            throw new Error('No se puede convertir a EXTERNAL porque el expediente histórico requiere conservar el vínculo; esta transición no está implementada');
        }
        if (rest.accountType === 'INTERNAL' && !existingUser.employee) {
            throw new Error('Cree primero el expediente real mediante /api/v1/hr/employees');
        }

        const targetRoles = [
            existingUser.role.name,
            ...existingUser.userRoles.map((entry) => entry.role.name)
        ];
        if (targetRoles.includes(ROLES.SUPERADMIN) && !isSuperAdmin) {
            throw new Error('No autorizado para modificar un usuario SUPERADMIN');
        }

        // Branch assignment / rotation (active branch + permitted set) is a
        // SUPERADMIN-only action.
        if ((rest.branchId !== undefined || branchIds !== undefined) && !isSuperAdmin) {
            throw new Error('No autorizado para asignar o rotar la sucursal del usuario');
        }

        if (branchIds !== undefined) {
            await this.assertBranchesAssignable(companyId, branchIds);
            const effectiveActiveBranch = rest.branchId ?? existingUser.branchId;
            if (effectiveActiveBranch != null && !branchIds.includes(effectiveActiveBranch)) {
                throw new Error('La sucursal activa debe permanecer dentro de las sucursales permitidas del usuario');
            }
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
                accountType: rest.accountType,
                color: rest.color,
                nif: rest.nif,
                address: rest.address,
                phone: rest.phone
            }).filter(([, v]) => v !== undefined)
        ) as Prisma.UserUpdateInput;
        if (rest.password !== undefined) {
            updateData.mustChangePassword = true;
            updateData.passwordChangedAt = null;
        }

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
                    accountType: true,
                    color: true,
                    role: { select: { id: true, name: true } },
                    userRoles: { select: { role: { select: { id: true, name: true } } } },
                    employee: { select: { id: true, employeeCode: true, status: true } }
                }
            });

            // Password resets and deactivation invalidate every outstanding
            // browser/Bearer/WebSocket session in the same transaction.
            if (rest.password !== undefined || rest.status === 'INACTIVE') {
                await tx.userSession.updateMany({
                    where: { userId: id, revoked: false },
                    data: { revoked: true }
                });
            }

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
            }

            if (rest.accountType !== undefined && rest.accountType !== existingUser.accountType && actorUserId) {
                await AuditLogService.log({
                    companyId,
                    userId: actorUserId,
                    entityType: 'User',
                    entityId: id,
                    action: 'UPDATE',
                    details: { field: 'accountType', from: existingUser.accountType, to: rest.accountType },
                }, tx);
            }

            if (roleIds && roleIds.length > 0) {
                return tx.user.findUnique({
                    where: { id },
                    select: {
                        id: true, name: true, email: true, username: true,
                        roleId: true, branchId: true, status: true, accountType: true, color: true,
                        role: { select: { id: true, name: true } },
                        userRoles: { select: { role: { select: { id: true, name: true } } } },
                        employee: { select: { id: true, employeeCode: true, status: true } }
                    }
                });
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
        branchId?: number | null;
        branchIds?: number[];
        color?: string;
        accountType?: UserAccountTypeValue;
    }, actingRoles: string[] = []) {
        if (data.accountType !== undefined && !['INTERNAL', 'EXTERNAL'].includes(data.accountType)) {
            throw new Error('Tipo de cuenta inválido');
        }
        const isSuperAdmin = actingRoles.includes(ROLES.SUPERADMIN);
        if (data.accountType === 'INTERNAL') {
            throw new Error('Cree la cuenta como EXTERNAL y complete el alta real mediante /api/v1/hr/employees');
        }
        this.validatePassword(data.password);
        const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

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
                    accountType: data.accountType || 'EXTERNAL',
                    status: 'ACTIVE'
                },
                select: {
                    id: true, name: true, email: true, username: true,
                    roleId: true, branchId: true, status: true, accountType: true, color: true,
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
                    roleId: true, branchId: true, status: true, accountType: true, color: true,
                    role: { select: { id: true, name: true } },
                    userRoles: { select: { role: { select: { id: true, name: true } } } },
                    employee: { select: { id: true, employeeCode: true, status: true } }
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
