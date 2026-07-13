import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { InventoryEngineService } from './inventory-engine.service';
import { UnitConversionService } from './unit-conversion.service';

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
        /** Unit of the entered quantity. When omitted, quantity is taken as base. */
        unit?: string;
    }) {
        // Wrap in transaction for atomicity
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Ensure both warehouse and product belong to the caller's company
            // before touching any stock (stock lookup is keyed only by ids).
            const warehouse = await tx.warehouse.findFirst({
                where: { id: data.warehouseId, companyId },
                select: { id: true }
            });
            if (!warehouse) throw new Error('Bodega no encontrada para esta empresa');

            const product = await tx.product.findFirst({
                where: { id: data.productId, companyId },
                select: { id: true, name: true }
            });
            if (!product) throw new Error('Producto no encontrado para esta empresa');

            // Stock and costing live in the base unit. If the caller sent a unit,
            // convert the quantity to base BEFORE costing; otherwise keep the legacy
            // assumption that the quantity is already in the base unit.
            let baseQuantity = data.quantity;
            let originalQuantity: number | null = null;
            let originalUnit: string | null = null;
            let conversionFactor: number | null = null;
            if (data.unit) {
                const conversion = await UnitConversionService.convert(
                    data.productId,
                    companyId,
                    data.quantity,
                    data.unit,
                    tx
                );
                baseQuantity = conversion.baseQuantity;
                originalQuantity = conversion.originalQuantity;
                originalUnit = conversion.originalUnit;
                conversionFactor = conversion.conversionFactor;
            }

            // Stock lock, availability check, costing, FIFO-layer consumption and
            // the OUT movement are handled by the single inventory engine.
            const result = await InventoryEngineService.applyMovement(tx, {
                type: 'OUT',
                companyId,
                warehouseId: data.warehouseId,
                productId: data.productId,
                userId: data.userId,
                quantity: baseQuantity,
                reason: `WASTE: ${data.reason}`,
                reference: data.notes,
                originalQuantity,
                originalUnit,
                conversionFactor,
                productName: product.name
            });

            return await tx.inventoryMovement.findUnique({ where: { id: result.movementId } });
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
        branchId?: number;
    }) {
        const where: Prisma.InventoryMovementWhereInput = {
            companyId, // Multi-tenant filter
            reason: { startsWith: 'WASTE:' }
        };

        if (filters.warehouseId) {
            where.warehouseId = filters.warehouseId;
        } else if (filters.branchId) {
            where.warehouse = { OR: [{ branchId: filters.branchId }, { branchId: null }] };
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
                product: { select: { name: true, unit: true, cost: true, currentAverageCost: true } },
                warehouse: { select: { name: true } },
                user: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Value each waste line at its REAL base-unit cost. Prefer the cost the
        // engine stored on the movement at OUT time; fall back to the product's
        // current average cost and only then to the legacy `cost` field.
        const lineCost = (m: (typeof movements)[number]): number => {
            if (m.totalCost != null) return Number(m.totalCost);
            const unitCost = Number(m.unitCost ?? m.product?.currentAverageCost ?? m.product?.cost ?? 0);
            return Number(m.quantity) * unitCost;
        };

        // Calculate totals
        const totalUnits = movements.reduce((sum, m) => sum + Number(m.quantity), 0);
        const totalCost = movements.reduce((sum, m) => sum + lineCost(m), 0);

        type ReasonAgg = { count: number; quantity: number; cost: number };
        // Group by reason
        const byReason = movements.reduce<Record<string, ReasonAgg>>((acc, m) => {
            const reason = (m.reason ?? '').replace('WASTE: ', '');
            if (!acc[reason]) {
                acc[reason] = { count: 0, quantity: 0, cost: 0 };
            }
            acc[reason].count++;
            acc[reason].quantity += Number(m.quantity);
            acc[reason].cost += lineCost(m);
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
                cost: Math.round(lineCost(m) * 100) / 100,
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
