import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { AuditLogService } from './audit-log.service';
import { InventoryEngineService } from './inventory-engine.service';

export class InventoryMovementService {
    static async getAll(companyId: number, filters?: {
        warehouseId?: number;
        branchId?: number;
        productId?: number;
        type?: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
        startDate?: Date;
        endDate?: Date;
        page?: number;
        limit?: number;
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

        const page = filters?.page || 1;
        const limit = Math.min(filters?.limit || 100, 500);
        const skip = (page - 1) * limit;

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
            },
            skip,
            take: limit
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
        // D11: optional entry cost (per original/purchase unit) for manual IN /
        // positive ADJUSTMENT movements so they can be valued correctly. Optional
        // to preserve backward compatibility with existing callers.
        unitCost?: number;
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

        // A single-warehouse movement cannot be a TRANSFER: that would only
        // subtract from the source and never credit the destination, leaving
        // inventory inconsistent. Transfers must go through transfer().
        if (data.type === 'TRANSFER') {
            throw new Error('Las transferencias deben realizarse mediante la operación de traslado entre bodegas');
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

        // D11: convert a caller-supplied IN/ADJUSTMENT entry cost (per original
        // unit) to base unit before handing it to the engine.
        const baseUnitCost = (data.unitCost != null)
            ? (conversionFactor && conversionFactor > 0 ? data.unitCost / conversionFactor : data.unitCost)
            : undefined;

        // Start transaction. All stock/movement/FIFO-batch mutations go through the
        // single inventory engine, preserving the WEIGHTED_AVERAGE valuation while
        // adding real FIFO layers.
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const result = await InventoryEngineService.applyMovement(tx, {
                type: data.type,
                companyId,
                warehouseId: data.warehouseId,
                productId: data.productId,
                userId: data.userId,
                quantity: baseQuantity,
                unitCost: baseUnitCost,
                reason: data.reason,
                reference: data.reference,
                originalQuantity,
                originalUnit,
                conversionFactor,
                // IN / ADJUSTMENT open a manual-adjustment FIFO layer.
                sourceType: 'ADJUSTMENT'
            });

            AuditLogService.log({
                companyId, userId: data.userId,
                entityType: 'InventoryMovement', entityId: result.movementId,
                action: 'CREATE',
                details: { type: data.type, productId: data.productId, warehouseId: data.warehouseId, quantity: baseQuantity, reason: data.reason }
            }).catch((err) => console.error('[InventoryMovementService] Failed to write audit log:', err));

            // Re-read with the same includes callers expect.
            return await tx.inventoryMovement.findUnique({
                where: { id: result.movementId },
                include: {
                    warehouse: { select: { id: true, name: true } },
                    product: { select: { id: true, name: true, unit: true } },
                    user: { select: { id: true, name: true } }
                }
            });
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

        // Verify both warehouses belong to this company
        const warehouses = await prisma.warehouse.findMany({
            where: { id: { in: [data.fromWarehouseId, data.toWarehouseId] }, companyId },
            select: { id: true }
        });

        if (warehouses.length !== 2) {
            throw new Error('Warehouse not found or unauthorized');
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

            // --- OUT from source warehouse (TRANSFER, outbound leg) ---
            // Let the engine derive the actual outbound valuation: moving average
            // for WEIGHTED_AVERAGE, consumed-layer COGS for FIFO.
            const outbound = await InventoryEngineService.applyMovement(tx, {
                type: 'TRANSFER',
                direction: 'OUT',
                companyId,
                warehouseId: data.fromWarehouseId,
                productId: data.productId,
                userId: data.userId,
                quantity: baseQuantity,
                originalQuantity,
                originalUnit,
                conversionFactor: convFactor,
                reason: `Transfer out to warehouse ${data.toWarehouseId}`,
                reference: data.reference || undefined,
                transferGroupId,
                productName: product.name
            });

            // --- IN to destination warehouse (TRANSFER, inbound leg) ---
            await InventoryEngineService.applyMovement(tx, {
                type: 'TRANSFER',
                direction: 'IN',
                companyId,
                warehouseId: data.toWarehouseId,
                productId: data.productId,
                userId: data.userId,
                quantity: baseQuantity,
                // Preserve value across warehouses. For FIFO this is the weighted
                // cost of the exact layers consumed by the outbound leg.
                unitCost: outbound.unitCost,
                inboundLayers: outbound.consumedLayers,
                originalQuantity,
                originalUnit,
                conversionFactor: convFactor,
                reason: `Transfer in from warehouse ${data.fromWarehouseId}`,
                reference: data.reference || undefined,
                transferGroupId,
                sourceType: 'TRANSFER'
            });

            return { success: true, transferGroupId };
        });
    }
}
