import mysql, { RowDataPacket } from 'mysql2/promise';

const TARGET_PRODUCT_IDS = [58, 172, 176, 310, 373, 374, 404] as const;

type SourceCandidate = {
  source: 'RECEIVED_PURCHASE' | 'COST_HISTORY' | 'FIFO_BATCH' | 'IN_MOVEMENT';
  referenceId: number;
  unitCost: number;
  occurredAt: string;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

async function main() {
  if (!['true', '1'].includes(process.env.ALLOW_PRODUCTION_READONLY_AUDIT || '')) {
    throw new Error('Set ALLOW_PRODUCTION_READONLY_AUDIT=true for the read-only production audit');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  const placeholders = TARGET_PRODUCT_IDS.map(() => '?').join(',');

  try {
    await connection.query('START TRANSACTION READ ONLY');

    const [products] = await connection.query<RowDataPacket[]>(`
      SELECT p.id, p.companyId, p.name, p.sku, p.unit, p.baseUnitId, p.type,
             p.active, p.cost, p.currentAverageCost, p.lastPurchaseCost
      FROM Product p
      WHERE p.id IN (${placeholders})
      ORDER BY p.id
    `, [...TARGET_PRODUCT_IDS]);

    const [stocks] = await connection.query<RowDataPacket[]>(`
      SELECT s.productId, s.warehouseId, w.code AS warehouseCode,
             w.type AS warehouseType, w.branchId, s.quantity
      FROM Stock s
      JOIN Warehouse w ON w.id = s.warehouseId AND w.companyId = s.companyId
      WHERE s.productId IN (${placeholders})
      ORDER BY s.productId, s.warehouseId
    `, [...TARGET_PRODUCT_IDS]);

    const [purchases] = await connection.query<RowDataPacket[]>(`
      SELECT poi.productId, poi.id, po.id AS purchaseOrderId, po.status,
             po.date AS occurredAt, poi.quantity, poi.cost, poi.baseQuantity,
             poi.baseCost, poi.conversionFactor, poi.purchaseUnit
      FROM PurchaseOrderItem poi
      JOIN PurchaseOrder po ON po.id = poi.purchaseOrderId
      WHERE poi.productId IN (${placeholders})
      ORDER BY poi.productId, po.date DESC, poi.id DESC
    `, [...TARGET_PRODUCT_IDS]);

    const [history] = await connection.query<RowDataPacket[]>(`
      SELECT productId, id, purchaseOrderItemId, productionOrderId,
             quantity, unitCost, previousAvgCost, newAvgCost,
             previousStock, newStock, createdAt AS occurredAt
      FROM ProductCostHistory
      WHERE productId IN (${placeholders})
      ORDER BY productId, createdAt DESC, id DESC
    `, [...TARGET_PRODUCT_IDS]);

    const [batches] = await connection.query<RowDataPacket[]>(`
      SELECT productId, id, warehouseId, unitCost, originalQty, remainingQty,
             sourceType, sourceRef, createdAt AS occurredAt
      FROM InventoryBatch
      WHERE productId IN (${placeholders})
      ORDER BY productId, createdAt DESC, id DESC
    `, [...TARGET_PRODUCT_IDS]);

    const [movements] = await connection.query<RowDataPacket[]>(`
      SELECT productId, id, warehouseId, type, quantity, unitCost, totalCost,
             reference, reason, createdAt AS occurredAt
      FROM InventoryMovement
      WHERE productId IN (${placeholders})
      ORDER BY productId, createdAt DESC, id DESC
    `, [...TARGET_PRODUCT_IDS]);

    const [menuUsage] = await connection.query<RowDataPacket[]>(`
      SELECT r.productId, mi.id AS menuItemId, mi.name AS menuItemName,
             mi.active, r.quantity, r.unit, r.unitId
      FROM Recipe r
      JOIN MenuItem mi ON mi.id = r.menuItemId
      WHERE r.productId IN (${placeholders})
      ORDER BY r.productId, mi.id
    `, [...TARGET_PRODUCT_IDS]);

    const [productionUsage] = await connection.query<RowDataPacket[]>(`
      SELECT c.componentProductId AS productId, pr.id AS recipeId,
             pr.name AS recipeName, pr.status, pr.productId AS outputProductId,
             c.quantity, c.unit, c.unitId
      FROM ProductionRecipeComponent c
      JOIN ProductionRecipe pr ON pr.id = c.recipeId
      WHERE c.componentProductId IN (${placeholders})
      ORDER BY c.componentProductId, pr.id
    `, [...TARGET_PRODUCT_IDS]);

    const [productionOutputs] = await connection.query<RowDataPacket[]>(`
      SELECT pr.productId, pr.id AS recipeId, pr.name AS recipeName, pr.status,
             pr.version, pr.yieldQuantity, pr.yieldUnitId,
             c.componentProductId, component.name AS componentName,
             component.cost AS componentCost,
             component.currentAverageCost AS componentAverageCost,
             component.lastPurchaseCost AS componentLastPurchaseCost,
             c.quantity, c.unit, c.unitId
      FROM ProductionRecipe pr
      LEFT JOIN ProductionRecipeComponent c ON c.recipeId = pr.id
      LEFT JOIN Product component ON component.id = c.componentProductId
      WHERE pr.productId IN (${placeholders})
      ORDER BY pr.productId, pr.version DESC, c.id
    `, [...TARGET_PRODUCT_IDS]);

    const [catalogAlternates] = await connection.query<RowDataPacket[]>(`
      SELECT id, companyId, name, sku, unit, baseUnitId, type, active,
             cost, currentAverageCost, lastPurchaseCost
      FROM Product
      WHERE companyId IN (SELECT DISTINCT companyId FROM Product WHERE id IN (${placeholders}))
        AND (
          UPPER(name) LIKE '%LEVADURA%'
          OR UPPER(name) LIKE '%MIEL%'
          OR UPPER(name) LIKE '%PIÑA%'
          OR UPPER(name) LIKE '%PINA%'
          OR UPPER(name) LIKE '%CARNE DELLA NONNA%'
          OR UPPER(name) LIKE '%MASA PRECOCIDA%'
          OR UPPER(name) LIKE '%AGUA DE PROCESO%'
          OR sku IN ('CCI-DAB047458A', 'CCI-1704189573', 'CCI-4E0B9A6D47')
        )
      ORDER BY name, id
    `, [...TARGET_PRODUCT_IDS]);

    const candidates = new Map<number, SourceCandidate[]>();
    for (const id of TARGET_PRODUCT_IDS) candidates.set(id, []);

    for (const row of purchases) {
      const unitCost = asNumber(row.baseCost);
      if (row.status === 'RECEIVED' && unitCost > 0) {
        candidates.get(asNumber(row.productId))?.push({
          source: 'RECEIVED_PURCHASE',
          referenceId: asNumber(row.id),
          unitCost,
          occurredAt: asIso(row.occurredAt),
        });
      }
    }
    for (const row of history) {
      const unitCost = asNumber(row.unitCost) || asNumber(row.newAvgCost);
      if (unitCost > 0) {
        candidates.get(asNumber(row.productId))?.push({
          source: 'COST_HISTORY',
          referenceId: asNumber(row.id),
          unitCost,
          occurredAt: asIso(row.occurredAt),
        });
      }
    }
    for (const row of batches) {
      const unitCost = asNumber(row.unitCost);
      if (unitCost > 0) {
        candidates.get(asNumber(row.productId))?.push({
          source: 'FIFO_BATCH',
          referenceId: asNumber(row.id),
          unitCost,
          occurredAt: asIso(row.occurredAt),
        });
      }
    }
    for (const row of movements) {
      const unitCost = asNumber(row.unitCost);
      if (row.type === 'IN' && unitCost > 0) {
        candidates.get(asNumber(row.productId))?.push({
          source: 'IN_MOVEMENT',
          referenceId: asNumber(row.id),
          unitCost,
          occurredAt: asIso(row.occurredAt),
        });
      }
    }

    const result = products.map((product) => {
      const productId = asNumber(product.id);
      const sourceCandidates = candidates.get(productId) ?? [];
      sourceCandidates.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
      return {
        product,
        stocks: stocks.filter((row) => asNumber(row.productId) === productId),
        receivedPurchases: purchases.filter((row) =>
          asNumber(row.productId) === productId && row.status === 'RECEIVED'),
        costHistory: history.filter((row) => asNumber(row.productId) === productId),
        inventoryBatches: batches.filter((row) => asNumber(row.productId) === productId),
        inventoryMovements: movements.filter((row) => asNumber(row.productId) === productId),
        menuUsage: menuUsage.filter((row) => asNumber(row.productId) === productId),
        productionUsage: productionUsage.filter((row) => asNumber(row.productId) === productId),
        productionOutputRecipes: productionOutputs.filter((row) => asNumber(row.productId) === productId),
        positiveCostCandidates: sourceCandidates,
        recommendation: sourceCandidates.length > 0
          ? 'REQUIRES_BUSINESS_SOURCE_CONFIRMATION'
          : 'NO_POSITIVE_HISTORICAL_SOURCE_FOUND',
      };
    });

    console.log(JSON.stringify({
      targetProductIds: TARGET_PRODUCT_IDS,
      products: result,
      catalogAlternates,
    }));
    await connection.rollback();
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
