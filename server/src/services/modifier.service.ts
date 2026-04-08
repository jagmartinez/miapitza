import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class ModifierService {
    // Modifier Groups CRUD
    static async getAll(companyId: number) {
        return await prisma.modifierGroup.findMany({
            where: { companyId },
            include: { modifiers: true }
        });
    }

    static async getById(id: number, companyId: number) {
        return await prisma.modifierGroup.findFirst({
            where: { id, companyId },
            include: { modifiers: true }
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

    // Modifiers CRUD
    static async addModifier(companyId: number, groupId: number, data: {
        name: string;
        extraPrice: number;
    }) {
        // Verify group belongs to company
        const group = await this.getById(groupId, companyId);
        if (!group) {
            throw new Error("Modifier group not found or does not belong to the company.");
        }

        return await prisma.modifier.create({
            data: {
                ...data,
                modifierGroupId: groupId
            }
        });
    }

    static async updateModifier(id: number, companyId: number, data: {
        name?: string;
        extraPrice?: number;
        active?: boolean;
    }) {
        if (data.extraPrice !== undefined && (Number(data.extraPrice) < 0 || !Number.isFinite(Number(data.extraPrice)))) {
            throw new Error('El precio extra debe ser mayor o igual a 0');
        }

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const modifier = await tx.modifier.findUnique({
                where: { id },
                include: { modifierGroup: true }
            });
            if (!modifier || modifier.modifierGroup.companyId !== companyId) {
                throw new Error('Modificador no encontrado');
            }
            return await tx.modifier.update({ where: { id }, data });
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
