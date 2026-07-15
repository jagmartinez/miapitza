import prisma from '../utils/prisma';

export class MenuBrandService {
    private static normalize(data: {
        name?: string;
        color?: string | null;
        sortOrder?: number;
        active?: boolean;
    }) {
        const normalized: typeof data = {};
        if (data.name !== undefined) {
            const name = data.name.trim();
            if (!name) throw new Error('El nombre de la marca es requerido');
            if (name.length > 100) throw new Error('El nombre de la marca no puede exceder 100 caracteres');
            normalized.name = name;
        }
        if (data.color !== undefined) {
            const color = data.color?.trim() || null;
            if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('El color debe usar formato hexadecimal #RRGGBB');
            normalized.color = color;
        }
        if (data.sortOrder !== undefined) {
            if (!Number.isInteger(data.sortOrder)) throw new Error('El orden debe ser un entero');
            normalized.sortOrder = data.sortOrder;
        }
        if (data.active !== undefined) {
            if (typeof data.active !== 'boolean') throw new Error('El estado activo es inválido');
            normalized.active = data.active;
        }
        return normalized;
    }

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
    }, actorUserId: number) {
        const normalized = this.normalize(data);
        if (!normalized.name) throw new Error('El nombre de la marca es requerido');
        return prisma.$transaction(async (tx) => {
            const brand = await tx.menuBrand.create({
                data: {
                    companyId,
                    name: normalized.name!,
                    color: normalized.color ?? null,
                    sortOrder: normalized.sortOrder ?? 0,
                    active: normalized.active ?? true,
                },
            });
            await tx.auditLog.create({
                data: {
                    companyId,
                    userId: actorUserId,
                    entityType: 'MenuBrand',
                    entityId: brand.id,
                    action: 'CREATE',
                    details: { name: brand.name, color: brand.color, sortOrder: brand.sortOrder },
                },
            });
            return brand;
        });
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        color?: string | null;
        sortOrder?: number;
        active?: boolean;
    }, actorUserId: number) {
        const normalized = this.normalize(data);
        if (Object.keys(normalized).length === 0) throw new Error('No hay campos válidos para actualizar');
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`MenuBrand\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const existing = await tx.menuBrand.findFirst({ where: { id, companyId } });
            if (!existing) throw new Error('Marca no encontrada');
            const brand = await tx.menuBrand.update({ where: { id }, data: normalized });
            await tx.auditLog.create({
                data: {
                    companyId,
                    userId: actorUserId,
                    entityType: 'MenuBrand',
                    entityId: id,
                    action: 'UPDATE',
                    details: {
                        fields: Object.keys(normalized),
                        previous: {
                            name: existing.name,
                            color: existing.color,
                            sortOrder: existing.sortOrder,
                            active: existing.active,
                        },
                    },
                },
            });
            return brand;
        });
    }

    static async delete(id: number, companyId: number, actorUserId: number) {
        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`MenuBrand\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const brand = await tx.menuBrand.findFirst({
                where: { id, companyId },
                include: { _count: { select: { menuItems: true } } },
            });
            if (!brand) throw new Error('Marca no encontrada');
            if (brand._count.menuItems > 0) throw new Error('No se puede eliminar una marca con platillos asociados');
            await tx.menuBrand.delete({ where: { id } });
            await tx.auditLog.create({
                data: {
                    companyId,
                    userId: actorUserId,
                    entityType: 'MenuBrand',
                    entityId: id,
                    action: 'DELETE',
                    details: { name: brand.name },
                },
            });
            return brand;
        });
    }
}
