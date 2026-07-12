import fs from 'fs';
import zlib from 'zlib';
import mysql, { RowDataPacket } from 'mysql2/promise';

type EncodedValue = unknown;

function encode(value: unknown): EncodedValue {
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value !== null && typeof value === 'object') return { $json: JSON.stringify(value) };
  return value;
}

async function writeLine(stream: zlib.Gzip, value: unknown) {
  const line = `${JSON.stringify(value)}\n`;
  if (!stream.write(line)) await new Promise<void>(resolve => stream.once('drain', resolve));
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!out || !out.endsWith('.ndjson.gz')) throw new Error('--out must end in .ndjson.gz');

  const connection = await mysql.createConnection({ uri: url, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const gzip = zlib.createGzip({ level: 9 });
  const destination = fs.createWriteStream(out, { flags: 'wx' });
  gzip.pipe(destination);

  const counts: Record<string, number> = {};
  try {
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const [tables] = await connection.query<RowDataPacket[]>("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    const tableKey = tables.length > 0 ? Object.keys(tables[0])[0] : '';
    const names = tables.map(row => String(row[tableKey])).sort();
    await writeLine(gzip, { type: 'header', format: 1, createdAt: new Date().toISOString(), tables: names.length });

    for (const table of names) {
      const [createRows] = await connection.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table.replace(/`/g, '``')}\``);
      const createSql = String(createRows[0]['Create Table']);
      await writeLine(gzip, { type: 'table', name: table, createSql });

      const [rows] = await connection.query<RowDataPacket[]>(`SELECT * FROM \`${table.replace(/`/g, '``')}\``);
      counts[table] = rows.length;
      for (const row of rows) {
        const data = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encode(value)]));
        await writeLine(gzip, { type: 'row', table, data });
      }
      await writeLine(gzip, { type: 'tableEnd', name: table, rows: rows.length });
    }
    await connection.query('COMMIT');
    await writeLine(gzip, { type: 'footer', counts });
    gzip.end();
    await new Promise<void>((resolve, reject) => {
      destination.on('close', resolve);
      destination.on('error', reject);
      gzip.on('error', reject);
    });
    console.log(JSON.stringify({ out, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts }));
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    gzip.destroy();
    destination.destroy();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
