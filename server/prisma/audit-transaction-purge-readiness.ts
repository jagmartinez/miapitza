import mysql, { RowDataPacket } from 'mysql2/promise';

const MASTER_TABLES = [
    'Company',
    'Branch',
    'User',
    'Role',
    'Permission',
    'Table',
    'FloorArea',
    'TableFloorPlan',
    'CashRegister',
    'PaymentMethod',
    'Category',
    'Product',
    'ProductUnit',
    'MenuItem',
    'Recipe',
    'ProductionRecipe',
    'Warehouse',
    'Supplier',
    'Stock',
    'Setting',
] as const;

const TRANSACTION_TABLES = [
    'FiscalCreditNotePaymentRefund',
    'FiscalCreditNoteLine',
    'FiscalCreditNote',
    'FiscalInvoiceCancellation',
    'CateringFiscalCreditNote',
    'CateringFiscalInvoice',
    'TableConsolidationItem',
    'TableConsolidationOrder',
    'TableConsolidation',
    'LegacyTableConsolidationReview',
    'KitchenNotification',
    'PedidosYaOrderSync',
    'PedidosYaWebhookLog',
    'Payment',
    'OrderItemModifier',
    'OrderItem',
    'Order',
    'Reservation',
    'TableGroup',
    'CateringPayment',
    'CateringServiceItem',
    'CateringMenuItem',
    'CateringEvent',
    'BankDepositShift',
    'CashCount',
    'CashMovement',
    'BankDeposit',
    'CashShift',
    'PurchaseOrderPayment',
    'PurchaseOrderItem',
    'PurchaseOrder',
    'ProductionOrderItem',
    'ProductionOrder',
    'ProductCostHistory',
    'InventoryBatch',
    'InventoryMovement',
    'AuditLog',
    'IdempotencyRecord',
    'FileCleanupTask',
    'UserSession',
] as const;

type CountRow = RowDataPacket & { count: string };
type TableRow = RowDataPacket & { TABLE_NAME: string };
type ColumnRow = RowDataPacket & { TABLE_NAME: string; COLUMN_NAME: string };

function quoteIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
}

