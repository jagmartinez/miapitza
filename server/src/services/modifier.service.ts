import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

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
        return await prisma.modifierGroup.create({
            data: {
                ...data,
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

        return await prisma.modifierGroup.update({
            where: { id },
            data,
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
                    where: { id: Number(data.productId), companyId }
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
                    where: { id: Number(data.unitId), companyId }
                });
                if (!unit) {
                    throw new Error('La unidad seleccionada no existe o no pertenece a la empresa');
                }
                link.unitId = unit.id;
            }
        }

        return link;
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

        const link = await this.resolveInventoryLink(companyId, data);

        // API contract keeps `extraPrice`; the Prisma model field is `price`.
        return await prisma.modifier.create({
            data: {
                name: data.name,
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

        // API contract keeps `extraPrice`; map it to the Prisma model field `price`.
        const { extraPrice, productId, consumeQuantity, unitId, ...rest } = data;
        const updateData: Prisma.ModifierUncheckedUpdateInput = { ...rest };
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
