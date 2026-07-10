import type { MenuRecipeCreateInput, MenuRecipeUpdateInput } from '../types';

export interface EditableMenuRecipe {
  id?: number;
  productId: number;
  productName: string;
  quantity: number | string;
  unit: string;
  /** Cost of one product base unit (weighted average when available). */
  cost: number;
  /** Number of product base units represented by one selected recipe unit. */
  conversionFactor: number;
  /** False when an imported/legacy unit cannot be resolved for this product. */
  unitConfigured: boolean;
}

export interface MenuRecipeSyncPlan {
  create: MenuRecipeCreateInput[];
  update: Array<{ id: number; data: Required<MenuRecipeUpdateInput> }>;
  delete: number[];
}

const normalizedUnit = (value: string): string => value.trim().toLowerCase();

export const calculateMenuRecipeLineCost = (ingredient: EditableMenuRecipe): number => {
  const quantity = Number(ingredient.quantity);
  const unitCost = Number(ingredient.cost);
  const conversionFactor = Number(ingredient.conversionFactor);

  if (
    !ingredient.unitConfigured
    || !Number.isFinite(quantity)
    || !Number.isFinite(unitCost)
    || !Number.isFinite(conversionFactor)
    || quantity <= 0
    || conversionFactor <= 0
  ) {
    return 0;
  }

  return quantity * conversionFactor * unitCost;
};

/**
 * Validate recipe rows before any menu or recipe mutation is sent. This keeps a
 * failed line from leaving a partially-synchronised imported recipe.
 */
export const validateMenuRecipes = (recipes: EditableMenuRecipe[]): string | null => {
  const seenProducts = new Set<number>();

  for (const ingredient of recipes) {
    if (seenProducts.has(ingredient.productId)) {
      return `El ingrediente "${ingredient.productName}" está duplicado.`;
    }
    seenProducts.add(ingredient.productId);

    const quantity = Number(ingredient.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `La cantidad de "${ingredient.productName}" debe ser mayor a 0.`;
    }
    if (!ingredient.unit.trim()) {
      return `Selecciona la unidad de "${ingredient.productName}".`;
    }
    if (!ingredient.unitConfigured) {
      return `La unidad "${ingredient.unit}" no está configurada para "${ingredient.productName}".`;
    }
  }

  return null;
};

/** Build the smallest set of line-level API mutations for an edited recipe. */
export const buildMenuRecipeSyncPlan = (
  original: EditableMenuRecipe[],
  current: EditableMenuRecipe[]
): MenuRecipeSyncPlan => {
  const originalById = new Map(
    original
      .filter((ingredient): ingredient is EditableMenuRecipe & { id: number } => ingredient.id !== undefined)
      .map((ingredient) => [ingredient.id, ingredient])
  );
  const retainedIds = new Set<number>();
  const create: MenuRecipeCreateInput[] = [];
  const update: MenuRecipeSyncPlan['update'] = [];

  for (const ingredient of current) {
    const quantity = Number(ingredient.quantity);
    const unit = ingredient.unit.trim();
    const previous = ingredient.id === undefined ? undefined : originalById.get(ingredient.id);

    if (!previous) {
      create.push({ productId: ingredient.productId, quantity, unit });
      continue;
    }

    // The line-level PUT endpoint cannot change productId. Treat this as a
    // replacement so the old unique menuItem/product row is removed first.
    if (previous.productId !== ingredient.productId) {
      create.push({ productId: ingredient.productId, quantity, unit });
      continue;
    }

    retainedIds.add(previous.id!);
    if (
      Number(previous.quantity) !== quantity
      || normalizedUnit(previous.unit) !== normalizedUnit(unit)
    ) {
      update.push({ id: previous.id!, data: { quantity, unit } });
    }
  }

  const deleted = Array.from(originalById.keys()).filter((id) => !retainedIds.has(id));
  return { create, update, delete: deleted };
};
