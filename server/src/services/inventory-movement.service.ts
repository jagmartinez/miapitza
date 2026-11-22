import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { AuditLogService } from './audit-log.service';
import { InventoryEngineService, COST_TRUE_UP_ORIGIN } from './inventory-engine.service';
import { CostingService } from './costing.service';
import { planSaleReturnFromSlices } from './inventory-consumption.service';
import { resolveEffectiveUnitCost } from '../utils/product-cost';

/**
 * `DSLICE-<id>` is the internal sourceRef of layers created when a sale returns
 * units that had covered a deficit; a manual reference must never mimic it
 * (layers take their sourceRef from the movement reference).
 */
function assertManualReferenceAllowed(reference?: string | null): void {
    if (typeof reference === 'string' && /^\s*DSLICE-/i.test(reference)) {
        throw new Error('La referencia "DSLICE-…" está reservada para el sistema; use otra referencia');
    }
}

/** A surplus adjustment needs a known cost; `productName` lets callers report which product lacks one. */
export class ProductCostMissingError extends Error {
    constructor(readonly productName: string) {
        super(
            `PRODUCT_COST_MISSING: "${productName}" no tiene costo promedio ni último costo de compra; ` +
            'registre una entrada valorizada antes de ajustar el conteo al alza'
        );
        this.name = 'ProductCostMissingError';
    }
}

export class InventoryMovementService {
    private static movementDirection(movement: { type: string; direction?: string | null; reason?: string | null }): 'IN' | 'OUT' {
        if (movement.direction === 'IN' || movement.direction === 'OUT') return movement.direction;
        if (movement.type === 'IN' || movement.type === 'ADJUSTMENT') return 'IN';
        if (movement.type === 'OUT') return 'OUT';
        return (movement.reason || '').toLowerCase().startsWith('transfer in') ? 'IN' : 'OUT';
    }

    /**
     * Units of an inbound that covered a negative balance (trimmed by the
     * engine, so no layer of its own holds them): min(qty, -balance before).
     */
    private static coveredDeficitQuantity(movement: { quantity: unknown; balanceQty?: unknown }): number {
        const quantity = Number(movement.quantity);
        if (movement.balanceQty == null || !(quantity > 0)) return 0;
        const balanceAfter = Number(movement.balanceQty);
        if (!Number.isFinite(balanceAfter)) return 0;
        const shortfall = Math.min(quantity, Math.max(0, quantity - balanceAfter));
        return shortfall > 1e-9 ? Math.round(shortfall * 1e9) / 1e9 : 0;
    }

