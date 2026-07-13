import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import mysql from 'mysql2/promise';

const INSERT_BATCH_SIZE = 250;

function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``;
}

function decode(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.$binary === 'string') return Buffer.from(record.$binary, 'base64');
    if (typeof record.$date === 'string') return record.$date;
    if (typeof record.$bigint === 'string') return record.$bigint;
    if (typeof record.$json === 'string') return record.$json;
  }
  return value;
}

async function main() {
  const fileIndex = process.argv.indexOf('--file');
  const targetIndex = process.argv.indexOf('--target-url');
  const databaseIndex = process.argv.indexOf('--target-database');
  const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined;
  const explicitTargetUrl = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
  const targetDatabase = databaseIndex >= 0 ? process.argv[databaseIndex + 1] : undefined;
  let targetUrl = explicitTargetUrl;
  if (!targetUrl && targetDatabase) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required with --target-database');
    if (!/^[A-Za-z0-9_]+$/.test(targetDatabase)) throw new Error('Invalid target database name');
    const derived = new URL(process.env.DATABASE_URL);
    derived.pathname = `/${targetDatabase}`;
    targetUrl = derived.toString();
  }
  if (!file || !targetUrl) {
    throw new Error('--file and either --target-url or --target-database are required');
  }

  const parsed = new URL(targetUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database.endsWith('_restore_test')) throw new Error('Target database must end in _restore_test');
  parsed.pathname = '/';

  const admin = await mysql.createConnection({ uri: parsed.toString(), multipleStatements: false });
  await admin.query(`DROP DATABASE IF EXISTS \`${database.replace(/`/g, '``')}\``);
  await admin.query(`CREATE DATABASE \`${database.replace(/`/g, '``')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const connection = await mysql.createConnection({ uri: targetUrl, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const counts: Record<string, number> = {};
  let expectedCounts: Record<string, number> | undefined;
  let pending: { table: string; columns: string[]; rows: unknown[][] } | undefined;
  const flushPending = async () => {
    if (!pending || pending.rows.length === 0) return;
    const rowPlaceholders = `(${pending.columns.map(() => '?').join(', ')})`;
    const placeholders = pending.rows.map(() => rowPlaceholders).join(', ');
    const sql = `INSERT INTO ${quoteIdentifier(pending.table)} (${pending.columns.map(quoteIdentifier).join(', ')}) VALUES ${placeholders}`;
    await connection.query(sql, pending.rows.flat());
    pending.rows = [];
  };
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    const input = fs.createReadStream(file).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const entry = JSON.parse(line) as {
        type: string;
        name?: string;
        table?: string;
        createSql?: string;
        data?: Record<string, unknown>;
        counts?: Record<string, number>;
      };
      if (entry.type === 'table' && entry.name && entry.createSql) {
        await flushPending();
        pending = undefined;
        await connection.query(entry.createSql);
        counts[entry.name] = 0;
      } else if (entry.type === 'row' && entry.table && entry.data) {
        const data = Object.fromEntries(Object.entries(entry.data).map(([key, value]) => [key, decode(value)]));
        const columns = Object.keys(data);
        if (!pending) pending = { table: entry.table, columns, rows: [] };
        if (pending.table !== entry.table || pending.columns.join('\0') !== columns.join('\0')) {
          throw new Error(`Inconsistent row shape for table ${entry.table}`);
        }
        pending.rows.push(columns.map(column => data[column]));
        if (pending.rows.length >= INSERT_BATCH_SIZE) await flushPending();
        counts[entry.table] = (counts[entry.table] || 0) + 1;
      } else if (entry.type === 'tableEnd') {
        await flushPending();
        pending = undefined;
      } else if (entry.type === 'footer' && entry.counts) {
        expectedCounts = entry.counts;
      }
    }
    await flushPending();
    if (!expectedCounts) throw new Error('Backup footer with source counts is missing');
    const actual = JSON.stringify(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    const expected = JSON.stringify(Object.entries(expectedCounts).sort(([a], [b]) => a.localeCompare(b)));
    if (actual !== expected) throw new Error('Restored table counts do not match the backup footer');
    await connection.query('SET FOREIGN_KEY_CHECKS=1');
    console.log(JSON.stringify({ database, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts }));
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
