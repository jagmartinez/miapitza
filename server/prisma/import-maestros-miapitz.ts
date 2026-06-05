/**
 * Importación idempotente desde:
 *   - Maestros Jonathan.xlsx          → proveedores, categorías, productos inventario, mesas
 *   - Plantilla_Inventario_Recetas_MiaPitza.xlsx → ingredientes receta, menú pizzas, BOM
 *
 * Uso:
 *   npx tsx prisma/import-maestros-miapitz.ts           # ejecutar importación
 *   npx tsx prisma/import-maestros-miapitz.ts --dry-run  # solo validar y reportar
 */

import * as ExcelJS from 'exceljs';
import * as path from 'path';
import { PrismaClient, ProductType, StorageType, MenuItemType } from '@prisma/client';
import { CategoryService } from '../src/services/category.service';
import { UnitConversionService } from '../src/services/unit-conversion.service';
import { resolveMenuPrice } from './miapitz-menu-prices';
import {
  buildProductNameIndex,
  normalizeIngredientKey,
  resolveOrCreateRecipeProduct,
} from './recipe-product-resolver';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const ROOT = path.resolve(__dirname, '../..');
const MAESTROS_FILE = path.join(ROOT, 'Maestros Jonathan.xlsx');
const PLANTILLA_FILE = path.join(ROOT, 'Plantilla_Inventario_Recetas_MiaPitza.xlsx');

const BRANCH_CODE = 'BAMBOO';
const BRANCH_NAME = 'Bamboo';

// Categorías de inventario del maestro → prefijo SKU
const INVENTORY_CATEGORY_DEFS: Record<string, { name: string; codePrefix: string; sortOrder: number }> = {
  CONGELADOS: { name: 'Congelados', codePrefix: 'CON', sortOrder: 8 },
  'MISCELÁNEOS': { name: 'Misceláneo', codePrefix: 'MIS', sortOrder: 7 },
  'MISCELANEOS': { name: 'Misceláneo', codePrefix: 'MIS', sortOrder: 7 },
  EMPAQUES: { name: 'Empaques', codePrefix: 'EMP', sortOrder: 6 },
  BEBIDAS: { name: 'Bebidas', codePrefix: 'BEB', sortOrder: 2 },
  LIMPIEZA: { name: 'Limpieza', codePrefix: 'LIM', sortOrder: 5 },
  VEGETALES: { name: 'Vegetales', codePrefix: 'VEG', sortOrder: 4 },
  'PAPELERÍA': { name: 'Papelería', codePrefix: 'PAP', sortOrder: 9 },
  PAPELERIA: { name: 'Papelería', codePrefix: 'PAP', sortOrder: 9 },
  EVENTOS: { name: 'Eventos', codePrefix: 'EVT', sortOrder: 10 },
};

// Categorías de menú (columnas B y C del maestro)
const MENU_CATEGORY_DEFS: { name: string; sortOrder: number; brand?: 'mia' | 'forno' | 'both' }[] = [
  { name: 'Pizzas', sortOrder: 1, brand: 'mia' },
  { name: 'Pastas Frescas', sortOrder: 2, brand: 'mia' },
  { name: 'Antipastos', sortOrder: 3, brand: 'mia' },
  { name: 'Postres', sortOrder: 4, brand: 'mia' },
  { name: 'Bebidas y Vinos', sortOrder: 5, brand: 'mia' },
  { name: 'Extras', sortOrder: 6, brand: 'both' },
  { name: 'Focaccias', sortOrder: 10, brand: 'forno' },
  { name: 'Kids Menú', sortOrder: 11, brand: 'forno' },
  { name: 'Proteínas', sortOrder: 12, brand: 'forno' },
  { name: 'Elegí tu Salsa', sortOrder: 13, brand: 'forno' },
  { name: 'Elegí tu Pasta', sortOrder: 14, brand: 'forno' },
];

// Categorías de ingredientes de receta (plantilla Inventario_Base)
const RECIPE_INGREDIENT_CATEGORIES: Record<string, { name: string; codePrefix: string }> = {
  'MATERIA PRIMA': { name: 'Materia Prima', codePrefix: 'MPR' },
  VEGETALES: { name: 'Vegetales Receta', codePrefix: 'VGR' },
  'PRODUCCIÓN': { name: 'Producción', codePrefix: 'PRD' },
  PRODUCCION: { name: 'Producción', codePrefix: 'PRD' },
  'LÁCTEOS': { name: 'Lácteos Receta', codePrefix: 'LCR' },
  LACTEOS: { name: 'Lácteos Receta', codePrefix: 'LCR' },
  EMBUTIDOS: { name: 'Embutidos Receta', codePrefix: 'EMB' },
  OTROS: { name: 'Otros Receta', codePrefix: 'OTR' },
  FRUTAS: { name: 'Frutas Receta', codePrefix: 'FRT' },
};

