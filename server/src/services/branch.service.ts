import prisma from '../utils/prisma';

export class BranchService {
    static async getAll(companyId: number) {
        return await prisma.branch.findMany({
            where: { companyId },
            include: {
                company: true,
                _count: {
                    select: {
                        users: true,
                        tables: true,
                        warehouses: true
                    }
                }
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const branch = await prisma.branch.findFirst({
            where: { id, companyId },
            include: {
                company: true,
                users: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: {
                            select: {
                                name: true
                            }
                        }
                    }
                },
                tables: {
                    select: {
                        id: true,
                        number: true,
                        capacity: true,
                        status: true
                    }
                },
                warehouses: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        if (!branch) {
            throw new Error('Branch not found');
        }

        return branch;
    }

    static async create(data: {
        companyId: number;
        name: string;
        code: string;
        address?: string;
        phone?: string;
    }) {
        // Check if code exists within the same company
        const existing = await prisma.branch.findFirst({
            where: { code: data.code, companyId: data.companyId }
        });

        if (existing) {
            throw new Error('Ya existe una sucursal con este código en la empresa');
        }

        return await prisma.branch.create({
            data: {
                companyId: data.companyId,
                name: data.name,
                code: data.code,
                address: data.address,
                phone: data.phone
            }
        });
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        code?: string;
        address?: string;
        phone?: string;
        status?: 'ACTIVE' | 'INACTIVE';
    }) {
        // Verify ownership
        const branch = await this.getById(id, companyId);
        if (!branch) throw new Error("Branch not found or unauthorized");

        return await prisma.branch.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.code !== undefined ? { code: data.code } : {}),
                ...(data.address !== undefined ? { address: data.address } : {}),
                ...(data.phone !== undefined ? { phone: data.phone } : {}),
                ...(data.status !== undefined ? { status: data.status } : {})
            }
        });
    }

    static async delete(id: number, companyId: number) {
        // Soft delete by setting status to INACTIVE
        // Verify ownership
        const branch = await this.getById(id, companyId);
        if (!branch) throw new Error("Branch not found or unauthorized");

        return await prisma.branch.update({
            where: { id },
            data: { status: 'INACTIVE' }
        });
    }
}
