import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { AuditLogService } from './audit-log.service';
import { effectiveUnitCost } from '../utils/product-cost';

type Tx = Prisma.TransactionClient;

export interface RecipeComponentInput {
    componentProductId: number;
    quantity: number;
    unitId?: number | null;
    unit?: string | null;
    notes?: string | null;
}

export interface CreateRecipeInput {
    productId: number;
    name?: string;
    yieldQuantity: number;
    yieldUnitId?: number | null;
    notes?: string | null;
    components: RecipeComponentInput[];
    activate?: boolean; // create directly as ACTIVE
}

export interface UpdateRecipeInput {
    name?: string;
    yieldQuantity?: number;
    yieldUnitId?: number | null;
    notes?: string | null;
    components?: RecipeComponentInput[];
}

/** Product types that can be the OUTPUT of a production recipe. */
const PRODUCIBLE_TYPES = ['INTERMEDIATE', 'PRODUCT_FOR_SALE', 'BOTH'] as const;

export interface RecipeCostBreakdownLine {
    componentProductId: number;
    componentName: string;
    componentType: string;
    unit: string;
    baseUnit: string;
    quantity: number; // in component `unit`
    baseQuantity: number; // converted to component base unit
    unitCost: number; // currentAverageCost per base unit
    totalCost: number;
}

export interface RecipeCost {
    batchCost: number;
    yieldBaseQuantity: number;
    yieldBaseUnit: string;
    unitCost: number; // cost per OUTPUT base unit
    lines: RecipeCostBreakdownLine[];
}

export class ProductionRecipeService {
    // ==========================================
    // Reads
    // ==========================================

    static recipeInclude() {
        return {
            product: {
                select: {
                    id: true,
                    name: true,
                    sku: true,
                    type: true,
                    unit: true,
                    baseUnitId: true,
                    baseUnit: { select: { id: true, name: true, abbreviation: true } }
                }
            },
            yieldUnit: { select: { id: true, name: true, abbreviation: true } },
            createdBy: { select: { id: true, name: true } },
            components: {
                include: {
                    componentProduct: {
                        select: { id: true, name: true, sku: true, type: true, unit: true, currentAverageCost: true, cost: true }
                    },
                    unitOfMeasure: { select: { id: true, name: true, abbreviation: true } }
                }
            }
        } satisfies Prisma.ProductionRecipeInclude;
    }

    static async list(
        companyId: number,
        filters?: { productId?: number; status?: string; search?: string }
    ) {
        const where: Prisma.ProductionRecipeWhereInput = { companyId };
        if (filters?.productId) where.productId = filters.productId;
        if (filters?.status) where.status = filters.status as Prisma.EnumProductionRecipeStatusFilter['equals'];
        if (filters?.search) {
            where.OR = [
                { name: { contains: filters.search } },
                { product: { name: { contains: filters.search } } },
                { product: { sku: { contains: filters.search } } }
            ];
        }

        const recipes = await prisma.productionRecipe.findMany({
            where,
            include: this.recipeInclude(),
            orderBy: [{ productId: 'asc' }, { version: 'desc' }]
        });

        // attach estimated cost to each
        return Promise.all(
            recipes.map(async (r) => ({
                ...r,
                ...(await this.computeRecipeCost(r.id, companyId)
                    .then((cost) => ({ cost, costError: null }))
                    .catch((error: unknown) => ({
                        cost: null,
                        costError: error instanceof Error ? error.message : String(error)
                    })))
            }))
        );
    }

    static async getById(id: number, companyId: number) {
        const recipe = await prisma.productionRecipe.findFirst({
            where: { id, companyId },
            include: this.recipeInclude()
        });
        if (!recipe) throw new Error('Receta de producción no encontrada');
        try {
            const cost = await this.computeRecipeCost(id, companyId);
            return { ...recipe, cost, costError: null };
        } catch (error: unknown) {
            return { ...recipe, cost: null, costError: error instanceof Error ? error.message : String(error) };
        }
    }

    /** Active recipe for a given output product (used by production orders). */
    static async getActiveForProduct(productId: number, companyId: number, db: Tx | typeof prisma = prisma) {
        return db.productionRecipe.findFirst({
            where: { productId, companyId, status: 'ACTIVE' },
            include: this.recipeInclude(),
            orderBy: { version: 'desc' }
        });
    }