const STORAGE_BY_INVENTORY_CATEGORY: Record<string, StorageType> = {
  CONGELADOS: 'FROZEN',
  VEGETALES: 'PERISHABLE',
};

type ImportStats = {
  categories: number;
  brands: number;
  suppliers: number;
  inventoryProducts: number;
  recipeProducts: number;
  menuItems: number;
  recipes: number;
  tables: number;
  warnings: string[];
};

const stats: ImportStats = {
  categories: 0,
  brands: 0,
  suppliers: 0,
  inventoryProducts: 0,
  recipeProducts: 0,
  menuItems: 0,
  recipes: 0,
  tables: 0,
  warnings: [],
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in v) return String((v as { text: string }).text).trim();
  if (typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result ?? '').trim();
  return String(v).trim();
}

function inferUnit(description: string | null, categoryName: string | null): string {
  const text = `${description ?? ''} ${categoryName ?? ''}`.toLowerCase();
  if (/\b1\s*lb\b|\blb\b|\blibras?\b/.test(text)) return 'lb';
  if (/\boz\b|\bonzas?\b/.test(text)) return 'oz';
  if (/\blitro?s?\b|\bl\b/.test(text)) return 'l';
  if (/\bml\b|\bmililitro?s?\b/.test(text)) return 'ml';
  if (/\bkg\b|\bkilo?s?\b/.test(text)) return 'kg';
  if (/\bgr\b|\bgramos?\b|\bg\b/.test(text)) return 'g';
  if (/\blata\b|\bbotella\b|\bbolsa\b|\bpaquete\b|\bcaja\b|\bund\b/.test(text)) return 'unidad';
  if (categoryName && normalizeKey(categoryName) === 'bebidas') return 'unidad';
  return 'unidad';
}

function mapRecipeUnit(raw: string): string {
  const key = normalizeKey(raw);
  const map: Record<string, string> = {
    gr: 'g',
    g: 'g',
    ml: 'ml',
    und: 'unidad',
    unidad: 'unidad',
    lamina: 'unidad',
  };
  return map[key] ?? raw.trim().toLowerCase();
}

async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

function findSheet(workbook: ExcelJS.Workbook, contains: string): ExcelJS.Worksheet {
  const sheet = workbook.worksheets.find((ws) =>
    normalizeKey(ws.name).includes(normalizeKey(contains))
  );
  if (!sheet) throw new Error(`No se encontró hoja que contenga "${contains}" en ${workbook.worksheets.map((s) => s.name).join(', ')}`);
  return sheet;
}

async function resolveCompanyId(): Promise<number> {
  const company = await prisma.company.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
  if (!company) throw new Error('No hay empresa activa en la BD. Ejecute seed.ts primero.');
  return company.id;
}

async function ensureBranch(companyId: number) {
  const existing = await prisma.branch.findFirst({ where: { companyId, code: BRANCH_CODE } });
  if (existing) return existing;
  if (DRY_RUN) {
    stats.warnings.push(`[dry-run] Crearía sucursal ${BRANCH_NAME} (${BRANCH_CODE})`);
    return { id: -1, companyId, code: BRANCH_CODE, name: BRANCH_NAME } as const;
  }
  return prisma.branch.create({
    data: {
      companyId,
      code: BRANCH_CODE,
      name: BRANCH_NAME,
      status: 'ACTIVE',
    },
  });
}

async function upsertCategory(
  companyId: number,
  name: string,
  data: { description?: string; codePrefix?: string; sortOrder?: number }
) {
  const existing = await prisma.category.findFirst({ where: { companyId, name } });
  if (existing) {
    if (!DRY_RUN) {
      await prisma.category.update({
        where: { id: existing.id },
        data: {
          description: data.description ?? existing.description,
          codePrefix: data.codePrefix ?? existing.codePrefix,
          sortOrder: data.sortOrder ?? existing.sortOrder,
          active: true,
        },
      });
    }
    return existing;
  }
  if (DRY_RUN) {
    stats.categories++;
    return { id: -stats.categories, companyId, name } as { id: number; companyId: number; name: string };
  }
  const created = await prisma.category.create({
    data: {
      companyId,
      name,
      description: data.description,
      codePrefix: data.codePrefix,
      sortOrder: data.sortOrder ?? 0,
      active: true,
    },
  });
  stats.categories++;
  return created;
}

