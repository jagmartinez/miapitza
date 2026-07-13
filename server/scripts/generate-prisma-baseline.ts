import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function main() {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  if (!out || !out.endsWith('.sql')) throw new Error('--out must name a .sql file');

  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [
    prismaCli,
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema-datamodel',
    'prisma/schema.prisma',
    '--script',
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Prisma baseline generation failed');

  const absoluteOut = path.resolve(out);
  mkdirSync(path.dirname(absoluteOut), { recursive: true });
  writeFileSync(absoluteOut, result.stdout, { encoding: 'utf8', flag: 'wx' });
  const sha256 = createHash('sha256').update(result.stdout).digest('hex');
  console.log(JSON.stringify({ out: absoluteOut, bytes: Buffer.byteLength(result.stdout), sha256 }));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
