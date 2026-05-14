import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';

export class InventoryMovementService {
    static async getAll(companyId: number, filters?: {
        warehouseId?: number;
        branchId?: number;
        productId?: number;
        type?: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
        startDate?: Date;
        endDate?: Date;
    }) {
        const where: Prisma.InventoryMovementWhereInput = { companyId };

        if (filters?.branchId) {
            where.warehouse = {
                branchId: filters.branchId
            };
        }

        if (filters?.warehouseId) {
            where.warehouseId = filters.warehouseId;
        }

        if (filters?.productId) {
            where.productId = filters.productId;
        }

        if (filters?.type) {
            where.type = filters.type;
        }

        if (filters?.startDate || filters?.endDate) {
            where.createdAt = {};
            if (filters.startDate) {
                where.createdAt.gte = filters.startDate;
            }
            if (filters.endDate) {
                where.createdAt.lte = filters.endDate;
            }
        }

        return await prisma.inventoryMovement.findMany({
            where,
            include: {
                warehouse: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        type: true,
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
                },
                user: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const movement = await prisma.inventoryMovement.findFirst({
            where: { id, companyId },
            include: {
                warehouse: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        type: true,
                        branch: {
                            select: {
                                id: true,
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
                        unit: true,
                        cost: true
                    }
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });

        if (!movement) {
            throw new Error('Movement not found');
        }

        return movement;
    }

    static async create(companyId: number, data: {
        warehouseId: number;
        productId: number;
        userId: number;
        type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
        quantity: number;
        reason?: string;
        reference?: string;
        unit?: string;
    }) {
        // Verify warehouse belongs to company
        const warehouse = await prisma.warehouse.findFirst({
            where: { id: data.warehouseId, companyId }
        });

        if (!warehouse) {
            throw new Error('Warehouse not found or unauthorized');
        }

        // Verify product belongs to company
        const product = await prisma.product.findFirst({
            where: { id: data.productId, companyId }
        });

        if (!product) {
            throw new Error('Product not found or unauthorized');
        }

        // Validate quantity
        if (data.quantity <= 0) {
            throw new Error('Quantity must be greater than 0');
        }

        // Convert unit if specified
        let baseQuantity = data.quantity;
        let originalQuantity: number | null = null;
        let originalUnit: string | null = null;
        let conversionFactor: number | null = null;

        if (data.unit) {
            const conv = await UnitConversionService.convert(
                data.productId, companyId, data.quantity, data.unit
            );
            baseQuantity = conv.baseQuantity;
            originalQuantity = conv.originalQuantity;
            originalUnit = conv.originalUnit;
            conversionFactor = conv.conversionFactor;
        }

        // Start transaction
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Get or create stock record
            let stock = await tx.stock.findUnique({
                where: {
                    warehouseId_productId: {
                        warehouseId: data.warehouseId,
                        productId: data.productId
                    }
                }
            });

            if (!stock) {
                stock = await tx.stock.create({
                    data: {
                        warehouseId: data.warehouseId,
                        productId: data.productId,
                        companyId,
                        quantity: 0
                    }
                });
            }

            // Calculate new quantity based on movement type (using base-unit quantity)
            const currentQuantity = Number(stock.quantity);
            let newQuantity = currentQuantity;

            if (data.type === 'IN') {
                newQuantity += baseQuantity;
            } else if (data.type === 'ADJUSTMENT') {
                newQuantity += baseQuantity;
                if (newQuantity < 0) {
                    throw new Error('Adjustment would result in negative stock');
                }
            } else if (data.type === 'OUT' || data.type === 'TRANSFER') {
                newQuantity -= baseQuantity;

                if (newQuantity < 0) {
                    throw new Error('Insufficient stock for this operation');
                }
            }

            // Update stock
            await tx.stock.update({
                where: {
                    warehouseId_productId: {
                        warehouseId: data.warehouseId,
                        productId: data.productId
                    }
                },
                data: {
                    quantity: newQuantity
                }
            });

            const unitCost = Number(product.currentAverageCost || product.cost || 0);
            const totalCost = baseQuantity * unitCost;

            const currentBalanceCost = currentQuantity * unitCost;
            let newBalanceCost = currentBalanceCost;

            if (data.type === 'IN' || data.type === 'ADJUSTMENT') {
                newBalanceCost = currentBalanceCost + totalCost;
            } else {
                newBalanceCost = currentBalanceCost - totalCost;
            }

            const movement = await tx.inventoryMovement.create({
                data: {
                    warehouseId: data.warehouseId,
                    productId: data.productId,
                    userId: data.userId,
                    type: data.type,
                    quantity: baseQuantity,
                    reason: data.reason,
                    reference: data.reference,
                    originalQuantity,
                    originalUnit,
                    conversionFactor,
                    companyId,
                    unitCost,
                    totalCost,
                    balanceQty: newQuantity,
                    balanceCost: newBalanceCost
                },
                include: {
                    warehouse: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    product: {
                        select: {
                            id: true,
                            name: true,
                            unit: true
                        }
                    },
                    user: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            });

            return movement;
        });
    }

    static async delete(_id: number) {
        // Generally, inventory movements should not be deleted
        // but marked as cancelled or reversed
        throw new Error('Inventory movements cannot be deleted. Create a reversal movement instead.');
    }

    // Get kardex (movement history) for a product
    static async getKardex(productId: number, companyId: number, warehouseId?: number, branchId?: number) {
        const where: Prisma.InventoryMovementWhereInput = { productId, companyId };

        if (branchId) {
            where.warehouse = {
                branchId: branchId
            };
        }

        if (warehouseId) {
            where.warehouseId = warehouseId;
        }

        return await prisma.inventoryMovement.findMany({
            where,
            include: {
                warehouse: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                user: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
    }

    // Transfer between warehouses with unit conversion support
    static async transfer(companyId: number, data: {
        fromWarehouseId: number;
        toWarehouseId: number;
        productId: number;
        userId: number;
        quantity: number;
        reference?: string;
        unit?: string;
    }) {
        if (data.fromWarehouseId === data.toWarehouseId) {
            throw new Error('Cannot transfer to the same warehouse');
        }

        if (data.quantity <= 0) {
            throw new Error('Transfer quantity must be positive');
        }

        // Convert unit before transaction
        let baseQuantity = data.quantity;
        let originalQuantity: number | null = null;
        let originalUnit: string | null = null;
        let convFactor: number | null = null;

        if (data.unit) {
            const conv = await UnitConversionService.convert(
                data.productId, companyId, data.quantity, data.unit
            );
            baseQuantity = conv.baseQuantity;
            originalQuantity = conv.originalQuantity;
            originalUnit = conv.originalUnit;
            convFactor = conv.conversionFactor;
        }

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const transferGroupId = `TRF-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

            const product = await tx.product.findFirst({
                where: { id: data.productId, companyId }
            });
            if (!product) throw new Error('Product not found or unauthorized');

            const unitCost = Number(product.currentAverageCost || product.cost || 0);
            const totalCost = baseQuantity * unitCost;

            // --- OUT from source warehouse ---
            const sourceStock = await tx.stock.findUnique({
                where: { warehouseId_productId: { warehouseId: data.fromWarehouseId, productId: data.productId } }
            });
            if (!sourceStock) throw new Error('No stock in source warehouse');

            const sourceNewQty = Number(sourceStock.quantity) - baseQuantity;
            if (sourceNewQty < 0) throw new Error('Insufficient stock in source warehouse for transfer');

            await tx.stock.update({
                where: { warehouseId_productId: { warehouseId: data.fromWarehouseId, productId: data.productId } },
                data: { quantity: sourceNewQty }
            });

            await tx.inventoryMovement.create({
                data: {
                    companyId,
                    warehouseId: data.fromWarehouseId,
                    productId: data.productId,
                    userId: data.userId,
                    type: 'TRANSFER',
                    transferGroupId,
                    quantity: baseQuantity,
                    originalQuantity,
                    originalUnit,
                    conversionFactor: convFactor,
                    reason: `Transfer out to warehouse ${data.toWarehouseId}`,
                    reference: data.reference || null,
                    unitCost,
                    totalCost,
                    balanceQty: sourceNewQty,
                    balanceCost: sourceNewQty * unitCost
                }
            });

            // --- IN to destination warehouse ---
            let destStock = await tx.stock.findUnique({
                where: { warehouseId_productId: { warehouseId: data.toWarehouseId, productId: data.productId } }
            });
            if (!destStock) {
                destStock = await tx.stock.create({
                    data: { warehouseId: data.toWarehouseId, productId: data.productId, companyId, quantity: 0 }
                });
            }

            const destNewQty = Number(destStock.quantity) + baseQuantity;

            await tx.stock.update({
                where: { warehouseId_productId: { warehouseId: data.toWarehouseId, productId: data.productId } },
                data: { quantity: destNewQty }
            });

            await tx.inventoryMovement.create({
                data: {
                    companyId,
                    warehouseId: data.toWarehouseId,
                    productId: data.productId,
                    userId: data.userId,
                    type: 'TRANSFER',
                    transferGroupId,
                    quantity: baseQuantity,
                    originalQuantity,
                    originalUnit,
                    conversionFactor: convFactor,
                    reason: `Transfer in from warehouse ${data.fromWarehouseId}`,
                    reference: data.reference || null,
                    unitCost,
                    totalCost,
                    balanceQty: destNewQty,
                    balanceCost: destNewQty * unitCost
                }
            });

            return { success: true, transferGroupId };
        });
    }
}