async function upsertBrand(companyId: number, name: string, sortOrder: number) {
  const existing = await prisma.menuBrand.findFirst({ where: { companyId, name } });
  if (existing) return existing;
  if (DRY_RUN) {
    stats.brands++;
    return { id: -stats.brands, companyId, name } as { id: number; companyId: number; name: string };
  }
  const created = await prisma.menuBrand.create({
    data: { companyId, name, sortOrder, active: true },
  });
  stats.brands++;
  return created;
}

async function nextSku(companyId: number, prefix: string, cache: Map<string, number>): Promise<string> {
  const key = `${companyId}:${prefix}`;
  if (!cache.has(key)) {
    const last = await prisma.product.findFirst({
      where: { companyId, sku: { startsWith: `${prefix}-` } },
      orderBy: { sku: 'desc' },
      select: { sku: true },
    });
    let n = 0;
    if (last?.sku) {
      const parts = last.sku.split('-');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(parsed)) n = parsed;
    }
    cache.set(key, n);
  }
  const next = (cache.get(key) ?? 0) + 1;
  cache.set(key, next);
  return `${prefix}-${String(next).padStart(6, '0')}`;
}

async function upsertSupplier(companyId: number, name: string, taxId: string | null) {
  const existing = await prisma.supplier.findFirst({ where: { companyId, name } });
  if (existing) {
    if (!DRY_RUN && taxId && taxId !== existing.taxId) {
      await prisma.supplier.update({ where: { id: existing.id }, data: { taxId, active: true } });
    }
    return existing;
  }
  if (DRY_RUN) {
    stats.suppliers++;
    return { id: -stats.suppliers, companyId, name } as { id: number; companyId: number; name: string };
  }
  const created = await prisma.supplier.create({
    data: { companyId, name, taxId: taxId || null, active: true },
  });
  stats.suppliers++;
  return created;
}

async function upsertProductBySku(
  companyId: number,
  data: {
    sku: string;
    name: string;
    categoryId?: number | null;
    unit: string;
    minStock?: number;
    type?: ProductType;
    storageType?: StorageType;
    observation?: string | null;
  }
) {
  const existing = await prisma.product.findFirst({ where: { companyId, sku: data.sku } });
  if (existing) {
    if (!DRY_RUN) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          categoryId: data.categoryId ?? undefined,
          unit: data.unit,
          minStock: data.minStock ?? existing.minStock,
          type: data.type ?? existing.type,
          storageType: data.storageType ?? existing.storageType,
          observation: data.observation ?? existing.observation,
          active: true,
        },
      });
    }
    return existing;
  }
  if (DRY_RUN) return { id: -1, companyId, sku: data.sku, name: data.name } as { id: number; companyId: number; sku: string; name: string };
  return prisma.product.create({
    data: {
      companyId,
      sku: data.sku,
      name: data.name,
      categoryId: data.categoryId ?? undefined,
      unit: data.unit,
      minStock: data.minStock ?? 0,
      type: data.type ?? 'INGREDIENT',
      storageType: data.storageType ?? 'NON_PERISHABLE',
      observation: data.observation ?? undefined,
      active: true,
    },
  });
}

async function resolveUnitId(companyId: number, unit: string): Promise<number | null> {
  const abbr = mapRecipeUnit(unit);
  const uom = await prisma.unitOfMeasure.findFirst({
    where: { companyId, abbreviation: abbr },
    select: { id: true },
  });
  return uom?.id ?? null;
}

