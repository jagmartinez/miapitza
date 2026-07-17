import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { getErrorMessage } from '../utils/error';
import { AuditLogService } from './audit-log.service';
import { resolveEffectiveUnitCost } from '../utils/product-cost';

export type ProductTypeValue = 'INGREDIENT' | 'PRODUCT_FOR_SALE' | 'BOTH' | 'INTERMEDIATE' | 'PACKAGING';

export class ProductService {

    /**
     * `Product.unit` is the physical base for products that have not yet been
     * migrated to `baseUnitId`. Reinterpreting it after transactional or recipe
     * references exist would silently change historical quantities. Once a
     * configured base exists, base changes must use the conversion endpoint.
     */
    private static async assertLegacyUnitCanChange(
        productId: number,
        companyId: number,
        currentBaseUnitId: number | null
    ): Promise<void> {
        if (currentBaseUnitId) {
            throw new Error(
                'La unidad de referencia se administra desde Conversiones. No puede cambiarse desde la ficha del producto.'
            );
        }

        const references = await Promise.all([
            prisma.stock.count({ where: { productId, companyId, quantity: { not: 0 } } }),
            prisma.inventoryMovement.count({ where: { productId, companyId } }),
            prisma.inventoryBatch.count({ where: { productId, companyId } }),
            prisma.purchaseOrderItem.count({ where: { productId, purchaseOrder: { companyId } } }),
            prisma.recipe.count({ where: { productId, menuItem: { companyId } } }),
            prisma.productionRecipe.count({ where: { productId, companyId } }),
            prisma.productionRecipeComponent.count({
                where: { componentProductId: productId, recipe: { companyId } }
            }),
            prisma.productionOrder.count({ where: { productId, companyId } }),
            prisma.productionOrderItem.count({
                where: { componentProductId: productId, productionOrder: { companyId } }
            }),
            prisma.modifier.count({ where: { productId, modifierGroup: { companyId } } })
        ]);

        if (references.some((count) => count > 0)) {
            throw new Error(
                'No se puede cambiar la unidad base de un producto con existencias, historial o recetas. Cree un producto nuevo o realice una migración controlada.'
            );
        }
    }

