import prisma from '../utils/prisma';

export class PermissionService {
    static async getAll() {
        return await prisma.permission.findMany({
            include: {
                _count: {
                    select: {
                        roles: true
                    }
                }
            }
        });
    }

    static async getById(id: number) {
        return await prisma.permission.findUnique({
            where: { id },
            include: {
                roles: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });
    }

    static async create(data: { name: string; description?: string }) {
        return await prisma.permission.create({
            data
        });
    }

    static async update(id: number, data: { name?: string; description?: string }) {
        return await prisma.permission.update({
            where: { id },
            data
        });
    }

    static async delete(id: number) {
        return await prisma.permission.delete({
            where: { id }
        });
    }
}
