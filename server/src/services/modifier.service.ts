import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';

export class ModifierService {
    // Modifier Groups CRUD
    // Include the optional inventory link (product + unit) so the admin UI can
    // render and edit which insumo a modifier consumes when sold.
    private static readonly modifierInclude = {
        modifiers: {
            include: { product: true, unit: true }
        }
    } satisfies Prisma.ModifierGroupInclude;

    static async getAll(companyId: number) {
        return await prisma.modifierGroup.findMany({
            where: { companyId },
            include: this.modifierInclude
        });
    }

    static async getById(id: number, companyId: number) {
        return await prisma.modifierGroup.findFirst({
            where: { id, companyId },
            include: this.modifierInclude
        });
    }

    static async create(companyId: number, data: {
        name: string;
        description?: string;
        minSelect?: number;
        maxSelect?: number;
        isRequired?: boolean;
    }) {
        const { isRequired } = data;
        const minSelect = data.minSelect ?? (isRequired === true ? 1 : 0);
        const name = data.name?.trim();
        if (!name) throw new Error('El nombre del grupo es requerido');
        if (!Number.isInteger(minSelect) || minSelect < 0) throw new Error('La selección mínima debe ser un entero no negativo');
        if (data.maxSelect !== undefined && !Number.isInteger(data.maxSelect)) throw new Error('La selección máxima debe ser un entero');
        if (data.maxSelect !== undefined && data.maxSelect < minSelect) throw new Error('La selección máxima no puede ser menor que la mínima');
        return await prisma.modifierGroup.create({
            data: {
                name,
                description: data.description,
                maxSelect: data.maxSelect,
                minSelect,
                companyId
            },
        });
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        description?: string;
        minSelect?: number;
        maxSelect?: number;
        isRequired?: boolean;
        active?: boolean;
    }) {
        // Verify ownership
        const group = await this.getById(id, companyId);
        if (!group) throw new Error("Not found or unauthorized");

        const { isRequired } = data;
        const minSelect = data.minSelect ?? (isRequired === true ? Math.max(1, group.minSelect) : isRequired === false ? 0 : undefined);
        const maxSelect = data.maxSelect ?? group.maxSelect;
        if (data.name !== undefined && !data.name.trim()) throw new Error('El nombre del grupo es requerido');
        if (minSelect !== undefined && (!Number.isInteger(minSelect) || minSelect < 0)) throw new Error('La selección mínima debe ser un entero no negativo');
        if (maxSelect !== null && !Number.isInteger(maxSelect)) throw new Error('La selección máxima debe ser un entero');
        if (maxSelect !== null && minSelect !== undefined && maxSelect < minSelect) throw new Error('La selección máxima no puede ser menor que la mínima');
        return await prisma.modifierGroup.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name.trim() } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.maxSelect !== undefined ? { maxSelect: data.maxSelect } : {}),
                ...(data.active !== undefined ? { active: data.active } : {}),
                ...(minSelect !== undefined ? { minSelect } : {})
            },
        });
    }

    static async delete(id: number, companyId: number) {
        // Verify ownership
        const group = await this.getById(id, companyId);
        if (!group) throw new Error("Not found or unauthorized");

        return await prisma.modifierGroup.delete({
            where: { id }
        });
    }

    // Validates and normalizes the optional inventory link fields. Only keys that
    // are present in `data` are returned, so partial updates leave others intact.
    // Passing an explicit `null` unlinks that field (e.g. productId=null).
    private static async resolveInventoryLink(
        companyId: number,
        data: { productId?: number | null; consumeQuantity?: number | null; unitId?: number | null }
    ): Promise<{ productId?: number | null; consumeQuantity?: number | null; unitId?: number | null }> {
        const link: { productId?: number | null; consumeQuantity?: number | null; unitId?: number | null } = {};

        if (data.productId !== undefined) {
            if (data.productId === null) {
                link.productId = null;
            } else {
                const product = await prisma.product.findFirst({
                    where: { id: Number(data.productId), companyId, active: true }
                });
                if (!product) {
                    throw new Error('El producto a consumir no existe o no pertenece a la empresa');
                }
                link.productId = product.id;
            }
        }

        if (data.consumeQuantity !== undefined) {
            if (data.consumeQuantity === null) {
                link.consumeQuantity = null;
            } else {
                const qty = Number(data.consumeQuantity);
                if (!Number.isFinite(qty) || qty <= 0) {
                    throw new Error('La cantidad a consumir debe ser mayor a 0');
                }
                link.consumeQuantity = qty;
            }
        }

        if (data.unitId !== undefined) {
            if (data.unitId === null) {
                link.unitId = null;
            } else {
                const unit = await prisma.unitOfMeasure.findFirst({
                    where: { id: Number(data.unitId), companyId, active: true }
                });
                if (!unit) {
                    throw new Error('La unidad seleccionada no existe o no pertenece a la empresa');
                }
                link.unitId = unit.id;
            }
        }

        return link;
    }

    private static async assertCompleteInventoryLink(companyId: number, link: {
        productId: number | null;
        consumeQuantity: number | null;
        unitId: number | null;
    }) {
        if (link.productId === null) {
            if (link.consumeQuantity !== null || link.unitId !== null) {
                throw new Error('Una cantidad o unidad de consumo requiere un producto vinculado');
            }
            return;
        }
        if (!(Number(link.consumeQuantity) > 0)) {
            throw new Error('Un modificador vinculado a inventario requiere una cantidad de consumo mayor a 0');
        }
        if (link.unitId !== null) {
            const unit = await prisma.unitOfMeasure.findFirst({
                where: { id: link.unitId, companyId, active: true },
                select: { abbreviation: true }
            });
            if (!unit) throw new Error('La unidad de consumo no existe o está inactiva');
            await UnitConversionService.convert(link.productId, companyId, Number(link.consumeQuantity), unit.abbreviation);
        }
    }

    // Modifiers CRUD
    static async addModifier(companyId: number, groupId: number, data: {
        name: string;
        extraPrice: number;
        productId?: number | null;
        consumeQuantity?: number | null;
        unitId?: number | null;
    }) {
        // Verify group belongs to company
        const group = await this.getById(groupId, companyId);
        if (!group) {
            throw new Error("Modifier group not found or does not belong to the company.");
        }

        const price = Number(data.extraPrice);
        if (price < 0 || !Number.isFinite(price)) {
            throw new Error('El precio extra debe ser mayor o igual a 0');
        }
        const name = data.name?.trim();
        if (!name) throw new Error('El nombre del modificador es requerido');

        const link = await this.resolveInventoryLink(companyId, data);
        await this.assertCompleteInventoryLink(companyId, {
            productId: link.productId ?? null,
            consumeQuantity: link.consumeQuantity ?? null,
            unitId: link.unitId ?? null
        });

        // API contract keeps `extraPrice`; the Prisma model field is `price`.
        return await prisma.modifier.create({
            data: {
                name,
                price,
                modifierGroupId: groupId,
                ...link
            }
        });
    }

    static async updateModifier(id: number, companyId: number, data: {
        name?: string;
        extraPrice?: number;
        active?: boolean;
        productId?: number | null;
        consumeQuantity?: number | null;
        unitId?: number | null;
    }) {
        if (data.extraPrice !== undefined && (Number(data.extraPrice) < 0 || !Number.isFinite(Number(data.extraPrice)))) {
            throw new Error('El precio extra debe ser mayor o igual a 0');
        }
        if (data.name !== undefined && !data.name.trim()) throw new Error('El nombre del modificador es requerido');

        // API contract keeps `extraPrice`; map it to the Prisma model field `price`.
        const { extraPrice, productId, consumeQuantity, unitId } = data;
        const updateData: Prisma.ModifierUncheckedUpdateInput = {
            ...(data.name !== undefined ? { name: data.name.trim() } : {}),
            ...(data.active !== undefined ? { active: data.active } : {})
        };
        if (extraPrice !== undefined) {
            updateData.price = Number(extraPrice);
        }

        const link = await this.resolveInventoryLink(companyId, { productId, consumeQuantity, unitId });
        Object.assign(updateData, link);

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const modifier = await tx.modifier.findUnique({
                where: { id },
                include: { modifierGroup: true }
            });
            if (!modifier || modifier.modifierGroup.companyId !== companyId) {
                throw new Error('Modificador no encontrado');
            }
            const nextLink = {
                productId: link.productId !== undefined ? link.productId : modifier.productId,
                consumeQuantity: link.consumeQuantity !== undefined ? link.consumeQuantity : modifier.consumeQuantity == null ? null : Number(modifier.consumeQuantity),
                unitId: link.unitId !== undefined ? link.unitId : modifier.unitId
            };
            if (productId === null) {
                if ((consumeQuantity !== undefined && consumeQuantity !== null) || (unitId !== undefined && unitId !== null)) {
                    throw new Error('No se puede configurar consumo sin un producto vinculado');
                }
                nextLink.consumeQuantity = null;
                nextLink.unitId = null;
                updateData.consumeQuantity = null;
                updateData.unitId = null;
            }
            await this.assertCompleteInventoryLink(companyId, nextLink);
            return await tx.modifier.update({ where: { id }, data: updateData });
        });
    }

    static async deleteModifier(id: number, companyId: number) {
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const modifier = await tx.modifier.findUnique({
                where: { id },
                include: { modifierGroup: true }
            });
            if (!modifier || modifier.modifierGroup.companyId !== companyId) {
                throw new Error('Modificador no encontrado');
            }
            return await tx.modifier.delete({ where: { id } });
        });
    }

    // MenuItem Assignment
    static async assignGroupToMenuItem(menuItemId: number, groupId: number, companyId: number) {
        // Verify both belong to company
        const menuItem = await prisma.menuItem.findFirst({
            where: { id: menuItemId, companyId }
        });
        const group = await prisma.modifierGroup.findFirst({
            where: { id: groupId, companyId }
        });

        if (!menuItem || !group) {
            throw new Error("Menu item or modifier group not found or unauthorized.");
        }

        return await prisma.menuItem.update({
            where: { id: menuItemId, companyId },
            data: {
                modifierGroups: {
                    connect: { id: groupId }
                }
            }
        });
    }

    static async removeGroupFromMenuItem(menuItemId: number, groupId: number, companyId: number) {
        // Verify ownership
        const menuItem = await prisma.menuItem.findFirst({
            where: { id: menuItemId, companyId }
        });
        if (!menuItem) throw new Error("Not found or unauthorized");
        const group = await prisma.modifierGroup.findFirst({ where: { id: groupId, companyId }, select: { id: true } });
        if (!group) throw new Error("Not found or unauthorized");

        return await prisma.menuItem.update({
            where: { id: menuItemId },
            data: {
                modifierGroups: {
                    disconnect: { id: groupId }
                }
            }
        });
    }
}
