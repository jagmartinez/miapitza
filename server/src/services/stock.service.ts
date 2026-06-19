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

            // Lock the Stock row (same FOR UPDATE pattern as order.service) and
            // re-read the locked quantity before the read-modify-write.
            await tx.$queryRaw`SELECT id FROM \`Stock\` WHERE id = ${stock.id} AND companyId = ${companyId} FOR UPDATE`;
            const lockedStock = await tx.stock.findUnique({
                where: { id: stock.id },
                select: { quantity: true }
            });

            let newQuantity = Number(lockedStock?.quantity ?? stock.quantity);
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
