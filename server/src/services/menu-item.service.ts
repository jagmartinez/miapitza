import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';

export class MenuItemService {
    static async getAll(companyId: number, filters?: {
        branchId?: number;
        categoryId?: number;
        brandId?: number;
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

        if (filters?.brandId) {
            where.brandId = filters.brandId;
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
                brand: {
                    select: {
                        id: true,
                        name: true,
                        color: true
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
                                cost: true,
                                currentAverageCost: true
                            }
                        },
                        unitOfMeasure: { select: { abbreviation: true } }
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

        // Calculate total cost from recipes in product base units.
        // Unit priority: recipe.unit -> recipe.unitId abbreviation -> product.unit.
        // Cost source aligned with production/reports: currentAverageCost ?? cost.
        const recipeCosts = await Promise.all(menuItem.recipes.map(async (recipe) => {
            const recipeUnit = recipe.unit || recipe.unitOfMeasure?.abbreviation || recipe.product.unit;
            const recipeQty = Number(recipe.quantity);
            const unitCost = Number(recipe.product.currentAverageCost ?? recipe.product.cost ?? 0);

            try {
                const conv = await UnitConversionService.convert(
                    recipe.product.id,
                    companyId,
                    recipeQty,
                    recipeUnit
                );
                return unitCost * conv.baseQuantity;
            } catch {
                // Conversion failed with an incompatible configured base unit: a
                // silent 1:1 would inflate the cost (e.g. ×1000 treating kg as g).
                // Surface a non-inflated 0 for this recipe instead of a misleading
                // number, and keep the menu list working (no crash).
                return 0;
            }
        }));

        const totalCost = recipeCosts.reduce((sum, value) => sum + value, 0);

        return {
            ...menuItem,
            totalCost,
            margin: Number(menuItem.price) - totalCost
        };
    }

    // Ensure foreign keys provided by the client actually belong to the caller's
    // company. Prisma only validates FKs by global id, so without this an item
    // could be linked to another tenant's category/brand/branch.
    private static async assertScopedRefs(companyId: number, refs: {
        categoryId?: number | null;
        brandId?: number | null;
        branchId?: number | null;
    }) {
        if (refs.categoryId !== undefined && refs.categoryId !== null) {
            const category = await prisma.category.findFirst({ where: { id: refs.categoryId, companyId }, select: { id: true } });
            if (!category) throw new Error('Categoría no encontrada para esta empresa');
        }
        if (refs.brandId !== undefined && refs.brandId !== null) {
            const brand = await prisma.menuBrand.findFirst({ where: { id: refs.brandId, companyId }, select: { id: true } });
            if (!brand) throw new Error('Marca no encontrada para esta empresa');
        }
        if (refs.branchId !== undefined && refs.branchId !== null) {
            const branch = await prisma.branch.findFirst({ where: { id: refs.branchId, companyId }, select: { id: true } });
            if (!branch) throw new Error('Sucursal no encontrada para esta empresa');
        }
    }

    static async create(companyId: number, data: {
        branchId?: number;
        brandId?: number | null;
        categoryId: number;
        name: string;
        description?: string;
        price: number;
        type?: 'PREPARED' | 'DIRECT';
    }) {
        await this.assertScopedRefs(companyId, { categoryId: data.categoryId, brandId: data.brandId, branchId: data.branchId });
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
        brandId?: number | null;
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

        await this.assertScopedRefs(companyId, { categoryId: data.categoryId, brandId: data.brandId, branchId: data.branchId });

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

    /**
     * Resolve a unit abbreviation to its `UnitOfMeasure` id within the company so
     * recipes keep referential integrity (`Recipe.unitId`) alongside the legacy
     * `unit` string. Returns null when the abbreviation is empty or unknown
     * (kept non-blocking to avoid breaking legacy products without a catalog).
     */
    private static async resolveUnitId(companyId: number, unit?: string | null): Promise<number | null> {
        if (!unit) return null;
        const abbr = unit.trim();
        if (!abbr) return null;
        const uom = await prisma.unitOfMeasure.findFirst({
            where: { companyId, abbreviation: abbr, active: true },
            select: { id: true }
        });
        return uom?.id ?? null;
    }

    // Recipe management
    static async addRecipe(menuItemId: number, companyId: number, data: {
        productId: number;
        quantity: number;
        unit?: string;
    }) {
        const quantity = Number(data.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('La cantidad de la receta debe ser mayor a 0');
        }
        // Verify menu item belongs to company
        await this.getById(menuItemId, companyId);
        // Verify the product also belongs to the company (avoid cross-tenant recipe links)
        const product = await prisma.product.findFirst({
            where: { id: data.productId, companyId },
            select: { id: true, unit: true }
        });
        if (!product) throw new Error('Producto no encontrado para esta empresa');
        const unit = String(data.unit ?? product.unit).trim();
        if (!unit) throw new Error('La unidad de la receta es requerida');
        await UnitConversionService.convert(product.id, companyId, quantity, unit);
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

        const unitId = await this.resolveUnitId(companyId, unit);

        return await prisma.recipe.create({
            data: {
                menuItemId,
                productId: data.productId,
                quantity,
                unit,
                unitId
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
        if (data.quantity === undefined && data.unit === undefined) {
            throw new Error('No hay cambios para guardar en la receta');
        }
        const existing = await prisma.recipe.findFirst({
            where: { id: recipeId, menuItem: { companyId } },
            include: { product: { select: { id: true, unit: true } } }
        });
        if (!existing) throw new Error('Receta no encontrada para esta empresa');
        const quantity = data.quantity === undefined ? Number(existing.quantity) : Number(data.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('La cantidad de la receta debe ser mayor a 0');
        }
        const unit = String(data.unit ?? existing.unit ?? existing.product.unit).trim();
        if (!unit) throw new Error('La unidad de la receta es requerida');
        await UnitConversionService.convert(existing.product.id, companyId, quantity, unit);

        const updateData: Prisma.RecipeUpdateInput = {};
        if (data.quantity !== undefined) updateData.quantity = quantity;
        if (data.unit !== undefined) {
            updateData.unit = unit;
            // Keep the FK in sync with the abbreviation.
            const unitId = await this.resolveUnitId(companyId, unit);
            updateData.unitOfMeasure = unitId
                ? { connect: { id: unitId } }
                : { disconnect: true };
        }

        return await prisma.recipe.update({
            where: {
                id: recipeId,
                menuItem: { companyId }
            },
            data: updateData,
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
