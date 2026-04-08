import prisma from '../utils/prisma';

export class CategoryService {
    static async getAll(companyId: number) {
        return await prisma.category.findMany({
            where: { companyId },
            include: {
                _count: {
                    select: {
                        menuItems: true,
                        products: true
                    }
                }
            },
            orderBy: {
                sortOrder: 'asc'
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const category = await prisma.category.findFirst({
            where: { id, companyId },
            include: {
                menuItems: true,
                products: true
            }
        });

        if (!category) {
            throw new Error('Category not found');
        }

        return category;
    }

    static async create(companyId: number, data: {
        name: string;
        description?: string;
        sortOrder?: number;
        active?: boolean;
    }) {
        return await prisma.category.create({
            data: {
                ...data,
                companyId
            }
        });
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        description?: string;
        sortOrder?: number;
        active?: boolean;
    }) {
        // Verify ownership
        await this.getById(id, companyId);

        return await prisma.category.update({
            where: { id },
            data
        });
    }

    static async delete(id: number, companyId: number) {
        // Check if category is in use
        const category = await prisma.category.findFirst({
            where: { id, companyId },
            include: {
                _count: {
                    select: {
                        menuItems: true,
                        products: true
                    }
                }
            }
        });

        if (!category) {
            throw new Error('Category not found');
        }

        if (category._count.menuItems > 0 || category._count.products > 0) {
            throw new Error('Cannot delete category with associated items');
        }

        return await prisma.category.delete({
            where: { id }
        });
    }
}