    // ==========================================
    // Cost computation (shared with production)
    // ==========================================

    /**
     * Compute estimated cost of producing ONE BATCH (the recipe yield), using each
     * component's current weighted-average cost converted to base units. Also returns
     * the yield expressed in the OUTPUT product's base unit so callers can derive a
     * per-unit cost and scale to any production quantity.
     */
    static async computeRecipeCost(
        recipeId: number,
        companyId: number,
        db: Tx | typeof prisma = prisma
    ): Promise<RecipeCost> {
        const recipe = await db.productionRecipe.findFirst({
            where: { id: recipeId, companyId },
            include: {
                product: { select: { id: true, unit: true } },
                yieldUnit: { select: { abbreviation: true } },
                components: {
                    include: {
                        componentProduct: { select: { id: true, name: true, type: true, unit: true, currentAverageCost: true, cost: true } },
                        unitOfMeasure: { select: { abbreviation: true } }
                    }
                }
            }
        });
        if (!recipe) throw new Error('Receta de producción no encontrada');

        const lines: RecipeCostBreakdownLine[] = [];
        let batchCost = 0;

        for (const c of recipe.components) {
            const unitAbbr = c.unitOfMeasure?.abbreviation || c.unit || c.componentProduct.unit;
            const conv = await UnitConversionService.convert(
                c.componentProductId,
                companyId,
                Number(c.quantity),
                unitAbbr,
                db as Tx
            );
            const unitCost = effectiveUnitCost(
                c.componentProduct.currentAverageCost,
                c.componentProduct.cost
            );
            const totalCost = conv.baseQuantity * unitCost;
            batchCost += totalCost;
            lines.push({
                componentProductId: c.componentProductId,
                componentName: c.componentProduct.name,
                componentType: c.componentProduct.type,
                unit: unitAbbr,
                baseUnit: conv.baseUnit,
                quantity: Number(c.quantity),
                baseQuantity: conv.baseQuantity,
                unitCost,
                totalCost
            });
        }

        // Convert recipe yield into the OUTPUT product's base unit.
        const yieldUnitAbbr = recipe.yieldUnit?.abbreviation || recipe.product.unit;
        const yieldConv = await UnitConversionService.convert(
            recipe.productId,
            companyId,
            Number(recipe.yieldQuantity),
            yieldUnitAbbr,
            db as Tx
        );
        const yieldBaseQuantity = yieldConv.baseQuantity;
        const unitCost = yieldBaseQuantity > 0 ? batchCost / yieldBaseQuantity : 0;

        return {
            batchCost: round6(batchCost),
            yieldBaseQuantity,
            yieldBaseUnit: yieldConv.baseUnit,
            unitCost: round6(unitCost),
            lines
        };
    }