async function importMaestros(companyId: number, branchId: number) {
  const workbook = await loadWorkbook(MAESTROS_FILE);
  const categoryMap = new Map<string, number>();
  const skuCache = new Map<string, number>();

  // --- Categorías inventario + menú ---
  console.log('→ Categorías…');
  await CategoryService.ensureDefaultCategories(companyId);

  const catSheet = findSheet(workbook, 'categor');
  for (let r = 2; r <= catSheet.rowCount; r++) {
    const invRaw = cellText(catSheet.getCell(r, 1));
    if (invRaw) {
      const def = INVENTORY_CATEGORY_DEFS[invRaw.toUpperCase()] ?? INVENTORY_CATEGORY_DEFS[normalizeKey(invRaw).toUpperCase()];
      const name = def?.name ?? invRaw.trim();
      const cat = await upsertCategory(companyId, name, {
        codePrefix: def?.codePrefix,
        sortOrder: def?.sortOrder,
        description: 'Categoría de inventario',
      });
      categoryMap.set(normalizeKey(name), cat.id);
      categoryMap.set(normalizeKey(invRaw), cat.id);
    }
    for (let col = 2; col <= 3; col++) {
      const menuRaw = cellText(catSheet.getCell(r, col));
      if (!menuRaw) continue;
      const menuDef = MENU_CATEGORY_DEFS.find((c) => normalizeKey(c.name) === normalizeKey(menuRaw));
      const name = menuDef?.name ?? menuRaw.trim();
      const cat = await upsertCategory(companyId, name, {
        sortOrder: menuDef?.sortOrder ?? 50,
        description: col === 2 ? 'Menú Mia Pitza' : 'Menú Forno Fiery',
      });
      categoryMap.set(normalizeKey(name), cat.id);
      categoryMap.set(normalizeKey(menuRaw), cat.id);
    }
  }

  for (const menuCat of MENU_CATEGORY_DEFS) {
    const cat = await upsertCategory(companyId, menuCat.name, {
      sortOrder: menuCat.sortOrder,
      description: 'Categoría de menú',
    });
    categoryMap.set(normalizeKey(menuCat.name), cat.id);
  }

  for (const [raw, def] of Object.entries(RECIPE_INGREDIENT_CATEGORIES)) {
    const cat = await upsertCategory(companyId, def.name, {
      codePrefix: def.codePrefix,
      description: 'Ingredientes para recetas / producción',
      sortOrder: 20,
    });
    categoryMap.set(normalizeKey(raw), cat.id);
    categoryMap.set(normalizeKey(def.name), cat.id);
  }

  // --- Marcas ---
  console.log('→ Marcas de menú…');
  const brandMia = await upsertBrand(companyId, 'Mia Pitza', 1);
  await upsertBrand(companyId, 'Forno Fiery', 2);

  // --- Proveedores ---
  console.log('→ Proveedores…');
  const supSheet = findSheet(workbook, 'proveedor');
  for (let r = 2; r <= supSheet.rowCount; r++) {
    const name = cellText(supSheet.getCell(r, 1));
    if (!name) continue;
    const taxId = cellText(supSheet.getCell(r, 2)) || null;
    await upsertSupplier(companyId, name, taxId === 'SN' ? null : taxId);
  }

  // --- Productos inventario ---
  console.log('→ Productos de inventario (maestro)…');
  const prodSheet = findSheet(workbook, 'producto');
  const seenNames = new Map<string, number>();

  for (let r = 2; r <= prodSheet.rowCount; r++) {
    const name = cellText(prodSheet.getCell(r, 1));
    if (!name) continue;

    const categoryRaw = cellText(prodSheet.getCell(r, 2));
    const description = cellText(prodSheet.getCell(r, 3)) || null;
    const minStockRaw = prodSheet.getCell(r, 4).value;
    const minStock = typeof minStockRaw === 'number' ? minStockRaw : parseFloat(String(minStockRaw ?? '0')) || 0;

    const invDef = INVENTORY_CATEGORY_DEFS[categoryRaw.toUpperCase()];
    const categoryName = invDef?.name ?? categoryRaw;
    const categoryId = categoryMap.get(normalizeKey(categoryName)) ?? categoryMap.get(normalizeKey(categoryRaw));

    const normName = normalizeKey(name);
    const occurrence = (seenNames.get(normName) ?? 0) + 1;
    seenNames.set(normName, occurrence);

    const prefix = invDef?.codePrefix ?? 'GEN';
    const sku = await nextSku(companyId, occurrence > 1 ? `${prefix}D` : prefix, skuCache);
    const unit = inferUnit(description, categoryName);
    const storageType = STORAGE_BY_INVENTORY_CATEGORY[categoryRaw.toUpperCase()] ?? 'NON_PERISHABLE';

    const observation = [
      description,
      occurrence > 1 ? `Duplicado #${occurrence} en catálogo maestro` : null,
    ].filter(Boolean).join(' | ') || null;

    await upsertProductBySku(companyId, {
      sku,
      name: occurrence > 1 ? `${name} (${occurrence})` : name,
      categoryId,
      unit,
      minStock,
      type: 'INGREDIENT',
      storageType,
      observation,
    });
    stats.inventoryProducts++;
  }

  // --- Mesas Bamboo ---
  console.log('→ Mesas sucursal Bamboo…');
  const tableSheet = findSheet(workbook, 'mesa');
  for (let r = 2; r <= tableSheet.rowCount; r++) {
    const number = cellText(tableSheet.getCell(r, 1));
    if (!number) continue;

    const existing = await prisma.table.findFirst({ where: { branchId, number } });
    if (existing) {
      if (!DRY_RUN) {
        await prisma.table.update({
          where: { id: existing.id },
          data: { capacity: existing.capacity || 4, status: 'AVAILABLE' },
        });
      }
    } else if (!DRY_RUN) {
      await prisma.table.create({
        data: {
          companyId,
          branchId,
          number,
          capacity: 4,
          status: 'AVAILABLE',
        },
      });
    }
    stats.tables++;
  }
}

