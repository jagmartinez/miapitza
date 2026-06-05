import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function normalizeProductKey(name: string): string {
  let key = stripAccents(name).toLowerCase().trim();
  key = key.replace(/\s*\(\d+\)\s*$/g, '');
  key = key.replace(/\s+(pricesmart|walmart|la\s+colonia)\s*$/i, '');
  return key.replace(/\s+/g, ' ');
}

export function normalizeCategoryKey(name: string): string {
  return stripAccents(name).toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function mergeProductRecords(
  tx: Tx,
  companyId: number,
  survivorId: number,
  loserId: number
): Promise<void> {
  if (survivorId === loserId) return;

  const recipes = await tx.recipe.findMany({ where: { productId: loserId } });
  for (const recipe of recipes) {
    const clash = await tx.recipe.findUnique({
      where: { menuItemId_productId: { menuItemId: recipe.menuItemId, productId: survivorId } },
    });
    if (clash) {
      await tx.recipe.update({
        where: { id: clash.id },
        data: {
          quantity: Number(clash.quantity) + Number(recipe.quantity),
          unit: clash.unit ?? recipe.unit,
          unitId: clash.unitId ?? recipe.unitId,
        },
      });
      await tx.recipe.delete({ where: { id: recipe.id } });
    } else {
      await tx.recipe.update({
        where: { id: recipe.id },
        data: { productId: survivorId },
      });
    }
  }

  const loserStock = await tx.stock.findMany({ where: { productId: loserId } });
  for (const row of loserStock) {
    const existing = await tx.stock.findUnique({
      where: { warehouseId_productId: { warehouseId: row.warehouseId, productId: survivorId } },
    });
    if (existing) {
      await tx.stock.update({
        where: { id: existing.id },
        data: { quantity: Number(existing.quantity) + Number(row.quantity) },
      });
      await tx.stock.delete({ where: { id: row.id } });
    } else {
      await tx.stock.update({
        where: { id: row.id },
        data: { productId: survivorId },
      });
    }
  }

  await tx.inventoryMovement.updateMany({
    where: { productId: loserId },
    data: { productId: survivorId },
  });
  await tx.purchaseOrderItem.updateMany({
    where: { productId: loserId },
    data: { productId: survivorId },
  });
  await tx.productCostHistory.updateMany({
    where: { productId: loserId },
    data: { productId: survivorId },
  });

  const loserUnits = await tx.productUnit.findMany({ where: { productId: loserId } });
  for (const unit of loserUnits) {
    const clash = await tx.productUnit.findUnique({
      where: { productId_unitId: { productId: survivorId, unitId: unit.unitId } },
    });
    if (!clash) {
      await tx.productUnit.update({
        where: { id: unit.id },
        data: { productId: survivorId },
      });
    } else {
      await tx.productUnit.delete({ where: { id: unit.id } });
    }
  }

  const loser = await tx.product.findUnique({ where: { id: loserId } });
  const survivor = await tx.product.findUnique({ where: { id: survivorId } });
  if (loser && survivor) {
    const updates: Prisma.ProductUpdateInput = {};
    if (!survivor.cost && loser.cost) updates.cost = loser.cost;
    if (!survivor.currentAverageCost && loser.currentAverageCost) {
      updates.currentAverageCost = loser.currentAverageCost;
    }
    if (!survivor.lastPurchaseCost && loser.lastPurchaseCost) {
      updates.lastPurchaseCost = loser.lastPurchaseCost;
    }
    if (!survivor.minStock && loser.minStock) updates.minStock = loser.minStock;
    if (Object.keys(updates).length > 0) {
      await tx.product.update({ where: { id: survivorId }, data: updates });
    }
  }

  await tx.product.delete({ where: { id: loserId } });
}

export async function productSurvivorScore(
  prisma: PrismaClient | Tx,
  productId: number
): Promise<number> {
  const [recipes, stockAgg, poItems] = await Promise.all([
    prisma.recipe.count({ where: { productId } }),
    prisma.stock.aggregate({ where: { productId }, _sum: { quantity: true } }),
    prisma.purchaseOrderItem.count({ where: { productId } }),
  ]);
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true, sku: true },
  });
  let score = recipes * 1000 + (Number(stockAgg._sum.quantity) || 0) * 10 + poItems * 50;
  if (product) {
    if (!/\(\d+\)/.test(product.name)) score += 25;
    if (!/pricesmart|walmart|la\s+colonia/i.test(product.name)) score += 20;
    if (product.sku && !/D-/.test(product.sku)) score += 15;
    const skuNum = parseInt(product.sku?.split('-')[1] ?? '999999', 10);
    if (!Number.isNaN(skuNum) && skuNum <= 200) score += 5;
    if (/\(\d+\)/.test(product.name)) score -= 50;
    if (/pricesmart|walmart|la\s+colonia/i.test(product.name)) score -= 35;
    if (product.sku && /D-/.test(product.sku)) score -= 40;
  }
  return score;
}

export async function mergeCategoryRecords(
  tx: Tx,
  survivorId: number,
  loserId: number
): Promise<void> {
  if (survivorId === loserId) return;
  await tx.product.updateMany({
    where: { categoryId: loserId },
    data: { categoryId: survivorId },
  });
  await tx.menuItem.updateMany({
    where: { categoryId: loserId },
    data: { categoryId: survivorId },
  });
  await tx.category.delete({ where: { id: loserId } });
}
