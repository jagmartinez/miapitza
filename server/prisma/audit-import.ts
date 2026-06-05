import prisma from '../src/utils/prisma';
import { resolveMenuPrice } from './miapitz-menu-prices';

async function main() {
  const companyId = 1;

  const [
    categories,
    brands,
    suppliers,
    products,
    menuItems,
    recipes,
    tables,
    units,
    productsWithBaseUnit,
    productsNoSku,
    menuNoPrice,
    recipeOrphans,
    duplicateSkus,
    branchBamboo,
    branchMain,
  ] = await Promise.all([
    prisma.category.findMany({ where: { companyId }, select: { id: true, name: true, codePrefix: true }, orderBy: { name: 'asc' } }),
    prisma.menuBrand.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { companyId }, select: { id: true, name: true, taxId: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({
      where: { companyId },
      select: { id: true, sku: true, name: true, categoryId: true, unit: true, minStock: true, baseUnitId: true, type: true },
      orderBy: { sku: 'asc' },
    }),
    prisma.menuItem.findMany({
      where: { companyId },
      select: { id: true, name: true, price: true, description: true, category: { select: { name: true } }, brand: { select: { name: true } }, _count: { select: { recipes: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.recipe.findMany({
      include: {
        menuItem: { select: { name: true } },
        product: { select: { name: true, sku: true } },
      },
    }),
    prisma.table.findMany({ where: { companyId }, select: { id: true, number: true, branch: { select: { code: true, name: true } } }, orderBy: { number: 'asc' } }),
    prisma.unitOfMeasure.findMany({ where: { companyId }, select: { abbreviation: true } }),
    prisma.product.count({ where: { companyId, baseUnitId: { not: null } } }),
    prisma.product.count({ where: { companyId, OR: [{ sku: null }, { sku: '' }] } }),
    prisma.menuItem.count({ where: { companyId, price: 0 } }),
    prisma.recipe.findMany({
      where: { menuItem: { companyId } },
      include: { menuItem: true, product: true },
    }),
    prisma.$queryRaw<{ sku: string; c: bigint }[]>`
      SELECT sku, COUNT(*) as c FROM Product WHERE companyId = ${companyId} AND sku IS NOT NULL GROUP BY sku HAVING c > 1
    `,
    prisma.branch.findFirst({ where: { companyId, code: 'BAMBOO' } }),
    prisma.branch.findFirst({ where: { companyId, code: 'MAIN' } }),
  ]);

  const mpProducts = products.filter((p) => p.sku?.startsWith('MP-'));
  const invProducts = products.filter((p) => !p.sku?.startsWith('MP-'));
  const dupNameProducts = new Map<string, number>();
  for (const p of invProducts) {
    const k = p.name.toLowerCase();
    dupNameProducts.set(k, (dupNameProducts.get(k) ?? 0) + 1);
  }
  const intentionalDups = [...dupNameProducts.entries()].filter(([, c]) => c > 1);

  const menuChecks = menuItems.map((m) => ({
    name: m.name,
    price: Number(m.price),
    expectedPrice: resolveMenuPrice(m.name, m.description),
    recipes: m._count.recipes,
    brand: m.brand?.name ?? null,
    category: m.category.name,
    ok: Number(m.price) === resolveMenuPrice(m.name, m.description) && m._count.recipes > 0,
  }));

  const recipeCodes = new Set<string>();
  for (const m of menuItems) {
    const match = m.description?.match(/PZ-\d+/i);
    if (match) recipeCodes.add(match[0].toUpperCase());
  }

  const report = {
    expected: {
      suppliers: 63,
      inventoryProducts: 188,
      recipeIngredients: 23,
      menuPizzas: 13,
      recipeLines: 68,
      bambooTables: 28,
      categoriesMin: 25,
    },
    actual: {
      categories: categories.length,
      brands: brands.length,
      suppliers: suppliers.length,
      productsTotal: products.length,
      inventoryProducts: invProducts.length,
      recipeIngredientsMp: mpProducts.length,
      menuItems: menuItems.length,
      recipes: recipes.length,
      tables: tables.length,
      units: units.length,
      productsWithBaseUnit,
      productsNoSku,
      menuWithZeroPrice: menuNoPrice,
    },
    branches: { main: branchMain, bamboo: branchBamboo },
    menuChecks,
    allMenuOk: menuChecks.every((m) => m.ok),
    duplicateSkus: duplicateSkus.map((d) => ({ sku: d.sku, count: Number(d.c) })),
    intentionalDuplicateProductNames: intentionalDups.length,
    sampleIntentionalDups: intentionalDups.slice(0, 5).map(([name, count]) => ({ name, count })),
    recipeIngredientSkus: mpProducts.map((p) => p.sku),
    tablesBranch: [...new Set(tables.map((t) => t.branch.code))],
    issues: [] as string[],
    passed: [] as string[],
  };

  if (report.actual.suppliers >= 62) report.passed.push('Proveedores importados (62-63, 1 posible duplicado por nombre)');
  else report.issues.push(`Proveedores: esperados ~63, hay ${report.actual.suppliers}`);

  if (report.actual.inventoryProducts === 188) report.passed.push('188 productos de inventario del maestro');
  else report.issues.push(`Productos inventario: esperados 188, hay ${report.actual.inventoryProducts}`);

  if (report.actual.recipeIngredientsMp === 23) report.passed.push('23 ingredientes MP-xxx para recetas');
  else report.issues.push(`Ingredientes receta: esperados 23, hay ${report.actual.recipeIngredientsMp}`);

  if (report.actual.menuItems === 13) report.passed.push('13 pizzas del menú (importación parcial de prueba)');
  else report.issues.push(`Menu items: esperados 13, hay ${report.actual.menuItems}`);

  if (report.actual.recipes === 68) report.passed.push('68 líneas BOM/recetas enlazadas');
  else report.issues.push(`Recetas: esperadas 68, hay ${report.actual.recipes}`);

  if (report.actual.tables === 28) report.passed.push('28 mesas en sucursal BAMBOO');
  else report.issues.push(`Mesas: esperadas 28, hay ${report.actual.tables}`);

  if (report.actual.productsWithBaseUnit === report.actual.productsTotal) report.passed.push('Todos los productos tienen unidad base configurada');
  else report.issues.push(`Productos sin baseUnitId: ${report.actual.productsTotal - report.actual.productsWithBaseUnit}`);

  if (report.actual.productsNoSku === 0) report.passed.push('Todos los productos tienen SKU');
  else report.issues.push(`Productos sin SKU: ${report.actual.productsNoSku}`);

  if (report.actual.menuWithZeroPrice === 0) report.passed.push('Todas las pizzas tienen precio del PDF');
  else report.issues.push(`Platos con precio 0: ${report.actual.menuWithZeroPrice}`);

  if (report.allMenuOk) report.passed.push('Cada pizza tiene precio correcto y al menos 1 ingrediente en receta');
  else report.issues.push('Algunas pizzas sin precio o sin receta');

  if (report.duplicateSkus.length === 0) report.passed.push('Sin SKUs duplicados');
  else report.issues.push(`SKUs duplicados: ${report.duplicateSkus.length}`);

  if (branchBamboo) report.passed.push('Sucursal BAMBOO creada para mesas');
  else report.issues.push('Sucursal BAMBOO no existe');

  // Partial import caveats (not bugs)
  report.issues.push(
    '[ESPERADO - parcial] Solo 13 pizzas; el PDF tiene ~70+ ítems (extras, pastas, vinos, antipastos…)',
  );
  report.issues.push(
    '[ESPERADO - parcial] Ingredientes MP-xxx separados del catálogo de compras (188 productos maestro)',
  );
  report.issues.push(
    '[ESPERADO - parcial] Columna PADEL de mesas vacía en Excel; no hay mesas Padel',
  );
  report.issues.push(
    '[ESPERADO - parcial] Stock inicial en almacén = 0; solo se importó minStock del maestro',
  );
  if (intentionalDups.length > 0) {
    report.issues.push(
      `[INFO] ${intentionalDups.length} nombres duplicados en maestro renombrados (ej. PEPPERONI x3)`,
    );
  }

  console.log(JSON.stringify(report, null, 2));
}

main().finally(() => prisma.$disconnect());