    private static consumedLayers(value: Prisma.JsonValue | null): Array<{
        quantity: number;
        unitCost: number;
        sourceRef?: string | null;
        sourceType?: 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT' | 'TRANSFER' | 'OPENING';
        createdAt?: Date;
    }> | undefined {
        if (value == null) {
            throw new Error('REVERSAL_PROVENANCE_MISSING: el movimiento no conserva sus capas de costo consumidas');
        }
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error('REVERSAL_PROVENANCE_MISSING: las capas consumidas no tienen un formato válido');
        }
        return value.map((raw) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new Error('REVERSAL_PROVENANCE_MISSING: existe una capa consumida inválida');
            }
            const layer = raw as Record<string, Prisma.JsonValue>;
            const quantity = Number(layer.quantity);
            const unitCost = Number(layer.unitCost);
            if (!(quantity > 0) || !Number.isFinite(unitCost) || unitCost < 0) {
                throw new Error('REVERSAL_PROVENANCE_MISSING: cantidad o costo de capa inválido');
            }
            const sourceType = typeof layer.sourceType === 'string'
                && ['PURCHASE', 'PRODUCTION', 'ADJUSTMENT', 'TRANSFER', 'OPENING'].includes(layer.sourceType)
                ? layer.sourceType as 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT' | 'TRANSFER' | 'OPENING'
                : undefined;
            const parsedCreatedAt = typeof layer.createdAt === 'string' ? new Date(layer.createdAt) : undefined;
            return {
                quantity,
                unitCost,
                sourceRef: typeof layer.sourceRef === 'string' ? layer.sourceRef : null,
                sourceType,
                ...(parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime()) ? { createdAt: parsedCreatedAt } : {})
            };
        });
    }

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
                OR: [{ branchId: filters.branchId }, { branchId: null }]
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
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        assertManualReferenceAllowed(data.reference);
        // Verify warehouse belongs to company
        const warehouse = await prisma.warehouse.findFirst({
            where: { id: data.warehouseId, companyId }
        });

        if (!warehouse) {
            throw new Error('Warehouse not found or unauthorized');
        }

        // Verify product belongs to company
        const product = await prisma.product.findFirst({
            where: { id: data.productId, companyId },
            include: { baseUnit: { select: { abbreviation: true } } }
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
        if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
            throw new Error('Quantity must be greater than 0');
        }
        const reason = data.reason?.trim();
        if (!reason) throw new Error('El motivo del movimiento es requerido');
        if (data.type === 'OUT' && data.unitCost != null) {
            throw new Error('El costo de una salida lo determina el método de costeo; no puede enviarse manualmente');
        }

        // Omission means the explicit product base/legacy unit, not an untracked
        // raw quantity. Every movement therefore persists originalUnit + factor.
        const effectiveUnit = data.unit || product.baseUnit?.abbreviation || product.unit;
        const conv = await UnitConversionService.convert(
            data.productId, companyId, data.quantity, effectiveUnit
        );
        const baseQuantity = conv.baseQuantity;
        const originalQuantity = conv.originalQuantity;
        const originalUnit = conv.originalUnit;
        const conversionFactor = conv.conversionFactor;

        // D11: convert a caller-supplied IN/ADJUSTMENT entry cost (per original
        // unit) to base unit before handing it to the engine.
        const baseUnitCost = (data.unitCost != null)
            ? (conversionFactor && conversionFactor > 0 ? data.unitCost / conversionFactor : data.unitCost)
            : undefined;

        // Start transaction. All stock/movement/FIFO-batch mutations go through the
        // single inventory engine, preserving the WEIGHTED_AVERAGE valuation while
        // adding real FIFO layers.
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            let previousGlobalStock: number | null = null;
            if (data.type === 'IN' || data.type === 'ADJUSTMENT') {
                // Canonical lock order Warehouse -> Product -> Stock before the
                // global-stock snapshot (the engine re-lock is then a no-op).
                await InventoryEngineService.lockInventoryScope(tx, companyId, [data.warehouseId], [data.productId]);
                const global = await tx.stock.aggregate({
                    where: { productId: data.productId, companyId },
                    _sum: { quantity: true }
                });
                previousGlobalStock = Number(global._sum.quantity ?? 0);
            }
            const result = await InventoryEngineService.applyMovement(tx, {
                type: data.type,
                companyId,
                warehouseId: data.warehouseId,
                productId: data.productId,
                userId: data.userId,
                quantity: baseQuantity,
                unitCost: baseUnitCost,
                reason,
                reference: data.reference,
                originalQuantity,
                originalUnit,
                conversionFactor,
                // IN / ADJUSTMENT open a manual-adjustment FIFO layer.
                sourceType: 'ADJUSTMENT',
                origin: 'MANUAL'
            });

            // A valued manual inbound changes the company-wide moving average just
            // like any other inventory entry. Without this, the movement/batch was
            // valued at the caller's cost but every later WA outflow used the stale
            // Product.currentAverageCost.
            if (previousGlobalStock != null) {
                await CostingService.applyProductionCost(
                    tx,
                    data.productId,
                    companyId,
                    baseQuantity,
                    result.unitCost,
                    previousGlobalStock,
                    undefined,
                    result.movementId
                );
            }

            await AuditLogService.log({
                companyId, userId: data.userId,
                entityType: 'InventoryMovement', entityId: result.movementId,
                action: 'CREATE',
                details: { type: data.type, productId: data.productId, warehouseId: data.warehouseId, quantity: baseQuantity, reason }
            }, tx);

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

    /**
     * Posts one count adjustment inside a transaction whose Warehouse -> Product
     * locks the CALLER already holds (it takes none). Shared by the single
     * physical count and the blind-count sheet approval:
     *   - |delta| <= 1e-9: no movement, the count is still audited;
     *   - delta < 0: ADJUSTMENT/OUT valued by the engine;
     *   - delta > 0: ADJUSTMENT/IN at the current average cost (fallback: last
     *     purchase cost), folded into the moving average.
     * `audit` is stored as the AuditLog details with `movementId` appended.
     */
    static async postCountAdjustmentTx(tx: Prisma.TransactionClient, companyId: number, input: {
        warehouseId: number;
        productId: number;
        userId: number;
        productName: string;
        deltaBase: number;
        reason: string;
        reference?: string;
        originalUnit: string;
        conversionFactor: number;
        audit: Record<string, unknown>;
        /** AuditLog entityId when no movement is posted (defaults to the product id). */
        auditEntityFallbackId?: number;
    }): Promise<{ movementId: number | null; direction: 'IN' | 'OUT' | null; unitCost: number | null }> {
        const delta = input.deltaBase;
        const factor = input.conversionFactor > 0 ? input.conversionFactor : 1;
        let movementId: number | null = null;
        let direction: 'IN' | 'OUT' | null = null;
        let postedUnitCost: number | null = null;
        if (Math.abs(delta) > 1e-9) {
            direction = delta > 0 ? 'IN' : 'OUT';
            const quantity = Math.abs(delta);
            let unitCost: number | undefined;
            let previousGlobalStock: number | null = null;
            if (direction === 'IN') {
                const locked = await tx.product.findFirst({
                    where: { id: input.productId, companyId },
                    select: {
                        currentAverageCost: true, averageCostKnown: true,
                        cost: true, referenceCostKnown: true,
                        lastPurchaseCost: true, lastPurchaseCostKnown: true
                    }
                });
                const current = resolveEffectiveUnitCost(locked?.currentAverageCost, locked?.cost, {
                    averageCostKnown: locked?.averageCostKnown,
                    referenceCostKnown: locked?.referenceCostKnown
                });
                const lastCost = Number(locked?.lastPurchaseCost);
                if (current.known) {
                    unitCost = current.value;
                } else if (locked?.lastPurchaseCostKnown || (Number.isFinite(lastCost) && lastCost > 0)) {
                    unitCost = Number.isFinite(lastCost) && lastCost >= 0 ? lastCost : undefined;
                }
                if (unitCost == null) throw new ProductCostMissingError(input.productName);
                const global = await tx.stock.aggregate({
                    where: { productId: input.productId, companyId },
                    _sum: { quantity: true }
                });
                previousGlobalStock = Number(global._sum.quantity ?? 0);
            }
            const result = await InventoryEngineService.applyMovement(tx, {
                type: 'ADJUSTMENT',
                direction,
                companyId,
                warehouseId: input.warehouseId,
                productId: input.productId,
                userId: input.userId,
                quantity,
                unitCost,
                reason: input.reason,
                reference: input.reference,
                originalQuantity: quantity / factor,
                originalUnit: input.originalUnit,
                conversionFactor: factor,
                sourceType: 'ADJUSTMENT',
                origin: 'MANUAL',
                productName: input.productName
            });
            movementId = result.movementId;
            postedUnitCost = result.unitCost;
            if (previousGlobalStock != null) {
                await CostingService.applyProductionCost(
                    tx, input.productId, companyId, quantity, result.unitCost,
                    previousGlobalStock, undefined, result.movementId
                );
            }
        }

        await AuditLogService.log({
            companyId, userId: input.userId,
            entityType: 'InventoryCount',
            entityId: movementId ?? input.auditEntityFallbackId ?? input.productId,
            action: 'UPDATE',
            details: { ...input.audit, movementId }
        }, tx);

        return { movementId, direction, unitCost: postedUnitCost };
    }

    /**
     * Physical count (D10). The user enters the COUNTED quantity (in any
     * configured unit); the server converts it to base, reads the current stock
     * under the canonical Warehouse -> Product lock and posts the difference:
     *   - counted < stock: ADJUSTMENT/OUT valued by the engine (FIFO layers or
     *     the moving average), i.e. at current cost;
     *   - counted > stock: ADJUSTMENT/IN at the current average cost, falling
     *     back to the last purchase cost, folded into the moving average;
     *   - equal: no movement, the count is still audited.
     */
    static async physicalCount(companyId: number, data: {
        warehouseId: number;
        productId: number;
        userId: number;
        countedQuantity: number;
        unit?: string;
        reason: string;
        reference?: string;
    }) {
        assertManualReferenceAllowed(data.reference);
        const counted = Number(data.countedQuantity);
        if (!Number.isFinite(counted) || counted < 0) {
            throw new Error('La cantidad contada debe ser un número finito mayor o igual a 0');
        }
        const reason = data.reason?.trim();
        if (!reason) throw new Error('El motivo del conteo físico es requerido');

        const warehouse = await prisma.warehouse.findFirst({
            where: { id: data.warehouseId, companyId },
            select: { id: true }
        });
        if (!warehouse) throw new Error('Warehouse not found or unauthorized');
        const product = await prisma.product.findFirst({
            where: { id: data.productId, companyId },
            include: { baseUnit: { select: { abbreviation: true } } }
        });
        if (!product) throw new Error('Product not found or unauthorized');

        const effectiveUnit = data.unit || product.baseUnit?.abbreviation || product.unit;
        // convert() requires a positive quantity; a count of 0 is 0 in any unit
        // but the unit must still be valid for the product.
        const conv = await UnitConversionService.convert(
            data.productId, companyId, counted > 0 ? counted : 1, effectiveUnit
        );
        const countedBase = counted > 0 ? conv.baseQuantity : 0;
        const factor = conv.conversionFactor > 0 ? conv.conversionFactor : 1;

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Product FOR UPDATE serializes every stock writer of this product, so
            // the stock read below cannot change before the engine posts the delta.
            await InventoryEngineService.lockInventoryScope(tx, companyId, [data.warehouseId], [data.productId]);
            const stock = await tx.stock.findUnique({
                where: { warehouseId_productId: { warehouseId: data.warehouseId, productId: data.productId } },
                select: { id: true, quantity: true }
            });
            const previousQuantity = Number(stock?.quantity ?? 0);
            const delta = countedBase - previousQuantity;
            const countReason = `Conteo físico: ${reason}`;

            const { movementId, direction } = await InventoryMovementService.postCountAdjustmentTx(tx, companyId, {
                warehouseId: data.warehouseId,
                productId: data.productId,
                userId: data.userId,
                productName: product.name,
                deltaBase: delta,
                reason: countReason,
                reference: data.reference,
                originalUnit: conv.originalUnit,
                conversionFactor: factor,
                auditEntityFallbackId: stock?.id,
                audit: {
                    kind: 'PHYSICAL_COUNT',
                    productId: data.productId,
                    warehouseId: data.warehouseId,
                    countedQuantity: counted,
                    countedUnit: conv.originalUnit,
                    countedBaseQuantity: countedBase,
                    previousQuantity,
                    delta,
                    reason
                }
            });

            return {
                adjusted: movementId != null,
                movementId,
                direction,
                previousQuantity,
                countedQuantity: countedBase,
                delta
            };
        });
    }

    static async delete(_id: number) {
        // Generally, inventory movements should not be deleted
        // but marked as cancelled or reversed
        throw new Error('Inventory movements cannot be deleted. Create a reversal movement instead.');
    }

    /**
     * Immutable counterflow for MANUAL, WASTE and TRANSFER movements only.
     * Domain-owned POS/purchase/production rows must use their own counterflow.
     */
    static async reverse(companyId: number, movementId: number, data: {
        userId: number;
        reason: string;
        reversalKey: string;
        /** Undefined means tenant-wide; otherwise own branch plus CENTRAL only. */
        branchId?: number;
    }) {
        const reason = data.reason?.trim();
        const reversalKey = data.reversalKey?.trim();
        if (!reason || reason.length < 5 || reason.length > 500) {
            throw new Error('El motivo de reversa debe tener entre 5 y 500 caracteres');
        }
        if (!reversalKey || reversalKey.length < 8 || reversalKey.length > 191) {
            throw new Error('X-Idempotency-Key es requerido y debe tener entre 8 y 191 caracteres');
        }
        if (!Number.isInteger(movementId) || movementId <= 0) {
            throw new Error('Movimiento inválido');
        }

        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const selected = await tx.inventoryMovement.findFirst({
                where: { id: movementId, companyId },
                select: { id: true, transferGroupId: true }
            });
            if (!selected) throw new Error('Movimiento no encontrado para esta empresa');

            // Legacy COST_TRUE_UP rows inherited the transferGroupId of the
            // inbound leg that posted them; they are not transfer legs.
            const groupWhere: Prisma.InventoryMovementWhereInput = selected.transferGroupId
                ? {
                    companyId,
                    transferGroupId: selected.transferGroupId,
                    OR: [{ origin: null }, { origin: { not: COST_TRUE_UP_ORIGIN } }]
                }
                : { companyId, id: selected.id };
            const ids = (await tx.inventoryMovement.findMany({
                where: groupWhere,
                select: { id: true },
                orderBy: { id: 'asc' }
            })).map((row) => row.id);
            if (ids.length === 0) throw new Error('Movimiento no encontrado para esta empresa');

            await tx.$queryRaw`SELECT id FROM \`InventoryMovement\` WHERE companyId = ${companyId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
            const originals = await tx.inventoryMovement.findMany({
                where: { companyId, id: { in: ids } },
                include: { warehouse: { select: { branchId: true } } },
                orderBy: { id: 'asc' }
            });
            if (originals.length !== ids.length) throw new Error('El grupo de movimiento cambió durante la reversa');

            for (const original of originals) {
                if (original.reversalOfId != null || original.origin === 'REVERSAL') {
                    throw new Error('Una reversa no puede volver a reversarse desde este flujo');
                }
                const reversibleOrigin = original.origin
                    || (original.type === 'TRANSFER' && original.transferGroupId ? 'TRANSFER' : null)
                    || ((original.reason || '').startsWith('WASTE:') ? 'WASTE' : null);
                if (!['MANUAL', 'WASTE', 'TRANSFER'].includes(reversibleOrigin || '')) {
                    throw new Error(
                        `El movimiento ${original.id} pertenece a otro dominio y debe reversarse desde su flujo de origen`
                    );
                }
                if (data.branchId != null
                    && original.warehouse.branchId != null
                    && original.warehouse.branchId !== data.branchId) {
                    throw new Error(`El movimiento ${original.id} pertenece a otra sucursal`);
                }
                const quantity = Number(original.quantity);
                const unitCost = Number(original.unitCost);
                const totalCost = Number(original.totalCost);
                if (!(quantity > 0) || !Number.isFinite(unitCost) || unitCost < 0
                    || !Number.isFinite(totalCost) || totalCost < 0
                    || Math.abs(quantity * unitCost - totalCost) > 0.0001) {
                    throw new Error(
                        `MOVEMENT_COST_INTEGRITY_ERROR: el movimiento ${original.id} no reconcilia cantidad, costo unitario y costo total`
                    );
                }
            }

            const already = await tx.inventoryMovement.findMany({
                where: { companyId, reversalOfId: { in: ids } },
                orderBy: { id: 'asc' }
            });
            if (already.length > 0) {
                if (already.length === originals.length && already.every((row) => row.reversalKey === reversalKey)) {
                    return { success: true, idempotent: true, reversalGroupId: already[0].reversalGroupId, movements: already };
                }
                throw new Error('El movimiento o una parte de su transferencia ya fue reversado');
            }
            const keyConflict = await tx.inventoryMovement.findFirst({
                where: { companyId, reversalKey }
            });
            if (keyConflict) throw new Error('X-Idempotency-Key ya fue usada para otra reversa');

            const reversalGroupId = `REV-${randomUUID()}`;
            const reversedIds: number[] = [];
            const isTransfer = originals.some((row) => row.type === 'TRANSFER' || row.transferGroupId != null);

            // Canonical lock order: Warehouses (ascending) -> Products -> Stock.
            // A transfer reversal touches destination before source, which would
            // otherwise invert the ascending warehouse order used by transfer().
            await InventoryEngineService.lockInventoryScope(
                tx,
                companyId,
                originals.map((row) => row.warehouseId),
                originals.map((row) => row.productId)
            );

            if (isTransfer) {
                const incoming = originals.filter((row) => this.movementDirection(row) === 'IN');
                const outgoing = originals.filter((row) => this.movementDirection(row) === 'OUT');
                if (originals.length !== 2 || incoming.length !== 1 || outgoing.length !== 1) {
                    throw new Error('TRANSFER_PROVENANCE_INVALID: la transferencia no tiene exactamente una entrada y una salida');
                }
                const destination = incoming[0];
                const source = outgoing[0];
                if (destination.productId !== source.productId
                    || Math.abs(Number(destination.quantity) - Number(source.quantity)) > 1e-9
                    || Math.abs(Number(destination.totalCost) - Number(source.totalCost)) > 0.0001) {
                    throw new Error('TRANSFER_RECONCILIATION_ERROR: las dos piernas de la transferencia no cuadran');
                }

                // Remove destination stock first, consuming only the exact layers
                // opened by the original inbound transfer movement. The part of
                // the inbound that covered a negative destination balance has
                // no layer: it is taken back through reverseCoveredShortfall.
                const destinationQuantity = Number(destination.quantity);
                const destinationShortfall = this.coveredDeficitQuantity(destination);
                const destinationLayerQuantity = destinationQuantity - destinationShortfall;
                const destinationCommon = {
                    type: 'TRANSFER' as const, origin: 'REVERSAL' as const,
                    companyId, warehouseId: destination.warehouseId, productId: destination.productId,
                    userId: data.userId, unitCost: Number(destination.unitCost),
                    reason: `REVERSAL: ${reason}`,
                    reference: `REV-MOV-${destination.id}`,
                    transferGroupId: reversalGroupId,
                    reversalGroupId, reversalKey
                };
                const removedLayers: NonNullable<Awaited<ReturnType<typeof InventoryEngineService.applyMovement>>['consumedLayers']> = [];
                let destinationReversalLinked = false;
                let destinationExactValue = 0;
                if (destinationLayerQuantity > 1e-9) {
                    // With a trimmed part, the surviving layer is valued at its own
                    // cost (the inbound's layers may carry different costs) and the
                    // shortfall gets the rest of the inbound value.
                    const destinationReverse = await InventoryEngineService.applyMovement(tx, {
                        ...destinationCommon,
                        ...(destinationShortfall > 1e-9 ? { unitCost: undefined, valueFromConsumedLayers: true } : {}),
                        direction: 'OUT',
                        quantity: destinationLayerQuantity,
                        consumeSourceMovementId: destination.id,
                        reversalOfId: destination.id
                    });
                    destinationExactValue = destinationReverse.totalCost;
                    destinationReversalLinked = true;
                    reversedIds.push(destinationReverse.movementId);
                    removedLayers.push(...(destinationReverse.consumedLayers ?? []));
                }
                if (destinationShortfall > 1e-9) {
                    const shortfall = await InventoryEngineService.reverseCoveredShortfall(tx, {
                        ...destinationCommon,
                        quantity: destinationShortfall,
                        unitCost: Math.max(0, Number(destination.totalCost) - destinationExactValue) / destinationShortfall,
                        coveringMovementIds: [destination.id],
                        ...(destinationReversalLinked ? {} : { reversalOfId: destination.id })
                    });
                    reversedIds.push(...shortfall.movementIds);
                    removedLayers.push(...shortfall.consumedLayers);
                }

                // Restore source stock with the exact FIFO portions that left it
                // (the destination layers when nothing was trimmed; otherwise the
                // source leg's own consumed layers), preserving acquisition order.
                let sourceLayers = removedLayers;
                if (destinationShortfall > 1e-9) {
                    try {
                        const original = this.consumedLayers(source.consumedLayers);
                        const originalQuantity = (original ?? []).reduce((sum, layer) => sum + layer.quantity, 0);
                        if (original && Math.abs(originalQuantity - Number(source.quantity)) <= 1e-6) {
                            sourceLayers = original;
                        }
                    } catch {
                        // Legacy source leg without provenance: keep the removed layers.
                    }
                }
                const sourceReverse = await InventoryEngineService.applyMovement(tx, {
                    type: 'TRANSFER', direction: 'IN', origin: 'REVERSAL',
                    companyId, warehouseId: source.warehouseId, productId: source.productId,
                    userId: data.userId, quantity: Number(source.quantity),
                    unitCost: Number(source.unitCost), inboundLayers: sourceLayers,
                    reason: `REVERSAL: ${reason}`,
                    reference: `REV-MOV-${source.id}`,
                    transferGroupId: reversalGroupId, sourceType: 'TRANSFER',
                    reversalOfId: source.id, reversalGroupId, reversalKey
                });
                reversedIds.push(sourceReverse.movementId);

                const company = await tx.company.findUnique({ where: { id: companyId }, select: { costingMethod: true } });
                if ((company?.costingMethod || 'WEIGHTED_AVERAGE') === 'FIFO') {
                    await CostingService.syncFifoCurrentAverageCost(tx, source.productId, companyId);
                }
            } else {
                const original = originals[0];
                const originalDirection = this.movementDirection(original);
                if (originalDirection === 'IN') {
                    // An IN that covered a negative balance (e.g. stock -20,
                    // count 5 -> IN 25) only opened a layer for the part above
                    // zero. Reverse that layer exactly and take the covered part
                    // back through reverseCoveredShortfall (other layers at their
                    // cost + true-up, or re-create the deficit at this cost).
                    const quantity = Number(original.quantity);
                    const shortfallQuantity = this.coveredDeficitQuantity(original);
                    const layerQuantity = quantity - shortfallQuantity;
                    const reverseCommon = {
                        type: 'ADJUSTMENT' as const, origin: 'REVERSAL' as const,
                        companyId, warehouseId: original.warehouseId, productId: original.productId,
                        userId: data.userId, unitCost: Number(original.unitCost),
                        reason: `REVERSAL: ${reason}`, reference: `REV-MOV-${original.id}`,
                        reversalGroupId, reversalKey
                    };
                    let linkedReversalId: number | null = null;
                    let exactValue = 0;
                    if (layerQuantity > 1e-9) {
                        const reversal = await InventoryEngineService.applyMovement(tx, {
                            ...reverseCommon,
                            ...(shortfallQuantity > 1e-9 ? { unitCost: undefined, valueFromConsumedLayers: true } : {}),
                            direction: 'OUT',
                            quantity: layerQuantity,
                            consumeSourceMovementId: original.id,
                            reversalOfId: original.id
                        });
                        exactValue = reversal.totalCost;
                        linkedReversalId = reversal.movementId;
                        reversedIds.push(reversal.movementId);
                    }
                    if (shortfallQuantity > 1e-9) {
                        const shortfall = await InventoryEngineService.reverseCoveredShortfall(tx, {
                            ...reverseCommon,
                            quantity: shortfallQuantity,
                            unitCost: Math.max(0, Number(original.totalCost) - exactValue) / shortfallQuantity,
                            coveringMovementIds: [original.id],
                            ...(linkedReversalId == null ? { reversalOfId: original.id } : {})
                        });
                        linkedReversalId = linkedReversalId ?? shortfall.firstMovementId;
                        reversedIds.push(...shortfall.movementIds);
                    }
                    if (linkedReversalId == null) throw new Error('No se pudo registrar la reversa del movimiento');
                    await CostingService.reverseInventoryMovementCost(tx, original.id, linkedReversalId, companyId);
                } else {
                    const layers = this.consumedLayers(original.consumedLayers);
                    // An OUT that went negative (manual/waste with allowNegative)
                    // opened deficit slices: price its unbacked part from its OWN
                    // slices (covered at their real value, open ones leave the
                    // queue) instead of covering another sale's oldest slice.
                    const plan = await planSaleReturnFromSlices(tx, {
                        companyId, warehouseId: original.warehouseId, productId: original.productId,
                        saleMovementIds: [original.id],
                        layers: (layers ?? []).map((layer) => ({
                            quantity: layer.quantity,
                            unitCost: layer.unitCost,
                            sourceRef: layer.sourceRef ?? null,
                            sourceType: layer.sourceType ?? 'ADJUSTMENT',
                            createdAt: layer.createdAt
                        }))
                    });
                    const adjustment = Math.abs(plan.adjustment) > 1e-9 ? plan.adjustment : 0;
                    const reversal = await InventoryEngineService.applyMovement(tx, {
                        type: 'ADJUSTMENT', direction: 'IN', origin: 'REVERSAL',
                        companyId, warehouseId: original.warehouseId, productId: original.productId,
                        userId: data.userId, quantity: Number(original.quantity),
                        unitCost: Number(original.unitCost), inboundLayers: plan.layers,
                        ...(adjustment !== 0 ? { restoredValueAdjustment: adjustment } : {}),
                        ...(plan.returnedOpenSlices.length > 0 ? { returnedOpenSlices: plan.returnedOpenSlices } : {}),
                        reason: `REVERSAL: ${reason}`, reference: `REV-MOV-${original.id}`,
                        sourceType: 'ADJUSTMENT',
                        reversalOfId: original.id, reversalGroupId, reversalKey
                    });
                    await plan.commit(reversal.movementId);
                    reversedIds.push(reversal.movementId);
                    const company = await tx.company.findUnique({ where: { id: companyId }, select: { costingMethod: true } });
                    if ((company?.costingMethod || 'WEIGHTED_AVERAGE') === 'FIFO') {
                        await CostingService.syncFifoCurrentAverageCost(tx, original.productId, companyId);
                    } else {
                        // An OUT never changes WA at posting time, but restoring it
                        // after later receipts does. Append a valued inbound cost
                        // event so the current and future moving average follows
                        // chronological quantity/value, not the stale pre-reversal average.
                        const global = await tx.stock.aggregate({
                            where: { productId: original.productId, companyId },
                            _sum: { quantity: true }
                        });
                        // A negative prior balance is legitimate (allowNegative OUTs);
                        // the fold treats it as no prior stock.
                        const previousGlobalStock = Number(global._sum.quantity ?? 0) - Number(original.quantity);
                        await CostingService.applyProductionCost(
                            tx,
                            original.productId,
                            companyId,
                            Number(original.quantity),
                            (Number(reversal.totalCost) + adjustment) / Number(original.quantity),
                            Math.max(0, previousGlobalStock),
                            undefined,
                            reversal.movementId
                        );
                    }
                }
            }

            const movements = await tx.inventoryMovement.findMany({
                where: { id: { in: reversedIds }, companyId },
                include: {
                    warehouse: { select: { id: true, name: true, branchId: true } },
                    product: { select: { id: true, name: true, unit: true } },
                    user: { select: { id: true, name: true } }
                },
                orderBy: { id: 'asc' }
            });
            return { success: true, idempotent: false, reversalGroupId, movements };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    // Get kardex (movement history) for a product
    static async getKardex(productId: number, companyId: number, warehouseId?: number, branchId?: number) {
        const where: Prisma.InventoryMovementWhereInput = { productId, companyId };

        if (branchId) {
            where.warehouse = {
                OR: [{ branchId }, { branchId: null }]
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
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
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
        assertManualReferenceAllowed(data.reference);
        if (data.fromWarehouseId === data.toWarehouseId) {
            throw new Error('Cannot transfer to the same warehouse');
        }

        if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
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

        const transferProduct = await prisma.product.findFirst({
            where: { id: data.productId, companyId },
            select: { unit: true, baseUnit: { select: { abbreviation: true } } }
        });
        if (!transferProduct) throw new Error('Product not found or unauthorized');
        const effectiveUnit = data.unit || transferProduct.baseUnit?.abbreviation || transferProduct.unit;
        const conversion = await UnitConversionService.convert(
            data.productId, companyId, data.quantity, effectiveUnit
        );
        const baseQuantity = conversion.baseQuantity;
        const originalQuantity = conversion.originalQuantity;
        const originalUnit = conversion.originalUnit;
        const convFactor = conversion.conversionFactor;

        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const transferGroupId = `TRF-${randomUUID()}`;

            const firstWarehouseId = Math.min(data.fromWarehouseId, data.toWarehouseId);
            const secondWarehouseId = Math.max(data.fromWarehouseId, data.toWarehouseId);
            await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE companyId = ${companyId} AND id IN (${firstWarehouseId}, ${secondWarehouseId}) ORDER BY id FOR UPDATE`;

            // Product before Stock: the engine (and every other writer) takes
            // Warehouse -> Product -> Stock; locking Stock first inverted it.
            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${data.productId} AND companyId = ${companyId} FOR UPDATE`;
            const product = await tx.product.findFirst({
                where: { id: data.productId, companyId }
            });
            if (!product) throw new Error('Product not found or unauthorized');

            // Ensure both stock rows exist, then lock them in deterministic order.
            // This prevents opposite-direction transfers from deadlocking or both
            // consuming the same source balance concurrently.
            for (const warehouseId of [data.fromWarehouseId, data.toWarehouseId]) {
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId, productId: data.productId } },
                    create: { warehouseId, productId: data.productId, companyId, quantity: 0 },
                    update: {}
                });
            }
            await tx.$queryRaw`SELECT id FROM \`Stock\` WHERE companyId = ${companyId} AND productId = ${data.productId} AND warehouseId IN (${firstWarehouseId}, ${secondWarehouseId}) ORDER BY warehouseId FOR UPDATE`;

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
                productName: product.name,
                origin: 'TRANSFER'
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
                sourceType: 'TRANSFER',
                origin: 'TRANSFER'
            });

            // OUT refreshed the company-wide FIFO average without the in-flight
            // layers; restore it now that the destination layers exist.
            const company = await tx.company.findUnique({
                where: { id: companyId },
                select: { costingMethod: true }
            });
            if ((company?.costingMethod || 'WEIGHTED_AVERAGE') === 'FIFO') {
                await CostingService.syncFifoCurrentAverageCost(tx, data.productId, companyId);
            }

            return { success: true, transferGroupId };
        });
    }
}
