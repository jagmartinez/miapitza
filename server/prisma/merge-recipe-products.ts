/**
 * Unifica la "doble capa" de productos: redirige recetas desde MP-xxx
 * hacia el catálogo maestro cuando hay match, y conserva un solo registro
 * de producción para ingredientes que no existen en compras.
 *
 * Uso: npx tsx prisma/merge-recipe-products.ts
 */

import prisma from '../src/utils/prisma';

const COMPANY_ID = 1;

/** MP-xxx → SKU maestro. null = mantener como producto único de producción (renombrar SKU). */
const MP_TO_MASTER_SKU: Record<string, string | null> = {
  'MP-001': null,
  'MP-002': 'MIS-000001',
  'MP-003': null,
  'MP-004': 'VEG-000012',
  'MP-005': null,
  'MP-006': null,
  'MP-007': 'CON-000036',
  'MP-008': 'CON-000019',
  'MP-009': 'CON-000034',
  'MP-010': 'CON-000028',
  'MP-011': 'CON-000014',
  'MP-012': 'MIS-000014',
  'MP-013': null,
  'MP-014': 'CON-000018',
  'MP-015': 'VEG-000008',
  'MP-016': 'MIS-000020',
  'MP-017': 'CON-000029',
  'MP-018': 'VEG-000006',
  'MP-019': 'CON-000030',
  'MP-020': null,
  'MP-021': null,
  'MP-022': null,
  'MP-023': 'MIS-000032',
};

async function main() {
  const lastPrd = await prisma.product.findFirst({
    where: { companyId: COMPANY_ID, sku: { startsWith: 'PRD-' } },
    orderBy: { sku: 'desc' },
    select: { sku: true },
  });
  let prdCounter = 0;
  if (lastPrd?.sku) {
    const parsed = parseInt(lastPrd.sku.split('-')[1], 10);
    if (!isNaN(parsed)) prdCounter = parsed;
  }

  const productionCategory = await prisma.category.findFirst({
    where: { companyId: COMPANY_ID, name: 'Producción' },
  });

  const mpProducts = await prisma.product.findMany({
    where: { companyId: COMPANY_ID, sku: { startsWith: 'MP-' } },
    orderBy: { sku: 'asc' },
  });

  let recipesRedirected = 0;
  let mpDeleted = 0;
  let keptAsProduction = 0;

  await prisma.$transaction(async (tx) => {
    for (const mp of mpProducts) {
      const targetSku = MP_TO_MASTER_SKU[mp.sku];
      if (targetSku === undefined) {
        console.warn(`Sin mapping para ${mp.sku} ${mp.name}`);
        continue;
      }

      if (targetSku) {
        const master = await tx.product.findFirst({
          where: { companyId: COMPANY_ID, sku: targetSku },
        });
        if (!master) throw new Error(`No se encontró producto maestro ${targetSku} para ${mp.sku}`);

        const recipes = await tx.recipe.findMany({ where: { productId: mp.id } });
        for (const recipe of recipes) {
          const clash = await tx.recipe.findUnique({
            where: { menuItemId_productId: { menuItemId: recipe.menuItemId, productId: master.id } },
          });
          if (clash) {
            await tx.recipe.update({
              where: { id: clash.id },
              data: { quantity: recipe.quantity, unit: recipe.unit, unitId: recipe.unitId },
            });
            await tx.recipe.delete({ where: { id: recipe.id } });
          } else {
            await tx.recipe.update({
              where: { id: recipe.id },
              data: { productId: master.id },
            });
          }
          recipesRedirected++;
        }

        await tx.productUnit.deleteMany({ where: { productId: mp.id } });
        await tx.stock.deleteMany({ where: { productId: mp.id } });
        await tx.product.delete({ where: { id: mp.id } });
        mpDeleted++;
        console.log(`  ${mp.sku} ${mp.name} → ${master.sku} ${master.name}`);
      } else {
        prdCounter += 1;
        const newSku = `PRD-${String(prdCounter).padStart(6, '0')}`;
        await tx.product.update({
          where: { id: mp.id },
          data: {
            sku: newSku,
            categoryId: productionCategory?.id ?? mp.categoryId,
            observation: 'Ingrediente de producción / receta (catálogo unificado)',
            type: 'INGREDIENT',
          },
        });
        keptAsProduction++;
        console.log(`  ${mp.sku} ${mp.name} → ${newSku} (producción única)`);
      }
    }
  });

  const totalProducts = await prisma.product.count({ where: { companyId: COMPANY_ID } });
  const mpRemaining = await prisma.product.count({
    where: { companyId: COMPANY_ID, sku: { startsWith: 'MP-' } },
  });

  console.log('\n=== Unificación completada ===');
  console.log(`  Recetas redirigidas:  ${recipesRedirected}`);
  console.log(`  MP eliminados (merge):${mpDeleted}`);
  console.log(`  Conservados PRD:      ${keptAsProduction}`);
  console.log(`  Productos totales:    ${totalProducts}`);
  console.log(`  MP restantes:         ${mpRemaining} (debe ser 0)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
