import mysql, { RowDataPacket } from 'mysql2/promise';

type ForeignKeyRow = RowDataPacket & {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
  CONSTRAINT_NAME: string;
};

type CountRow = RowDataPacket & { count: string | number };

function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``;
}

async function main() {
  const databaseIndex = process.argv.indexOf('--target-database');
  const targetDatabase = databaseIndex >= 0 ? process.argv[databaseIndex + 1] : undefined;
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (targetDatabase) {
    if (!/^[A-Za-z0-9_]+_restore_test$/.test(targetDatabase)) throw new Error('Invalid restore database name');
    const derived = new URL(databaseUrl);
    derived.pathname = `/${targetDatabase}`;
    databaseUrl = derived.toString();
  }
  const database = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  if (!database.endsWith('_restore_test')) {
    throw new Error('Verification is restricted to a database ending in _restore_test');
  }

  const connection = await mysql.createConnection({ uri: databaseUrl });
  const issues: Array<{ check: string; count: number; detail?: string }> = [];
  try {
    const [foreignKeys] = await connection.query<ForeignKeyRow[]>(`
      SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME,
             REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
    `);

    for (const key of foreignKeys) {
      const childTable = quoteIdentifier(key.TABLE_NAME);
      const childColumn = quoteIdentifier(key.COLUMN_NAME);
      const parentTable = quoteIdentifier(key.REFERENCED_TABLE_NAME);
      const parentColumn = quoteIdentifier(key.REFERENCED_COLUMN_NAME);
      const [rows] = await connection.query<CountRow[]>(`
        SELECT COUNT(*) AS count
        FROM ${childTable} child
        LEFT JOIN ${parentTable} parent
          ON child.${childColumn} = parent.${parentColumn}
        WHERE child.${childColumn} IS NOT NULL
          AND parent.${parentColumn} IS NULL
      `);
      const count = Number(rows[0].count);
      if (count > 0) issues.push({ check: 'foreign-key-orphans', count, detail: key.CONSTRAINT_NAME });
    }

    const invariantQueries: Array<[string, string]> = [
      ['negative-stock', 'SELECT COUNT(*) AS count FROM `Stock` WHERE quantity < -0.000001'],
      ['invalid-fifo-layer', 'SELECT COUNT(*) AS count FROM `InventoryBatch` WHERE remainingQty < 0 OR remainingQty > originalQty'],
      ['invalid-active-product-unit', 'SELECT COUNT(*) AS count FROM `ProductUnit` WHERE active = 1 AND conversionFactor <= 0'],
      ['invalid-promotion-usage', 'SELECT COUNT(*) AS count FROM `Promotion` WHERE usageCount < 0 OR (usageLimit IS NOT NULL AND usageCount > usageLimit)'],
      ['invalid-purchase-payment', 'SELECT COUNT(*) AS count FROM `PurchaseOrder` WHERE paidAmount < 0 OR paidAmount > total + 0.01'],
      ['positive-stock-without-usable-cost', `
        SELECT COUNT(DISTINCT s.productId) AS count
        FROM Stock s
        JOIN Product p ON p.id = s.productId AND p.companyId = s.companyId
        WHERE s.quantity > 0.000001
          AND COALESCE(p.currentAverageCost, 0) <= 0
          AND COALESCE(p.cost, 0) <= 0
          AND NOT EXISTS (
            SELECT 1
            FROM InventoryBatch batch
            WHERE batch.productId = s.productId
              AND batch.companyId = s.companyId
              AND batch.remainingQty > 0.000001
              AND batch.unitCost > 0
          )
      `],
      ['active-menu-component-without-cost', `
        SELECT COUNT(DISTINCT r.productId) AS count
        FROM Recipe r
        JOIN MenuItem menu_item ON menu_item.id = r.menuItemId AND menu_item.active = 1
        JOIN Product p ON p.id = r.productId
        WHERE p.active = 1
          AND COALESCE(p.currentAverageCost, 0) <= 0
          AND COALESCE(p.cost, 0) <= 0
          AND NOT EXISTS (
            SELECT 1
            FROM ProductionRecipe produced
            WHERE produced.productId = p.id
              AND produced.companyId = p.companyId
              AND produced.status = 'ACTIVE'
          )
      `],
      ['active-production-component-without-cost', `
        SELECT COUNT(DISTINCT component.componentProductId) AS count
        FROM ProductionRecipeComponent component
        JOIN ProductionRecipe recipe ON recipe.id = component.recipeId AND recipe.status = 'ACTIVE'
        JOIN Product p ON p.id = component.componentProductId
        WHERE p.active = 1
          AND COALESCE(p.currentAverageCost, 0) <= 0
          AND COALESCE(p.cost, 0) <= 0
      `],
      ['negative-active-payment', "SELECT COUNT(*) AS count FROM `Payment` WHERE status = 'ACTIVE' AND amount < 0"],
      ['zero-active-payment', "SELECT COUNT(*) AS count FROM `Payment` WHERE status = 'ACTIVE' AND amount = 0"],
      ['negative-order-total', 'SELECT COUNT(*) AS count FROM `Order` WHERE total < 0'],
      ['order-financial-status-drift', `
        SELECT COUNT(*) AS count
        FROM \`Order\` o
        LEFT JOIN (
          SELECT orderId, SUM(amount) AS activePaid
          FROM Payment
          WHERE status = 'ACTIVE'
          GROUP BY orderId
        ) p ON p.orderId = o.id
        WHERE o.financialStatus <> CASE
          WHEN COALESCE(p.activePaid, 0) >= o.total AND COALESCE(p.activePaid, 0) > 0 THEN 'PAID'
          WHEN COALESCE(p.activePaid, 0) > 0 THEN 'PARTIAL'
          ELSE 'UNPAID'
        END
      `],
      ['paid-order-without-financial-close', "SELECT COUNT(*) AS count FROM `Order` WHERE financialStatus = 'PAID' AND closedAt IS NULL"],
      ['underpaid-order-with-financial-close', "SELECT COUNT(*) AS count FROM `Order` WHERE financialStatus <> 'PAID' AND closedAt IS NOT NULL"],
      ['delivered-order-without-delivery-time', "SELECT COUNT(*) AS count FROM `Order` WHERE status = 'DELIVERED' AND deliveredAt IS NULL"],
      ['paid-order-without-items', `
        SELECT COUNT(*) AS count
        FROM (
          SELECT o.id
          FROM \`Order\` o
          LEFT JOIN OrderItem oi ON oi.orderId = o.id
          WHERE o.financialStatus = 'PAID' AND o.status <> 'CANCELLED'
          GROUP BY o.id
          HAVING COUNT(oi.id) = 0
        ) invalid_orders
      `],
      ['stock-tenant-mismatch', `
        SELECT COUNT(*) AS count
        FROM Stock s
        JOIN Warehouse w ON w.id = s.warehouseId
        JOIN Product p ON p.id = s.productId
        WHERE s.companyId <> w.companyId OR s.companyId <> p.companyId
      `],
      ['order-tenant-mismatch', `
        SELECT COUNT(*) AS count
        FROM \`Order\` o
        JOIN Branch b ON b.id = o.branchId
        JOIN User u ON u.id = o.userId
        WHERE o.companyId <> b.companyId OR o.companyId <> u.companyId
      `],
      ['payment-method-tenant-mismatch', `
        SELECT COUNT(*) AS count
        FROM Payment p
        JOIN \`Order\` o ON o.id = p.orderId
        JOIN PaymentMethod pm ON pm.id = p.paymentMethodId
        WHERE pm.companyId IS NOT NULL AND pm.companyId <> o.companyId
      `],
    ];

    for (const [check, sql] of invariantQueries) {
      const [rows] = await connection.query<CountRow[]>(sql);
      const count = Number(rows[0].count);
      if (count > 0) issues.push({ check, count });
    }

    const [migrationRows] = await connection.query<RowDataPacket[]>(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN finished_at IS NULL AND rolled_back_at IS NULL THEN 1 ELSE 0 END) AS unresolved,
             SUM(CASE WHEN rolled_back_at IS NOT NULL THEN 1 ELSE 0 END) AS rolledBack
      FROM _prisma_migrations
    `);

    let invalidActivePaymentSamples: RowDataPacket[] = [];
    if (issues.some(issue => issue.check === 'negative-active-payment' || issue.check === 'zero-active-payment')) {
      const [samples] = await connection.query<RowDataPacket[]>(`
        SELECT p.id, p.orderId, CAST(p.amount AS CHAR) AS amount,
               p.createdAt, o.status AS orderStatus,
               CAST(o.total AS CHAR) AS orderTotal,
               pm.name AS paymentMethod
        FROM Payment p
        JOIN \`Order\` o ON o.id = p.orderId
        JOIN PaymentMethod pm ON pm.id = p.paymentMethodId
        WHERE p.status = 'ACTIVE' AND p.amount <= 0
        ORDER BY p.id
        LIMIT 25
      `);
      invalidActivePaymentSamples = samples;
    }

    let orderIntegritySamples: RowDataPacket[] = [];
    if (issues.some(issue => issue.check === 'negative-order-total' || issue.check === 'paid-order-without-items')) {
      const [samples] = await connection.query<RowDataPacket[]>(`
        SELECT o.id,
               CAST(COALESCE((
                 SELECT SUM(order_item.subtotal)
                 FROM OrderItem order_item
                 WHERE order_item.orderId = o.id
               ), 0) AS CHAR) AS itemSubtotal,
               CAST(o.discount AS CHAR) AS discount,
               CAST(o.tax AS CHAR) AS tax,
               CAST(o.tipAmount AS CHAR) AS tip,
               CAST(o.total AS CHAR) AS total,
               o.status AS orderStatus,
               o.financialStatus,
               (
                 SELECT COUNT(*)
                 FROM OrderItem order_item
                 WHERE order_item.orderId = o.id
               ) AS itemCount,
               CAST(COALESCE((
                 SELECT SUM(active_payment.amount)
                 FROM Payment active_payment
                 WHERE active_payment.orderId = o.id AND active_payment.status = 'ACTIVE'
               ), 0) AS CHAR) AS activePaid
        FROM \`Order\` o
        WHERE o.total < 0
           OR (
             o.financialStatus = 'PAID'
             AND o.status <> 'CANCELLED'
             AND NOT EXISTS (SELECT 1 FROM OrderItem order_item WHERE order_item.orderId = o.id)
           )
        ORDER BY o.id
        LIMIT 25
      `);
      orderIntegritySamples = samples;
    }

    let costIntegritySamples: RowDataPacket[] = [];
    if (issues.some(issue => [
      'positive-stock-without-usable-cost',
      'active-menu-component-without-cost',
      'active-production-component-without-cost',
    ].includes(issue.check))) {
      const [samples] = await connection.query<RowDataPacket[]>(`
        SELECT 'POSITIVE_STOCK' AS context,
               p.id AS productId,
               p.sku,
               p.name,
               p.active,
               CAST(p.currentAverageCost AS CHAR) AS currentAverageCost,
               CAST(p.cost AS CHAR) AS referenceCost,
               CAST((SELECT SUM(s.quantity) FROM Stock s WHERE s.productId = p.id AND s.companyId = p.companyId) AS CHAR) AS stockQuantity
        FROM Product p
        WHERE COALESCE(p.currentAverageCost, 0) <= 0
          AND COALESCE(p.cost, 0) <= 0
          AND EXISTS (SELECT 1 FROM Stock s WHERE s.productId = p.id AND s.companyId = p.companyId AND s.quantity > 0.000001)
          AND NOT EXISTS (
            SELECT 1 FROM InventoryBatch batch
            WHERE batch.productId = p.id AND batch.companyId = p.companyId
              AND batch.remainingQty > 0.000001 AND batch.unitCost > 0
          )
        UNION ALL
        SELECT 'MENU_RECIPE', p.id, p.sku, p.name, p.active,
               CAST(p.currentAverageCost AS CHAR), CAST(p.cost AS CHAR), NULL
        FROM Product p
        WHERE p.active = 1
          AND COALESCE(p.currentAverageCost, 0) <= 0
          AND COALESCE(p.cost, 0) <= 0
           AND EXISTS (
             SELECT 1 FROM Recipe r
             JOIN MenuItem menu_item ON menu_item.id = r.menuItemId AND menu_item.active = 1
             WHERE r.productId = p.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM ProductionRecipe produced
             WHERE produced.productId = p.id
               AND produced.companyId = p.companyId
               AND produced.status = 'ACTIVE'
           )
        UNION ALL
        SELECT 'PRODUCTION_RECIPE', p.id, p.sku, p.name, p.active,
               CAST(p.currentAverageCost AS CHAR), CAST(p.cost AS CHAR), NULL
        FROM Product p
        WHERE p.active = 1
          AND COALESCE(p.currentAverageCost, 0) <= 0
          AND COALESCE(p.cost, 0) <= 0
          AND EXISTS (
            SELECT 1 FROM ProductionRecipeComponent component
            JOIN ProductionRecipe recipe ON recipe.id = component.recipeId AND recipe.status = 'ACTIVE'
            WHERE component.componentProductId = p.id
          )
        ORDER BY productId, context
        LIMIT 50
      `);
      costIntegritySamples = samples;
    }

    const result = {
      database,
      foreignKeysChecked: foreignKeys.length,
      invariantsChecked: invariantQueries.length,
      migrations: {
        total: Number(migrationRows[0].total),
        unresolved: Number(migrationRows[0].unresolved),
        rolledBack: Number(migrationRows[0].rolledBack),
      },
      issues,
      invalidActivePaymentSamples,
      orderIntegritySamples,
      costIntegritySamples,
    };
    console.log(JSON.stringify(result));
    if (issues.length > 0) process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