    static async previewCost(companyId: number, data: {
        productId: number;
        yieldQuantity: number;
        yieldUnitId?: number | null;
        components: RecipeComponentInput[];
    }): Promise<RecipeCost> {
        const output = await this.validateOutputProduct(data.productId, companyId);
        await this.validateComponents(companyId, data.components);
        if (!Number.isFinite(data.yieldQuantity) || data.yieldQuantity <= 0) {
            throw new Error('El rendimiento debe ser un número mayor a 0.');
        }

        const componentProducts = await prisma.product.findMany({
            where: { companyId, id: { in: data.components.map(component => component.componentProductId) } },
            select: { id: true, name: true, type: true, unit: true, currentAverageCost: true, cost: true }
        });
        const unitIds = [
            ...data.components.flatMap(component => component.unitId ? [component.unitId] : []),
            ...(data.yieldUnitId ? [data.yieldUnitId] : [])
        ];
        const units = unitIds.length > 0
            ? await prisma.unitOfMeasure.findMany({
                where: { companyId, id: { in: [...new Set(unitIds)] } },
                select: { id: true, abbreviation: true }
            })
            : [];
        const unitById = new Map(units.map(unit => [unit.id, unit.abbreviation]));
        if (units.length !== new Set(unitIds).size) {
            throw new Error('Una o más unidades no pertenecen a esta empresa.');
        }

        const lines: RecipeCostBreakdownLine[] = [];
        let batchCost = 0;
        for (const component of data.components) {
            const product = componentProducts.find(candidate => candidate.id === component.componentProductId)!;
            const unit = component.unitId
                ? unitById.get(component.unitId)!
                : component.unit || product.unit;
            const conversion = await UnitConversionService.convert(
                product.id,
                companyId,
                Number(component.quantity),
                unit
            );
            const unitCost = effectiveUnitCost(product.currentAverageCost, product.cost);
            const totalCost = conversion.baseQuantity * unitCost;
            batchCost += totalCost;
            lines.push({
                componentProductId: product.id,
                componentName: product.name,
                componentType: product.type,
                unit,
                baseUnit: conversion.baseUnit,
                quantity: Number(component.quantity),
                baseQuantity: conversion.baseQuantity,
                unitCost,
                totalCost: round6(totalCost)
            });
        }

        const yieldUnit = data.yieldUnitId
            ? unitById.get(data.yieldUnitId)!
            : output.unit;
        const yieldConversion = await UnitConversionService.convert(
            output.id,
            companyId,
            data.yieldQuantity,
            yieldUnit
        );
        return {
            batchCost: round6(batchCost),
            yieldBaseQuantity: yieldConversion.baseQuantity,
            yieldBaseUnit: yieldConversion.baseUnit,
            unitCost: round6(batchCost / yieldConversion.baseQuantity),
            lines
        };
    }

    // ==========================================
    // Circular dependency validation
    // ==========================================

    /**
     * Detect whether using `componentProductIds` as inputs to produce
     * `outputProductId` would create a circular dependency (directly or
     * transitively through other ACTIVE production recipes).
     *
     * Throws with a descriptive message if a cycle is found.
     */
    static async assertNoCircularDependency(
        companyId: number,
        outputProductId: number,
        componentProductIds: number[],
        excludeRecipeId?: number,
        db: Tx | typeof prisma = prisma
    ): Promise<void> {
        // Direct self-reference
        if (componentProductIds.includes(outputProductId)) {
            throw new Error('Una receta no puede contener su propio producto como insumo.');
        }

        // DFS from each component following ACTIVE recipes' components.
        const visited = new Set<number>();

        const dfs = async (productId: number, path: number[]): Promise<void> => {
            if (productId === outputProductId) {
                throw new Error(
                    `Dependencia circular detectada: el producto ${outputProductId} no puede depender de sí mismo a través de la cadena de recetas (${path.join(' -> ')}).`
                );
            }
            if (visited.has(productId)) return;
            visited.add(productId);

            const activeRecipe = await db.productionRecipe.findFirst({
                where: {
                    productId,
                    companyId,
                    status: 'ACTIVE',
                    ...(excludeRecipeId ? { id: { not: excludeRecipeId } } : {})
                },
                include: { components: { select: { componentProductId: true } } }
            });
            if (!activeRecipe) return;

            for (const comp of activeRecipe.components) {
                await dfs(comp.componentProductId, [...path, comp.componentProductId]);
            }
        };

        for (const cid of componentProductIds) {
            await dfs(cid, [outputProductId, cid]);
        }
    }

    // ==========================================
    // Validation helpers
    // ==========================================

    private static async validateOutputProduct(
        productId: number,
        companyId: number,
        db: Tx | typeof prisma = prisma
    ) {
        const product = await db.product.findFirst({ where: { id: productId, companyId, active: true } });
        if (!product) throw new Error('Producto de salida no encontrado.');
        if (!PRODUCIBLE_TYPES.includes(product.type as typeof PRODUCIBLE_TYPES[number])) {
            throw new Error(
                'El producto de salida debe ser de tipo INTERMEDIATE (semielaborado) o PRODUCT_FOR_SALE/BOTH (terminado). ' +
                `Tipo actual: ${product.type}.`
            );
        }
        return product;
    }

