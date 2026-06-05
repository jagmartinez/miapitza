import prisma from '../src/utils/prisma';
import { ProductService } from '../src/services/product.service';

export function normalizeIngredientKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/** Nombre en plantilla → candidatos en catálogo maestro */
export const INGREDIENT_NAME_ALIASES: Record<string, string[]> = {
  'queso mozzarella': ['mozzarella'],
  'mozzarella fresco': ['mozzarella fresco'],
  'jamon selva negra': ['jamon selva negra'],
  'pina hawaiana': ['pina'],
  'jalapeno': ['chile jalapeno'],
  'hongos': ['hongos'],
  'queso parmesano': ['queso parmesano'],
  'salsa 4 quesos': ['salsa 4 queso'],
  'aceite de oliva': ['aceite de oliva'],
  'miel': ['miel balde', 'miel'],
  'tomate': ['tomate criollo'],
  'pepperoni': ['pepperoni'],
  'ricotta': ['ricotta'],
  'prosciutto': ['prosciutto'],
  'cebolla morada': ['cebolla morada'],
};

export function buildProductNameIndex(
  products: Array<{ id: number; name: string; sku: string | null }>
): Map<string, { id: number; name: string; sku: string | null }> {
  const map = new Map<string, { id: number; name: string; sku: string | null }>();
  for (const p of products) {
    map.set(normalizeIngredientKey(p.name), p);
  }
  return map;
}

export function findProductForIngredient(
  index: Map<string, { id: number; name: string; sku: string | null }>,
  ingredientName: string
): { id: number; name: string; sku: string | null } | null {
  const key = normalizeIngredientKey(ingredientName);
  const direct = index.get(key);
  if (direct) return direct;

  const aliases = INGREDIENT_NAME_ALIASES[key] ?? [];
  for (const alias of aliases) {
    const hit = index.get(normalizeIngredientKey(alias));
    if (hit) return hit;
  }

  for (const [nameKey, product] of index) {
    if (nameKey.includes(key) || key.includes(nameKey)) return product;
  }

  return null;
}

export async function resolveOrCreateRecipeProduct(
  companyId: number,
  index: Map<string, { id: number; name: string; sku: string | null }>,
  data: {
    name: string;
    unit: string;
    categoryId?: number | null;
  }
) {
  const existing = findProductForIngredient(index, data.name);
  if (existing) return existing;

  const sku = await ProductService.generateSku(companyId, data.categoryId ?? undefined, 'INGREDIENT');
  const created = await prisma.product.create({
    data: {
      companyId,
      sku,
      name: data.name,
      unit: data.unit,
      categoryId: data.categoryId ?? undefined,
      type: 'INGREDIENT',
      storageType: 'PERISHABLE',
      observation: 'Ingrediente de producción / receta',
      active: true,
    },
    select: { id: true, name: true, sku: true },
  });

  index.set(normalizeIngredientKey(created.name), created);
  return created;
}
