import crypto from 'crypto';
import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import {
  classifyTransactionPurgeTable,
  normalizeTableName,
  PurgeScope,
  TableClassification,
  TRANSACTION_PURGE_POLICY_VERSION,
} from './transaction-purge-policy';

type Scope = PurgeScope;
type Classification = TableClassification;
const POLICY_VERSION = TRANSACTION_PURGE_POLICY_VERSION;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``;
}

function normalized(value: string): string {
  return normalizeTableName(value);
}

function classificationFor(table: string): Classification | undefined {
  return classifyTransactionPurgeTable(table);
}

async function exactCounts(connection: Connection, tables: string[]): Promise<Record<string, number>> {
  if (tables.length === 0) return {};
  const sql = tables
    .map(table => `SELECT ${connection.escape(table)} AS tableName, COUNT(*) AS rowCount FROM ${quoteIdentifier(table)}`)
    .join(' UNION ALL ');
  const [rows] = await connection.query<RowDataPacket[]>(sql);
  return Object.fromEntries(rows.map(row => [String(row.tableName), Number(row.rowCount)]));
}

type BackupMetadata = {
  createdAt: string;
  counts: Record<string, number>;
  triggers: number;
};

async function readBackupMetadata(file: string): Promise<BackupMetadata> {
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let createdAt = '';
  let counts: Record<string, number> | undefined;
  let triggers = -1;
  for await (const line of lines) {
    if (!line) continue;
    const entry = JSON.parse(line) as {
      type: string;
      createdAt?: string;
      counts?: Record<string, number>;
      schemaObjects?: { triggers?: number };
    };
    if (entry.type === 'header') createdAt = String(entry.createdAt ?? '');
    if (entry.type === 'footer') {
      counts = entry.counts;
      triggers = Number(entry.schemaObjects?.triggers ?? -1);
    }
  }
  if (!createdAt || !counts || triggers < 0) throw new Error('Backup metadata is incomplete');
  return { createdAt, counts, triggers };
}

function stateToken(
  database: string,
  scope: Scope,
  counts: Record<string, number>,
  companies: unknown[],
  targets: string[],
): string {
  const stableCounts = Object.entries(counts)
    .map(([table, count]) => [normalized(table), count] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      policyVersion: POLICY_VERSION,
      database,
      scope,
      counts: stableCounts,
      companies,
      targets: targets.map(normalized).sort(),
    }))
    .digest('hex')
    .slice(0, 20)
    .toUpperCase();
  return `PURGE-${hash}`;
}

