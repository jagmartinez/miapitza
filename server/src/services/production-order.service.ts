import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { CostingService } from './costing.service';
import { ProductionRecipeService } from './production-recipe.service';
import { AuditLogService } from './audit-log.service';

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
            product: { select: { id: true, name: true, sku: true, type: true, unit: true } },
            recipe: { select: { id: true, name: true, version: true, yieldQuantity: true } },
            warehouse: { select: { id: true, name: true, code: true } },
            branch: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } },
            cancelledBy: { select: { id: true, name: true } },
            items: {
                include: {
                    componentProduct: { select: { id: true, name: true, sku: true, type: true, unit: true } },
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
        if (!(plannedQuantity > 0)) throw new Error('La cantidad a producir debe ser mayor a 0.');

        let recipe;
        if (params.recipeId) {
            recipe = await db.productionRecipe.findFirst({
                where: { id: params.recipeId, companyId, productId },
                include: { components: { select: { componentProductId: true } } }
            });
            if (!recipe) throw new Error('La receta indicada no existe o no corresponde al producto.');
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
        // Validate warehouse belongs to company (and branch if scoped)
        const warehouse = await prisma.warehouse.findFirst({
            where: { id: data.warehouseId, companyId },
            select: { id: true, branchId: true }
        });
        if (!warehouse) throw new Error('Almacén no encontrado.');

        const preview = await this.computeRequirements(companyId, {
            productId: data.productId,
            recipeId: data.recipeId,
            plannedQuantity: data.plannedQuantity,
            warehouseId: data.warehouseId
        });

        const order = await prisma.$transaction(async (tx) => {
            const code = await this.generateCode(companyId, tx);
            return tx.productionOrder.create({
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
                    date: data.date ? new Date(data.date) : new Date(),
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
        });

        AuditLogService.log({
            companyId, userId, entityType: 'ProductionOrder', entityId: order.id,
            action: 'CREATE',
            details: { code: order.code, productId: data.productId, plannedQuantity: data.plannedQuantity, status: order.status }
        }).catch((err) => console.error('[ProductionOrderService] audit log failed:', err));

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

        const plannedQuantity = data.plannedQuantity ?? Number(order.plannedQuantity);
        const warehouseId = data.warehouseId ?? order.warehouseId;
        const recipeId = data.recipeId ?? order.recipeId ?? undefined;

        const preview = await this.computeRequirements(companyId, {
            productId: order.productId,
            recipeId,
            plannedQuantity,
            warehouseId
        });

        await prisma.$transaction(async (tx) => {
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
        });

        AuditLogService.log({
            companyId, userId, entityType: 'ProductionOrder', entityId: id,
            action: 'UPDATE', details: { plannedQuantity, warehouseId }
        }).catch((err) => console.error('[ProductionOrderService] audit log failed:', err));

        return this.getById(id, companyId);
    }

    /** Simple status transitions that do NOT touch inventory (DRAFT/PENDING/IN_PROGRESS). */
    static async setStatus(id: number, companyId: number, status: 'PENDING' | 'IN_PROGRESS' | 'DRAFT', userId: number) {
        const order = await prisma.productionOrder.findFirst({ where: { id, companyId } });
        if (!order) throw new Error('Orden de producción no encontrada');
        if (order.status === 'FINISHED' || order.status === 'CANCELLED') {
            throw new Error('La orden ya está finalizada o anulada.');
        }
        const data: Prisma.ProductionOrderUpdateInput = { status };
        if (status === 'IN_PROGRESS' && !order.startedAt) data.startedAt = new Date();
        await prisma.productionOrder.update({ where: { id }, data });

        AuditLogService.log({
            companyId, userId, entityType: 'ProductionOrder', entityId: id,
            action: 'UPDATE', details: { status }
        }).catch((err) => console.error('[ProductionOrderService] audit log failed:', err));

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
        if (order.items.length === 0) throw new Error('La orden no tiene insumos definidos.');

        // Re-validate the recipe still exists / active for traceability
        if (order.recipeId) {
            const recipe = await prisma.productionRecipe.findFirst({ where: { id: order.recipeId, companyId } });
            if (!recipe) throw new Error('La receta utilizada ya no existe.');
        }

        const producedQuantity = payload.producedQuantity ?? Number(order.plannedQuantity);
        if (!(producedQuantity > 0)) throw new Error('La cantidad producida debe ser mayor a 0.');

        // Map of real consumption overrides
        const overrides = new Map<number, number>();
        for (const c of payload.consumptions || []) {
            overrides.set(c.componentProductId, c.consumedQuantity);
        }

        const result = await prisma.$transaction(async (tx) => {
            let realCost = 0;
            const consumedSnapshot: Array<{ componentProductId: number; consumedQuantity: number; unitCost: number; totalCost: number }> = [];

            // 1. Consume inputs (OUT)
            for (const item of order.items) {
                const consumedQuantity = overrides.has(item.componentProductId)
                    ? Number(overrides.get(item.componentProductId))
                    : Number(item.requiredQuantity);

                if (consumedQuantity < 0) throw new Error('La cantidad consumida no puede ser negativa.');
                if (consumedQuantity === 0) {
                    await tx.productionOrderItem.update({
                        where: { id: item.id },
                        data: { consumedQuantity: 0, totalCost: 0 }
                    });
                    continue;
                }

                const product = await tx.product.findFirst({
                    where: { id: item.componentProductId, companyId },
                    select: { id: true, name: true, currentAverageCost: true, cost: true }
                });
                if (!product) throw new Error(`Componente ${item.componentProductId} no encontrado.`);

                const stock = await tx.stock.findUnique({
                    where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.componentProductId } }
                });
                const currentQty = stock ? Number(stock.quantity) : 0;

                if (!payload.allowNegative && currentQty < consumedQuantity) {
                    throw new Error(
                        `Stock insuficiente de "${product.name}". Requerido: ${consumedQuantity}, Disponible: ${currentQty}. ` +
                        `Produzca primero el insumo o ajuste el inventario.`
                    );
                }

                const newQty = currentQty - consumedQuantity;
                const unitCost = Number(product.currentAverageCost || product.cost || 0);
                const totalCost = unitCost * consumedQuantity;
                realCost += totalCost;

                if (stock) {
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.componentProductId } },
                        data: { quantity: newQty }
                    });
                } else {
                    await tx.stock.create({
                        data: { companyId, warehouseId: order.warehouseId, productId: item.componentProductId, quantity: newQty }
                    });
                }

                await tx.inventoryMovement.create({
                    data: {
                        companyId,
                        warehouseId: order.warehouseId,
                        productId: item.componentProductId,
                        userId,
                        type: 'OUT',
                        quantity: consumedQuantity,
                        unitCost,
                        totalCost,
                        balanceQty: newQty,
                        balanceCost: newQty * unitCost,
                        reason: `Producción ${order.code}: consumo de insumo`,
                        reference: PROD_REF(order.id)
                    }
                });

                await tx.productionOrderItem.update({
                    where: { id: item.id },
                    data: { consumedQuantity, unitCost, totalCost }
                });

                consumedSnapshot.push({ componentProductId: item.componentProductId, consumedQuantity, unitCost, totalCost });
            }

            realCost = round6(realCost);
            const realUnitCost = producedQuantity > 0 ? round6(realCost / producedQuantity) : 0;

            // 2. Produce output (IN) at real unit cost
            const outStock = await tx.stock.findUnique({
                where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: order.productId } }
            });
            const previousStock = outStock ? Number(outStock.quantity) : 0;
            const newOutQty = previousStock + producedQuantity;

            if (outStock) {
                await tx.stock.update({
                    where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: order.productId } },
                    data: { quantity: newOutQty }
                });
            } else {
                await tx.stock.create({
                    data: { companyId, warehouseId: order.warehouseId, productId: order.productId, quantity: newOutQty }
                });
            }

            await tx.inventoryMovement.create({
                data: {
                    companyId,
                    warehouseId: order.warehouseId,
                    productId: order.productId,
                    userId,
                    type: 'IN',
                    quantity: producedQuantity,
                    unitCost: realUnitCost,
                    totalCost: realCost,
                    balanceQty: newOutQty,
                    balanceCost: newOutQty * realUnitCost,
                    reason: `Producción ${order.code}: entrada de producto fabricado`,
                    reference: PROD_REF(order.id)
                }
            });

            // 3. Fold into the OUTPUT product's weighted-average cost
            await CostingService.applyProductionCost(tx, order.productId, companyId, producedQuantity, realUnitCost, previousStock);

            // 4. Mark order finished
            const updated = await tx.productionOrder.update({
                where: { id },
                data: {
                    status: 'FINISHED',
                    producedQuantity,
                    realCost,
                    realUnitCost,
                    finishedAt: new Date(),
                    notes: payload.notes === undefined ? undefined : payload.notes
                },
                include: this.orderInclude()
            });

            return { updated, realCost, realUnitCost, producedQuantity };
        });

        AuditLogService.log({
            companyId, userId, entityType: 'ProductionOrder', entityId: id,
            action: 'UPDATE',
            details: {
                status: 'FINISHED',
                plannedQuantity: Number(order.plannedQuantity),
                producedQuantity: result.producedQuantity,
                realCost: result.realCost,
                realUnitCost: result.realUnitCost
            }
        }).catch((err) => console.error('[ProductionOrderService] audit log failed:', err));

        return result.updated;
    }

    // ==========================================
    // Cancel (with inventory reversal if finished)
    // ==========================================
    static async cancel(id: number, companyId: number, userId: number, reason?: string) {
        const order = await prisma.productionOrder.findFirst({
            where: { id, companyId },
            include: { items: true }
        });
        if (!order) throw new Error('Orden de producción no encontrada');
        if (order.status === 'CANCELLED') throw new Error('La orden ya está anulada.');

        const wasFinished = order.status === 'FINISHED';

        await prisma.$transaction(async (tx) => {
            if (wasFinished) {
                // Reverse the produced OUTPUT: take it back OUT of stock.
                const producedQuantity = Number(order.producedQuantity);
                if (producedQuantity > 0) {
                    const outStock = await tx.stock.findUnique({
                        where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: order.productId } }
                    });
                    const currentQty = outStock ? Number(outStock.quantity) : 0;
                    if (currentQty < producedQuantity) {
                        throw new Error(
                            'No se puede anular: el producto fabricado ya fue consumido/vendido y no hay existencia suficiente para revertir.'
                        );
                    }
                    const product = await tx.product.findFirst({
                        where: { id: order.productId, companyId },
                        select: { currentAverageCost: true, cost: true }
                    });
                    const unitCost = Number(product?.currentAverageCost || product?.cost || 0);
                    const newQty = currentQty - producedQuantity;
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: order.productId } },
                        data: { quantity: newQty }
                    });
                    await tx.inventoryMovement.create({
                        data: {
                            companyId,
                            warehouseId: order.warehouseId,
                            productId: order.productId,
                            userId,
                            type: 'OUT',
                            quantity: producedQuantity,
                            unitCost,
                            totalCost: unitCost * producedQuantity,
                            balanceQty: newQty,
                            balanceCost: newQty * unitCost,
                            reason: `Anulación producción ${order.code}: reversa de producto fabricado`,
                            reference: PROD_REF(order.id)
                        }
                    });
                }

                // Restore consumed inputs back IN.
                for (const item of order.items) {
                    const consumed = Number(item.consumedQuantity);
                    if (consumed <= 0) continue;
                    const stock = await tx.stock.findUnique({
                        where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.componentProductId } }
                    });
                    const currentQty = stock ? Number(stock.quantity) : 0;
                    const newQty = currentQty + consumed;
                    const unitCost = Number(item.unitCost);
                    if (stock) {
                        await tx.stock.update({
                            where: { warehouseId_productId: { warehouseId: order.warehouseId, productId: item.componentProductId } },
                            data: { quantity: newQty }
                        });
                    } else {
                        await tx.stock.create({
                            data: { companyId, warehouseId: order.warehouseId, productId: item.componentProductId, quantity: newQty }
                        });
                    }
                    await tx.inventoryMovement.create({
                        data: {
                            companyId,
                            warehouseId: order.warehouseId,
                            productId: item.componentProductId,
                            userId,
                            type: 'IN',
                            quantity: consumed,
                            unitCost,
                            totalCost: unitCost * consumed,
                            balanceQty: newQty,
                            balanceCost: newQty * unitCost,
                            reason: `Anulación producción ${order.code}: reversa de insumo`,
                            reference: PROD_REF(order.id)
                        }
                    });
                }
            }

            await tx.productionOrder.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    cancelledAt: new Date(),
                    cancelledById: userId,
                    cancelReason: reason ?? null
                }
            });
        });

        AuditLogService.log({
            companyId, userId, entityType: 'ProductionOrder', entityId: id,
            action: 'CANCEL', details: { reason, wasFinished }
        }).catch((err) => console.error('[ProductionOrderService] audit log failed:', err));

        return this.getById(id, companyId);
    }
}

function round6(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000;
}
