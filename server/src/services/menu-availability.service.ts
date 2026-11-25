import type { Prisma } from '@prisma/client';
import { UnitConversionService } from './unit-conversion.service';

/** Por debajo de este número de porciones el POS avisa "Pocas". */
export const LOW_STOCK_PORTIONS = 3;

export type MenuAvailabilityStatus = 'OK' | 'LOW' | 'OUT';

export interface MenuAvailabilityItem {
    menuItemId: number;
    status: MenuAvailabilityStatus;
    /** Porciones completas que alcanzan con las existencias de la bodega. */
    portions: number;
}

export interface MenuAvailabilityResult {
    warehouseId: number;
    items: MenuAvailabilityItem[];
}

type RecipeRow = {
    productId: number;
    quantity: Prisma.Decimal | number | string;
    unit?: string | null;
    unitOfMeasure?: { abbreviation: string } | null;
    product: { unit: string; baseUnit?: { abbreviation: string } | null };
};

/** Subconjunto de lectura del cliente Prisma: el servicio nunca escribe. */
export interface MenuAvailabilityDb {
    warehouse: { findFirst(args: unknown): Promise<{ id: number; branchId: number | null } | null> };
    menuItem: { findMany(args: unknown): Promise<Array<{ id: number; recipes: RecipeRow[] }>> };
    stock: { findMany(args: unknown): Promise<Array<{ productId: number; quantity: Prisma.Decimal | number | string }>> };
}

/**
 * Solo lectura: por cada plato con receta, cuántas porciones alcanzan con las existencias de la bodega.
 * Usa la misma conversión de unidades que el descuento de inventario al vender
 * (InventoryConsumptionService.consumeForOrder). Un plato sin receta o con una unidad que no se puede
 * convertir se omite: el POS no muestra aviso en vez de inventar uno.
 */
export class MenuAvailabilityService {
    static async forWarehouse(
        db: MenuAvailabilityDb,
        params: { companyId: number; warehouseId: number; branchId?: number | null },
    ): Promise<MenuAvailabilityResult | null> {
        const { companyId, warehouseId, branchId } = params;
        const warehouse = await db.warehouse.findFirst({
            where: { id: warehouseId, companyId, ...(branchId ? { branchId } : {}) },
            select: { id: true, branchId: true },
        });
        if (!warehouse) return null;

        const items = await db.menuItem.findMany({
            where: {
                companyId,
                active: true,
                recipes: { some: {} },
                ...(warehouse.branchId ? { OR: [{ branchId: null }, { branchId: warehouse.branchId }] } : {}),
            },
            select: {
                id: true,
                recipes: {
                    select: {
                        productId: true,
                        quantity: true,
                        unit: true,
                        unitOfMeasure: { select: { abbreviation: true } },
                        product: { select: { unit: true, baseUnit: { select: { abbreviation: true } } } },
                    },
                },
            },
        });

        const productIds = [...new Set(items.flatMap((item) => item.recipes.map((recipe) => recipe.productId)))];
        const stocks = productIds.length
            ? await db.stock.findMany({
                where: { warehouseId, companyId, productId: { in: productIds } },
                select: { productId: true, quantity: true },
            })
            : [];
        const stockByProduct = new Map(stocks.map((row) => [row.productId, Number(row.quantity)]));

        // Factor a unidad base por (producto, unidad): una sola conversión por combinación.
        const factorCache = new Map<string, Promise<number | null>>();
        const factorFor = (recipe: RecipeRow): Promise<number | null> => {
            const unit = recipe.unit || recipe.unitOfMeasure?.abbreviation || recipe.product.baseUnit?.abbreviation || recipe.product.unit;
            const key = `${recipe.productId}|${unit}`;
            let cached = factorCache.get(key);
            if (!cached) {
                cached = UnitConversionService.convert(recipe.productId, companyId, 1, unit, db as never)
                    .then((conv) => (Number.isFinite(conv.baseQuantity) && conv.baseQuantity > 0 ? conv.baseQuantity : null))
                    .catch(() => null);
                factorCache.set(key, cached);
            }
            return cached;
        };

        const result: MenuAvailabilityItem[] = [];
        for (const item of items) {
            let portions = Number.POSITIVE_INFINITY;
            let known = item.recipes.length > 0;
            for (const recipe of item.recipes) {
                const factor = await factorFor(recipe);
                const perPortion = factor === null ? Number.NaN : factor * Number(recipe.quantity);
                if (!(perPortion > 0)) { known = false; break; }
                const available = stockByProduct.get(recipe.productId) ?? 0;
                portions = Math.min(portions, Math.floor((available + 1e-9) / perPortion));
            }
            if (!known || !Number.isFinite(portions)) continue;
            portions = Math.max(0, portions);
            result.push({
                menuItemId: item.id,
                portions,
                status: portions < 1 ? 'OUT' : portions < LOW_STOCK_PORTIONS ? 'LOW' : 'OK',
            });
        }
        return { warehouseId, items: result };
    }
}