    static async getAll(companyId: number, filters?: {
        type?: ProductTypeValue;
        storageType?: 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE';
        categoryId?: number;
        active?: boolean;
        branchId?: number;
        page?: number;
        limit?: number;
    }) {
        const where: Prisma.ProductWhereInput = { companyId };

        // When the caller is scoped to a branch, the aggregate stock should only
        // reflect that branch's warehouses (plus shared CENTRAL warehouses).
        const stockWhere: Prisma.StockWhereInput | undefined = filters?.branchId
            ? { warehouse: { OR: [{ branchId: filters.branchId }, { branchId: null }] } }
            : undefined;

        if (filters?.type) {
            where.type = filters.type;
        }

        if (filters?.storageType) {
            where.storageType = filters.storageType;
        }

        if (filters?.categoryId) {
            where.categoryId = filters.categoryId;
        }

        if (filters?.active !== undefined) {
            where.active = filters.active;
        }

        const page = filters?.page || 1;
        const limit = Math.min(filters?.limit || 100, 500);
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            prisma.product.findMany({
                where,
                include: {
                    category: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    stocks: {
                        where: stockWhere,
                        select: { quantity: true }
                    },
                    _count: {
                        select: {
                            stocks: true,
                            recipes: true
                        }
                    }
                },
                orderBy: {
                    name: 'asc'
                },
                skip,
                take: limit
            }),
            prisma.product.count({ where })
        ]);

        // Expose an aggregate current stock so the UI can display and sort by it
        // without an extra round trip per product.
        const mapped = data.map((product) => {
            const totalStock = product.stocks.reduce((sum, s) => sum + Number(s.quantity), 0);
            const { stocks, ...rest } = product;
            void stocks;
            const costQuality = resolveEffectiveUnitCost(
                product.currentAverageCost,
                product.cost,
                {
                    averageCostKnown: product.averageCostKnown,
                    referenceCostKnown: product.referenceCostKnown
                }
            );
            return { ...rest, totalStock, costQuality };
        });

        return { data: mapped, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    static async getById(id: number, companyId: number) {
        const product = await prisma.product.findFirst({
            where: { id, companyId },
            include: {
                category: {
                    select: {
                        id: true,
                        name: true,
                        description: true
                    }
                },
                stocks: {
                    include: {
                        warehouse: {
                            select: {
                                id: true,
                                name: true,
                                branchId: true,
                                branch: {
                                    select: {
                                        name: true,
                                        code: true
                                    }
                                }
                            }
                        }
                    }
                },
                recipes: {
                    include: {
                        menuItem: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });

        if (!product) {
            throw new Error('Product not found');
        }

        return {
            ...product,
            costQuality: resolveEffectiveUnitCost(
                product.currentAverageCost,
                product.cost,
                {
                    averageCostKnown: product.averageCostKnown,
                    referenceCostKnown: product.referenceCostKnown
                }
            )
        };
    }

    static async generateSku(
        companyId: number,
        categoryId?: number | null,
        type?: ProductTypeValue
    ): Promise<string> {
        let prefix = 'GEN';

        if (categoryId) {
            const category = await prisma.category.findFirst({
                where: { id: categoryId, companyId }
            });
            if (category?.codePrefix) {
                prefix = category.codePrefix;
            }
        } else if (type === 'INGREDIENT') {
            prefix = 'ING';
        } else if (type === 'INTERMEDIATE') {
            prefix = 'INT';
        } else if (type === 'PACKAGING') {
            prefix = 'EMP';
        }

        const lastProduct = await prisma.product.findFirst({
            where: {
                companyId,
                sku: { startsWith: `${prefix}-` }
            },
            orderBy: { sku: 'desc' },
            select: { sku: true }
        });

        let nextNumber = 1;
        if (lastProduct?.sku) {
            const parts = lastProduct.sku.split('-');
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num)) {
                nextNumber = num + 1;
            }
        }

        return `${prefix}-${String(nextNumber).padStart(6, '0')}`;
    }

    static async create(companyId: number, data: {
        name: string;
        sku?: string;
        categoryId?: number;
        unit: string;
        minStock?: number;
        cost?: number;
        referenceCostKnown?: boolean;
        price?: number | null;
        type?: ProductTypeValue;
        storageType?: 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE';
        observation?: string | null;
        active?: boolean;
    }, userId?: number) {
        const name = data.name?.trim();
        const unit = data.unit?.trim().toLowerCase();
        if (!name) throw new Error('El nombre del producto es requerido.');
        if (!unit) throw new Error('La unidad de referencia del producto es requerida.');
        if (data.cost !== undefined && (!Number.isFinite(data.cost) || data.cost < 0)) {
            throw new Error('El costo de referencia debe ser un número finito mayor o igual a cero.');
        }
        if (data.referenceCostKnown === false && Number(data.cost ?? 0) > 0) {
            throw new Error('Un costo de referencia positivo no puede marcarse como desconocido.');
        }
        if (data.minStock !== undefined && (!Number.isFinite(data.minStock) || data.minStock < 0)) {
            throw new Error('El inventario mínimo debe ser un número finito mayor o igual a cero.');
        }
        if (data.price != null && (!Number.isFinite(data.price) || data.price < 0)) {
            throw new Error('El precio debe ser un número finito mayor o igual a cero.');
        }
        // La categoría, si se indica, debe pertenecer a la empresa (evita asociar
        // productos a categorías de otro tenant).
        if (data.categoryId !== undefined && data.categoryId !== null) {
            const category = await prisma.category.findFirst({
                where: { id: data.categoryId, companyId },
                select: { id: true }
            });
            if (!category) {
                throw new Error('La categoría no pertenece a la empresa.');
            }
        }

        if (!data.sku || data.sku.trim() === '') {
            data.sku = await this.generateSku(companyId, data.categoryId, data.type);
        }

        if (data.sku) {
            const existing = await prisma.product.findFirst({
                where: { sku: data.sku, companyId }
            });

            if (existing) {
                throw new Error('Product with this SKU already exists');
            }
        }

        const product = await prisma.product.create({
            data: {
                name,
                sku: data.sku,
                categoryId: data.categoryId,
                unit,
                companyId,
                minStock: data.minStock ?? 0,
                cost: data.cost ?? 0,
                referenceCostKnown: data.referenceCostKnown ?? (data.cost !== undefined),
                price: data.price,
                type: data.type || 'INGREDIENT',
                storageType: data.storageType,
                observation: data.observation,
                active: data.active ?? true
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

        if (userId) {
            AuditLogService.log({
                companyId, userId, entityType: 'Product', entityId: product.id,
                action: 'CREATE', details: { name: product.name, sku: product.sku }
            }).catch((err) => console.error('[ProductService] Failed to write audit log:', err));
        }

        return product;
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        sku?: string;
        categoryId?: number;
        unit?: string;
        minStock?: number;
        cost?: number;
        referenceCostKnown?: boolean;
        price?: number | null;
        type?: ProductTypeValue;
        storageType?: 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE' | null;
        observation?: string | null;
        active?: boolean;
    }, userId?: number) {
        const name = data.name === undefined ? undefined : data.name.trim();
        const unit = data.unit === undefined ? undefined : data.unit.trim().toLowerCase();
        if (name !== undefined && !name) throw new Error('El nombre del producto es requerido.');
        if (unit !== undefined && !unit) throw new Error('La unidad de referencia del producto es requerida.');
        if (data.cost !== undefined && (!Number.isFinite(data.cost) || data.cost < 0)) {
            throw new Error('El costo de referencia debe ser un número finito mayor o igual a cero.');
        }
        if (data.referenceCostKnown === false && Number(data.cost ?? 0) > 0) {
            throw new Error('Un costo de referencia positivo no puede marcarse como desconocido.');
        }
        if (data.minStock !== undefined && (!Number.isFinite(data.minStock) || data.minStock < 0)) {
            throw new Error('El inventario mínimo debe ser un número finito mayor o igual a cero.');
        }
        if (data.price != null && (!Number.isFinite(data.price) || data.price < 0)) {
            throw new Error('El precio debe ser un número finito mayor o igual a cero.');
        }
        const existing = await this.getById(id, companyId);

        if (unit !== undefined && unit !== String(existing.unit).trim().toLowerCase()) {
            await this.assertLegacyUnitCanChange(
                id,
                companyId,
                (existing as { baseUnitId?: number | null }).baseUnitId ?? null
            );
        }

        // La categoría, si se indica, debe pertenecer a la empresa (evita reasignar
        // productos a categorías de otro tenant).
        if (data.categoryId !== undefined && data.categoryId !== null) {
            const category = await prisma.category.findFirst({
                where: { id: data.categoryId, companyId },
                select: { id: true }
            });
            if (!category) {
                throw new Error('La categoría no pertenece a la empresa.');
            }
        }

        const hasSkuKey = Object.prototype.hasOwnProperty.call(data, 'sku');
        const incomingSkuEmpty = hasSkuKey && (!data.sku || String(data.sku).trim() === '');
        const currentSkuEmpty = !existing.sku || String(existing.sku).trim() === '';

        if (incomingSkuEmpty || (!hasSkuKey && currentSkuEmpty)) {
            const effectiveCategoryId =
                data.categoryId !== undefined ? data.categoryId : existing.categoryId;
            const effectiveType = (data.type || existing.type) as ProductTypeValue;
            data.sku = await this.generateSku(companyId, effectiveCategoryId, effectiveType);
        }

        if (data.sku) {
            const duplicate = await prisma.product.findFirst({
                where: {
                    sku: data.sku,
                    companyId,
                    NOT: { id }
                }
            });

            if (duplicate) {
                throw new Error('Product with this SKU already exists');
            }
        }

        // `cost` is a catalog/reference cost used only when no positive moving
        // average exists. Manual catalog edits must never rewrite transactional
        // facts (`currentAverageCost` or `lastPurchaseCost`). Those fields are
        // updated exclusively by received purchases/valued inventory flows.
        const updateData: Prisma.ProductUncheckedUpdateInput = {
            ...(name !== undefined ? { name } : {}),
            ...(data.sku !== undefined ? { sku: data.sku } : {}),
            ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
            ...(unit !== undefined ? { unit } : {}),
            ...(data.minStock !== undefined ? { minStock: data.minStock } : {}),
            ...(data.cost !== undefined ? { cost: data.cost } : {}),
            ...(data.referenceCostKnown !== undefined
                ? { referenceCostKnown: data.referenceCostKnown }
                : data.cost !== undefined ? { referenceCostKnown: true } : {}),
            ...(data.price !== undefined ? { price: data.price } : {}),
            ...(data.type !== undefined ? { type: data.type } : {}),
            ...(data.storageType !== undefined ? { storageType: data.storageType } : {}),
            ...(data.observation !== undefined ? { observation: data.observation } : {}),
            ...(data.active !== undefined ? { active: data.active } : {})
        };
        const product = await prisma.product.update({
            where: { id },
            data: updateData,
            include: {
                category: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        if (userId) {
            const diff = AuditLogService.buildDiff(
                { name: existing.name, sku: (existing as Record<string, unknown>).sku, cost: (existing as Record<string, unknown>).cost, active: (existing as Record<string, unknown>).active },
                data as Record<string, unknown>
            );
            if (Object.keys(diff).length > 0) {
                AuditLogService.log({
                    companyId, userId, entityType: 'Product', entityId: id,
                    action: 'UPDATE', details: diff
                }).catch((err) => console.error('[ProductService] Failed to write audit log:', err));
            }
        }

        return product;
    }

    static async delete(id: number, companyId: number, userId?: number) {
        // Check if product has stock or is used in recipes
        const product = await prisma.product.findFirst({
            where: { id, companyId },
            include: {
                stocks: true,
                recipes: true
            }
        });

        if (!product) {
            throw new Error('Product not found');
        }

        if (product.stocks.length > 0) {
            throw new Error('Cannot delete product with existing stock records');
        }

        if (product.recipes.length > 0) {
            throw new Error('Cannot delete product used in recipes');
        }

        const deleted = await prisma.product.delete({
            where: { id },
        });

        if (userId) {
            AuditLogService.log({
                companyId, userId, entityType: 'Product', entityId: id,
                action: 'DELETE', details: { name: product.name, sku: (product as Record<string, unknown>).sku }
            }).catch((err) => console.error('[ProductService] Failed to write audit log:', err));
        }

        return deleted;
    }

    static async getLowStock(companyId: number, branchId?: number, page?: number, limit?: number) {
        try {
            const where: Prisma.ProductWhereInput = {
                active: true,
                companyId
            };

            const products = await prisma.product.findMany({
                where,
                include: {
                    stocks: {
                        where: branchId ? {
                            warehouse: {
                                OR: [{ branchId }, { branchId: null }]
                            }
                        } : undefined,
                        include: {
                            warehouse: {
                                select: {
                                    id: true,
                                    name: true,
                                    branchId: true,
                                    branch: {
                                        select: {
                                            name: true,
                                            code: true
                                        }
                                    }
                                }
                            }
                        }
                    },
                    category: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            });

            // Filter products where total stock is at or below minStock (includes "mínimo alcanzado")
            // Only consider stocks from the specified branch if branchId is provided
            const lowStockProducts = products.filter((product) => {
                const minStock = Number(product.minStock);
                if (minStock <= 0) return false;
                const totalStock = product.stocks.reduce(
                    (sum, stock) => sum + Number(stock.quantity),
                    0
                );
                return totalStock <= minStock;
            });

            // Filtering happens after aggregating stocks, so applying skip/take to
            // the SQL product list first would miss low-stock rows on later pages.
            // Default callers need the complete alert set; explicit pagination is
            // applied only after the physical predicate has been evaluated.
            if (!limit) return lowStockProducts;
            const resolvedPage = page || 1;
            const resolvedLimit = Math.min(limit, 500);
            const skip = (resolvedPage - 1) * resolvedLimit;
            return lowStockProducts.slice(skip, skip + resolvedLimit);
        } catch (error: unknown) {
            console.error('[ProductService.getLowStock] Error:', error);
            throw new Error(`Failed to fetch low stock products: ${getErrorMessage(error)}`);
        }
    }
}
