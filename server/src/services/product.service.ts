import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { getErrorMessage } from '../utils/error';

export class ProductService {

    static async getAll(companyId: number, filters?: {
        type?: 'INGREDIENT' | 'PRODUCT_FOR_SALE' | 'BOTH';
        storageType?: 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE';
        categoryId?: number;
        active?: boolean;
        page?: number;
        limit?: number;
    }) {
        const where: Prisma.ProductWhereInput = { companyId };

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

        return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
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

        return product;
    }

    static async generateSku(companyId: number, categoryId: number): Promise<string> {
        const category = await prisma.category.findFirst({
            where: { id: categoryId, companyId }
        });

        if (!category) {
            throw new Error('Categoría no encontrada para generar código');
        }

        const prefix = category.codePrefix || 'GEN';

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
        price?: number;
        type?: 'INGREDIENT' | 'PRODUCT_FOR_SALE' | 'BOTH';
        storageType?: 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE';
    }) {
        if (!data.sku && data.categoryId) {
            data.sku = await this.generateSku(companyId, data.categoryId);
        }

        if (data.sku) {
            const existing = await prisma.product.findFirst({
                where: { sku: data.sku, companyId }
            });

            if (existing) {
                throw new Error('Product with this SKU already exists');
            }
        }

        return await prisma.product.create({
            data: {
                ...data,
                companyId,
                minStock: data.minStock || 0,
                cost: data.cost || 0,
                type: data.type || 'INGREDIENT'
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
        name?: string;
        sku?: string;
        categoryId?: number;
        unit?: string;
        minStock?: number;
        cost?: number;
        price?: number;
        type?: 'INGREDIENT' | 'PRODUCT_FOR_SALE' | 'BOTH';
        storageType?: 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE' | null;
        active?: boolean;
    }) {
        // Check if new SKU already exists in the same company
        if (data.sku) {
            const existing = await prisma.product.findFirst({
                where: {
                    sku: data.sku,
                    companyId,
                    NOT: { id }
                }
            });

            if (existing) {
                throw new Error('Product with this SKU already exists');
            }
        }

        // Verify ownership
        await this.getById(id, companyId);

        return await prisma.product.update({
            where: { id },
            data,
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

    static async delete(id: number, companyId: number) {
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

        return await prisma.product.delete({
            where: { id },
        });
    }

    static async getLowStock(companyId: number, branchId?: number) {
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
                                branchId
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

            // Filter products where total stock is below minStock
            // Only consider stocks from the specified branch if branchId is provided
            const lowStockProducts = products.filter((product) => {
                const totalStock = product.stocks.reduce(
                    (sum, stock) => sum + Number(stock.quantity),
                    0
                );
                return totalStock < Number(product.minStock);
            });

            return lowStockProducts;
        } catch (error: unknown) {
            console.error('[ProductService.getLowStock] Error:', error);
            throw new Error(`Failed to fetch low stock products: ${getErrorMessage(error)}`);
        }
    }
}
