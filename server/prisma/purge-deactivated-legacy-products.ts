import prisma from '../src/utils/prisma';

const IDS = [375, 376, 377, 378, 380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 390, 391, 392];
const COMPANY_ID = 1;

async function main() {
  const apply = process.argv.includes('--apply');
  const products = await prisma.product.findMany({
    where: { id: { in: IDS }, companyId: COMPANY_ID },
    select: {
      id: true,
      name: true,
      active: true,
      _count: {
        select: {
          stocks: true,
          inventoryMovements: true,
          inventoryBatches: true,
          purchaseOrderItems: true,
          recipes: true,
          costHistory: true,
          allowedUnits: true,
          modifierLinks: true,
          productionRecipes: true,
          recipeComponents: true,
          productionOrders: true,
          productionOrderItems: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  if (products.length !== IDS.length) throw new Error(`Expected ${IDS.length} products, found ${products.length}`);

  const active = products.filter(product => product.active);
  if (active.length > 0) throw new Error(`Products must be inactive before purge: ${active.map(product => product.id).join(', ')}`);
  const referenced = products.filter(product => Object.values(product._count).some(count => count !== 0));
  if (referenced.length > 0) {
    throw new Error(`Refusing purge; products gained references: ${referenced.map(product => `${product.id}:${JSON.stringify(product._count)}`).join('; ')}`);
  }

  const plan = products.map(product => ({ id: product.id, name: product.name, references: product._count }));
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', delete: plan }, null, 2));
    return;
  }
  if (process.env.ALLOW_LEGACY_PRODUCT_PURGE !== '1') throw new Error('Set ALLOW_LEGACY_PRODUCT_PURGE=1 to apply');

  await prisma.$transaction(async tx => {
    // ProductUnit is onDelete: Cascade, but the precondition requires zero rows.
    // All historical/operational relations are zero and therefore never cascaded.
    const result = await tx.product.deleteMany({ where: { id: { in: IDS }, companyId: COMPANY_ID, active: false } });
    if (result.count !== IDS.length) throw new Error(`Expected to delete ${IDS.length}, deleted ${result.count}`);
  });

  const remaining = await prisma.product.count({ where: { id: { in: IDS } } });
  if (remaining !== 0) throw new Error(`Postcondition failed: ${remaining} legacy products remain`);
  console.log(JSON.stringify({ mode: 'applied', deletedIds: IDS, remaining }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