async function importPlantilla(companyId: number, brandMiaId: number) {
  const workbook = await loadWorkbook(PLANTILLA_FILE);
  const categoryMap = new Map<string, number>();
  const allCategories = await prisma.category.findMany({ where: { companyId }, select: { id: true, name: true } });
  for (const c of allCategories) categoryMap.set(normalizeKey(c.name), c.id);

  const existingProducts = await prisma.product.findMany({
    where: { companyId, active: true },
    select: { id: true, name: true, sku: true },
  });
  const productIndex = buildProductNameIndex(existingProducts);
  const productByName = new Map<string, { id: number; name: string }>();

  // --- Ingredientes receta: reutilizar catálogo maestro, crear solo si no existe ---
  console.log('→ Ingredientes de receta (plantilla, catálogo unificado)…');
  const invSheet = findSheet(workbook, 'inventario');
  for (let r = 2; r <= invSheet.rowCount; r++) {
    const name = cellText(invSheet.getCell(r, 2));
    if (!name) continue;

    const categoryRaw = cellText(invSheet.getCell(r, 3));
    const unitRaw = cellText(invSheet.getCell(r, 4));
    const catDef = RECIPE_INGREDIENT_CATEGORIES[categoryRaw.toUpperCase()];
    const categoryId = categoryMap.get(normalizeKey(catDef?.name ?? categoryRaw));

    let product: { id: number; name: string };
    if (DRY_RUN) {
      const hit = productIndex.get(normalizeIngredientKey(name));
      product = { id: hit?.id ?? -r, name };
    } else {
      const resolved = await resolveOrCreateRecipeProduct(companyId, productIndex, {
        name,
        unit: mapRecipeUnit(unitRaw || 'g'),
        categoryId,
      });
      product = { id: resolved.id, name: resolved.name };
    }

    productByName.set(normalizeKey(name), product);
    stats.recipeProducts++;
  }

  // --- Menu items (Recetas) ---
  console.log('→ Platos del menú (pizzas)…');
  const recSheet = findSheet(workbook, 'recetas');
  const menuByCode = new Map<string, { id: number; name: string }>();
  const pizzasCategoryId = categoryMap.get(normalizeKey('Pizzas'));

  for (let r = 2; r <= recSheet.rowCount; r++) {
    const code = cellText(recSheet.getCell(r, 1));
    const name = cellText(recSheet.getCell(r, 2));
    const tipo = cellText(recSheet.getCell(r, 3));
    if (!code || !name) continue;

    const description = `Código receta: ${code} | Tipo: ${tipo}`;
    const price = resolveMenuPrice(name, description) ?? 0;
    const priceNote = price > 0 ? '' : ' | [IMPORTADO - ASIGNAR PRECIO]';

    const existing = await prisma.menuItem.findFirst({
      where: { companyId, name, categoryId: pizzasCategoryId ?? undefined },
    });

    let menuItem = existing;
    if (existing) {
      if (!DRY_RUN) {
        menuItem = await prisma.menuItem.update({
          where: { id: existing.id },
          data: {
            description: `${description}${priceNote}`,
            price,
            type: 'PREPARED',
            brandId: brandMiaId,
            active: true,
          },
        });
      }
    } else if (!DRY_RUN) {
      menuItem = await prisma.menuItem.create({
        data: {
          companyId,
          categoryId: pizzasCategoryId!,
          brandId: brandMiaId,
          name,
          description: `${description}${priceNote}`,
          price,
          type: 'PREPARED' as MenuItemType,
          active: true,
        },
      });
    } else {
      menuItem = { id: -r, name } as { id: number; name: string };
    }

    menuByCode.set(code.toUpperCase(), { id: menuItem!.id, name });
    stats.menuItems++;
  }

  // --- BOM (Detalle_Recetas) ---
  console.log('→ Recetas / BOM…');
  const detSheet = findSheet(workbook, 'detalle');
  for (let r = 2; r <= detSheet.rowCount; r++) {
    const recipeCode = cellText(detSheet.getCell(r, 1));
    const ingredientName = cellText(detSheet.getCell(r, 2));
    const qtyRaw = detSheet.getCell(r, 3).value;
    const unitRaw = cellText(detSheet.getCell(r, 4));
    if (!recipeCode || !ingredientName) continue;

    const quantity = typeof qtyRaw === 'number' ? qtyRaw : parseFloat(String(qtyRaw)) || 0;
    const unit = mapRecipeUnit(unitRaw);

    const menuItem = menuByCode.get(recipeCode.toUpperCase());
    const product = productByName.get(normalizeKey(ingredientName));

    if (!menuItem) {
      stats.warnings.push(`Receta ${recipeCode}: plato no encontrado`);
      continue;
    }
    if (!product) {
      stats.warnings.push(`Receta ${recipeCode}: ingrediente "${ingredientName}" no encontrado en Inventario_Base`);
      continue;
    }

    if (DRY_RUN) {
      stats.recipes++;
      continue;
    }

    const unitId = await resolveUnitId(companyId, unit);
    await prisma.recipe.upsert({
      where: { menuItemId_productId: { menuItemId: menuItem.id, productId: product.id } },
      update: { quantity, unit, unitId },
      create: { menuItemId: menuItem.id, productId: product.id, quantity, unit, unitId },
    });
    stats.recipes++;
  }
}

