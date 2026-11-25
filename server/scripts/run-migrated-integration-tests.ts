import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const rootDirectory = path.resolve(__dirname, '..');
const baselineFile = path.join(rootDirectory, 'prisma/baseline/20260713_schema.sql');
const migrationsDirectory = path.join(rootDirectory, 'prisma/migrations');
const baselineLastMigration = '20260713_add_purchase_payment_reversals';
// The reviewed baseline predates weekly scheduling even though two later-sorted
// 20260713 migrations (payment types and purchase reversals) are materialized.
const migrationsExcludedFromBaseline = new Set(['20260713_add_hr_weekly_scheduling']);
// Order financial status was materialized when the baseline was generated but
// sorts after the HR migrations that are intentionally absent from it.
const additionalBaselineMigrations = ['20260713_separate_order_financial_status'];
// HR foundation's baseline already contains Branch.timezone; applying the
// later compatibility migration would attempt to add the same column again.
additionalBaselineMigrations.push('20260714_add_branch_timezone');
const disposableLifecycle = 'DISPOSABLE_MIGRATED';

function runNode(script: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: rootDirectory,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit code ${result.status ?? 'unknown'}`);
}

async function main() {
  dotenv.config({ path: path.join(rootDirectory, '.env.test'), override: true });
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL is required in .env.test');

  const parsed = new URL(sourceUrl);
  const sourceDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+_test$/.test(sourceDatabase)) {
    throw new Error(`Refusing integration tests outside a database ending in _test (received ${sourceDatabase || 'empty'})`);
  }

  const stem = sourceDatabase.replace(/_test$/, '').slice(0, 30);
  const disposableDatabase = `${stem}_it_${process.pid}_${Date.now()}_test`;
  if (!/^[A-Za-z0-9_]+_test$/.test(disposableDatabase) || disposableDatabase.length > 64) {
    throw new Error('Unsafe disposable integration database name');
  }

  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/';
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${disposableDatabase}`;
  const quotedDatabase = `\`${disposableDatabase}\``;
  const admin = await mysql.createConnection({ uri: adminUrl.toString() });
  let created = false;

  try {
    const [existing] = await admin.query<mysql.RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [disposableDatabase],
    );
    if (existing.length > 0) throw new Error(`Refusing to replace existing database ${disposableDatabase}`);

    await admin.query(`CREATE DATABASE ${quotedDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    const target = await mysql.createConnection({ uri: targetUrl.toString(), multipleStatements: true });
    try {
      await target.query(fs.readFileSync(baselineFile, 'utf8'));
    } finally {
      await target.end();
    }

    const migrationNames = fs.readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(migrationsDirectory, entry.name, 'migration.sql')))
      .map(entry => entry.name)
      .sort();
    const baselineIndex = migrationNames.indexOf(baselineLastMigration);
    if (baselineIndex < 0) throw new Error(`Baseline boundary ${baselineLastMigration} is missing`);

    const prismaCli = require.resolve('prisma/build/index.js');
    const migratedEnv = {
      ...process.env,
      DATABASE_URL: targetUrl.toString(),
      INTEGRATION_DATABASE_LIFECYCLE: disposableLifecycle,
    };
    const baselineMigrations = migrationNames
      .slice(0, baselineIndex + 1)
      .filter(migration => !migrationsExcludedFromBaseline.has(migration))
      .concat(additionalBaselineMigrations);
    for (const migration of baselineMigrations) {
      runNode(prismaCli, ['migrate', 'resolve', '--applied', migration], migratedEnv);
    }
    runNode(prismaCli, ['migrate', 'deploy'], migratedEnv);

    const jestCli = require.resolve('jest/bin/jest');
    runNode(jestCli, ['--config', 'jest.integration.config.cjs', '--runInBand', ...process.argv.slice(2)], migratedEnv);
  } finally {
    if (created) await admin.query(`DROP DATABASE ${quotedDatabase}`);
    await admin.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
