/**
 * Canonical unit resolution for recipe-like lines (sale recipes, production
 * recipe components, catering/report consumption). Every path that converts a
 * recipe quantity to the product base unit must agree, otherwise the same line
 * is costed/deducted in one unit and reported in another.
 *
 * Priority (same as sales deduction and credit-note reversal):
 *   1. line.unit            explicit abbreviation stored on the line
 *   2. line.unitOfMeasure   abbreviation of the line's unitId FK
 *   3. product.baseUnit     configured base unit of the product
 *   4. product.unit         legacy free-text unit of the product
 */
export interface RecipeUnitLine {
    unit?: string | null;
    unitOfMeasure?: { abbreviation?: string | null } | null;
}

export interface RecipeUnitProduct {
    unit?: string | null;
    baseUnit?: { abbreviation?: string | null } | null;
}

function clean(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

export function resolveRecipeUnit(line: RecipeUnitLine, product: RecipeUnitProduct): string {
    return clean(line.unit)
        ?? clean(line.unitOfMeasure?.abbreviation)
        ?? clean(product.baseUnit?.abbreviation)
        ?? clean(product.unit)
        ?? '';
}

/** Scale of Recipe.quantity / Modifier.consumeQuantity / component quantities. */
export const RECIPE_QUANTITY_SCALE = 6;

/**
 * Round a recipe quantity to the stored precision and reject values that would
 * be persisted as zero (or are not finite/positive). Validating the raw input is
 * not enough: 0.0000004 passes `> 0` but is stored as 0.000000.
 */
export function normalizeRecipeQuantity(raw: unknown, label = 'La cantidad de la receta'): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} debe ser mayor a 0`);
    }
    const factor = 10 ** RECIPE_QUANTITY_SCALE;
    const rounded = Math.round(value * factor) / factor;
    if (!(rounded > 0)) {
        throw new Error(
            `${label} es demasiado pequeña: el mínimo admitido es 0.000001. Use una unidad menor (por ejemplo g o ml).`
        );
    }
    if (rounded >= 1e12) {
        throw new Error(`${label} excede el máximo permitido`);
    }
    return rounded;
}