async function configureUnits(companyId: number) {
  if (DRY_RUN) {
    stats.warnings.push('[dry-run] Se omitió seed/configure de unidades de medida');
    return;
  }
  console.log('→ Unidades de medida…');
  await UnitConversionService.seedDefaultUnits(companyId);

  const products = await prisma.product.findMany({
    where: { companyId, baseUnitId: null, active: true },
    select: { id: true, unit: true },
  });

  let configured = 0;
  for (const p of products) {
    const result = await UnitConversionService.autoConfigureProduct(p.id, companyId, p.unit);
    if (result) configured++;
  }
  console.log(`   ${configured}/${products.length} productos con unidad base configurada`);
}

async function main() {
  console.log(`=== Importación Maestros + Mia Pitza ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const companyId = await resolveCompanyId();
  console.log(`Empresa: id=${companyId}`);

  const branch = await ensureBranch(companyId);
  console.log(`Sucursal mesas: ${BRANCH_NAME} (id=${branch.id})\n`);

  await importMaestros(companyId, branch.id);

  let brandMiaId = -1;
  if (DRY_RUN) {
    brandMiaId = -1;
  } else {
    const brand = await prisma.menuBrand.findFirst({ where: { companyId, name: 'Mia Pitza' } });
    if (!brand) throw new Error('Marca "Mia Pitza" no encontrada tras importar maestros');
    brandMiaId = brand.id;
  }

  await importPlantilla(companyId, brandMiaId);
  await configureUnits(companyId);

  console.log('\n=== Resumen ===');
  console.log(`  Categorías nuevas:     ${stats.categories}`);
  console.log(`  Marcas nuevas:         ${stats.brands}`);
  console.log(`  Proveedores:           ${stats.suppliers}`);
  console.log(`  Productos inventario:  ${stats.inventoryProducts}`);
  console.log(`  Ingredientes receta:   ${stats.recipeProducts}`);
  console.log(`  Platos menú:           ${stats.menuItems}`);
  console.log(`  Líneas BOM/receta:     ${stats.recipes}`);
  console.log(`  Mesas Bamboo:          ${stats.tables}`);

  if (stats.warnings.length) {
    console.log(`\n⚠ Advertencias (${stats.warnings.length}):`);
    for (const w of stats.warnings) console.log(`  - ${w}`);
  }

  if (DRY_RUN) console.log('\n(dry-run: no se escribió nada en la BD)');
  else console.log('\n✓ Importación completada');
}

main()
  .catch((err) => {
    console.error('Error en importación:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