    private static async validateComponents(
        companyId: number,
        components: RecipeComponentInput[],
        db: Tx | typeof prisma = prisma
    ) {
        if (!components || components.length === 0) {
            throw new Error('La receta debe tener al menos un componente.');
        }
        const ids = components.map((c) => c.componentProductId);
        if (new Set(ids).size !== ids.length) {
            throw new Error('La receta tiene componentes duplicados.');
        }
        const products = await db.product.findMany({
            where: { id: { in: ids }, companyId, active: true },
            select: { id: true, name: true, unit: true }
        });
        const found = new Set(products.map((p) => p.id));
        for (const c of components) {
            if (!found.has(c.componentProductId)) {
                throw new Error(`Componente con id ${c.componentProductId} no existe en la empresa.`);
            }
            if (!(c.quantity > 0)) {
                throw new Error('La cantidad de cada componente debe ser mayor a 0.');
            }
        }
        const unitIds = components.flatMap(component => component.unitId ? [component.unitId] : []);
        const units = unitIds.length > 0
            ? await db.unitOfMeasure.findMany({
                where: { companyId, id: { in: [...new Set(unitIds)] }, active: true },
                select: { id: true, abbreviation: true }
            })
            : [];
        const unitById = new Map(units.map(unit => [unit.id, unit.abbreviation]));
        if (units.length !== new Set(unitIds).size) {
            throw new Error('Una o más unidades de componentes no pertenecen a esta empresa.');
        }
        // Validate unit compatibility for every component (throws if incompatible).
        for (const c of components) {
            const prod = products.find((p) => p.id === c.componentProductId)!;
            const unitAbbr = c.unitId ? unitById.get(c.unitId)! : c.unit || prod.unit;
            await UnitConversionService.convert(c.componentProductId, companyId, Number(c.quantity), unitAbbr, db as Tx);
        }
    }

    private static async validateYield(
        companyId: number,
        productId: number,
        yieldQuantity: number,
        yieldUnitId?: number | null,
        db: Tx | typeof prisma = prisma
    ): Promise<void> {
        if (!Number.isFinite(yieldQuantity) || yieldQuantity <= 0) {
            throw new Error('El rendimiento (yieldQuantity) debe ser un número finito mayor a 0.');
        }

        let unitAbbreviation: string | undefined;
        if (yieldUnitId != null) {
            const yieldUnit = await db.unitOfMeasure.findFirst({
                where: { id: yieldUnitId, companyId, active: true },
                select: { abbreviation: true }
            });
            if (!yieldUnit) {
                throw new Error('La unidad de rendimiento no existe, está inactiva o no pertenece a la empresa.');
            }
            unitAbbreviation = yieldUnit.abbreviation;
        } else {
            const output = await db.product.findFirst({
                where: { id: productId, companyId },
                select: { unit: true, baseUnit: { select: { abbreviation: true } } }
            });
            if (!output) throw new Error('Producto de salida no encontrado.');
            unitAbbreviation = output.baseUnit?.abbreviation || output.unit;
        }

        // This validates dimensional compatibility and rejects unsafe implicit 1:1
        // conversions before the recipe can be persisted or activated.
        await UnitConversionService.convert(productId, companyId, yieldQuantity, unitAbbreviation, db as Tx);
    }

    // ==========================================
    // Mutations
    // ==========================================

