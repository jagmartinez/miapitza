import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { ProductionRecipeService } from './production-recipe.service';

export class MenuItemService {
    static async getOwnerBranch(menuItemId: number, companyId: number): Promise<number | null> {
        const item = await prisma.menuItem.findFirst({
            where: { id: menuItemId, companyId },
            select: { branchId: true }
        });
        if (!item) throw new Error('Menu item not found');
        return item.branchId;
    }

    static async getRecipeOwnerBranch(recipeId: number, companyId: number): Promise<number | null> {
        const recipe = await prisma.recipe.findFirst({
            where: { id: recipeId, menuItem: { companyId } },
            select: { menuItem: { select: { branchId: true } } }
        });
        if (!recipe) throw new Error('Receta no encontrada para esta empresa');
        return recipe.menuItem.branchId;
    }

    static async getImageOwnerBranch(imageId: number, companyId: number): Promise<number | null> {
        const image = await prisma.menuItemImage.findFirst({
            where: { id: imageId, menuItem: { companyId } },
            select: { menuItem: { select: { branchId: true } } }
        });
        if (!image) throw new Error('Imagen no encontrada para esta empresa');
        return image.menuItem.branchId;
    }

    static async getAll(companyId: number, filters?: {
        branchId?: number;
        categoryId?: number;
        brandId?: number;
        active?: boolean;
        type?: 'PREPARED' | 'DIRECT';
        resolveBranchPrice?: boolean;
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
            if (filters.active) {
                // Existing bad data must not reach operational/POS catalogs.
                // DIRECT items need no BOM; PREPARED items need at least one
                // sale-recipe line and remain visible in the admin's unfiltered list.
                where.AND = [
                    {
                        OR: [
                            { type: 'DIRECT' },
                            { type: 'PREPARED', recipes: { some: {} } }
                        ]
                    }
                ];
            }
        }

        if (filters?.type) {
            where.type = filters.type;
        }

        const menuItems = await prisma.menuItem.findMany({
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
                },
                branchPrices: filters?.branchId && filters.resolveBranchPrice
                    ? {
                        where: { branchId: filters.branchId, active: true },
                        select: { price: true }
                    }
                    : false
            },
            orderBy: [
                { categoryId: 'asc' },
                { name: 'asc' }
            ]
        });

        if (!filters?.branchId || !filters.resolveBranchPrice) return menuItems;
        return menuItems.map((item) => ({
            ...item,
            basePrice: item.price,
            price: item.branchPrices[0]?.price ?? item.price
        }));
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
                    where: { active: true },
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
        // Prefer the real weighted average, but allow a catalog reference cost
        // when no purchase/production has established an average yet.
        const recipeCosts = await Promise.all(menuItem.recipes.map(async (recipe) => {
            const recipeUnit = recipe.unit || recipe.unitOfMeasure?.abbreviation || recipe.product.unit;
            const recipeQty = Number(recipe.quantity);
            const unitCost = await ProductionRecipeService.resolveProductUnitCost(
                recipe.product.id,
                companyId
            );

            try {
                const conv = await UnitConversionService.convert(
                    recipe.product.id,
                    companyId,
                    recipeQty,
                    recipeUnit
                );
                return unitCost * conv.baseQuantity;
            } catch (error) {
                // Conversion failed with an incompatible configured base unit: a
                // silent 1:1 or zero would hide a corrupt recipe cost. Fail closed
                // with the exact product/unit context.
                throw new Error(`No se pudo calcular el costo de "${recipe.product.name}" en unidad "${recipeUnit}": ${(error as Error).message}`);
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
    }, db: Prisma.TransactionClient | typeof prisma = prisma) {
        if (refs.categoryId !== undefined && refs.categoryId !== null) {
            const category = await db.category.findFirst({ where: { id: refs.categoryId, companyId }, select: { id: true } });
            if (!category) throw new Error('Categoría no encontrada para esta empresa');
        }
        if (refs.brandId !== undefined && refs.brandId !== null) {
            const brand = await db.menuBrand.findFirst({ where: { id: refs.brandId, companyId }, select: { id: true } });
            if (!brand) throw new Error('Marca no encontrada para esta empresa');
        }
        if (refs.branchId !== undefined && refs.branchId !== null) {
            const branch = await db.branch.findFirst({ where: { id: refs.branchId, companyId }, select: { id: true } });
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
        const price = Number(data.price);
        if (!Number.isFinite(price) || price < 0) throw new Error('El precio debe ser un número válido mayor o igual a 0');
        const name = data.name?.trim();
        if (!name) throw new Error('El nombre del elemento de menú es requerido');
        await this.assertScopedRefs(companyId, { categoryId: data.categoryId, brandId: data.brandId, branchId: data.branchId });
        const type = data.type || 'PREPARED';
        // PREPARED items require a sale recipe before going live; create inactive
        // so POS cannot sell a kitchen plate with an empty BOM.
        return await prisma.menuItem.create({
            data: {
                branchId: data.branchId,
                brandId: data.brandId,
                categoryId: data.categoryId,
                name,
                description: data.description,
                price,
                companyId,
                type,
                active: type === 'DIRECT'
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
        if (data.name !== undefined && !data.name.trim()) {
            throw new Error('El nombre del elemento de menú es requerido');
        }
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

            const nextType = data.type ?? item.type;
            const nextActive = data.active ?? item.active;
            if (nextActive && nextType === 'PREPARED') {
                const recipeCount = await tx.recipe.count({ where: { menuItemId: id } });
                if (recipeCount === 0) {
                    throw new Error(
                        'No se puede activar un plato preparado sin receta de venta. Agregue ingredientes o márquelo como venta directa.'
                    );
                }
            }

            const safeData: Prisma.MenuItemUncheckedUpdateInput = {
                ...(data.branchId !== undefined ? { branchId: data.branchId } : {}),
                ...(data.brandId !== undefined ? { brandId: data.brandId } : {}),
                ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
                ...(data.name !== undefined ? { name: data.name.trim() } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.price !== undefined ? { price: Number(data.price) } : {}),
                ...(data.active !== undefined ? { active: data.active } : {}),
                ...(data.type !== undefined ? { type: data.type } : {})
            };
            return await tx.menuItem.update({
                where: { id },
                data: safeData,
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
    private static async resolveUnitId(
        companyId: number,
        unit?: string | null,
        db: Prisma.TransactionClient | typeof prisma = prisma
    ): Promise<number | null> {
        if (!unit) return null;
        const abbr = unit.trim();
        if (!abbr) return null;
        const uom = await db.unitOfMeasure.findFirst({
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
            where: { id: data.productId, companyId, active: true },
            select: { id: true, unit: true }
        });
        if (!product) throw new Error('Producto no encontrado o inactivo para esta empresa');
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

    /**
     * Replace the complete sale recipe in one transaction. Every product, unit
     * and quantity is validated before the first delete, so a failed replacement
     * leaves the previous BOM intact and an active PREPARED item is never exposed
     * with an empty recipe.
     */
    static async replaceRecipes(menuItemId: number, companyId: number, recipes: Array<{
        productId: number;
        quantity: number;
        unit?: string;
    }>, menuItemData?: {
        branchId?: number | null;
        brandId?: number | null;
        categoryId?: number;
        name?: string;
        description?: string;
        price?: number;
        active?: boolean;
        type?: 'PREPARED' | 'DIRECT';
    }) {
        if (!Array.isArray(recipes)) throw new Error('La receta debe ser una lista de ingredientes');
        if (recipes.length > 500) throw new Error('La receta excede el máximo de 500 ingredientes');

        const productIds = recipes.map((line) => Number(line.productId));
        if (productIds.some((productId) => !Number.isInteger(productId) || productId <= 0)) {
            throw new Error('Todos los ingredientes deben tener un producto válido');
        }
        if (new Set(productIds).size !== productIds.length) {
            throw new Error('La receta no puede contener productos duplicados');
        }

        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT id FROM \`MenuItem\` WHERE id = ${menuItemId} AND companyId = ${companyId} FOR UPDATE`;
            const menuItem = await tx.menuItem.findFirst({
                where: { id: menuItemId, companyId },
                select: { id: true, active: true, type: true, name: true }
            });
            if (!menuItem) throw new Error('Elemento de menú no encontrado');
            if (menuItemData?.name !== undefined && !menuItemData.name.trim()) {
                throw new Error('El nombre del elemento de menú es requerido');
            }
            if (menuItemData?.price !== undefined
                && (!Number.isFinite(Number(menuItemData.price)) || Number(menuItemData.price) < 0)) {
                throw new Error('El precio debe ser un número válido mayor o igual a 0');
            }
            await this.assertScopedRefs(companyId, {
                categoryId: menuItemData?.categoryId,
                brandId: menuItemData?.brandId,
                branchId: menuItemData?.branchId
            }, tx);

            const nextActive = menuItemData?.active ?? menuItem.active;
            const nextType = menuItemData?.type ?? menuItem.type;
            if (nextActive && nextType === 'PREPARED' && recipes.length === 0) {
                throw new Error(`No se puede dejar "${menuItem.name}" activo sin ingredientes`);
            }

            const products = await tx.product.findMany({
                where: { id: { in: productIds }, companyId, active: true },
                select: { id: true, unit: true }
            });
            const productById = new Map(products.map((product) => [product.id, product]));
            if (products.length !== productIds.length) {
                throw new Error('Uno o más productos no existen, están inactivos o pertenecen a otra empresa');
            }

            const normalized = [] as Array<{
                menuItemId: number;
                productId: number;
                quantity: number;
                unit: string;
                unitId: number | null;
            }>;
            for (const line of recipes) {
                const quantity = Number(line.quantity);
                if (!Number.isFinite(quantity) || quantity <= 0) {
                    throw new Error('La cantidad de cada ingrediente debe ser mayor a 0');
                }
                const product = productById.get(Number(line.productId))!;
                const unit = String(line.unit ?? product.unit).trim();
                if (!unit) throw new Error('La unidad de cada ingrediente es requerida');

                await UnitConversionService.convert(product.id, companyId, quantity, unit, tx);
                const unitId = await this.resolveUnitId(companyId, unit, tx);
                normalized.push({ menuItemId, productId: product.id, quantity, unit, unitId });
            }

            await tx.recipe.deleteMany({ where: { menuItemId } });
            if (normalized.length > 0) {
                await tx.recipe.createMany({ data: normalized });
            }

            const updatedMenuItem = menuItemData
                ? await tx.menuItem.update({
                    where: { id: menuItemId },
                    data: {
                        ...(menuItemData.branchId !== undefined ? { branchId: menuItemData.branchId } : {}),
                        ...(menuItemData.brandId !== undefined ? { brandId: menuItemData.brandId } : {}),
                        ...(menuItemData.categoryId !== undefined ? { categoryId: menuItemData.categoryId } : {}),
                        ...(menuItemData.name !== undefined ? { name: menuItemData.name.trim() } : {}),
                        ...(menuItemData.description !== undefined ? { description: menuItemData.description } : {}),
                        ...(menuItemData.price !== undefined ? { price: Number(menuItemData.price) } : {}),
                        ...(menuItemData.active !== undefined ? { active: menuItemData.active } : {}),
                        ...(menuItemData.type !== undefined ? { type: menuItemData.type } : {})
                    }
                })
                : menuItem;

            const replacedRecipes = await tx.recipe.findMany({
                where: { menuItemId },
                include: {
                    product: {
                        select: { id: true, name: true, unit: true, cost: true }
                    },
                    unitOfMeasure: {
                        select: { id: true, abbreviation: true }
                    }
                },
                orderBy: { id: 'asc' }
            });
            return { menuItem: updatedMenuItem, recipes: replacedRecipes };
        });
    }

    static async deleteRecipe(recipeId: number, companyId: number) {
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const existing = await tx.recipe.findFirst({
                where: { id: recipeId, menuItem: { companyId } },
                select: {
                    id: true,
                    menuItemId: true,
                    menuItem: { select: { active: true, type: true, name: true } }
                }
            });
            if (!existing) throw new Error('Receta no encontrada para esta empresa');

            if (existing.menuItem.active && existing.menuItem.type === 'PREPARED') {
                const remaining = await tx.recipe.count({
                    where: { menuItemId: existing.menuItemId, id: { not: recipeId } }
                });
                if (remaining === 0) {
                    throw new Error(
                        `No se puede eliminar el último ingrediente de "${existing.menuItem.name}" mientras esté activo. Desactive el plato primero.`
                    );
                }
            }

            return tx.recipe.delete({
                where: {
                    id: recipeId,
                    menuItem: { companyId }
                }
            });
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
