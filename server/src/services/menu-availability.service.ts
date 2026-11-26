import prisma from '../utils/prisma';
import { resolveRecipeUnit } from '../utils/recipe-unit';
import type { Prisma } from '@prisma/client';
import { UnitConversionService } from './unit-conversion.service';
import { SaleWarehouseService } from './sale-warehouse.service';
import { WarehouseRouteService } from './warehouse-route.service';

/**
 * POS stock availability (informational only: selling is never blocked, a
 * sale may drive stock negative and records an alert at consumption time).
 *
 * For every active menu item of a branch it estimates how many portions the
 * branch can still fulfil, reading each recipe product from the warehouse it
 * is consumed from (InventoryWarehouseRoute rule, else the sale warehouse): min over recipe lines of
 * floor(stock / required base quantity). Everything is loaded with a fixed
 * number of batched queries (menu+recipes, stocks, company units); the unit
 * conversion mirrors UnitConversionService.convert over that preloaded data
 * instead of one round-trip per recipe line.
 */

export type UnitLike = {
    id: number;
    abbreviation: string;
    name: string;
    measurementType: string;
    systemFactor: unknown;
    active: boolean;
    companyId: number | null;
};

export type ProductUnitsLike = {
    unit: string;
    baseUnit: UnitLike | null;
    allowedUnits: Array<{ conversionFactor: unknown; active: boolean; unit: UnitLike }>;
};

export type RecipeLineLike = {
    productId: number;
    quantity: unknown;
    unit?: string | null;
    unitOfMeasure?: { abbreviation: string } | null;
    product: ProductUnitsLike;
};

export type MenuAvailabilityStatus = 'AVAILABLE' | 'LOW' | 'OUT' | 'UNTRACKED' | 'UNKNOWN';

export type MenuItemAvailability = {
    menuItemId: number;
    status: MenuAvailabilityStatus;
    /** Whole portions fulfillable now; null when untracked/unknown. */
    portions: number | null;
    /** Recipe product that limits the portions (lowest ratio). */
    limitingProductId: number | null;
};

export const LOW_STOCK_PORTIONS = 5;

