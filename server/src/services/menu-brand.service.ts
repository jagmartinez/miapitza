import prisma from '../utils/prisma';

export class MenuBrandService {
    static async getAll(companyId: number) {
        return await prisma.menuBrand.findMany({
            where: { companyId },
            include: {
                _count: {
                    select: { menuItems: true }
                }
            },
            orderBy: [
                { sortOrder: 'asc' },
                { name: 'asc' }
            ]
        });
    }

    static async getById(id: number, companyId: number) {
        const brand = await prisma.menuBrand.findFirst({
            where: { id, companyId }
        });
        if (!brand) {
            throw new Error('Marca no encontrada');
        }
        return brand;
    }

    static async create(companyId: number, data: {
        name: string;
        color?: string | null;
        sortOrder?: number;
        active?: boolean;
    }) {
        const name = data.name?.trim();
        if (!name) {
            throw new Error('El nombre de la marca es requerido');
        }

        const existing = await prisma.menuBrand.findFirst({
            where: { companyId, name }
        });
        if (existing) {
            throw new Error(`Ya existe una marca llamada "${name}"`);
        }

        return await prisma.menuBrand.create({
            data: {
                companyId,
                name,
                color: data.color ?? null,
                sortOrder: data.sortOrder ?? 0,
                active: data.active ?? true
            }
        });
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        color?: string | null;
        sortOrder?: number;
        active?: boolean;
    }) {
        await this.getById(id, companyId);

        if (data.name !== undefined) {
            const name = data.name.trim();
            if (!name) {
                throw new Error('El nombre de la marca es requerido');
            }
            const existing = await prisma.menuBrand.findFirst({
                where: { companyId, name, NOT: { id } }
            });
            if (existing) {
                throw new Error(`Ya existe una marca llamada "${name}"`);
            }
            data.name = name;
        }

        return await prisma.menuBrand.update({
            where: { id },
            data
        });
    }

    static async delete(id: number, companyId: number) {
        const brand = await prisma.menuBrand.findFirst({
            where: { id, companyId },
            include: {
                _count: { select: { menuItems: true } }
            }
        });

        if (!brand) {
            throw new Error('Marca no encontrada');
        }

        if (brand._count.menuItems > 0) {
            throw new Error('No se puede eliminar una marca con platillos asociados');
        }

        return await prisma.menuBrand.delete({
            where: { id }
        });
    }
}
