import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function valuesFor(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueFor(flag: string): string | undefined {
  return valuesFor(flag)[0];
}

function safeRemoveTemporaryTree(directory: string): void {
  const resolvedDirectory = path.resolve(directory);
  const resolvedTemp = path.resolve(os.tmpdir());
  const expectedPrefix = `${resolvedTemp}${path.sep}`;
  if (!resolvedDirectory.startsWith(expectedPrefix)
    || !path.basename(resolvedDirectory).startsWith('restaurant-prisma-migrations-')) {
    throw new Error(`Refusing to remove unexpected temporary directory: ${resolvedDirectory}`);
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function main(): void {
  const targetDatabase = valueFor('--target-database');
  const excludedNames = new Set(valuesFor('--exclude'));
  const sourceUrl = process.env.DATABASE_URL;

  if (!sourceUrl) throw new Error('DATABASE_URL is required');
  if (!targetDatabase || !/^[A-Za-z0-9_]+_restore_test$/.test(targetDatabase)) {
    throw new Error('--target-database must be a safe name ending in _restore_test');
  }
  if (excludedNames.size === 0) {
    throw new Error('At least one exact --exclude migration name is required');
  }

  const migrationsSource = path.resolve(process.cwd(), 'prisma', 'migrations');
  const entries = fs.readdirSync(migrationsSource, { withFileTypes: true });
  const migrationNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const missingExclusions = [...excludedNames].filter((name) => !migrationNames.includes(name));
  if (missingExclusions.length > 0) {
    throw new Error(`Excluded migrations do not exist: ${missingExclusions.join(', ')}`);
  }

  const includedNames = migrationNames.filter((name) => !excludedNames.has(name)).sort();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-prisma-migrations-'));
  const temporaryPrisma = path.join(temporaryRoot, 'prisma');
  const temporaryMigrations = path.join(temporaryPrisma, 'migrations');

  try {
    fs.mkdirSync(temporaryMigrations, { recursive: true });
    fs.copyFileSync(
      path.join(migrationsSource, 'migration_lock.toml'),
      path.join(temporaryMigrations, 'migration_lock.toml'),
    );
    for (const name of includedNames) {
      fs.cpSync(
        path.join(migrationsSource, name),
        path.join(temporaryMigrations, name),
        { recursive: true },
      );
    }

    const temporarySchema = path.join(temporaryPrisma, 'schema.prisma');
    fs.writeFileSync(
      temporarySchema,
      [
        'datasource db {',
        '  provider = "mysql"',
        '  url      = env("DATABASE_URL")',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const targetUrl = new URL(sourceUrl);
    targetUrl.pathname = `/${targetDatabase}`;
    const prismaCli = require.resolve('prisma/build/index.js');
    console.log(JSON.stringify({
      targetDatabase,
      includedMigrations: includedNames,
      excludedMigrations: [...excludedNames].sort(),
    }));

    const result = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', temporarySchema],
      {
        cwd: temporaryRoot,
        env: { ...process.env, DATABASE_URL: targetUrl.toString() },
        encoding: 'utf8',
      },
    );
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
  } finally {
    safeRemoveTemporaryTree(temporaryRoot);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