function positive(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Factor so that `quantity [unitAbbreviation] * factor = base quantity`, or
 * null when UnitConversionService.convert would reject the conversion.
 * `companyUnits` are the active+inactive UnitOfMeasure rows of the company.
 */
export function baseUnitFactor(
    companyId: number,
    product: ProductUnitsLike,
    unitAbbreviation: string,
    companyUnitsByAbbreviation: Map<string, UnitLike>,
    companyUnits: UnitLike[]
): number | null {
    // Same resolution as UnitConversionService.convert: raw match first, then
    // unambiguous normalised aliases (matchUnitAbbreviation) for the base and
    // allowed units; company units by raw then normalised key (pickCompanyUnit).
    const normalize = (raw: string) => UnitConversionService.normalizeLegacyAbbreviation(raw);
    const dynamicFactor = (base: UnitLike): number | null => {
        const dynamic = UnitConversionService.pickCompanyUnit(
            unitAbbreviation,
            (abbreviation) => companyUnitsByAbbreviation.get(abbreviation)
        );
        if (!dynamic || !dynamic.active || dynamic.measurementType !== base.measurementType) return null;
        if (base.measurementType === 'PACKAGE') return null;
        const dyn = positive(dynamic.systemFactor);
        const bas = positive(base.systemFactor);
        return dyn && bas ? dyn / bas : null;
    };

    const baseUnit = product.baseUnit;
    if (baseUnit) {
        if ((baseUnit.companyId != null && baseUnit.companyId !== companyId) || baseUnit.active === false) return null;
        const candidates: Array<{ abbreviation: string; factor: unknown | null }> = [
            { abbreviation: baseUnit.abbreviation, factor: null },
            ...product.allowedUnits
                .filter((pu) => pu.active && pu.unit.active && pu.unit.companyId === companyId)
                .map((pu) => ({ abbreviation: pu.unit.abbreviation, factor: pu.conversionFactor }))
        ];
        const matched = UnitConversionService.matchUnitAbbreviation(unitAbbreviation, candidates, (c) => c.abbreviation);
        if (matched) return matched.factor === null ? 1 : positive(matched.factor);
        return dynamicFactor(baseUnit);
    }

    // Legacy product without base unit: infer it from the free-text unit.
    const candidates = UnitConversionService.buildLegacyUnitCandidates(product.unit);
    let inferred: UnitLike | undefined;
    for (const abbreviation of candidates) {
        const unit = companyUnitsByAbbreviation.get(abbreviation);
        if (unit?.active) { inferred = unit; break; }
    }
    if (!inferred) {
        for (const abbreviation of candidates) {
            // MySQL's default collation compares UnitOfMeasure.name case-insensitively
            // in UnitConversionService.resolveBaseUnitFromLegacy; mirror it.
            const unit = companyUnits.find((u) => u.active && String(u.name).toLowerCase() === abbreviation.toLowerCase());
            if (unit) { inferred = unit; break; }
        }
    }
    if (!inferred) return normalize(unitAbbreviation) === normalize(product.unit) ? 1 : null;
    if (UnitConversionService.matchUnitAbbreviation(unitAbbreviation, [inferred], (unit) => unit.abbreviation)) return 1;
    return dynamicFactor(inferred);
}

/** Pure portions computation for one menu item (exported for tests). */
export function computeItemAvailability(
    companyId: number,
    menuItemId: number,
    recipes: RecipeLineLike[],
    stockByProduct: Map<number, number>,
    companyUnitsByAbbreviation: Map<string, UnitLike>,
    companyUnits: UnitLike[],
    lowThreshold = LOW_STOCK_PORTIONS
): MenuItemAvailability {
    if (recipes.length === 0) {
        return { menuItemId, status: 'UNTRACKED', portions: null, limitingProductId: null };
    }
    let portions = Number.POSITIVE_INFINITY;
    let limitingProductId: number | null = null;
    for (const recipe of recipes) {
        const quantity = positive(recipe.quantity);
        const unit = resolveRecipeUnit(recipe, recipe.product);
        const factor = quantity
            ? baseUnitFactor(companyId, recipe.product, unit, companyUnitsByAbbreviation, companyUnits)
            : null;
        if (!quantity || !factor) {
            return { menuItemId, status: 'UNKNOWN', portions: null, limitingProductId: recipe.productId };
        }
        const required = quantity * factor;
        const stock = stockByProduct.get(recipe.productId) ?? 0;
        // Small epsilon so 0.3 / 0.1 still yields 3 portions.
        const linePortions = stock <= 0 ? 0 : Math.floor(stock / required + 1e-9);
        if (linePortions < portions) {
            portions = linePortions;
            limitingProductId = recipe.productId;
        }
    }
    const whole = Number.isFinite(portions) ? portions : 0;
    const status: MenuAvailabilityStatus = whole <= 0 ? 'OUT' : whole <= lowThreshold ? 'LOW' : 'AVAILABLE';
    return { menuItemId, status, portions: whole, limitingProductId };
}

/** Por debajo de este número de porciones el POS avisa "Pocas". */
export const POS_LOW_STOCK_PORTIONS = 3;

export type PosMenuAvailabilityStatus = 'OK' | 'LOW' | 'OUT';

export interface PosMenuAvailabilityItem {
    menuItemId: number;
    status: PosMenuAvailabilityStatus;
    /** Porciones completas que alcanzan con las existencias de la bodega. */
    portions: number;
}

export interface PosMenuAvailabilityResult {
    warehouseId: number;
    items: PosMenuAvailabilityItem[];
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

export class MenuAvailabilityService {
    /**
     * Solo lectura: por cada plato con receta, cuántas porciones alcanzan con las existencias de la bodega.
     * Usa la misma conversión de unidades que el descuento de inventario al vender
     * (InventoryConsumptionService.consumeForOrder). Un plato sin receta o con una unidad que no se puede
     * convertir se omite: el POS no muestra aviso en vez de inventar uno.
     */
    static async forWarehouse(
        db: MenuAvailabilityDb,
        params: { companyId: number; warehouseId: number; branchId?: number | null },
    ): Promise<PosMenuAvailabilityResult | null> {
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

        const result: PosMenuAvailabilityItem[] = [];
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
                status: portions < 1 ? 'OUT' : portions < POS_LOW_STOCK_PORTIONS ? 'LOW' : 'OK',
            });
        }
        return { warehouseId, items: result };
    }


    static async getForBranch(companyId: number, branchId: number) {
        const branch = await prisma.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true } });
        if (!branch) throw new Error('Sucursal no encontrada');

        const saleWarehouse = await SaleWarehouseService.resolve(prisma, companyId, branchId);
        if (saleWarehouse.warehouseId === null) {
            return {
                branchId,
                warehouseId: null,
                warehouseIds: [] as number[],
                reason: saleWarehouse.reason,
                lowThreshold: LOW_STOCK_PORTIONS,
                items: [] as MenuItemAvailability[]
            };
        }
        const warehouseId = saleWarehouse.warehouseId;

        const unitSelect = {
            id: true, abbreviation: true, name: true, measurementType: true,
            systemFactor: true, active: true, companyId: true
        } as const;
        const [menuItems, companyUnits] = await Promise.all([
            prisma.menuItem.findMany({
                where: { companyId, active: true, OR: [{ branchId }, { branchId: null }] },
                select: {
                    id: true,
                    recipes: {
                        select: {
                            productId: true,
                            quantity: true,
                            unit: true,
                            unitOfMeasure: { select: { abbreviation: true } },
                            product: {
                                select: {
                                    unit: true,
                                    baseUnit: { select: unitSelect },
                                    allowedUnits: {
                                        where: { companyId, active: true },
                                        select: { conversionFactor: true, active: true, unit: { select: unitSelect } }
                                    }
                                }
                            }
                        }
                    }
                }
            }),
            prisma.unitOfMeasure.findMany({ where: { companyId }, select: unitSelect })
        ]);

        const productIds = [...new Set(menuItems.flatMap((item) => item.recipes.map((recipe) => recipe.productId)))];
        // Same routing as sale consumption: product rule > category rule > sale warehouse.
        const routing = await WarehouseRouteService.resolveForBranch(prisma, companyId, branchId, warehouseId, productIds);
        const routedWarehouseIds = [...new Set([warehouseId, ...routing.values()])].sort((a, b) => a - b);
        const stocks = productIds.length > 0
            ? await prisma.stock.findMany({
                where: { companyId, warehouseId: { in: routedWarehouseIds }, productId: { in: productIds } },
                select: { warehouseId: true, productId: true, quantity: true }
            })
            : [];
        const stockByProduct = new Map<number, number>();
        for (const stock of stocks) {
            if ((routing.get(stock.productId) ?? warehouseId) !== stock.warehouseId) continue;
            stockByProduct.set(stock.productId, Number(stock.quantity));
        }
        const unitsByAbbreviation = new Map(companyUnits.map((unit) => [unit.abbreviation.toLowerCase(), unit as UnitLike]));

        return {
            branchId,
            warehouseId,
            /** Every warehouse availability was read from (sale + routed). */
            warehouseIds: routedWarehouseIds,
            reason: null,
            lowThreshold: LOW_STOCK_PORTIONS,
            items: menuItems.map((item) => computeItemAvailability(
                companyId,
                item.id,
                item.recipes as unknown as RecipeLineLike[],
                stockByProduct,
                unitsByAbbreviation,
                companyUnits as UnitLike[]
            ))
        };
    }
}
