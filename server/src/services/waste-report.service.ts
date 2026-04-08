import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

/**
 * Waste Report Service
 * Handles tracking and reporting of waste/spoilage
 */
export class WasteReportService {
    /**
     * Record a waste entry
     */
    static async recordWaste(companyId: number, data: {
        warehouseId: number;
        productId: number;
        userId: number;
        quantity: number;
        reason: string;
        notes?: string;
    }) {
        // Wrap in transaction for atomicity
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Check stock availability first
            const stock = await tx.stock.findUnique({
                where: {
                    warehouseId_productId: {
                        warehouseId: data.warehouseId,
                        productId: data.productId
                    }
                }
            });

            if (!stock) {
                throw new Error('No stock record found for this product in the specified warehouse');
            }

            if (Number(stock.quantity) < data.quantity) {
                throw new Error(`Insufficient stock. Available: ${stock.quantity}, Requested: ${data.quantity}`);
            }

            // Create inventory movement for waste
            const movement = await tx.inventoryMovement.create({
                data: {
                    companyId,
                    warehouseId: data.warehouseId,
                    productId: data.productId,
                    userId: data.userId,
                    type: 'OUT',
                    quantity: data.quantity,
                    reason: `WASTE: ${data.reason}`,
                    reference: data.notes
                }
            });

            // Update stock atomically
            await tx.stock.update({
                where: {
                    warehouseId_productId: {
                        warehouseId: data.warehouseId,
                        productId: data.productId
                    }
                },
                data: {
                    quantity: { decrement: data.quantity }
                }
            });

            return movement;
        });
    }

    /**
     * Get waste report for a period
     */
    static async getWasteReport(companyId: number, filters: {
        startDate?: Date;
        endDate?: Date;
        warehouseId?: number;
        productId?: number;
    }) {
        const where: Prisma.InventoryMovementWhereInput = {
            companyId, // Multi-tenant filter
            reason: { startsWith: 'WASTE:' }
        };

        if (filters.warehouseId) {
            where.warehouseId = filters.warehouseId;
        }

        if (filters.productId) {
            where.productId = filters.productId;
        }

        if (filters.startDate || filters.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt.gte = filters.startDate;
            if (filters.endDate) where.createdAt.lte = filters.endDate;
        }

        const movements = await prisma.inventoryMovement.findMany({
            where,
            include: {
                product: { select: { name: true, unit: true, cost: true } },
                warehouse: { select: { name: true } },
                user: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Calculate totals
        const totalUnits = movements.reduce((sum, m) => sum + Number(m.quantity), 0);
        const totalCost = movements.reduce(
            (sum, m) => sum + Number(m.quantity) * Number(m.product?.cost || 0),
            0
        );

        type ReasonAgg = { count: number; quantity: number; cost: number };
        // Group by reason
        const byReason = movements.reduce<Record<string, ReasonAgg>>((acc, m) => {
            const reason = (m.reason ?? '').replace('WASTE: ', '');
            if (!acc[reason]) {
                acc[reason] = { count: 0, quantity: 0, cost: 0 };
            }
            acc[reason].count++;
            acc[reason].quantity += Number(m.quantity);
            acc[reason].cost += Number(m.quantity) * Number(m.product?.cost || 0);
            return acc;
        }, {});

        return {
            summary: {
                totalEntries: movements.length,
                totalUnits,
                totalCost: Math.round(totalCost * 100) / 100
            },
            byReason: Object.entries(byReason).map(([reason, data]) => ({
                reason,
                ...data,
                cost: Math.round(data.cost * 100) / 100
            })),
            details: movements.map((m) => ({
                id: m.id,
                date: m.createdAt,
                product: m.product?.name,
                quantity: Number(m.quantity),
                unit: m.product?.unit,
                cost: Math.round(Number(m.quantity) * Number(m.product?.cost || 0) * 100) / 100,
                reason: (m.reason ?? '').replace('WASTE: ', ''),
                warehouse: m.warehouse?.name,
                user: m.user?.name
            }))
        };
    }

    /**
     * Get common waste reasons
     */
    static getWasteReasons() {
        return [
            'Caducidad',
            'Deterioro',
            'Derrame',
            'Error de preparación',
            'Contaminación',
            'Devolución de cliente',
            'Defecto de producto',
            'Sobre-producción',
            'Otro'
        ];
    }
}