async function main() {
    if (process.env.ALLOW_PRODUCTION_READONLY_AUDIT !== 'true') {
        throw new Error('Set ALLOW_PRODUCTION_READONLY_AUDIT=true for this read-only audit');
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');

    const connection = await mysql.createConnection({ uri: databaseUrl });
    try {
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

        const [metadata] = await connection.query<RowDataPacket[]>(`
            SELECT DATABASE() AS databaseName,
                   @@version AS databaseVersion,
                   @@read_only AS readOnlyServer
        `);
        const [tableRows] = await connection.query<TableRow[]>(`
            SELECT TABLE_NAME
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME
        `);
        const [columnRows] = await connection.query<ColumnRow[]>(`
            SELECT TABLE_NAME, COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
        `);
        const [triggers] = await connection.query<RowDataPacket[]>(`
            SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING
            FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE()
            ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME
        `);
        const [views] = await connection.query<RowDataPacket[]>(`
            SELECT TABLE_NAME
            FROM information_schema.VIEWS
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME
        `);
        const [routines] = await connection.query<RowDataPacket[]>(`
            SELECT ROUTINE_NAME, ROUTINE_TYPE
            FROM information_schema.ROUTINES
            WHERE ROUTINE_SCHEMA = DATABASE()
            ORDER BY ROUTINE_TYPE, ROUTINE_NAME
        `);
        const [events] = await connection.query<RowDataPacket[]>(`
            SELECT EVENT_NAME, STATUS
            FROM information_schema.EVENTS
            WHERE EVENT_SCHEMA = DATABASE()
            ORDER BY EVENT_NAME
        `);
        const tables = new Set(tableRows.map(row => row.TABLE_NAME));
        const columns = new Map<string, Set<string>>();
        for (const row of columnRows) {
            const tableColumns = columns.get(row.TABLE_NAME) ?? new Set<string>();
            tableColumns.add(row.COLUMN_NAME);
            columns.set(row.TABLE_NAME, tableColumns);
        }

        const counts: Record<string, {
            total: number;
            byCompany?: Array<Record<string, unknown>>;
            byStatus?: Array<Record<string, unknown>>;
        } | 'ABSENT'> = {};
        for (const table of [...MASTER_TABLES, ...TRANSACTION_TABLES]) {
            if (!tables.has(table)) {
                counts[table] = 'ABSENT';
                continue;
            }
            const quoted = quoteIdentifier(table);
            const [countRows] = await connection.query<CountRow[]>(
                `SELECT CAST(COUNT(*) AS CHAR) AS count FROM ${quoted}`,
            );
            const entry: {
                total: number;
                byCompany?: Array<Record<string, unknown>>;
                byStatus?: Array<Record<string, unknown>>;
            } = { total: Number(countRows[0].count) };
            const tableColumns = columns.get(table) ?? new Set<string>();
            if (tableColumns.has('companyId')) {
                const [byCompany] = await connection.query<RowDataPacket[]>(`
                    SELECT companyId, CAST(COUNT(*) AS CHAR) AS count
                    FROM ${quoted}
                    GROUP BY companyId
                    ORDER BY companyId
                `);
                entry.byCompany = byCompany.map(row => ({
                    companyId: Number(row.companyId),
                    count: Number(row.count),
                }));
            }
            if (tableColumns.has('status')) {
                const [byStatus] = await connection.query<RowDataPacket[]>(`
                    SELECT status, CAST(COUNT(*) AS CHAR) AS count
                    FROM ${quoted}
                    GROUP BY status
                    ORDER BY status
                `);
                entry.byStatus = byStatus.map(row => ({
                    status: row.status,
                    count: Number(row.count),
                }));
            }
            counts[table] = entry;
        }

        const companies = tables.has('Company')
            ? await connection.query<RowDataPacket[]>(
                'SELECT id, name, active FROM `Company` ORDER BY id',
            ).then(([rows]) => rows.map(row => ({
                id: Number(row.id),
                name: row.name,
                active: Boolean(row.active),
            })))
            : [];

        const operationalStates: Record<string, unknown> = {};
        if (tables.has('Order')) {
            const hasFinancialStatus = columns.get('Order')?.has('financialStatus');
            const [rows] = await connection.query<RowDataPacket[]>(`
                SELECT status,
                       ${hasFinancialStatus ? 'financialStatus' : "'LEGACY' AS financialStatus"},
                       invoiceNumber IS NOT NULL AS invoiced,
                       CAST(COUNT(*) AS CHAR) AS count
                FROM \`Order\`
                GROUP BY status, ${hasFinancialStatus ? 'financialStatus,' : ''} invoiceNumber IS NOT NULL
                ORDER BY status, financialStatus, invoiced
            `);
            operationalStates.orders = rows.map(row => ({
                status: row.status,
                financialStatus: row.financialStatus,
                invoiced: Boolean(row.invoiced),
                count: Number(row.count),
            }));
        }
        if (tables.has('CashShift')) {
            const [rows] = await connection.query<RowDataPacket[]>(`
                SELECT endDate IS NULL AS isOpen, CAST(COUNT(*) AS CHAR) AS count
                FROM CashShift
                GROUP BY endDate IS NULL
                ORDER BY isOpen
            `);
            operationalStates.cashShifts = rows.map(row => ({
                isOpen: Boolean(row.isOpen),
                count: Number(row.count),
            }));
        }
        if (tables.has('Table')) {
            const [rows] = await connection.query<RowDataPacket[]>(`
                SELECT status, CAST(COUNT(*) AS CHAR) AS count
                FROM \`Table\`
                GROUP BY status
                ORDER BY status
            `);
            operationalStates.tables = rows.map(row => ({
                status: row.status,
                count: Number(row.count),
            }));
        }
        if (tables.has('CashRegister')) {
            const [rows] = await connection.query<RowDataPacket[]>(`
                SELECT status, CAST(COUNT(*) AS CHAR) AS count
                FROM CashRegister
                GROUP BY status
                ORDER BY status
            `);
            operationalStates.cashRegisters = rows.map(row => ({
                status: row.status,
                count: Number(row.count),
            }));
        }

        const migrationLedger = tables.has('_prisma_migrations')
            ? await connection.query<RowDataPacket[]>(`
                SELECT
                    CAST(COUNT(*) AS CHAR) AS historyRows,
                    CAST(SUM(finished_at IS NOT NULL AND rolled_back_at IS NULL) AS CHAR) AS successful,
                    CAST(SUM(finished_at IS NULL AND rolled_back_at IS NULL) AS CHAR) AS unresolved,
                    CAST(SUM(rolled_back_at IS NOT NULL) AS CHAR) AS rolledBack
                FROM _prisma_migrations
            `).then(([rows]) => ({
                historyRows: Number(rows[0].historyRows),
                successful: Number(rows[0].successful),
                unresolved: Number(rows[0].unresolved),
                rolledBack: Number(rows[0].rolledBack),
            }))
            : null;

        console.log(JSON.stringify({
            generatedAt: new Date().toISOString(),
            metadata: {
                databaseName: metadata[0].databaseName,
                databaseVersion: metadata[0].databaseVersion,
                readOnlyServer: Boolean(metadata[0].readOnlyServer),
                tableCount: tableRows.length,
                triggers,
                views,
                routines,
                events,
            },
            companies,
            migrationLedger,
            counts,
            operationalStates,
        }));
        await connection.rollback();
    } finally {
        await connection.end();
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
