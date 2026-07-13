import { spawnSync } from 'node:child_process';

function main() {
  const databaseIndex = process.argv.indexOf('--target-database');
  const targetDatabase = databaseIndex >= 0 ? process.argv[databaseIndex + 1] : undefined;
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL is required');
  if (!targetDatabase || !/^[A-Za-z0-9_]+_restore_test$/.test(targetDatabase)) {
    throw new Error('--target-database must be a safe name ending in _restore_test');
  }

  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${targetDatabase}`;
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: targetUrl.toString() },
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