    static async create(companyId: number, data: CreateRecipeInput, userId?: number) {
        const product = await this.validateOutputProduct(data.productId, companyId);
        await this.validateComponents(companyId, data.components);
        await this.validateYield(companyId, data.productId, data.yieldQuantity, data.yieldUnitId);
        await this.assertNoCircularDependency(
            companyId,
            data.productId,
            data.components.map((c) => c.componentProductId)
        );

        const created = await prisma.$transaction(async (tx) => {
            // Serialize recipe graph mutations per tenant. Locking only the output
            // product would let concurrent A->B and B->A activations both pass the
            // cycle check and commit a circular dependency.
            await tx.$queryRaw`SELECT id FROM \`Company\` WHERE id = ${companyId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${data.productId} AND companyId = ${companyId} FOR UPDATE`;
            await this.validateOutputProduct(data.productId, companyId, tx);
            await this.validateComponents(companyId, data.components, tx);
            await this.validateYield(companyId, data.productId, data.yieldQuantity, data.yieldUnitId, tx);
            if (data.activate) {
                await this.assertNoCircularDependency(
                    companyId,
                    data.productId,
                    data.components.map((component) => component.componentProductId),
                    undefined,
                    tx
                );
            }
            const last = await tx.productionRecipe.findFirst({
                where: { companyId, productId: data.productId },
                orderBy: { version: 'desc' },
                select: { version: true }
            });
            const version = (last?.version || 0) + 1;

            // If activating, deactivate other active versions for this product.
            if (data.activate) {
                await tx.productionRecipe.updateMany({
                    where: { companyId, productId: data.productId, status: 'ACTIVE' },
                    data: { status: 'INACTIVE' }
                });
            }

            return tx.productionRecipe.create({
                data: {
                    companyId,
                    productId: data.productId,
                    name: data.name?.trim() || `Receta de ${product.name}`,
                    version,
                    status: data.activate ? 'ACTIVE' : 'DRAFT',
                    yieldQuantity: data.yieldQuantity,
                    yieldUnitId: data.yieldUnitId ?? null,
                    notes: data.notes ?? null,
                    createdById: userId ?? null,
                    components: {
                        create: data.components.map((c) => ({
                            componentProductId: c.componentProductId,
                            quantity: c.quantity,
                            unitId: c.unitId ?? null,
                            unit: c.unit ?? null,
                            notes: c.notes ?? null
                        }))
                    }
                },
                include: this.recipeInclude()
            });
        });

        if (userId) {
            AuditLogService.log({
                companyId, userId, entityType: 'ProductionRecipe', entityId: created.id,
                action: 'CREATE',
                details: { productId: data.productId, version: created.version, status: created.status, components: data.components.length }
            }).catch((err) => console.error('[ProductionRecipeService] audit log failed:', err));
        }

        return this.getById(created.id, companyId);
    }

