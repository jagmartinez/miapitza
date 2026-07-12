import prisma from '../src/utils/prisma';

async function main() {
  const missingCatalog = await prisma.product.findMany({
    where: { active: true, OR: [{ sku: null }, { sku: '' }, { baseUnitId: null }] },
    select: {
      id: true,
      companyId: true,
      name: true,
      sku: true,
      unit: true,
      baseUnitId: true,
      type: true,
      _count: { select: { stocks: true, recipes: true, recipeComponents: true, purchaseOrderItems: true } },
    },
    orderBy: [{ companyId: 'asc' }, { id: 'asc' }],
  });

  const [invalidUnits, negativeStocks, invalidBatches, invalidRecipes, invalidProductionRecipes] = await Promise.all([
    prisma.productUnit.findMany({
      select: { id: true, companyId: true, productId: true, unitId: true, conversionFactor: true, product: { select: { companyId: true } }, unit: { select: { companyId: true } } },
    }).then(rows => rows.filter(row => row.conversionFactor.toNumber() <= 0 || row.companyId !== row.product.companyId || row.companyId !== row.unit.companyId)),
    prisma.stock.findMany({
      where: { quantity: { lt: 0 } },
      select: { id: true, companyId: true, warehouseId: true, productId: true, quantity: true },
    }),
    prisma.inventoryBatch.findMany({
      where: { OR: [{ unitCost: { lt: 0 } }, { originalQty: { lt: 0 } }, { remainingQty: { lt: 0 } }] },
      select: { id: true, companyId: true, warehouseId: true, productId: true, unitCost: true, originalQty: true, remainingQty: true },
    }),
    prisma.recipe.findMany({
      where: { quantity: { lte: 0 } },
      select: { id: true, menuItemId: true, productId: true, quantity: true, unitId: true },
    }),
    prisma.productionRecipe.findMany({
      where: { status: 'ACTIVE', OR: [{ yieldQuantity: { lte: 0 } }, { components: { none: {} } }] },
      select: { id: true, companyId: true, productId: true, yieldQuantity: true, _count: { select: { components: true } } },
    }),
  ]);

  const activeRecipes = await prisma.productionRecipe.groupBy({
    by: ['companyId', 'productId'],
    where: { status: 'ACTIVE' },
    _count: { _all: true },
    having: { id: { _count: { gt: 1 } } },
  });

  const missingNames = [...new Set(missingCatalog.map(product => product.name))];
  const catalogCandidates = await prisma.product.findMany({
    where: { companyId: { in: [...new Set(missingCatalog.map(product => product.companyId))] }, name: { in: missingNames } },
    select: {
      id: true,
      companyId: true,
      name: true,
      sku: true,
      baseUnitId: true,
      unit: true,
      cost: true,
      currentAverageCost: true,
      lastPurchaseCost: true,
      active: true,
      baseUnit: { select: { abbreviation: true, name: true } },
      allowedUnits: { select: { unitId: true, conversionFactor: true, isDefault: true, unit: { select: { abbreviation: true } } } },
      _count: { select: { stocks: true, recipes: true, recipeComponents: true, purchaseOrderItems: true } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  const missingIds = missingCatalog.map(product => product.id);
  const [legacyStocks, legacyPurchaseItems, legacyMovements, legacyBatches, legacyCostHistory] = await Promise.all([
    prisma.stock.findMany({ where: { productId: { in: missingIds } }, select: { id: true, companyId: true, warehouseId: true, productId: true, quantity: true } }),
    prisma.purchaseOrderItem.findMany({ where: { productId: { in: missingIds } }, select: { id: true, purchaseOrderId: true, productId: true, quantity: true, cost: true, subtotal: true, purchaseUnit: true, conversionFactor: true, baseQuantity: true, baseCost: true } }),
    prisma.inventoryMovement.findMany({ where: { productId: { in: missingIds } }, select: { id: true, warehouseId: true, productId: true, type: true, quantity: true, originalUnit: true, conversionFactor: true, unitCost: true, totalCost: true, reference: true } }),
    prisma.inventoryBatch.findMany({ where: { productId: { in: missingIds } }, select: { id: true, warehouseId: true, productId: true, unitCost: true, originalQty: true, remainingQty: true, sourceType: true, sourceRef: true } }),
    prisma.productCostHistory.findMany({ where: { productId: { in: missingIds } }, select: { id: true, productId: true, companyId: true, purchaseOrderItemId: true, quantity: true, unitCost: true, previousAvgCost: true, newAvgCost: true, previousStock: true, newStock: true } }),
  ]);

  console.log(JSON.stringify({
    missingCatalog,
    catalogCandidates,
    legacyDetails: { legacyStocks, legacyPurchaseItems, legacyMovements, legacyBatches, legacyCostHistory },
    invalidUnits,
    negativeStocks,
    invalidBatches,
    invalidRecipes,
    invalidProductionRecipes,
    duplicateActiveProductionRecipes: activeRecipes,
  }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
