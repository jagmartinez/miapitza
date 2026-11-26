import type { Prisma, PrismaClient } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaClient;

export type WarehouseRouteRule = {
    warehouseId: number;
    categoryId: number | null;
    productId: number | null;
};

export type WarehouseRouteInput = {
    warehouseId: unknown;
    categoryId?: unknown;
    productId?: unknown;
};

type RouteDelegate = {
    findMany: (args: unknown) => Promise<Array<{
        warehouseId: number;
        categoryId: number | null;
        productId: number | null;
        warehouse?: { companyId: number; branchId: number | null; type: string } | null;
    }>>;
};

/**
 * Per-branch ingredient routing for sale consumption.
 *
 * A sale normally consumes every recipe/modifier line from one warehouse (the
 * order's sale warehouse). A branch may route an inventory product, or every
 * product of a category, to another BRANCH warehouse of that same branch
 * (e.g. drinks from "Bodega Barra", food from "Cocina"):
 *
 *   product rule  >  category rule  >  fallback (sale / waste warehouse)
 *
 * Rules are validated on write and re-checked on read: a rule whose warehouse
 * is no longer a BRANCH warehouse of the branch is ignored (fallback).
 */
export class WarehouseRouteService {
    private static delegate(db: Db): RouteDelegate | null {
        const delegate = (db as unknown as { inventoryWarehouseRoute?: Partial<RouteDelegate> }).inventoryWarehouseRoute;
        return typeof delegate?.findMany === 'function' ? delegate as RouteDelegate : null;
    }

    /** Valid (non-stale) routing rules of a branch. */
    static async loadRules(db: Db, companyId: number, branchId: number): Promise<WarehouseRouteRule[]> {
        const delegate = this.delegate(db);
        if (!delegate) return [];
        const rows = await delegate.findMany({
            where: { companyId, branchId },
            select: {
                warehouseId: true,
                categoryId: true,
                productId: true,
                warehouse: { select: { companyId: true, branchId: true, type: true } }
            },
            orderBy: { id: 'asc' }
        });
        return rows
            .filter((row) => !row.warehouse
                || (row.warehouse.companyId === companyId && row.warehouse.branchId === branchId && row.warehouse.type === 'BRANCH'))
            .map((row) => ({ warehouseId: row.warehouseId, categoryId: row.categoryId ?? null, productId: row.productId ?? null }));
    }

    /**
     * Pure resolution: productId -> warehouse for the given products, from the
     * rules and each product's category. Products without a rule map to
     * `fallbackWarehouseId`.
     */
    static resolveFromRules(
        rules: WarehouseRouteRule[],
        products: Array<{ id: number; categoryId: number | null }>,
        fallbackWarehouseId: number
    ): Map<number, number> {
        const byProduct = new Map<number, number>();
        const byCategory = new Map<number, number>();
        for (const rule of rules) {
            if (rule.productId != null) byProduct.set(rule.productId, rule.warehouseId);
            else if (rule.categoryId != null) byCategory.set(rule.categoryId, rule.warehouseId);
        }
        const resolved = new Map<number, number>();
        for (const product of products) {
            resolved.set(
                product.id,
                byProduct.get(product.id)
                    ?? (product.categoryId != null ? byCategory.get(product.categoryId) : undefined)
                    ?? fallbackWarehouseId
            );
        }
        return resolved;
    }

