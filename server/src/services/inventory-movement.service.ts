import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { AuditLogService } from './audit-log.service';
import { InventoryEngineService } from './inventory-engine.service';
import { CostingService } from './costing.service';

export class InventoryMovementService {
    private static movementDirection(movement: { type: string; direction?: string | null; reason?: string | null }): 'IN' | 'OUT' {
        if (movement.direction === 'IN' || movement.direction === 'OUT') return movement.direction;
        if (movement.type === 'IN' || movement.type === 'ADJUSTMENT') return 'IN';
        if (movement.type === 'OUT') return 'OUT';
        return (movement.reason || '').toLowerCase().startsWith('transfer in') ? 'IN' : 'OUT';
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
            throw new Error('REVERSAL_PROVENANCE_MISSING: las capas consumidas no tienen un formato vÃ¡lido');
        }
        return value.map((raw) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new Error('REVERSAL_PROVENANCE_MISSING: existe una capa consumida invÃ¡lida');
            }
            const layer = raw as Record<string, Prisma.JsonValue>;
            const quantity = Number(layer.quantity);
            const unitCost = Number(layer.unitCost);
            if (!(quantity > 0) || !Number.isFinite(unitCost) || unitCost < 0) {
                throw new Error('REVERSAL_PROVENANCE_MISSING: cantidad o costo de capa invÃ¡lido');
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
                await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${data.productId} AND companyId = ${companyId} FOR UPDATE`;
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

            AuditLogService.log({
                companyId, userId: data.userId,
                entityType: 'InventoryMovement', entityId: result.movementId,
                action: 'CREATE',
                details: { type: data.type, productId: data.productId, warehouseId: data.warehouseId, quantity: baseQuantity, reason }
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
            throw new Error('Movimiento invÃ¡lido');
        }

        return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const selected = await tx.inventoryMovement.findFirst({
                where: { id: movementId, companyId },
                select: { id: true, transferGroupId: true }
            });
            if (!selected) throw new Error('Movimiento no encontrado para esta empresa');

            const groupWhere: Prisma.InventoryMovementWhereInput = selected.transferGroupId
                ? { companyId, transferGroupId: selected.transferGroupId }
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
            if (originals.length !== ids.length) throw new Error('El grupo de movimiento cambiÃ³ durante la reversa');

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
                // opened by the original inbound transfer movement.
                const destinationReverse = await InventoryEngineService.applyMovement(tx, {
                    type: 'TRANSFER', direction: 'OUT', origin: 'REVERSAL',
                    companyId, warehouseId: destination.warehouseId, productId: destination.productId,
                    userId: data.userId, quantity: Number(destination.quantity),
                    unitCost: Number(destination.unitCost),
                    consumeSourceMovementId: destination.id,
                    reason: `REVERSAL: ${reason}`,
                    reference: `REV-MOV-${destination.id}`,
                    transferGroupId: reversalGroupId,
                    reversalOfId: destination.id, reversalGroupId, reversalKey
                });
                reversedIds.push(destinationReverse.movementId);

                // Restore source stock with the exact FIFO portions just removed
                // from destination, preserving their original acquisition order.
                const sourceReverse = await InventoryEngineService.applyMovement(tx, {
                    type: 'TRANSFER', direction: 'IN', origin: 'REVERSAL',
                    companyId, warehouseId: source.warehouseId, productId: source.productId,
                    userId: data.userId, quantity: Number(source.quantity),
                    unitCost: Number(source.unitCost), inboundLayers: destinationReverse.consumedLayers,
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
                    const reversal = await InventoryEngineService.applyMovement(tx, {
                        type: 'ADJUSTMENT', direction: 'OUT', origin: 'REVERSAL',
                        companyId, warehouseId: original.warehouseId, productId: original.productId,
                        userId: data.userId, quantity: Number(original.quantity),
                        unitCost: Number(original.unitCost), consumeSourceMovementId: original.id,
                        reason: `REVERSAL: ${reason}`, reference: `REV-MOV-${original.id}`,
                        reversalOfId: original.id, reversalGroupId, reversalKey
                    });
                    reversedIds.push(reversal.movementId);
                    await CostingService.reverseInventoryMovementCost(tx, original.id, reversal.movementId, companyId);
                } else {
                    const layers = this.consumedLayers(original.consumedLayers);
                    const reversal = await InventoryEngineService.applyMovement(tx, {
                        type: 'ADJUSTMENT', direction: 'IN', origin: 'REVERSAL',
                        companyId, warehouseId: original.warehouseId, productId: original.productId,
                        userId: data.userId, quantity: Number(original.quantity),
                        unitCost: Number(original.unitCost), inboundLayers: layers,
                        reason: `REVERSAL: ${reason}`, reference: `REV-MOV-${original.id}`,
                        sourceType: 'ADJUSTMENT',
                        reversalOfId: original.id, reversalGroupId, reversalKey
                    });
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
                        const previousGlobalStock = Number(global._sum.quantity ?? 0) - Number(original.quantity);
                        if (previousGlobalStock < -1e-9) {
                            throw new Error('MOVEMENT_STOCK_INTEGRITY_ERROR: el saldo global previo a la reversa es invÃ¡lido');
                        }
                        await CostingService.applyProductionCost(
                            tx,
                            original.productId,
                            companyId,
                            Number(original.quantity),
                            Number(original.unitCost),
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
