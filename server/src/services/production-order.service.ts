import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { CostingService } from './costing.service';
import { ProductionRecipeService } from './production-recipe.service';
import { AuditLogService } from './audit-log.service';
import { InventoryEngineService } from './inventory-engine.service';

type Tx = Prisma.TransactionClient;

const PROD_REF = (id: number) => `PROD-${id}`;

export interface ProductionOrderRequirementLine {
    componentProductId: number;
    componentName: string;
    componentType: string;
    unit: string;
    requiredQuantity: number; // in component base unit
    availableQuantity: number; // current stock in warehouse
    sufficient: boolean;
    producible: boolean; // has an ACTIVE production recipe (intermediate)
    unitCost: number;
    totalCost: number;
}

export interface ProductionPreview {
    productId: number;
    recipeId: number;
    plannedQuantity: number;
    yieldBaseQuantity: number;
    estimatedCost: number;
    estimatedUnitCost: number;
    canProduce: boolean;
    requirements: ProductionOrderRequirementLine[];
}

export class ProductionOrderService {
    static orderInclude() {
        return {
            product: {
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    type: true,
                    unit: true,
                    baseUnit: { select: { id: true, name: true, abbreviation: true } }
                }
            },
            recipe: { select: { id: true, name: true, version: true, yieldQuantity: true } },
            warehouse: { select: { id: true, name: true, code: true } },
            branch: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } },
            cancelledBy: { select: { id: true, name: true } },
            items: {
                include: {
                    componentProduct: {
                        select: {
                            id: true,
                            name: true,
                            sku: true,
                            type: true,
                            unit: true,
                            baseUnit: { select: { id: true, name: true, abbreviation: true } }
                        }
                    },
                    unitOfMeasure: { select: { id: true, abbreviation: true } }
                }
            }
        } satisfies Prisma.ProductionOrderInclude;
    }

    // ==========================================
    // Code sequence
    // ==========================================
    private static async generateCode(companyId: number, db: Tx | typeof prisma = prisma): Promise<string> {
        const last = await db.productionOrder.findFirst({
            where: { companyId, code: { startsWith: 'PRD-' } },
            orderBy: { id: 'desc' },
            select: { code: true }
        });
        let next = 1;
        if (last?.code) {
            const n = parseInt(last.code.replace('PRD-', ''), 10);
            if (!Number.isNaN(n)) next = n + 1;
        }
        return `PRD-${String(next).padStart(6, '0')}`;
    }

    // ==========================================
    // Requirement computation / preview
    // ==========================================

    /**
     * Compute insumos requeridos for producing `plannedQuantity` (in OUTPUT product
     * base units) using the product's active recipe (or a specific recipeId).
     * Also evaluates stock availability per component in the target warehouse.
     */
    static async computeRequirements(
        companyId: number,
        params: { productId: number; recipeId?: number; plannedQuantity: number; warehouseId: number },
        db: Tx | typeof prisma = prisma
    ): Promise<ProductionPreview> {
        const { productId, plannedQuantity, warehouseId } = params;
        if (!Number.isFinite(plannedQuantity) || !(plannedQuantity > 0)) {
            throw new Error('La cantidad a producir debe ser un número finito mayor a 0.');
        }

        const warehouse = await db.warehouse.findFirst({
            where: { id: warehouseId, companyId },
            select: { id: true }
        });
        if (!warehouse) throw new Error('Almacén no encontrado para la empresa.');

        let recipe;
        if (params.recipeId) {
            // Solo se puede producir con recetas ACTIVE (alineado con getActiveForProduct);
            // recetas DRAFT/INACTIVE no son usables vía API aunque se pase su recipeId.
            recipe = await db.productionRecipe.findFirst({
                where: { id: params.recipeId, companyId, productId, status: 'ACTIVE' },
                include: { components: { select: { componentProductId: true } } }
            });
            if (!recipe) throw new Error('La receta indicada no existe, no corresponde al producto o no está activa.');
        } else {
            recipe = await ProductionRecipeService.getActiveForProduct(productId, companyId, db);
            if (!recipe) throw new Error('El producto no tiene una receta de producción activa.');
        }

        const cost = await ProductionRecipeService.computeRecipeCost(recipe.id, companyId, db);
        if (!(cost.yieldBaseQuantity > 0)) {
            throw new Error('El rendimiento de la receta no es válido (debe ser mayor a 0).');
        }

        const scaleFactor = plannedQuantity / cost.yieldBaseQuantity;

        const requirements: ProductionOrderRequirementLine[] = [];
        let canProduce = true;

        for (const line of cost.lines) {
            const requiredQuantity = round6(line.baseQuantity * scaleFactor);

            const stock = await db.stock.findUnique({
                where: { warehouseId_productId: { warehouseId, productId: line.componentProductId } }
            });
            const availableQuantity = stock ? Number(stock.quantity) : 0;
            const sufficient = availableQuantity >= requiredQuantity;

            const activeSub = await db.productionRecipe.findFirst({
                where: { productId: line.componentProductId, companyId, status: 'ACTIVE' },
                select: { id: true }
            });

            if (!sufficient) canProduce = false;

            requirements.push({
                componentProductId: line.componentProductId,
                componentName: line.componentName,
                componentType: line.componentType,
                unit: line.baseUnit,
                requiredQuantity,
                availableQuantity,
                sufficient,
                producible: !!activeSub,
                unitCost: line.unitCost,
                totalCost: round6(line.unitCost * requiredQuantity)
            });
        }

        return {
            productId,
            recipeId: recipe.id,
            plannedQuantity,
            yieldBaseQuantity: cost.yieldBaseQuantity,
            estimatedCost: round6(cost.batchCost * scaleFactor),
            estimatedUnitCost: cost.unitCost,
            canProduce,
            requirements
        };
    }

    static async preview(
        companyId: number,
        params: { productId: number; recipeId?: number; plannedQuantity: number; warehouseId: number }
    ) {
        return this.computeRequirements(companyId, params);
    }

    // ==========================================
    // Reads
    // ==========================================
    static async list(
        companyId: number,
        filters?: { branchId?: number; status?: string; productId?: number; warehouseId?: number; search?: string }
    ) {
        const where: Prisma.ProductionOrderWhereInput = { companyId };
        if (filters?.branchId) where.branchId = filters.branchId;
        if (filters?.status) where.status = filters.status as Prisma.EnumProductionOrderStatusFilter['equals'];
        if (filters?.productId) where.productId = filters.productId;
        if (filters?.warehouseId) where.warehouseId = filters.warehouseId;
        if (filters?.search) {
            where.OR = [
                { code: { contains: filters.search } },
                { product: { name: { contains: filters.search } } }
            ];
        }
        return prisma.productionOrder.findMany({
            where,
            include: this.orderInclude(),
            orderBy: { id: 'desc' }
        });
    }

    static async getById(id: number, companyId: number) {
        const order = await prisma.productionOrder.findFirst({
            where: { id, companyId },
            include: this.orderInclude()
        });
        if (!order) throw new Error('Orden de producción no encontrada');
        return order;
    }

    // ==========================================
    // Create / update (draft)
    // ==========================================
    static async create(
        companyId: number,
        data: {
            productId: number;
            recipeId?: number;
            plannedQuantity: number;
            warehouseId: number;
            branchId: number;
            notes?: string;
            date?: string | Date;
            status?: 'DRAFT' | 'PENDING';
        },
        userId: number
    ) {
        const orderDate = data.date ? new Date(data.date) : new Date();
        if (Number.isNaN(orderDate.getTime())) throw new Error('La fecha de producción no es válida.');

        const order = await prisma.$transaction(async (tx) => {
            // Serialize code allocation and revalidate the complete recipe/scope
            // snapshot in the same transaction that creates the order. Otherwise
            // an active recipe or an empty warehouse could change after preview.
            await tx.$queryRaw`SELECT id FROM \`Company\` WHERE id = ${companyId} FOR UPDATE`;
            const branch = await tx.branch.findFirst({
                where: { id: data.branchId, companyId },
                select: { id: true }
            });
            if (!branch) throw new Error('Sucursal no encontrada para la empresa.');

            await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${data.warehouseId} AND companyId = ${companyId} FOR UPDATE`;
            const warehouse = await tx.warehouse.findFirst({
                where: { id: data.warehouseId, companyId },
                select: { id: true, branchId: true }
            });
            if (!warehouse) throw new Error('Almacén no encontrado.');
            if (warehouse.branchId && warehouse.branchId !== data.branchId) {
                throw new Error('El almacén no pertenece a la sucursal de la orden de producción.');
            }

            const preview = await this.computeRequirements(companyId, {
                productId: data.productId,
                recipeId: data.recipeId,
                plannedQuantity: data.plannedQuantity,
                warehouseId: data.warehouseId
            }, tx);
            const code = await this.generateCode(companyId, tx);
            const created = await tx.productionOrder.create({
                data: {
                    companyId,
                    branchId: data.branchId,
                    code,
                    productId: data.productId,
                    recipeId: preview.recipeId,
                    warehouseId: data.warehouseId,
                    status: data.status === 'PENDING' ? 'PENDING' : 'DRAFT',
                    plannedQuantity: data.plannedQuantity,
                    estimatedCost: preview.estimatedCost,
                    estimatedUnitCost: preview.estimatedUnitCost,
                    userId,
                    notes: data.notes ?? null,
                    date: orderDate,
                    items: {
                        create: preview.requirements.map((r) => ({
                            componentProductId: r.componentProductId,
                            requiredQuantity: r.requiredQuantity,
                            unit: r.unit,
                            unitCost: r.unitCost,
                            totalCost: r.totalCost
                        }))
                    }
                },
                include: this.orderInclude()
            });
            await AuditLogService.log({
                companyId, userId, entityType: 'ProductionOrder', entityId: created.id,
                action: 'CREATE',
                details: {
                    code: created.code,
                    productId: data.productId,
                    plannedQuantity: data.plannedQuantity,
                    status: created.status
                }
            }, tx);
            return created;
        });

        return order;
    }

    static async update(
        id: number,
        companyId: number,
        data: { plannedQuantity?: number; warehouseId?: number; notes?: string; recipeId?: number },
        userId: number
    ) {
        const order = await prisma.productionOrder.findFirst({ where: { id, companyId } });
        if (!order) throw new Error('Orden de producción no encontrada');
        if (order.status !== 'DRAFT' && order.status !== 'PENDING') {
            throw new Error('Solo se pueden editar órdenes en estado Borrador o Pendiente.');
        }

        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`ProductionOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const lockedOrder = await tx.productionOrder.findFirst({ where: { id, companyId } });
            if (!lockedOrder) throw new Error('Orden de producción no encontrada');
            if (lockedOrder.status !== 'DRAFT' && lockedOrder.status !== 'PENDING') {
                throw new Error('Solo se pueden editar órdenes en estado Borrador o Pendiente.');
            }

            const plannedQuantity = data.plannedQuantity ?? Number(lockedOrder.plannedQuantity);
            const warehouseId = data.warehouseId ?? lockedOrder.warehouseId;
            const recipeId = data.recipeId ?? lockedOrder.recipeId ?? undefined;
            const warehouse = await tx.warehouse.findFirst({
                where: { id: warehouseId, companyId },
                select: { branchId: true }
            });
            if (!warehouse) throw new Error('Almacén no encontrado para la empresa.');
            if (warehouse.branchId && warehouse.branchId !== lockedOrder.branchId) {
                throw new Error('El almacén no pertenece a la sucursal de la orden de producción.');
            }
            const preview = await this.computeRequirements(companyId, {
                productId: lockedOrder.productId,
                recipeId,
                plannedQuantity,
                warehouseId
            }, tx);

            await tx.productionOrderItem.deleteMany({ where: { productionOrderId: id } });
            await tx.productionOrder.update({
                where: { id },
                data: {
                    plannedQuantity,
                    warehouseId,
                    recipeId: preview.recipeId,
                    notes: data.notes === undefined ? undefined : data.notes,
                    estimatedCost: preview.estimatedCost,
                    estimatedUnitCost: preview.estimatedUnitCost,
                    items: {
                        create: preview.requirements.map((r) => ({
                            componentProductId: r.componentProductId,
                            requiredQuantity: r.requiredQuantity,
                            unit: r.unit,
                            unitCost: r.unitCost,
                            totalCost: r.totalCost
                        }))
                    }
                }
            });
            const applied = { plannedQuantity, warehouseId };
            await AuditLogService.log({
                companyId, userId, entityType: 'ProductionOrder', entityId: id,
                action: 'UPDATE', details: applied
            }, tx);
            return applied;
        });

        return this.getById(id, companyId);
    }

    /** Simple status transitions that do NOT touch inventory (DRAFT/PENDING/IN_PROGRESS). */
    static async setStatus(id: number, companyId: number, status: 'PENDING' | 'IN_PROGRESS' | 'DRAFT', userId: number) {
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`ProductionOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const order = await tx.productionOrder.findFirst({ where: { id, companyId } });
            if (!order) throw new Error('Orden de producción no encontrada');
            if (order.status === 'FINISHED' || order.status === 'CANCELLED') {
                throw new Error('La orden ya está finalizada o anulada.');
            }
            const allowed: Record<'DRAFT' | 'PENDING' | 'IN_PROGRESS', Array<'DRAFT' | 'PENDING' | 'IN_PROGRESS'>> = {
                DRAFT: ['DRAFT', 'PENDING', 'IN_PROGRESS'],
                PENDING: ['PENDING', 'IN_PROGRESS'],
                IN_PROGRESS: ['IN_PROGRESS']
            };
            const currentStatus = order.status as 'DRAFT' | 'PENDING' | 'IN_PROGRESS';
            if (!allowed[currentStatus].includes(status)) {
                throw new Error(`Transición de estado inválida: ${currentStatus} -> ${status}.`);
            }
            const updateData: Prisma.ProductionOrderUpdateInput = { status };
            if (status === 'IN_PROGRESS' && !order.startedAt) updateData.startedAt = new Date();
            await tx.productionOrder.update({ where: { id }, data: updateData });
            await AuditLogService.log({
                companyId, userId, entityType: 'ProductionOrder', entityId: id,
                action: 'UPDATE', details: { status }
            }, tx);
        });

        return this.getById(id, companyId);
    }

    // ==========================================
    // Finish: the core inventory transformation
    // ==========================================

    /**
     * Confirm/finish a production order. This is an INTERNAL inventory transformation
     * (not a purchase nor a sale):
     *   - Consumes (OUT) the real quantities of each input from the warehouse.
     *   - Computes the real production cost from consumed inputs (weighted average).
     *   - Adds (IN) the produced quantity of the OUTPUT product at its real unit cost,
     *     folding it into the product's weighted-average cost.
     * Supports produced quantity differing from planned (mermas / rendimiento) and
     * optional real consumption overrides per component.
     */
    static async finish(
        id: number,
        companyId: number,
        userId: number,
        payload: {
            producedQuantity?: number;
            consumptions?: Array<{ componentProductId: number; consumedQuantity: number }>;
            notes?: string;
            allowNegative?: boolean;
        }
    ) {
        const order = await prisma.productionOrder.findFirst({
            where: { id, companyId },
            include: { items: true }
        });
        if (!order) throw new Error('Orden de producción no encontrada');
        if (order.status === 'FINISHED') throw new Error('La orden ya está finalizada.');
        if (order.status === 'CANCELLED') throw new Error('No se puede finalizar una orden anulada.');
        if (order.status !== 'IN_PROGRESS') throw new Error('La orden debe estar En Proceso antes de finalizarse.');
        if (order.items.length === 0) throw new Error('La orden no tiene insumos definidos.');

        // Mid-flight recipe version changes deactivate the source version; finish
        // still uses the order's BOM snapshot. Only a hard-deleted recipe is blocked.
        if (order.recipeId) {
            const recipe = await prisma.productionRecipe.findFirst({ where: { id: order.recipeId, companyId } });
            if (!recipe) throw new Error('La receta utilizada ya no existe.');
        }

        // Map of real consumption overrides
        const overrides = new Map<number, number>();
        for (const c of payload.consumptions || []) {
            const componentProductId = Number(c.componentProductId);
            const consumedQuantity = Number(c.consumedQuantity);
            if (!Number.isInteger(componentProductId) || componentProductId <= 0) {
                throw new Error('Cada consumo debe indicar un componente válido.');
            }
            if (!Number.isFinite(consumedQuantity) || consumedQuantity < 0) {
                throw new Error('La cantidad consumida debe ser un número finito mayor o igual a 0.');
            }
            if (overrides.has(componentProductId)) {
                throw new Error(`El componente ${componentProductId} está duplicado en los consumos.`);
            }
            overrides.set(componentProductId, consumedQuantity);
        }

        const hasPositiveConsumption = order.items.some((item) => {
            const quantity = overrides.has(item.componentProductId)
                ? Number(overrides.get(item.componentProductId))
                : Number(item.requiredQuantity);
            return Number.isFinite(quantity) && quantity > 0;
        });
        if (!hasPositiveConsumption) {
            throw new Error('La producción debe consumir al menos un insumo en cantidad mayor a 0.');
        }

        if (payload.allowNegative) {
            const company = await prisma.company.findUnique({
                where: { id: companyId },
                select: { costingMethod: true }
            });
            if ((company?.costingMethod || 'WEIGHTED_AVERAGE') === 'FIFO') {
                throw new Error(
                    'El override de stock negativo no es compatible con costeo FIFO: ' +
                    'las capas de costo deben cubrir cada unidad. Reconcilie inventario o use promedio ponderado.'
                );
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            // Serialize finish/cancel/retry on this order. Re-read the order only
            // after acquiring the row lock so a second request cannot consume the
            // same BOM twice.
            await tx.$queryRaw`SELECT id FROM \`ProductionOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const lockedOrder = await tx.productionOrder.findFirst({
                where: { id, companyId },
                include: { items: true }
            });
            if (!lockedOrder) throw new Error('Orden de producción no encontrada');
            if (lockedOrder.status === 'FINISHED') throw new Error('La orden ya está finalizada.');
            if (lockedOrder.status === 'CANCELLED') throw new Error('No se puede finalizar una orden anulada.');
            if (lockedOrder.status !== 'IN_PROGRESS') throw new Error('La orden debe estar En Proceso antes de finalizarse.');
            if (lockedOrder.items.length === 0) throw new Error('La orden no tiene insumos definidos.');

            const componentIds = new Set(lockedOrder.items.map((item) => item.componentProductId));
            for (const componentProductId of overrides.keys()) {
                if (!componentIds.has(componentProductId)) {
                    throw new Error(`El componente ${componentProductId} no pertenece a esta orden de producción.`);
                }
            }

            const lockedHasPositiveConsumption = lockedOrder.items.some((item) => {
                const quantity = overrides.has(item.componentProductId)
                    ? Number(overrides.get(item.componentProductId))
                    : Number(item.requiredQuantity);
                return Number.isFinite(quantity) && quantity > 0;
            });
            if (!lockedHasPositiveConsumption) {
                throw new Error('La producción debe consumir al menos un insumo en cantidad mayor a 0.');
            }

            if (lockedOrder.recipeId) {
                const recipe = await tx.productionRecipe.findFirst({ where: { id: lockedOrder.recipeId, companyId } });
                if (!recipe) throw new Error('La receta utilizada ya no existe.');
            }

            const producedQuantity = payload.producedQuantity ?? Number(lockedOrder.plannedQuantity);
            if (!Number.isFinite(producedQuantity) || !(producedQuantity > 0)) {
                throw new Error('La cantidad producida debe ser un número finito mayor a 0.');
            }

            // The inventory engine publishes a company-wide product average while
            // mutating warehouse-local stock/layers. Acquire every involved product
            // lock in a deterministic order before the first movement so concurrent
            // productions with crossed BOM/output products cannot deadlock or leave
            // a stale FIFO display cost.
            const productIds = [...new Set([
                lockedOrder.productId,
                ...lockedOrder.items.map((item) => item.componentProductId)
            ])].sort((a, b) => a - b);
            for (const productId of productIds) {
                await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
            }

            let realCost = 0;

            // 1. Consume inputs (OUT) through the single inventory engine. Under
            // WEIGHTED_AVERAGE the OUT is valued by the shared outflow contract
            // (identical to the legacy code); the engine also consumes FIFO layers.
            const orderedItems = [...lockedOrder.items].sort((a, b) => a.componentProductId - b.componentProductId);
            for (const item of orderedItems) {
                const consumedQuantity = overrides.has(item.componentProductId)
                    ? Number(overrides.get(item.componentProductId))
                    : Number(item.requiredQuantity);

                if (!Number.isFinite(consumedQuantity) || consumedQuantity < 0) {
                    throw new Error('La cantidad consumida debe ser un número finito mayor o igual a 0.');
                }
                if (consumedQuantity === 0) {
                    await tx.productionOrderItem.update({
                        where: { id: item.id },
                        data: { consumedQuantity: 0, totalCost: 0 }
                    });
                    continue;
                }

                const product = await tx.product.findFirst({
                    where: { id: item.componentProductId, companyId },
                    select: { id: true, name: true }
                });
                if (!product) throw new Error(`Componente ${item.componentProductId} no encontrado.`);

                const moved = await InventoryEngineService.applyMovement(tx, {
                    type: 'OUT',
                    companyId,
                    warehouseId: lockedOrder.warehouseId,
                    productId: item.componentProductId,
                    userId,
                    quantity: consumedQuantity,
                    reason: `Producción ${lockedOrder.code}: consumo de insumo`,
                    reference: PROD_REF(lockedOrder.id),
                    allowNegative: payload.allowNegative,
                    productName: product.name
                });

                realCost += moved.totalCost;

                await tx.productionOrderItem.update({
                    where: { id: item.id },
                    data: {
                        consumedQuantity,
                        unitCost: moved.unitCost,
                        totalCost: moved.totalCost,
                        consumedLayers: (moved.consumedLayers || []).map((layer) => ({
                            quantity: layer.quantity,
                            unitCost: layer.unitCost,
                            sourceRef: layer.sourceRef ?? null,
                            sourceType: layer.sourceType ?? 'ADJUSTMENT',
                            createdAt: layer.createdAt?.toISOString() ?? null
                        })) as Prisma.InputJsonValue
                    }
                });
            }

            realCost = round6(realCost);
            const realUnitCost = producedQuantity > 0 ? round6(realCost / producedQuantity) : 0;

            // 2. Produce output (IN) at real unit cost.
            // Stock GLOBAL del producto fabricado ANTES de la entrada (suma de todas
            // las bodegas), capturado antes de que el motor mute la bodega destino:
            // el costeo global se alimenta de este stock global.
            // Serialize company-wide moving-average updates for this output product.
            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${lockedOrder.productId} AND companyId = ${companyId} FOR UPDATE`;
            const globalAgg = await tx.stock.aggregate({
                where: { productId: lockedOrder.productId, companyId },
                _sum: { quantity: true }
            });
            const previousGlobalStock = Number(globalAgg._sum.quantity || 0);

            // IN through the engine at the real unit cost; opens a PRODUCTION FIFO
            // layer and keeps the accumulated valued balance (previous warehouse
            // value + realCost) exactly as before.
            await InventoryEngineService.applyMovement(tx, {
                type: 'IN',
                companyId,
                warehouseId: lockedOrder.warehouseId,
                productId: lockedOrder.productId,
                userId,
                quantity: producedQuantity,
                unitCost: realUnitCost,
                reason: `Producción ${lockedOrder.code}: entrada de producto fabricado`,
                reference: PROD_REF(lockedOrder.id),
                sourceType: 'PRODUCTION'
            });

            // 3. Fold into the OUTPUT product's weighted-average cost using GLOBAL stock
            // (coherente con el costeo global; previousGlobalStock = suma de todas las bodegas).
            // productionOrderId enables exact cost reversal on cancellation (#1).
            await CostingService.applyProductionCost(tx, lockedOrder.productId, companyId, producedQuantity, realUnitCost, previousGlobalStock, lockedOrder.id);

            // 4. Mark order finished
            const updated = await tx.productionOrder.update({
                where: { id },
                data: {
                    status: 'FINISHED',
                    producedQuantity,
                    realCost,
                    realUnitCost,
                    finishedAt: new Date(),
                    finishedById: userId,
                    notes: payload.notes === undefined ? undefined : payload.notes
                },
                include: this.orderInclude()
            });

            await AuditLogService.log({
                companyId, userId, entityType: 'ProductionOrder', entityId: id,
                action: 'UPDATE',
                details: {
                    status: 'FINISHED',
                    plannedQuantity: Number(lockedOrder.plannedQuantity),
                    producedQuantity,
                    realCost,
                    realUnitCost
                }
            }, tx);

            return {
                updated,
                realCost,
                realUnitCost,
                producedQuantity,
                plannedQuantity: Number(lockedOrder.plannedQuantity)
            };
        });

        return result.updated;
    }

    // ==========================================
    // Cancel (with inventory reversal if finished)
    // ==========================================
    static async cancel(id: number, companyId: number, userId: number, reason?: string) {
        const cancelReason = reason?.trim();
        if (!cancelReason) throw new Error('El motivo de anulación es requerido.');
        const order = await prisma.productionOrder.findFirst({
            where: { id, companyId },
            include: { items: true }
        });
        if (!order) throw new Error('Orden de producción no encontrada');
        if (order.status === 'CANCELLED') throw new Error('La orden ya está anulada.');

        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`ProductionOrder\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const lockedOrder = await tx.productionOrder.findFirst({
                where: { id, companyId },
                include: { items: true }
            });
            if (!lockedOrder) throw new Error('Orden de producción no encontrada');
            if (lockedOrder.status === 'CANCELLED') throw new Error('La orden ya está anulada.');

            const wasFinished = lockedOrder.status === 'FINISHED';
            if (wasFinished) {
                const productIds = [...new Set([
                    lockedOrder.productId,
                    ...lockedOrder.items.map((item) => item.componentProductId)
                ])].sort((a, b) => a - b);
                for (const productId of productIds) {
                    await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
                }
                // Reverse the produced OUTPUT: take it back OUT of stock (valued at
                // the product's current moving-average cost — bespoke, passed
                // explicitly so the engine preserves the legacy number).
                const producedQuantity = Number(lockedOrder.producedQuantity);
                if (producedQuantity > 0) {
                    const product = await tx.product.findFirst({
                        where: { id: lockedOrder.productId, companyId },
                        select: { name: true }
                    });
                    // Friendly guard: cannot reverse if the produced output is no
                    // longer fully in stock (already consumed/sold). The engine's
                    // own locked check is the race-safe backstop.
                    const outStock = await tx.stock.findUnique({
                        where: { warehouseId_productId: { warehouseId: lockedOrder.warehouseId, productId: lockedOrder.productId } },
                        select: { quantity: true }
                    });
                    const currentQty = outStock ? Number(outStock.quantity) : 0;
                    if (currentQty < producedQuantity) {
                        throw new Error(
                            'No se puede anular: el producto fabricado ya fue consumido/vendido y no hay existencia suficiente para revertir.'
                        );
                    }
                    // Reconcile against the original production entry, not the
                    // product's later moving average. The exact source layer guard
                    // below ensures only this order's still-open output is removed.
                    const unitCost = Number(lockedOrder.realUnitCost);
                    await InventoryEngineService.applyMovement(tx, {
                        type: 'OUT',
                        companyId,
                        warehouseId: lockedOrder.warehouseId,
                        productId: lockedOrder.productId,
                        userId,
                        quantity: producedQuantity,
                        unitCost,
                        reason: `Anulación producción ${lockedOrder.code}: reversa de producto fabricado`,
                        reference: PROD_REF(lockedOrder.id),
                        consumeSourceRef: PROD_REF(lockedOrder.id),
                        productName: product?.name
                    });
                }

                // Restore consumed inputs back IN (valued at the cost they were
                // consumed at — bespoke item.unitCost) and fold that inbound into
                // the component's moving average when using WA. Without this, WA
                // stays stale when an intervening receipt changed the average
                // between finish and cancel. FIFO averages are refreshed by the
                // engine from remaining layers.
                const companyCosting = await tx.company.findUnique({
                    where: { id: companyId },
                    select: { costingMethod: true }
                });
                const isFifoCosting = (companyCosting?.costingMethod || 'WEIGHTED_AVERAGE') === 'FIFO';
                const orderedItems = [...lockedOrder.items].sort((a, b) => a.componentProductId - b.componentProductId);
                for (const item of orderedItems) {
                    const consumed = Number(item.consumedQuantity);
                    if (consumed <= 0) continue;
                    const storedLayers = Array.isArray(item.consumedLayers)
                        ? item.consumedLayers.map((raw) => {
                            const layer = raw as Record<string, unknown>;
                            return {
                                quantity: Number(layer.quantity),
                                unitCost: Number(layer.unitCost),
                                sourceRef: typeof layer.sourceRef === 'string' ? layer.sourceRef : null,
                                sourceType: typeof layer.sourceType === 'string'
                                    ? layer.sourceType as 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT' | 'TRANSFER' | 'OPENING'
                                    : 'ADJUSTMENT' as const,
                                createdAt: typeof layer.createdAt === 'string' ? new Date(layer.createdAt) : undefined
                            };
                        }).filter((layer) =>
                            Number.isFinite(layer.quantity) && layer.quantity > 0 &&
                            Number.isFinite(layer.unitCost) && layer.unitCost >= 0 &&
                            (!layer.createdAt || !Number.isNaN(layer.createdAt.getTime()))
                        )
                        : [];
                    const restoredQuantity = storedLayers.reduce((sum, layer) => sum + layer.quantity, 0);
                    const exactLayers = Math.abs(restoredQuantity - consumed) <= 1e-6 ? storedLayers : undefined;
                    const restoreUnitCost = exactLayers && exactLayers.length > 0
                        ? exactLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCost, 0) / consumed
                        : Number(item.unitCost);

                    await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${item.componentProductId} AND companyId = ${companyId} FOR UPDATE`;
                    const componentGlobalAgg = await tx.stock.aggregate({
                        where: { productId: item.componentProductId, companyId },
                        _sum: { quantity: true }
                    });
                    const previousComponentStock = Number(componentGlobalAgg._sum.quantity || 0);

                    await InventoryEngineService.applyMovement(tx, {
                        type: 'IN',
                        companyId,
                        warehouseId: lockedOrder.warehouseId,
                        productId: item.componentProductId,
                        userId,
                        quantity: consumed,
                        unitCost: restoreUnitCost,
                        inboundLayers: exactLayers,
                        reason: `Anulación producción ${lockedOrder.code}: reversa de insumo`,
                        reference: PROD_REF(lockedOrder.id),
                        sourceType: exactLayers ? undefined : 'ADJUSTMENT'
                    });

                    // WA needs an explicit fold. FIFO IN does not auto-sync
                    // (preserves receipt history snapshots), so refresh here.
                    if (isFifoCosting) {
                        await CostingService.syncFifoCurrentAverageCost(
                            tx,
                            item.componentProductId,
                            companyId
                        );
                    } else {
                        await CostingService.applyProductionCost(
                            tx,
                            item.componentProductId,
                            companyId,
                            consumed,
                            restoreUnitCost,
                            previousComponentStock
                        );
                    }
                }

                // Exact cost reversal (#1): remove this order's ProductCostHistory
                // entry and recompute the product cost from the remaining history,
                // INSIDE the transaction (replaces the previous partial post-commit
                // recalculateProductCost).
                await CostingService.reverseProductionCost(tx, id, companyId);
            }

            await tx.productionOrder.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    cancelledAt: new Date(),
                    cancelledById: userId,
                    cancelReason
                }
            });
            await AuditLogService.log({
                companyId, userId, entityType: 'ProductionOrder', entityId: id,
                action: 'CANCEL', details: { reason: cancelReason, wasFinished }
            }, tx);
            return { wasFinished };
        });

        return this.getById(id, companyId);
    }
}

function round6(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000;
}