    /**
     * Routes the given products for a branch. Every requested product id is in
     * the result (fallback when no rule applies).
     */
    static async resolveForBranch(
        db: Db,
        companyId: number,
        branchId: number,
        fallbackWarehouseId: number,
        productIds: Iterable<number>
    ): Promise<Map<number, number>> {
        const ids = [...new Set(productIds)];
        const fallback = new Map(ids.map((id) => [id, fallbackWarehouseId] as const));
        if (ids.length === 0) return fallback;
        const rules = await this.loadRules(db, companyId, branchId);
        if (rules.length === 0) return fallback;
        const needsCategory = rules.some((rule) => rule.productId == null && rule.categoryId != null);
        const products = needsCategory
            ? await db.product.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, categoryId: true } })
            : [];
        const categoryOf = new Map(products.map((product) => [product.id, product.categoryId ?? null]));
        return this.resolveFromRules(
            rules,
            ids.map((id) => ({ id, categoryId: categoryOf.get(id) ?? null })),
            fallbackWarehouseId
        );
    }

    /**
     * Routes products for a consumption whose fallback warehouse is known (the
     * order's sale warehouse, or the selected waste warehouse). The branch is
     * the fallback warehouse's branch; a warehouse without branch (CENTRAL) or
     * a client without the routing delegate keeps every line on the fallback.
     */
    static async resolveForWarehouse(
        db: Db,
        companyId: number,
        fallbackWarehouseId: number,
        productIds: Iterable<number>
    ): Promise<Map<number, number>> {
        const ids = [...new Set(productIds)];
        const fallback = new Map(ids.map((id) => [id, fallbackWarehouseId] as const));
        if (ids.length === 0 || !this.delegate(db)) return fallback;
        const warehouseDelegate = (db as unknown as { warehouse?: { findFirst?: unknown } }).warehouse;
        if (typeof warehouseDelegate?.findFirst !== 'function') return fallback;
        const warehouse = await db.warehouse.findFirst({
            where: { id: fallbackWarehouseId, companyId },
            select: { branchId: true, type: true }
        });
        if (!warehouse?.branchId || warehouse.type !== 'BRANCH') return fallback;
        return this.resolveForBranch(db, companyId, warehouse.branchId, fallbackWarehouseId, ids);
    }

    static async list(db: Db, companyId: number, branchId: number) {
        const branch = await db.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true } });
        if (!branch) throw new Error('Sucursal no encontrada');
        return db.inventoryWarehouseRoute.findMany({
            where: { companyId, branchId },
            include: {
                warehouse: { select: { id: true, name: true, code: true, type: true, branchId: true } },
                category: { select: { id: true, name: true } },
                product: { select: { id: true, name: true, sku: true, categoryId: true } }
            },
            orderBy: [{ productId: 'asc' }, { categoryId: 'asc' }, { id: 'asc' }]
        });
    }

    /** Validates and normalizes a full rule set for a branch (throws user-facing errors). */
    static async validateRules(
        db: Db,
        companyId: number,
        branchId: number,
        input: unknown
    ): Promise<WarehouseRouteRule[]> {
        if (!Array.isArray(input)) throw new Error('Las reglas de bodega deben ser una lista');
        if (input.length > 500) throw new Error('Demasiadas reglas de bodega para una sucursal');
        const toId = (raw: unknown, label: string): number | null => {
            if (raw === null || raw === undefined || raw === '' || raw === 0) return null;
            const id = Number(raw);
            if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} inválido`);
            return id;
        };
        const rules = (input as WarehouseRouteInput[]).map((row) => {
            if (!row || typeof row !== 'object') throw new Error('Regla de bodega inválida');
            const warehouseId = toId(row.warehouseId, 'Almacén de la regla');
            const categoryId = toId(row.categoryId, 'Categoría de la regla');
            const productId = toId(row.productId, 'Producto de la regla');
            if (!warehouseId) throw new Error('Cada regla requiere un almacén');
            if ((categoryId == null) === (productId == null)) {
                throw new Error('Cada regla debe indicar una categoría o un producto (solo uno)');
            }
            return { warehouseId, categoryId, productId };
        });

        const productKeys = new Set<number>();
        const categoryKeys = new Set<number>();
        for (const rule of rules) {
            if (rule.productId != null) {
                if (productKeys.has(rule.productId)) throw new Error('Hay reglas duplicadas para el mismo producto');
                productKeys.add(rule.productId);
            } else if (rule.categoryId != null) {
                if (categoryKeys.has(rule.categoryId)) throw new Error('Hay reglas duplicadas para la misma categoría');
                categoryKeys.add(rule.categoryId);
            }
        }

        const warehouseIds = [...new Set(rules.map((rule) => rule.warehouseId))];
        if (warehouseIds.length > 0) {
            const warehouses = await db.warehouse.findMany({
                where: { id: { in: warehouseIds }, companyId },
                select: { id: true, branchId: true, type: true }
            });
            for (const id of warehouseIds) {
                const warehouse = warehouses.find((candidate) => candidate.id === id);
                if (!warehouse) throw new Error('Almacén de la regla no encontrado en la empresa');
                if (warehouse.type !== 'BRANCH' || warehouse.branchId !== branchId) {
                    throw new Error('El almacén de cada regla debe ser una bodega de tipo sucursal de esta misma sucursal');
                }
            }
        }
        if (productKeys.size > 0) {
            const count = await db.product.count({ where: { companyId, id: { in: [...productKeys] } } });
            if (count !== productKeys.size) throw new Error('Producto de la regla no encontrado en la empresa');
        }
        if (categoryKeys.size > 0) {
            const categories = await db.category.findMany({
                where: { companyId, id: { in: [...categoryKeys] } },
                select: { id: true, name: true, showInInventory: true }
            });
            if (categories.length !== categoryKeys.size) throw new Error('Categoría de la regla no encontrada en la empresa');
            // Same filter as the routing UI: only inventory categories route
            // ingredients (a menu-only category never groups inventory products).
            const notInventory = categories.find((category) => category.showInInventory === false);
            if (notInventory) {
                throw new Error(`La categoría "${notInventory.name}" no es una categoría de inventario; solo se pueden enrutar categorías de inventario`);
            }
        }
        return rules;
    }

    /** Replaces the full rule set of a branch atomically (inside `tx`). */
    static async replaceForBranch(
        tx: Prisma.TransactionClient,
        companyId: number,
        branchId: number,
        input: unknown,
        userId: number
    ) {
        const branch = await tx.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true } });
        if (!branch) throw new Error('Sucursal no encontrada');
        // Serialize concurrent edits of the same branch's rule set.
        await tx.$queryRaw`SELECT id FROM \`Branch\` WHERE id = ${branchId} AND companyId = ${companyId} FOR UPDATE`;
        const rules = await this.validateRules(tx, companyId, branchId, input);
        await tx.inventoryWarehouseRoute.deleteMany({ where: { companyId, branchId } });
        if (rules.length > 0) {
            await tx.inventoryWarehouseRoute.createMany({
                data: rules.map((rule) => ({ companyId, branchId, ...rule }))
            });
        }
        await tx.auditLog.create({
            data: {
                companyId,
                entityType: 'Branch',
                entityId: branchId,
                action: 'INVENTORY_WAREHOUSE_ROUTES_UPDATED',
                userId,
                details: { rules } as unknown as Prisma.InputJsonValue
            }
        });
        return this.list(tx, companyId, branchId);
    }
}
