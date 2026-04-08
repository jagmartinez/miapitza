import prisma from '../utils/prisma';

/**
 * Dynamic Pricing Service
 * Handles branch-specific pricing for menu items
 */
export class DynamicPricingService {
    /**
     * Get price for a menu item at a specific branch
     */
    static async getPrice(menuItemId: number, branchId: number, companyId: number): Promise<number> {
        const branch = await prisma.branch.findFirst({
            where: { id: branchId, companyId },
            select: { id: true }
        });
        if (!branch) {
            throw new Error('Sucursal no encontrada');
        }

        // First check for branch-specific price
        const branchPrice = await prisma.menuItemBranchPrice?.findFirst({
            where: {
                menuItemId,
                branchId,
                branch: { companyId }
            }
        });

        if (branchPrice) {
            return Number(branchPrice.price);
        }

        // Fall back to default menu item price
        const menuItem = await prisma.menuItem.findFirst({
            where: { id: menuItemId, companyId },
            select: { price: true }
        });

        if (!menuItem) {
            throw new Error('Menu item not found');
        }
        return Number(menuItem.price);
    }

    /**
     * Set branch-specific price
     */
    static async setBranchPrice(menuItemId: number, branchId: number, price: number, companyId: number) {
        if (!Number.isFinite(price) || price < 0) {
            throw new Error('Precio inválido');
        }
        // Verify menu item exists and belongs to company
        const menuItem = await prisma.menuItem.findFirst({
            where: { id: menuItemId, companyId }
        });

        if (!menuItem) {
            throw new Error('Item de menú no encontrado');
        }

        const branch = await prisma.branch.findFirst({
            where: { id: branchId, companyId },
            select: { id: true }
        });
        if (!branch) {
            throw new Error('Sucursal no encontrada');
        }

        // Upsert branch price
        return await prisma.menuItemBranchPrice?.upsert({
            where: {
                menuItemId_branchId: { menuItemId, branchId }
            },
            create: {
                menuItemId,
                branchId,
                price
            },
            update: {
                price
            }
        }) || { menuItemId, branchId, price, simulated: true };
    }

    /**
     * Get all branch prices for a menu item
     */
    static async getBranchPrices(menuItemId: number, companyId: number) {
        const menuItem = await prisma.menuItem.findFirst({
            where: { id: menuItemId, companyId },
            select: {
                id: true,
                name: true,
                price: true
            }
        });

        if (!menuItem) {
            throw new Error('Item de menú no encontrado');
        }

        const branchPrices = await prisma.menuItemBranchPrice?.findMany({
            where: {
                menuItemId,
                branch: { companyId }
            },
            include: {
                branch: { select: { id: true, name: true } }
            }
        }) || [];

        return {
            menuItem: {
                id: menuItem.id,
                name: menuItem.name,
                defaultPrice: Number(menuItem.price)
            },
            branchPrices: branchPrices.map((bp) => ({
                branchId: bp.branch?.id || bp.branchId,
                branchName: bp.branch?.name || 'Unknown',
                price: Number(bp.price)
            }))
        };
    }

    /**
     * Remove branch-specific price (revert to default)
     */
    static async removeBranchPrice(menuItemId: number, branchId: number) {
        return await prisma.menuItemBranchPrice?.delete({
            where: {
                menuItemId_branchId: { menuItemId, branchId }
            }
        });
    }
}
