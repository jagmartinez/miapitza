import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class MenuItemService {
    static async getAll(companyId: number, filters?: {
        branchId?: number;
        categoryId?: number;
        active?: boolean;
        type?: 'PREPARED' | 'DIRECT';
    }) {
        const where: Prisma.MenuItemWhereInput = { companyId };

        if (filters?.branchId !== undefined) {
            where.OR = [
                { branchId: filters.branchId },
                { branchId: null }
            ];
        }

        if (filters?.categoryId) {
            where.categoryId = filters.categoryId;
        }

        if (filters?.active !== undefined) {
            where.active = filters.active;
        }

        if (filters?.type) {
            where.type = filters.type;
        }

        return await prisma.menuItem.findMany({
            where,
            include: {
                category: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                recipes: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                unit: true,
                                cost: true
                            }
                        }
                    }
                },
                images: {
                    select: {
                        id: true,
                        imageUrl: true
                    },
                    orderBy: {
                        sortOrder: 'asc'
                    },
                    take: 5
                },
                _count: {
                    select: {
                        recipes: true,
                        modifierGroups: true
                    }
                }
            },
            orderBy: [
                { categoryId: 'asc' },
                { name: 'asc' }
            ]
        });
    }

    static async getById(id: number, companyId: number) {
        const menuItem = await prisma.menuItem.findFirst({
            where: { id, companyId },
            include: {
                category: {
                    select: {
                        id: true,
                        name: true,
                        description: true
                    }
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                        code: true
                    }
                },
                recipes: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                unit: true,
                                cost: true
                            }
                        }
                    }
                },
                modifierGroups: {
                    include: {
                        modifiers: {
                            where: { active: true }
                        }
                    }
                }
            }
        });

        if (!menuItem) {
            throw new Error('Menu item not found');
        }

        // Calculate total cost from recipes
        const totalCost = menuItem.recipes.reduce((sum, recipe) => {
            return sum + (Number(recipe.product.cost) * Number(recipe.quantity));
        }, 0);

        return {
            ...menuItem,
            totalCost,
            margin: Number(menuItem.price) - totalCost
        };
    }

    static async create(companyId: number, data: {
        branchId?: number;
        categoryId: number;
        name: string;
        description?: string;
        price: number;
        type?: 'PREPARED' | 'DIRECT';
    }) {
        return await prisma.menuItem.create({
            data: {
                ...data,
                companyId,
                type: data.type || 'PREPARED'
            },
            include: {
                category: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });
    }

    static async update(id: number, companyId: number, data: {
        branchId?: number | null;
        categoryId?: number;
        name?: string;
        description?: string;
        price?: number;
        active?: boolean;
        type?: 'PREPARED' | 'DIRECT';
    }) {
        // Validate price if provided
        if (data.price !== undefined) {
            const price = Number(data.price);
            if (!Number.isFinite(price) || price < 0) {
                throw new Error('El precio debe ser un número válido mayor o igual a 0');
            }
        }

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const item = await tx.menuItem.findFirst({ where: { id, companyId } });
            if (!item) throw new Error('Elemento de menú no encontrado');

            return await tx.menuItem.update({
                where: { id },
                data,
                include: {
                    category: { select: { id: true, name: true } }
                }
            });
        });
    }

    static async delete(id: number, companyId: number) {
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const item = await tx.menuItem.findFirst({ where: { id, companyId } });
            if (!item) throw new Error('Elemento de menú no encontrado');

            const orderItems = await tx.orderItem.findFirst({
                where: { menuItemId: id, order: { companyId } }
            });
            if (orderItems) {
                throw new Error('No se puede eliminar un elemento de menú con órdenes existentes');
            }

            return await tx.menuItem.delete({ where: { id } });
        });
    }

    // Recipe management
    static async addRecipe(menuItemId: number, companyId: number, data: {
        productId: number;
        quantity: number;
        unit?: string;
    }) {
        // Verify menu item belongs to company
        await this.getById(menuItemId, companyId);
        // Check if recipe already exists
        const existing = await prisma.recipe.findFirst({
            where: {
                menuItemId,
                productId: data.productId
            }
        });

        if (existing) {
            throw new Error('Recipe for this product already exists in this menu item');
        }

        return await prisma.recipe.create({
            data: {
                menuItemId,
                ...data
            },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        unit: true,
                        cost: true
                    }
                }
            }
        });
    }

    static async updateRecipe(recipeId: number, companyId: number, data: {
        quantity?: number;
        unit?: string;
    }) {
        return await prisma.recipe.update({
            where: {
                id: recipeId,
                menuItem: { companyId }
            },
            data,
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        unit: true
                    }
                }
            }
        });
    }

    static async deleteRecipe(recipeId: number, companyId: number) {
        return await prisma.recipe.delete({
            where: {
                id: recipeId,
                menuItem: { companyId }
            }
        });
    }

    static async getRecipes(menuItemId: number, companyId: number) {
        return await prisma.recipe.findMany({
            where: {
                menuItemId,
                menuItem: { companyId }
            },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        unit: true,
                        cost: true
                    }
                }
            }
        });
    }

    // Image management
    static async addImage(menuItemId: number, companyId: number, imageUrl: string) {
        // Verify menu item belongs to company
        await this.getById(menuItemId, companyId);

        // Enforce server-side image limit
        const imageCount = await prisma.menuItemImage.count({ where: { menuItemId } });
        if (imageCount >= 5) {
            throw new Error('Máximo 5 imágenes por elemento de menú');
        }

        return await prisma.menuItemImage.create({
            data: {
                menuItemId,
                imageUrl
            }
        });
    }

    static async deleteImage(imageId: number, companyId: number) {
        return await prisma.menuItemImage.delete({
            where: {
                id: imageId,
                menuItem: { companyId }
            }
        });
    }

    static async getImages(menuItemId: number, companyId: number) {
        return await prisma.menuItemImage.findMany({
            where: {
                menuItemId,
                menuItem: { companyId }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
    }
}
