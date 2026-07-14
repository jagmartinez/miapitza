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
        if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
            throw new Error('La cantidad de merma debe ser un número finito mayor a 0');
        }
        if (!data.reason?.trim()) {
            throw new Error('El motivo de la merma es requerido');
        }

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
                select: {
                    id: true,
                    name: true,
                    unit: true,
                    baseUnit: { select: { abbreviation: true } }
                }
            });
            if (!product) throw new Error('Producto no encontrado para esta empresa');

            // Stock and costing live in the base unit. If the caller sent a unit,
            // convert the quantity to base BEFORE costing; otherwise keep the legacy
            // assumption that the quantity is already in the base unit.
            const effectiveUnit = data.unit || product.baseUnit?.abbreviation || product.unit;
            const conversion = await UnitConversionService.convert(
                data.productId,
                companyId,
                data.quantity,
                effectiveUnit,
                tx
            );
            const baseQuantity = conversion.baseQuantity;
            const originalQuantity = conversion.originalQuantity;
            const originalUnit = conversion.originalUnit;
            const conversionFactor = conversion.conversionFactor;

            // Stock lock, availability check, costing, FIFO-layer consumption and
            // the OUT movement are handled by the single inventory engine.
            const result = await InventoryEngineService.applyMovement(tx, {
                type: 'OUT',
                companyId,
                warehouseId: data.warehouseId,
                productId: data.productId,
                userId: data.userId,
                quantity: baseQuantity,
                reason: `WASTE: ${data.reason.trim()}`,
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
                product: {
                    select: {
                        name: true,
                        unit: true,
                        cost: true,
                        currentAverageCost: true,
                        baseUnit: { select: { abbreviation: true } }
                    }
                },
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

        const movementUnit = (m: (typeof movements)[number]): string =>
            m.product?.baseUnit?.abbreviation || m.product?.unit || '';
        const movementReason = (m: (typeof movements)[number]): string =>
            (m.reason ?? '').replace(/^WASTE:\s*/, '');

        // Quantities of different dimensions are never added together.  A report
        // containing 2 kg and 3 L must expose two physical totals, not "5 units".
        const quantityByUnitMap = new Map<string, number>();
        for (const movement of movements) {
            const unit = movementUnit(movement);
            quantityByUnitMap.set(unit, (quantityByUnitMap.get(unit) || 0) + Number(movement.quantity));
        }
        const quantities = Array.from(quantityByUnitMap, ([unit, quantity]) => ({ unit, quantity }));
        const totalCost = movements.reduce((sum, m) => sum + lineCost(m), 0);

        type ReasonAgg = { reason: string; unit: string; count: number; quantity: number; cost: number };
        // Group by reason AND physical unit. This keeps every subtotal meaningful.
        const byReasonMap = movements.reduce<Map<string, ReasonAgg>>((acc, m) => {
            const reason = movementReason(m);
            const unit = movementUnit(m);
            const key = `${reason}\u0000${unit}`;
            if (!acc.has(key)) {
                acc.set(key, { reason, unit, count: 0, quantity: 0, cost: 0 });
            }
            const row = acc.get(key)!;
            row.count++;
            row.quantity += Number(m.quantity);
            row.cost += lineCost(m);
            return acc;
        }, new Map<string, ReasonAgg>());

        return {
            summary: {
                totalEntries: movements.length,
                quantities,
                totalCost: Math.round(totalCost * 100) / 100
            },
            byReason: Array.from(byReasonMap.values()).map((data) => ({
                ...data,
                cost: Math.round(data.cost * 100) / 100
            })),
            details: movements.map((m) => ({
                id: m.id,
                date: m.createdAt,
                product: m.product?.name,
                quantity: Number(m.quantity),
                unit: movementUnit(m),
                cost: Math.round(lineCost(m) * 100) / 100,
                reason: movementReason(m),
                reference: m.reference,
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
