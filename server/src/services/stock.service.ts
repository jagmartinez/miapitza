import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class StockService {
    static async getAll(companyId: number, filters?: {
        warehouseId?: number;
        branchId?: number;
        productId?: number;
        page?: number;
        limit?: number;
    }) {
        const where: Prisma.StockWhereInput = { companyId };

        if (filters?.warehouseId) {
            where.warehouseId = filters.warehouseId;
        }

        if (filters?.branchId) {
            where.warehouse = {
                branchId: filters.branchId
            };
        }

        if (filters?.productId) {
            where.productId = filters.productId;
        }

        const page = filters?.page || 1;
        const limit = Math.min(filters?.limit || 100, 500);
        const skip = (page - 1) * limit;

        return await prisma.stock.findMany({
            where,
            include: {
                warehouse: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: {
                                name: true
                            }
                        }
                    }
                },
                product: {
                    select: {
                        id: true,
                        name: true,
                        sku: true,
                        unit: true
                    }
                }
            },
            orderBy: {
                quantity: 'desc'
            },
            skip,
            take: limit
        });
    }

    static async getByProduct(productId: number, companyId: number) {
        return await prisma.stock.findMany({
            where: { productId, companyId },
            include: {
                warehouse: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });
    }

    static async getByWarehouse(warehouseId: number, companyId: number) {
        return await prisma.stock.findMany({
            where: { warehouseId, companyId },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        sku: true,
                        unit: true
                    }
                }
            }
        });
    }

}
