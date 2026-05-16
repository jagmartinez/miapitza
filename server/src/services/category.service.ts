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
        codePrefix?: string;
        sortOrder?: number;
        active?: boolean;
    }) {
        if (data.codePrefix) {
            data.codePrefix = data.codePrefix.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 10);
            const existing = await prisma.category.findFirst({
                where: { companyId, codePrefix: data.codePrefix }
            });
            if (existing) {
                throw new Error(`El prefijo "${data.codePrefix}" ya está en uso por la categoría "${existing.name}"`);
            }
        }

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
        codePrefix?: string;
        sortOrder?: number;
        active?: boolean;
    }) {
        await this.getById(id, companyId);

        if (data.codePrefix) {
            data.codePrefix = data.codePrefix.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 10);
            const existing = await prisma.category.findFirst({
                where: { companyId, codePrefix: data.codePrefix, NOT: { id } }
            });
            if (existing) {
                throw new Error(`El prefijo "${data.codePrefix}" ya está en uso por la categoría "${existing.name}"`);
            }
        }

        return await prisma.category.update({
            where: { id },
            data
        });
    }

    static async delete(id: number, companyId: number) {
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

    static async ensureDefaultCategories(companyId: number) {
        const defaults = [
            { name: 'Carnes', codePrefix: 'CAR', description: 'Carnes rojas, blancas y embutidos', sortOrder: 1 },
            { name: 'Bebidas', codePrefix: 'BEB', description: 'Bebidas y líquidos', sortOrder: 2 },
            { name: 'Lácteos', codePrefix: 'LAC', description: 'Productos lácteos y derivados', sortOrder: 3 },
            { name: 'Vegetales', codePrefix: 'VEG', description: 'Vegetales, verduras y hortalizas', sortOrder: 4 },
            { name: 'Limpieza', codePrefix: 'LIM', description: 'Productos de limpieza y aseo', sortOrder: 5 },
            { name: 'Empaques', codePrefix: 'EMP', description: 'Empaques, envases y desechables', sortOrder: 6 },
            { name: 'Misceláneo', codePrefix: 'MIS', description: 'Productos varios y misceláneos', sortOrder: 7 },
        ];

        const created: string[] = [];
        const existing: string[] = [];

        for (const cat of defaults) {
            const found = await prisma.category.findFirst({
                where: { companyId, name: cat.name }
            });
            if (found) {
                if (!found.codePrefix) {
                    await prisma.category.update({
                        where: { id: found.id },
                        data: { codePrefix: cat.codePrefix }
                    });
                    existing.push(`${cat.name} (prefijo actualizado: ${cat.codePrefix})`);
                } else {
                    existing.push(cat.name);
                }
            } else {
                await prisma.category.create({
                    data: { ...cat, companyId }
                });
                created.push(cat.name);
            }
        }

        return { created, existing };
    }
}
