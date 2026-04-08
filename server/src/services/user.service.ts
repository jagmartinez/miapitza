import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import bcrypt from 'bcryptjs';

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
        status?: 'ACTIVE' | 'INACTIVE';
        color?: string | null;
        nif?: string;
        address?: string;
        phone?: string;
    }) {
        if (data.password) {
            this.validatePassword(data.password);
            data.password = await bcrypt.hash(data.password, 10);
        }

        await this.getById(id, companyId);

        const { roleIds, ...rest } = data;

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

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
    }

    static async create(companyId: number, data: {
        name: string;
        email: string;
        username: string;
        password: string;
        roleId: number;
        roleIds?: number[];
        branchId?: number;
        color?: string;
    }) {
        this.validatePassword(data.password);
        const hashedPassword = await bcrypt.hash(data.password, 10);

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const user = await tx.user.create({
                data: {
                    name: data.name || '',
                    email: data.email || '',
                    username: data.username,
                    password: hashedPassword,
                    roleId: data.roleId || 3,
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

            const roleIds = data.roleIds && data.roleIds.length > 0
                ? data.roleIds
                : [data.roleId || 3];

            await tx.userRole.createMany({
                data: roleIds.map((roleId: number) => ({ userId: user.id, roleId }))
            });

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
