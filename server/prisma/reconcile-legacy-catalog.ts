import prisma from '../src/utils/prisma';

const UNUSED_IDS = [375, 376, 377, 378, 380, 381, 382, 383, 384, 385, 386, 387, 388, 389, 390, 391, 392];
const PRESERVED_ID = 379;
const COMPANY_ID = 1;

async function main() {
  const apply = process.argv.includes('--apply');
  const products = await prisma.product.findMany({
    where: { id: { in: [...UNUSED_IDS, PRESERVED_ID] }, companyId: COMPANY_ID },
    select: {
      id: true, active: true, sku: true, baseUnitId: true, unit: true,
      _count: {
        select: {
          stocks: true, inventoryMovements: true, inventoryBatches: true,
          purchaseOrderItems: true, recipes: true, recipeComponents: true,
          productionOrders: true, productionOrderItems: true, costHistory: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  if (products.length !== 18) throw new Error(`Expected 18 legacy products, found ${products.length}`);

  const blockers = products.filter(product => UNUSED_IDS.includes(product.id) && Object.values(product._count).some(count => count !== 0));
  if (blockers.length > 0) throw new Error(`Unused candidates gained references: ${blockers.map(product => product.id).join(', ')}`);

  const preserved = products.find(product => product.id === PRESERVED_ID)!;
  if (preserved.unit !== 'unit' && preserved.unit !== 'unidad') throw new Error(`Unexpected legacy unit: ${preserved.unit}`);
  const unit = await prisma.unitOfMeasure.findFirst({ where: { id: 18, companyId: COMPANY_ID, abbreviation: 'unidad', active: true } });
  if (!unit) throw new Error('Company unit id 18 (unidad) is unavailable');

  const plan = {
    deactivate: UNUSED_IDS,
    preserve: {
      id: PRESERVED_ID,
      sku: 'LEGACY-000379',
      baseUnitId: unit.id,
      unit: unit.abbreviation,
      conversionFactor: 1,
      references: preserved._count,
    },
  };
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', plan }, null, 2));
    return;
  }
  if (process.env.ALLOW_LEGACY_CATALOG_RECONCILIATION !== '1') {
    throw new Error('Set ALLOW_LEGACY_CATALOG_RECONCILIATION=1 to apply');
  }

  await prisma.$transaction(async tx => {
    const deactivated = await tx.product.updateMany({
      where: { id: { in: UNUSED_IDS }, companyId: COMPANY_ID, active: true },
      data: { active: false },
    });
    if (deactivated.count !== UNUSED_IDS.length) throw new Error(`Expected to deactivate ${UNUSED_IDS.length}, changed ${deactivated.count}`);

    await tx.product.update({
      where: { id: PRESERVED_ID },
      data: {
        sku: 'LEGACY-000379',
        baseUnitId: unit.id,
        unit: unit.abbreviation,
        observation: 'Legacy purchase preserved as unidad; do not merge into liter-based catalog without documented package volume.',
      },
    });
    await tx.productUnit.upsert({
      where: { productId_unitId: { productId: PRESERVED_ID, unitId: unit.id } },
      create: { companyId: COMPANY_ID, productId: PRESERVED_ID, unitId: unit.id, conversionFactor: 1, isDefault: true, active: true },
      update: { conversionFactor: 1, isDefault: true, active: true },
    });
  });

  const remaining = await prisma.product.count({
    where: { companyId: COMPANY_ID, active: true, OR: [{ sku: null }, { sku: '' }, { baseUnitId: null }] },
  });
  if (remaining !== 0) throw new Error(`Postcondition failed: ${remaining} active products remain incomplete`);
  console.log(JSON.stringify({ mode: 'applied', plan, remainingIncompleteActiveProducts: remaining }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