    static async update(id: number, companyId: number, data: UpdateRecipeInput, userId?: number) {
        const existing = await prisma.productionRecipe.findFirst({
            where: { id, companyId },
            include: { components: true }
        });
        if (!existing) throw new Error('Receta de producción no encontrada');
        if (existing.status !== 'DRAFT') {
            throw new Error('Solo se pueden editar recetas en borrador. Cree una nueva versión para conservar la trazabilidad.');
        }

        if (data.components) {
            await this.validateComponents(companyId, data.components);
            await this.assertNoCircularDependency(
                companyId,
                existing.productId,
                data.components.map((c) => c.componentProductId),
                id
            );
        }
        if (data.yieldQuantity !== undefined || data.yieldUnitId !== undefined) {
            await this.validateYield(
                companyId,
                existing.productId,
                data.yieldQuantity ?? Number(existing.yieldQuantity),
                data.yieldUnitId === undefined ? existing.yieldUnitId : data.yieldUnitId
            );
        }

        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`ProductionRecipe\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const locked = await tx.productionRecipe.findFirst({ where: { id, companyId } });
            if (!locked) throw new Error('Receta de producción no encontrada');
            if (locked.status !== 'DRAFT') {
                throw new Error('Solo se pueden editar recetas en borrador. Cree una nueva versión para conservar la trazabilidad.');
            }
            await tx.productionRecipe.update({
                where: { id },
                data: {
                    name: data.name?.trim() || undefined,
                    yieldQuantity: data.yieldQuantity ?? undefined,
                    yieldUnitId: data.yieldUnitId === undefined ? undefined : data.yieldUnitId,
                    notes: data.notes === undefined ? undefined : data.notes
                }
            });

            if (data.components) {
                await tx.productionRecipeComponent.deleteMany({ where: { recipeId: id } });
                await tx.productionRecipeComponent.createMany({
                    data: data.components.map((c) => ({
                        recipeId: id,
                        componentProductId: c.componentProductId,
                        quantity: c.quantity,
                        unitId: c.unitId ?? null,
                        unit: c.unit ?? null,
                        notes: c.notes ?? null
                    }))
                });
            }
        });

        if (userId) {
            AuditLogService.log({
                companyId, userId, entityType: 'ProductionRecipe', entityId: id,
                action: 'UPDATE', details: { fields: Object.keys(data) }
            }).catch((err) => console.error('[ProductionRecipeService] audit log failed:', err));
        }

        return this.getById(id, companyId);
    }

    /** Change recipe status: ACTIVE deactivates other active versions of the same product. */
    static async setStatus(id: number, companyId: number, status: 'DRAFT' | 'ACTIVE' | 'INACTIVE', userId?: number) {
        await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Company\` WHERE id = ${companyId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM \`ProductionRecipe\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const recipe = await tx.productionRecipe.findFirst({
                where: { id, companyId },
                include: { components: true }
            });
            if (!recipe) throw new Error('Receta de producción no encontrada');

            const allowed: Record<typeof recipe.status, Array<typeof recipe.status>> = {
                DRAFT: ['DRAFT', 'ACTIVE', 'INACTIVE'],
                ACTIVE: ['ACTIVE', 'INACTIVE'],
                INACTIVE: ['INACTIVE', 'ACTIVE']
            };
            if (!allowed[recipe.status].includes(status)) {
                throw new Error(`Transición de receta inválida: ${recipe.status} -> ${status}.`);
            }

            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${recipe.productId} AND companyId = ${companyId} FOR UPDATE`;
            if (status === 'ACTIVE') {
                if (recipe.components.length === 0) throw new Error('No se puede activar una receta sin componentes.');
                const components = recipe.components.map((component) => ({
                    componentProductId: component.componentProductId,
                    quantity: Number(component.quantity),
                    unitId: component.unitId,
                    unit: component.unit,
                    notes: component.notes
                }));
                await this.validateOutputProduct(recipe.productId, companyId, tx);
                await this.validateComponents(companyId, components, tx);
                await this.validateYield(companyId, recipe.productId, Number(recipe.yieldQuantity), recipe.yieldUnitId, tx);
                await this.assertNoCircularDependency(
                    companyId,
                    recipe.productId,
                    components.map((component) => component.componentProductId),
                    id,
                    tx
                );
                await tx.productionRecipe.updateMany({
                    where: { companyId, productId: recipe.productId, status: 'ACTIVE', id: { not: id } },
                    data: { status: 'INACTIVE' }
                });
            }
            await tx.productionRecipe.update({ where: { id }, data: { status } });
        });

        if (userId) {
            await AuditLogService.log({
                companyId, userId, entityType: 'ProductionRecipe', entityId: id,
                action: 'UPDATE', details: { status }
            });
        }

        return this.getById(id, companyId);
    }

    /** Clone an existing recipe into a new DRAFT version (versionado + trazabilidad). */
    static async createNewVersion(id: number, companyId: number, userId?: number) {
        const source = await prisma.productionRecipe.findFirst({
            where: { id, companyId },
            include: { components: true }
        });
        if (!source) throw new Error('Receta de producción no encontrada');

        return this.create(
            companyId,
            {
                productId: source.productId,
                name: source.name,
                yieldQuantity: Number(source.yieldQuantity),
                yieldUnitId: source.yieldUnitId,
                notes: source.notes,
                components: source.components.map((c) => ({
                    componentProductId: c.componentProductId,
                    quantity: Number(c.quantity),
                    unitId: c.unitId,
                    unit: c.unit,
                    notes: c.notes
                }))
            },
            userId
        );
    }

    static async remove(id: number, companyId: number, userId?: number) {
        const recipe = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`ProductionRecipe\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const locked = await tx.productionRecipe.findFirst({ where: { id, companyId } });
            if (!locked) throw new Error('Receta de producción no encontrada');
            if (locked.status === 'ACTIVE') {
                throw new Error('No se puede eliminar una receta activa. Desactívela primero.');
            }
            const usedByOrders = await tx.productionOrder.count({ where: { recipeId: id, companyId } });
            if (usedByOrders > 0) {
                throw new Error('No se puede eliminar una receta utilizada por órdenes de producción. Desactívela en su lugar.');
            }
            await tx.productionRecipe.delete({ where: { id } });
            return locked;
        });

        if (userId) {
            AuditLogService.log({
                companyId, userId, entityType: 'ProductionRecipe', entityId: id,
                action: 'DELETE', details: { productId: recipe.productId, version: recipe.version }
            }).catch((err) => console.error('[ProductionRecipeService] audit log failed:', err));
        }

        return { success: true };
    }
}

function round6(n: number): number {
    return Math.round(n * 1_000_000) / 1_000_000;
}
