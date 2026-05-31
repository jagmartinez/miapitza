import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class CashRegisterService {
    static async getAll(companyId: number, branchId?: number) {
        const where: Prisma.CashRegisterWhereInput = { companyId };
        if (branchId) where.branchId = branchId;

        const registers = await prisma.cashRegister.findMany({
            where,
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                shifts: {
                    where: {
                        endDate: null // Only get active shifts
                    },
                    take: 1,
                    select: {
                        id: true,
                        startDate: true,
                        userId: true
                    }
                },
                _count: {
                    select: {
                        shifts: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });

        // Calculate dynamic status based on active shifts
        return registers.map((register) => ({
            ...register,
            status: register.shifts.length > 0 ? 'OPEN' : 'CLOSED',
            activeShift: register.shifts[0] || null,
            shifts: undefined // Remove shifts from response to keep it clean
        }));
    }

    static async getById(id: number, companyId: number) {
        const cashRegister = await prisma.cashRegister.findFirst({
            where: { id, companyId },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                shifts: {
                    orderBy: {
                        startDate: 'desc'
                    },
                    take: 10, // Last 10 shifts
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });

        if (!cashRegister) {
            throw new Error('Cash register not found');
        }

        return cashRegister;
    }

    static async create(companyId: number, data: {
        branchId: number;
        name: string;
    }) {
        // Verify branch
        const branch = await prisma.branch.findFirst({
            where: { id: data.branchId, companyId }
        });

        if (!branch) {
            throw new Error('Branch not found or unauthorized');
        }

        return await prisma.cashRegister.create({
            data: {
                ...data,
                companyId
            },
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                }
            }
        });
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
    }) {
        // Verify ownership
        await this.getById(id, companyId);

        return await prisma.cashRegister.update({
            where: { id },
            data,
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                }
            }
        });
    }

    static async delete(id: number, companyId: number) {
        // Verify ownership before any destructive action (prevents cross-tenant delete)
        await this.getById(id, companyId);

        // Check if has active shifts
        const activeShift = await prisma.cashShift.findFirst({
            where: {
                cashRegisterId: id,
                companyId,
                endDate: null
            }
        });

        if (activeShift) {
            throw new Error('Cannot delete cash register with active shifts');
        }

        return await prisma.cashRegister.delete({
            where: { id }
        });
    }

    // Get current active shift
    static async getActiveShift(companyId: number, cashRegisterId: number) {
        return await prisma.cashShift.findFirst({
            where: {
                cashRegisterId,
                companyId,
                endDate: null
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                movements: {
                    orderBy: {
                        id: 'desc'
                    }
                }
            }
        });
    }
}
