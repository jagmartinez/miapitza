import prisma from '../src/utils/prisma';

const COMPANY_ID = 1;
const TARGET_SKU = 'MIS-000059';
const REFERENCE_COST = 145.67;

async function main() {
  const apply = process.argv.includes('--apply');
  const product = await prisma.product.findFirst({
    where: { companyId: COMPANY_ID, sku: TARGET_SKU },
    select: {
      id: true, name: true, active: true, unit: true, cost: true,
      currentAverageCost: true, lastPurchaseCost: true,
      _count: { select: { stocks: true, purchaseOrderItems: true, costHistory: true, recipes: true } },
    },
  });
  if (!product) throw new Error(`Product ${TARGET_SKU} not found for company ${COMPANY_ID}`);
  if (!product.active || product.name !== 'MEZCLA BROWNIES' || product.unit !== 'unidad') {
    throw new Error(`Unexpected target identity: ${JSON.stringify(product)}`);
  }
  if (Number(product.currentAverageCost) !== 0 || Number(product.lastPurchaseCost) !== 0) {
    throw new Error('Refusing to overwrite operational purchase cost/history');
  }
  if (product._count.stocks !== 0 || product._count.purchaseOrderItems !== 0 || product._count.costHistory !== 0) {
    throw new Error(`Refusing reconciliation because operational references appeared: ${JSON.stringify(product._count)}`);
  }

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    product,
    proposedReferenceCost: REFERENCE_COST,
    evidence: 'recetas-menu.production-map.json: Compras!42, 874/6 = 145.6667 per unidad',
  };
  if (!apply) {
    console.error(JSON.stringify(report));
    return;
  }
  if (process.env.ALLOW_RECIPE_COST_RECONCILIATION !== '1') {
    throw new Error('Set ALLOW_RECIPE_COST_RECONCILIATION=1 to apply');
  }

  await prisma.$transaction(async tx => {
    const result = await tx.product.updateMany({
      where: {
        id: product.id,
        companyId: COMPANY_ID,
        sku: TARGET_SKU,
        cost: product.cost,
        currentAverageCost: 0,
        lastPurchaseCost: 0,
      },
      data: { cost: REFERENCE_COST },
    });
    if (result.count !== 1) throw new Error(`Expected one guarded update, got ${result.count}`);
  });

  const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, select: { cost: true } });
  if (Number(updated.cost) !== REFERENCE_COST) throw new Error('Postcondition failed');
  console.error(JSON.stringify({ ...report, updatedReferenceCost: Number(updated.cost) }));
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
