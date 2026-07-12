import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import mysql from 'mysql2/promise';

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
  const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined;
  const targetUrl = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
  if (!file || !targetUrl) throw new Error('--file and --target-url are required');

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
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    const input = fs.createReadStream(file).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      const entry = JSON.parse(line) as { type: string; name?: string; table?: string; createSql?: string; data?: Record<string, unknown> };
      if (entry.type === 'table' && entry.name && entry.createSql) {
        await connection.query(entry.createSql);
        counts[entry.name] = 0;
      } else if (entry.type === 'row' && entry.table && entry.data) {
        const data = Object.fromEntries(Object.entries(entry.data).map(([key, value]) => [key, decode(value)]));
        await connection.query('INSERT INTO ?? SET ?', [entry.table, data]);
        counts[entry.table] = (counts[entry.table] || 0) + 1;
      }
    }
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