function deletionOrder(
  targets: string[],
  foreignKeys: Array<{ child: string; parent: string }>,
): { order: string[]; cycles: string[][] } {
  const targetByKey = new Map(targets.map(table => [normalized(table), table]));
  const children = new Map<string, Set<string>>();
  for (const table of targets) children.set(normalized(table), new Set());
  for (const foreignKey of foreignKeys) {
    const child = normalized(foreignKey.child);
    const parent = normalized(foreignKey.parent);
    if (child === parent || !targetByKey.has(child) || !targetByKey.has(parent)) continue;
    children.get(parent)?.add(child);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: string[] = [];
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (table: string) => {
    if (visited.has(table)) return;
    if (visiting.has(table)) {
      const start = stack.indexOf(table);
      cycles.push([...stack.slice(start), table].map(key => targetByKey.get(key) ?? key));
      return;
    }
    visiting.add(table);
    stack.push(table);
    for (const child of children.get(table) ?? []) visit(child);
    stack.pop();
    visiting.delete(table);
    visited.add(table);
    order.push(targetByKey.get(table) ?? table);
  };
  for (const table of targets.map(normalized).sort()) visit(table);
  return { order, cycles };
}

async function columnExists(connection: Connection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(`
    SELECT COUNT(*) AS matches
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) AND LOWER(COLUMN_NAME) = LOWER(?)
  `, [table, column]);
  return Number(rows[0].matches) === 1;
}

async function applyMasterResets(connection: Connection, actualByKey: Map<string, string>): Promise<string[]> {
  const applied: string[] = [];
  const update = async (tableKey: string, assignment: string, label: string) => {
    const table = actualByKey.get(tableKey);
    if (!table) return;
    await connection.query(`UPDATE ${quoteIdentifier(table)} SET ${assignment}`);
    applied.push(label);
  };

  const tableName = actualByKey.get('table');
  if (tableName) {
    const assignments = [`status = 'AVAILABLE'`];
    if (await columnExists(connection, tableName, 'activeTableGroupId')) assignments.push('activeTableGroupId = NULL');
    await update('table', assignments.join(', '), 'Table: AVAILABLE and no active group');
  }
  await update('cashregister', `status = 'CLOSED'`, 'CashRegister: CLOSED');
  await update('promotion', 'usageCount = 0', 'Promotion: usageCount=0');
  await update('stock', 'quantity = 0', 'Stock: quantity=0');

  const productName = actualByKey.get('product');
  if (productName) {
    const resets: string[] = [];
    for (const column of ['currentAverageCost', 'lastPurchaseCost']) {
      if (await columnExists(connection, productName, column)) resets.push(`${quoteIdentifier(column)} = 0`);
    }
    for (const column of ['averageCostKnown', 'lastPurchaseCostKnown']) {
      if (await columnExists(connection, productName, column)) resets.push(`${quoteIdentifier(column)} = FALSE`);
    }
    if (resets.length > 0) await update('product', resets.join(', '), 'Product: derived inventory costs reset');
  }

  for (const tableKey of ['saleschannelconfig', 'pedidosyaconfig']) {
    const table = actualByKey.get(tableKey);
    if (table && await columnExists(connection, table, 'lastSyncAt')) {
      await update(tableKey, 'lastSyncAt = NULL', `${table}: lastSyncAt=NULL`);
    }
  }
  return applied;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const execute = hasArg('--execute');
  const scope = (arg('--scope') ?? 'master-only') as Scope;
  if (!['restaurant-operations', 'master-only'].includes(scope)) {
    throw new Error('--scope must be restaurant-operations or master-only');
  }

  const parsedUrl = new URL(url);
  const database = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)
    && database.endsWith('_restore_test');
  const connection = await mysql.createConnection({
    uri: url,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  try {
    const [tableRows] = await connection.query<RowDataPacket[]>(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    const tables = tableRows.map(row => String(row.TABLE_NAME));
    const actualByKey = new Map(tables.map(table => [normalized(table), table]));
    const unknown = tables.filter(table => !classificationFor(table));
    if (unknown.length > 0) {
      throw new Error(`Unclassified tables; purge fails closed: ${unknown.join(', ')}`);
    }

    const counts = await exactCounts(connection, tables);
    const [companies] = await connection.query<RowDataPacket[]>(`
      SELECT id, name, active
      FROM Company
      ORDER BY id
    `);
    const [foreignKeyRows] = await connection.query<RowDataPacket[]>(`
      SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent, COLUMN_NAME AS childColumn
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
    `);
    const foreignKeys = foreignKeyRows.map(row => ({
      child: String(row.child),
      parent: String(row.parent),
      childColumn: String(row.childColumn),
    }));
    const targetClasses = scope === 'master-only'
      ? new Set<Classification>(['RESTAURANT_TRANSACTION', 'HR_TRANSACTION'])
      : new Set<Classification>(['RESTAURANT_TRANSACTION']);
    const targets = tables.filter(table => targetClasses.has(classificationFor(table)!));
    const preserve = tables.filter(table => !targets.includes(table));
    const { order, cycles } = deletionOrder(targets, foreignKeys);

    const masterToTargetForeignKeys = foreignKeys.filter(foreignKey =>
      preserve.some(table => normalized(table) === normalized(foreignKey.child))
      && targets.some(table => normalized(table) === normalized(foreignKey.parent)),
    );
    const allowedMasterToTarget = masterToTargetForeignKeys.filter(foreignKey =>
      normalized(foreignKey.child) === 'table'
      && normalized(foreignKey.parent) === 'tablegroup'
      && normalized(foreignKey.childColumn) === 'activetablegroupid',
    );
    const unexpectedMasterToTarget = masterToTargetForeignKeys.filter(foreignKey =>
      !allowedMasterToTarget.includes(foreignKey),
    );

    const [triggerRows] = await connection.query<RowDataPacket[]>(`
      SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
      FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
      ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME
    `);
    const deleteBlockers = triggerRows
      .filter(row =>
        String(row.EVENT_MANIPULATION).toUpperCase() === 'DELETE'
        && targets.some(table => normalized(table) === normalized(String(row.EVENT_OBJECT_TABLE)))
        && (counts[String(row.EVENT_OBJECT_TABLE)]
          ?? counts[actualByKey.get(normalized(String(row.EVENT_OBJECT_TABLE))) ?? '']
          ?? 0) > 0,
      )
      .map(row => ({
        trigger: String(row.TRIGGER_NAME),
        table: String(row.EVENT_OBJECT_TABLE),
        rows: counts[actualByKey.get(normalized(String(row.EVENT_OBJECT_TABLE))) ?? ''] ?? 0,
      }));

    const [fileRows] = actualByKey.has('purchaseorder')
      ? await connection.query<RowDataPacket[]>(`
          SELECT COUNT(*) AS records, SUM(invoicePdf IS NOT NULL AND invoicePdf <> '') AS files
          FROM PurchaseOrder
        `)
      : [[{ records: 0, files: 0 }] as unknown as RowDataPacket[], []];
    const token = stateToken(database, scope, counts, companies, targets);
    const report = {
      mode: execute ? 'execute' : 'plan',
      target: {
        host: parsedUrl.hostname,
        database,
        localRestore: local,
        companies,
      },
      scope,
      policyVersion: POLICY_VERSION,
      token,
      totals: {
        tables: tables.length,
        rows: Object.values(counts).reduce((sum, count) => sum + count, 0),
        targetTables: targets.length,
        targetRows: targets.reduce((sum, table) => sum + (counts[table] ?? 0), 0),
        preservedTables: preserve.length,
        preservedRows: preserve.reduce((sum, table) => sum + (counts[table] ?? 0), 0),
      },
      classifications: Object.fromEntries(
        tables.map(table => [table, { classification: classificationFor(table), rows: counts[table] ?? 0 }]),
      ),
      deletionOrder: order,
      blockers: {
        unknownTables: unknown,
        dependencyCycles: cycles,
        unexpectedMasterToTargetForeignKeys: unexpectedMasterToTarget,
        immutableDeleteTriggers: deleteBlockers,
      },
      plannedMasterResets: [
        'Table.status=AVAILABLE and activeTableGroupId=NULL',
        'CashRegister.status=CLOSED',
        'Promotion.usageCount=0',
        'Stock.quantity=0 while preserving warehouse-product associations',
        'Product.currentAverageCost/lastPurchaseCost=0 and known flags=false',
        'Sales channel lastSyncAt=NULL when present',
      ],
      retainedSafetyState: ['InvoiceSequence', 'CreditNoteSequence', '_prisma_migrations'],
      transactionalFileReferences: {
        purchaseOrders: Number(fileRows[0]?.records ?? 0),
        invoicePdfs: Number(fileRows[0]?.files ?? 0),
        physicalFilesAreNotDeletedByThisDatabaseTransaction: true,
      },
    };

    if (!execute) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (cycles.length > 0) throw new Error(`Target dependency cycles require explicit handling: ${JSON.stringify(cycles)}`);
    if (unexpectedMasterToTarget.length > 0) {
      throw new Error(`Preserved tables depend on purge targets: ${JSON.stringify(unexpectedMasterToTarget)}`);
    }
    if (deleteBlockers.length > 0) {
      throw new Error(`Immutable/legal delete triggers block this scope: ${JSON.stringify(deleteBlockers)}`);
    }

    if (!local) {
      if (process.env.ALLOW_PRODUCTION_TRANSACTION_PURGE !== 'YES') {
        throw new Error('Production execution requires ALLOW_PRODUCTION_TRANSACTION_PURGE=YES');
      }
      if (arg('--expected-database') !== database) throw new Error('Production database name does not match --expected-database');
      const expectedCompanyIds = (arg('--expected-company-ids') ?? '').split(',').filter(Boolean).map(Number);
      const actualCompanyIds = companies.map(row => Number(row.id));
      if (JSON.stringify(expectedCompanyIds) !== JSON.stringify(actualCompanyIds)) {
        throw new Error('Production company IDs do not match --expected-company-ids');
      }
      if (arg('--confirm-token') !== token) throw new Error(`Production state token mismatch; current token is ${token}`);
      const backupFile = arg('--backup-file');
      const expectedBackupHash = arg('--backup-sha256')?.toUpperCase();
      if (!backupFile || !expectedBackupHash) throw new Error('Production execution requires --backup-file and --backup-sha256');
      const backupHash = crypto.createHash('sha256').update(await fs.promises.readFile(backupFile)).digest('hex').toUpperCase();
      if (backupHash !== expectedBackupHash) throw new Error('Backup SHA-256 does not match');
      const backup = await readBackupMetadata(backupFile);
      const backupAgeMs = Date.now() - new Date(backup.createdAt).getTime();
      if (!Number.isFinite(backupAgeMs) || backupAgeMs < -300_000 || backupAgeMs > 86_400_000) {
        throw new Error('Production backup must be between 0 and 24 hours old');
      }
      const sourceCounts = Object.fromEntries(Object.entries(counts).map(([table, count]) => [normalized(table), count]));
      const backupCounts = Object.fromEntries(Object.entries(backup.counts).map(([table, count]) => [normalized(table), count]));
      if (JSON.stringify(Object.entries(sourceCounts).sort()) !== JSON.stringify(Object.entries(backupCounts).sort())) {
        throw new Error('Production changed after backup; take a new backup while writers are quiesced');
      }
      if (backup.triggers !== triggerRows.length) throw new Error('Backup trigger count does not match current production');
    }

    const preservedCountsBefore = Object.fromEntries(preserve.map(table => [table, counts[table] ?? 0]));
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await connection.beginTransaction();
    try {
      const masterResets = await applyMasterResets(connection, actualByKey);
      const selfForeignKeys = foreignKeys.filter(foreignKey =>
        normalized(foreignKey.child) === normalized(foreignKey.parent)
        && targets.some(table => normalized(table) === normalized(foreignKey.child)),
      );
      for (const foreignKey of selfForeignKeys) {
        const table = actualByKey.get(normalized(foreignKey.child))!;
        const [columnRows] = await connection.query<RowDataPacket[]>(`
          SELECT IS_NULLABLE
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) AND LOWER(COLUMN_NAME) = LOWER(?)
        `, [table, foreignKey.childColumn]);
        if (String(columnRows[0]?.IS_NULLABLE).toUpperCase() === 'YES') {
          await connection.query(
            `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(foreignKey.childColumn)} = NULL `
            + `WHERE ${quoteIdentifier(foreignKey.childColumn)} IS NOT NULL`,
          );
        }
      }
      for (const table of order) await connection.query(`DELETE FROM ${quoteIdentifier(table)}`);

      const afterTargetCounts = await exactCounts(connection, targets);
      const nonEmpty = Object.entries(afterTargetCounts).filter(([, count]) => count !== 0);
      if (nonEmpty.length > 0) throw new Error(`Transactional tables remain non-empty: ${JSON.stringify(nonEmpty)}`);
      const preservedCountsAfter = await exactCounts(connection, preserve);
      if (JSON.stringify(preservedCountsBefore) !== JSON.stringify(preservedCountsAfter)) {
        throw new Error('Preserved table row counts changed during purge');
      }
      await connection.commit();
      console.log(JSON.stringify({
        ...report,
        result: {
          committed: true,
          deletedRows: report.totals.targetRows,
          masterResets,
          targetCountsAfter: afterTargetCounts,
          preservedCountsAfter,
        },
      }, null, 2));
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
