import crypto from 'crypto';
import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import {
  classifyTransactionPurgeTable,
  isPurgeTarget,
  sanitizePreservedRow,
  TRANSACTION_PURGE_POLICY_VERSION,
} from './transaction-purge-policy';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``;
}

function stableValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function contentHash(rows: RowDataPacket[], transform?: (row: Record<string, unknown>) => Record<string, unknown>): string {
  const canonical = rows
    .map(row => stableValue(transform ? transform(row) : row))
    .map(row => JSON.stringify(row))
    .sort();
  return crypto.createHash('sha256').update(canonical.join('\n')).digest('hex');
}

async function tables(connection: Connection): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(`
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);
  return rows.map(row => String(row.TABLE_NAME));
}

async function triggers(connection: Connection): Promise<Record<string, string>> {
  const [rows] = await connection.query<RowDataPacket[]>(`
    SELECT TRIGGER_NAME
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()
    ORDER BY TRIGGER_NAME
  `);
  const definitions: Record<string, string> = {};
  for (const row of rows) {
    const name = String(row.TRIGGER_NAME);
    const [createRows] = await connection.query<RowDataPacket[]>(`SHOW CREATE TRIGGER ${quoteIdentifier(name)}`);
    const sql = String(createRows[0]['SQL Original Statement'] || createRows[0]['Create Trigger'])
      .replace(/^CREATE\s+DEFINER\s*=\s*.+?\s+TRIGGER\b/is, 'CREATE TRIGGER')
      .replace(/\s+/g, ' ')
      .trim();
    definitions[name] = crypto.createHash('sha256').update(sql).digest('hex');
  }
  return definitions;
}

async function foreignKeyOrphans(connection: Connection) {
  const [rows] = await connection.query<RowDataPacket[]>(`
    SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME,
           REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, ORDINAL_POSITION
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
  `);
  const grouped = new Map<string, {
    table: string;
    constraint: string;
    parent: string;
    columns: Array<{ child: string; parent: string }>;
  }>();
  for (const row of rows) {
    const key = `${row.TABLE_NAME}\0${row.CONSTRAINT_NAME}`;
    const group = grouped.get(key) ?? {
      table: String(row.TABLE_NAME),
      constraint: String(row.CONSTRAINT_NAME),
      parent: String(row.REFERENCED_TABLE_NAME),
      columns: [],
    };
    group.columns.push({ child: String(row.COLUMN_NAME), parent: String(row.REFERENCED_COLUMN_NAME) });
    grouped.set(key, group);
  }

  const issues: Array<{ table: string; constraint: string; orphans: number }> = [];
  for (const foreignKey of grouped.values()) {
    const join = foreignKey.columns
      .map(column => `child.${quoteIdentifier(column.child)} = parent.${quoteIdentifier(column.parent)}`)
      .join(' AND ');
    const populated = foreignKey.columns
      .map(column => `child.${quoteIdentifier(column.child)} IS NOT NULL`)
      .join(' AND ');
    const missing = foreignKey.columns
      .map(column => `parent.${quoteIdentifier(column.parent)} IS NULL`)
      .join(' AND ');
    const [countRows] = await connection.query<RowDataPacket[]>(`
      SELECT COUNT(*) AS rowCount
      FROM ${quoteIdentifier(foreignKey.table)} child
      LEFT JOIN ${quoteIdentifier(foreignKey.parent)} parent ON ${join}
      WHERE ${populated} AND ${missing}
    `);
    const orphans = Number(countRows[0].rowCount);
    if (orphans > 0) issues.push({ table: foreignKey.table, constraint: foreignKey.constraint, orphans });
  }
  return { checked: grouped.size, issues };
}

async function main() {
  const sourceUrl = arg('--source-url');
  const targetUrl = arg('--target-url');
  if (!sourceUrl || !targetUrl) throw new Error('--source-url and --target-url are required');
  const sourceParsed = new URL(sourceUrl);
  const targetParsed = new URL(targetUrl);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  const sourceDatabase = decodeURIComponent(sourceParsed.pathname.replace(/^\//, ''));
  const targetDatabase = decodeURIComponent(targetParsed.pathname.replace(/^\//, ''));
  if (!localHosts.has(sourceParsed.hostname) || !sourceDatabase.endsWith('_restore_test')) {
    throw new Error('Source must be a local database ending in _restore_test');
  }
  if (!localHosts.has(targetParsed.hostname) || !targetDatabase.endsWith('_master_only_test')) {
    throw new Error('Target must be a local database ending in _master_only_test');
  }

  const source = await mysql.createConnection({
    uri: sourceUrl,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  const target = await mysql.createConnection({
    uri: targetUrl,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  try {
    const sourceTables = await tables(source);
    const targetTables = await tables(target);
    const issues: Array<Record<string, unknown>> = [];
    if (JSON.stringify(sourceTables) !== JSON.stringify(targetTables)) {
      issues.push({ check: 'table-set-mismatch' });
    }

    const unclassified = sourceTables.filter(table => !classifyTransactionPurgeTable(table));
    if (unclassified.length > 0) issues.push({ check: 'unclassified-tables', tables: unclassified });

    let sourceRows = 0;
    let targetRows = 0;
    let preservedTablesChecked = 0;
    let transactionTablesChecked = 0;
    for (const sourceTable of sourceTables) {
      const targetTable = targetTables.find(table => table.toLowerCase() === sourceTable.toLowerCase());
      if (!targetTable) continue;
      const [sourceData] = await source.query<RowDataPacket[]>(`SELECT * FROM ${quoteIdentifier(sourceTable)}`);
      const [targetData] = await target.query<RowDataPacket[]>(`SELECT * FROM ${quoteIdentifier(targetTable)}`);
      sourceRows += sourceData.length;
      targetRows += targetData.length;
      if (isPurgeTarget(sourceTable, 'master-only')) {
        transactionTablesChecked += 1;
        if (targetData.length !== 0) {
          issues.push({ check: 'transaction-table-not-empty', table: targetTable, rows: targetData.length });
        }
        continue;
      }
      preservedTablesChecked += 1;
      const expectedHash = contentHash(sourceData, row => sanitizePreservedRow(sourceTable, row));
      const actualHash = contentHash(targetData);
      if (sourceData.length !== targetData.length || expectedHash !== actualHash) {
        issues.push({
          check: 'preserved-table-mismatch',
          table: targetTable,
          sourceRows: sourceData.length,
          targetRows: targetData.length,
          expectedHash,
          actualHash,
        });
      }
    }

    const sourceTriggers = await triggers(source);
    const targetTriggers = await triggers(target);
    if (JSON.stringify(sourceTriggers) !== JSON.stringify(targetTriggers)) {
      issues.push({ check: 'trigger-definition-mismatch' });
    }
    const foreignKeys = await foreignKeyOrphans(target);
    issues.push(...foreignKeys.issues.map(issue => ({ check: 'foreign-key-orphans', ...issue })));

    const result = {
      policyVersion: TRANSACTION_PURGE_POLICY_VERSION,
      sourceDatabase,
      targetDatabase,
      tables: sourceTables.length,
      sourceRows,
      targetRows,
      preservedTablesChecked,
      transactionTablesChecked,
      triggersChecked: Object.keys(sourceTriggers).length,
      foreignKeysChecked: foreignKeys.checked,
      issues,
    };
    console.log(JSON.stringify(result, null, 2));
    if (issues.length > 0) process.exitCode = 1;
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
