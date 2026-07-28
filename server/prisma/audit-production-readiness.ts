import path from 'node:path';
import mysql, { RowDataPacket } from 'mysql2/promise';
import {
    compareMigrationLedger,
    loadExpectedMigrations,
    type MigrationLedgerRow,
} from '../src/utils/migration-ledger';

type CountRow = RowDataPacket & { count: number | string };

async function count(connection: mysql.Connection, sql: string): Promise<number> {
    const [rows] = await connection.query<CountRow[]>(sql);
    return Number(rows[0]?.count ?? 0);
}

async function main() {
    if (!['true', '1'].includes(process.env.ALLOW_PRODUCTION_READONLY_AUDIT || '')) {
        throw new Error('Set ALLOW_PRODUCTION_READONLY_AUDIT=true for the read-only production audit');
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');

    const connection = await mysql.createConnection({ uri: databaseUrl });
    try {
        await connection.query('START TRANSACTION READ ONLY');
        const [migrationRows] = await connection.query<Array<RowDataPacket & MigrationLedgerRow>>(`
            SELECT migration_name, checksum, finished_at, rolled_back_at,
                   finished_at IS NOT NULL AND rolled_back_at IS NULL AS succeeded
            FROM _prisma_migrations
            ORDER BY started_at
        `);
        const migrationLedger = compareMigrationLedger(
            loadExpectedMigrations(path.resolve(__dirname, 'migrations')),
            migrationRows,
        );
        const [columns] = await connection.query<RowDataPacket[]>(`
            SELECT TABLE_NAME, COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND (
                (TABLE_NAME = 'Order' AND COLUMN_NAME = 'invoiceSnapshot')
                OR (TABLE_NAME = 'InventoryMovement' AND COLUMN_NAME = 'consumedLayers')
              )
            ORDER BY TABLE_NAME, COLUMN_NAME
        `);
        const [zeroCostMenu] = await connection.query<RowDataPacket[]>(`
            SELECT DISTINCT p.id
            FROM Recipe r
            JOIN MenuItem mi ON mi.id = r.menuItemId AND mi.active = 1
            JOIN Product p ON p.id = r.productId AND p.active = 1
            WHERE COALESCE(p.currentAverageCost, 0) <= 0 AND COALESCE(p.cost, 0) <= 0
              AND NOT EXISTS (
                SELECT 1
                FROM ProductionRecipe produced
                WHERE produced.productId = p.id
                  AND produced.companyId = p.companyId
                  AND produced.status = 'ACTIVE'
              )
            ORDER BY p.id
        `);
        const [zeroCostProduction] = await connection.query<RowDataPacket[]>(`
            SELECT DISTINCT p.id
            FROM ProductionRecipeComponent component
            JOIN ProductionRecipe recipe ON recipe.id = component.recipeId AND recipe.status = 'ACTIVE'
            JOIN Product p ON p.id = component.componentProductId AND p.active = 1
            WHERE COALESCE(p.currentAverageCost, 0) <= 0 AND COALESCE(p.cost, 0) <= 0
            ORDER BY p.id
        `);
        const [positiveStockZeroCost] = await connection.query<RowDataPacket[]>(`
            SELECT DISTINCT p.id
            FROM Stock s
            JOIN Product p ON p.id = s.productId
            WHERE s.quantity > 0.000001
              AND COALESCE(p.currentAverageCost, 0) <= 0
              AND COALESCE(p.cost, 0) <= 0
              AND NOT EXISTS (
                SELECT 1 FROM InventoryBatch batch
                WHERE batch.productId = p.id
                  AND batch.companyId = p.companyId
                  AND batch.remainingQty > 0.000001
                  AND batch.unitCost > 0
              )
            ORDER BY p.id
        `);
        const [permissionRows] = await connection.query<RowDataPacket[]>(`
            SELECT name FROM Permission
            WHERE name LIKE 'hr.%' OR name LIKE 'orders.%' OR name LIKE 'invoices.%' OR name LIKE 'payments.%'
            ORDER BY name
        `);
        const unpaidTableAccountOnAvailableTable = await count(connection, `
            SELECT COUNT(*) AS count
            FROM \`Order\` o
            JOIN \`Table\` t
              ON t.id = o.tableId
             AND t.companyId = o.companyId
            WHERE t.status = 'AVAILABLE'
              AND o.status IN ('OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED')
              AND o.financialStatus IN ('UNPAID', 'PARTIAL')
        `);
        const [unpaidTableAccountSamples] = await connection.query<RowDataPacket[]>(`
            SELECT
                o.id AS orderId,
                o.branchId,
                o.tableId,
                o.status AS orderStatus,
                o.financialStatus,
                o.invoiceFiscalStatus,
                t.activeTableGroupId
            FROM \`Order\` o
            JOIN \`Table\` t
              ON t.id = o.tableId
             AND t.companyId = o.companyId
            WHERE t.status = 'AVAILABLE'
              AND o.status IN ('OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED')
              AND o.financialStatus IN ('UNPAID', 'PARTIAL')
            ORDER BY o.id
            LIMIT 50
        `);

        const successfulMigrations = migrationRows.filter((row) => row.succeeded);
        const result = {
            migrations: {
                historyRows: migrationRows.length,
                expected: migrationLedger.expected,
                successful: successfulMigrations.length,
                rolledBack: migrationRows.filter((row) => row.rolled_back_at !== null).length,
                unresolved: migrationRows.filter((row) => row.finished_at === null && row.rolled_back_at === null).length,
                latestSuccessful: successfulMigrations.slice(-5).map((row) => row.migration_name),
                issues: migrationLedger.issues,
            },
            deployedColumns: columns.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`),
            invariants: {
                negativeStock: await count(connection, 'SELECT COUNT(*) AS count FROM Stock WHERE quantity < -0.000001'),
                negativeOrderTotal: await count(connection, 'SELECT COUNT(*) AS count FROM `Order` WHERE total < 0'),
                paidOrderWithoutItems: await count(connection, `
                    SELECT COUNT(*) AS count FROM (
                        SELECT o.id FROM \`Order\` o
                        LEFT JOIN OrderItem oi ON oi.orderId = o.id
                        WHERE o.financialStatus = 'PAID' AND o.status <> 'CANCELLED'
                        GROUP BY o.id HAVING COUNT(oi.id) = 0
                    ) invalid
                `),
                nonPositiveActivePayment: await count(connection, "SELECT COUNT(*) AS count FROM Payment WHERE status = 'ACTIVE' AND amount <= 0"),
                financialStatusDrift: await count(connection, `
                    SELECT COUNT(*) AS count
                    FROM \`Order\` o
                    LEFT JOIN (
                        SELECT orderId, SUM(amount) activePaid FROM Payment
                        WHERE status = 'ACTIVE' GROUP BY orderId
                    ) p ON p.orderId = o.id
                    WHERE o.financialStatus <> CASE
                        WHEN COALESCE(p.activePaid, 0) >= o.total AND COALESCE(p.activePaid, 0) > 0 THEN 'PAID'
                        WHEN COALESCE(p.activePaid, 0) > 0 THEN 'PARTIAL'
                        ELSE 'UNPAID'
                    END
                `),
                unpaidTableAccountOnAvailableTable,
                unpaidTableAccountOnAvailableTableSamples: unpaidTableAccountSamples.map((row) => ({
                    orderId: Number(row.orderId),
                    branchId: Number(row.branchId),
                    tableId: Number(row.tableId),
                    orderStatus: row.orderStatus,
                    financialStatus: row.financialStatus,
                    invoiceFiscalStatus: row.invoiceFiscalStatus,
                    activeTableGroupId: row.activeTableGroupId === null
                        ? null
                        : Number(row.activeTableGroupId),
                })),
                zeroCostMenuProductIds: zeroCostMenu.map((row) => Number(row.id)),
                zeroCostProductionProductIds: zeroCostProduction.map((row) => Number(row.id)),
                positiveStockZeroCostProductIds: positiveStockZeroCost.map((row) => Number(row.id)),
            },
            installedPermissionNames: permissionRows.map((row) => row.name),
            rhCounts: {
                employees: await count(connection, 'SELECT COUNT(*) AS count FROM Employee'),
                payrollRuns: await count(connection, 'SELECT COUNT(*) AS count FROM PayrollRun'),
                biometricProfiles: await count(connection, 'SELECT COUNT(*) AS count FROM BiometricProfile'),
            },
        };
        console.log(JSON.stringify(result));
        if (migrationLedger.issues.length > 0 || unpaidTableAccountOnAvailableTable > 0) {
            process.exitCode = 1;
        }
        await connection.rollback();
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
