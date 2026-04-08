import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class StockService {
    static async getAll(companyId: number, filters?: {
        warehouseId?: number;
        branchId?: number;
        productId?: number;
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
            }
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

    static async updateStock(companyId: number, warehouseId: number, productId: number, quantity: number, type: 'IN' | 'OUT' | 'ADJUSTMENT') {
        // This should normally be done via InventoryMovementService
        // but adding it here for direct operations if needed
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            let stock = await tx.stock.findUnique({
                where: {
                    warehouseId_productId: {
                        warehouseId,
                        productId
                    }
                }
            });

            if (!stock) {
                stock = await tx.stock.create({
                    data: {
                        warehouseId,
                        productId,
                        companyId,
                        quantity: 0
                    }
                });
            }

            let newQuantity = Number(stock.quantity);
            if (type === 'IN') {
                newQuantity += quantity;
            } else if (type === 'ADJUSTMENT') {
                // ADJUSTMENT: positive adds, negative subtracts
                newQuantity += quantity; // quantity can be negative
            } else {
                // OUT
                newQuantity -= quantity;
            }

            if (newQuantity < 0) {
                throw new Error(`Insufficient stock. Available: ${stock.quantity}, Requested: ${quantity}`);
            }

            return await tx.stock.update({
                where: {
                    warehouseId_productId: {
                        warehouseId,
                        productId
                    }
                },
                data: {
                    quantity: newQuantity
                }
            });
        });
    }
}
