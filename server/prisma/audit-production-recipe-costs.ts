import prisma from '../src/utils/prisma';
import { ProductionRecipeService } from '../src/services/production-recipe.service';

async function main() {
  const recipes = await prisma.productionRecipe.findMany({
    include: {
      company: { select: { name: true } },
      product: { select: { name: true, sku: true, unit: true } },
      components: {
        include: {
          componentProduct: {
            select: {
              name: true,
              sku: true,
              unit: true,
              baseUnitId: true,
              cost: true,
              currentAverageCost: true,
            },
          },
          unitOfMeasure: { select: { abbreviation: true, measurementType: true } },
        },
      },
    },
    orderBy: [{ companyId: 'asc' }, { id: 'asc' }],
  });

  const results = await Promise.all(recipes.map(async recipe => {
    try {
      const cost = await ProductionRecipeService.computeRecipeCost(recipe.id, recipe.companyId);
      return {
        id: recipe.id,
        company: recipe.company.name,
        product: recipe.product.name,
        sku: recipe.product.sku,
        status: recipe.status,
        cost,
        components: recipe.components.map(component => ({
          product: component.componentProduct.name,
          sku: component.componentProduct.sku,
          quantity: Number(component.quantity),
          requestedUnit: component.unitOfMeasure?.abbreviation || component.unit,
          baseUnit: component.componentProduct.unit,
          currentAverageCost: Number(component.componentProduct.currentAverageCost),
          referenceCost: Number(component.componentProduct.cost),
        })),
      };
    } catch (error) {
      return {
        id: recipe.id,
        company: recipe.company.name,
        product: recipe.product.name,
        sku: recipe.product.sku,
        status: recipe.status,
        error: error instanceof Error ? error.message : String(error),
        components: recipe.components.map(component => ({
          product: component.componentProduct.name,
          sku: component.componentProduct.sku,
          quantity: Number(component.quantity),
          requestedUnit: component.unitOfMeasure?.abbreviation || component.unit,
          requestedType: component.unitOfMeasure?.measurementType,
          baseUnit: component.componentProduct.unit,
          currentAverageCost: Number(component.componentProduct.currentAverageCost),
          referenceCost: Number(component.componentProduct.cost),
        })),
      };
    }
  }));

  const errors = results.filter(result => 'error' in result);
  const zeroCosts = results.filter(result => 'cost' in result && result.cost.batchCost === 0);
  const zeroCostLines = results.flatMap(result => 'cost' in result
    ? result.cost.lines
      .filter(line => line.unitCost === 0)
      .map(line => ({ recipeId: result.id, recipe: result.product, status: result.status, component: line.componentName }))
    : []);
  const zeroCostProductIds = [...new Set(results.flatMap(result => 'cost' in result
    ? result.cost.lines.filter(line => line.unitCost === 0).map(line => line.componentProductId)
    : []))];
  const zeroCostProducts = await prisma.product.findMany({
    where: { id: { in: zeroCostProductIds } },
    select: {
      id: true, name: true, sku: true, companyId: true, type: true, unit: true,
      cost: true, currentAverageCost: true, lastPurchaseCost: true,
      stocks: { select: { quantity: true, warehouseId: true } },
      purchaseOrderItems: { select: { cost: true, quantity: true, baseCost: true, baseQuantity: true, purchaseOrder: { select: { status: true } } }, take: 5, orderBy: { id: 'desc' } },
      costHistory: { select: { unitCost: true, quantity: true, createdAt: true }, take: 5, orderBy: { id: 'desc' } },
      productionRecipes: { select: { id: true, status: true, yieldQuantity: true }, take: 5, orderBy: { version: 'desc' } },
    },
  });
  const brownie = results.filter(result => result.product.toLowerCase().includes('brownie'));
  const report = JSON.stringify({
    recipeCount: recipes.length,
    errorCount: errors.length,
    zeroCostCount: zeroCosts.length,
    zeroCostLineCount: zeroCostLines.length,
    errors: errors.map(result => ({ id: result.id, product: result.product, status: result.status, error: result.error })),
    zeroCosts: zeroCosts.map(result => ({ id: result.id, product: result.product, status: result.status })),
    zeroCostLines,
    zeroCostProducts,
    brownie: brownie.map(result => ({
      id: result.id,
      product: result.product,
      status: result.status,
      ...('cost' in result ? { cost: result.cost } : { error: result.error }),
      components: result.components,
    })),
  });
  if (process.argv.includes('--emit-as-error')) throw new Error(`AUDIT_RESULT=${report}`);
  console.log(report);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
