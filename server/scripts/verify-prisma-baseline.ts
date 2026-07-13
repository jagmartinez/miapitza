import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

async function main() {
  dotenv.config({ path: process.env.BASELINE_ENV_FILE || '.env.test', override: false });
  const fileIndex = process.argv.indexOf('--file');
  const databaseIndex = process.argv.indexOf('--target-database');
  const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined;
  const targetDatabase = databaseIndex >= 0 ? process.argv[databaseIndex + 1] : undefined;
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL is required');
  if (!file?.endsWith('.sql')) throw new Error('--file must name the baseline .sql');
  if (!targetDatabase || !/^[A-Za-z0-9_]+_restore_test$/.test(targetDatabase)) {
    throw new Error('--target-database must be a safe name ending in _restore_test');
  }

  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${targetDatabase}`;
  const admin = await mysql.createConnection({ uri: adminUrl.toString() });
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
    await admin.query(`CREATE DATABASE \`${targetDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const target = await mysql.createConnection({ uri: targetUrl.toString(), multipleStatements: true });
    try {
      await target.query(readFileSync(file, 'utf8'));
    } finally {
      await target.end();
    }

    const prismaCli = require.resolve('prisma/build/index.js');
    const result = spawnSync(process.execPath, [
      prismaCli,
      'migrate',
      'diff',
      '--from-url',
      targetUrl.toString(),
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--exit-code',
    ], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Baseline differs from Prisma schema (exit ${result.status})`);
    console.log(JSON.stringify({ targetDatabase, baselineMatchesSchema: true }));
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
    await admin.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
