import mysql from 'mysql2/promise';

async function main() {
  const databaseIndex = process.argv.indexOf('--target-database');
  const targetDatabase = databaseIndex >= 0 ? process.argv[databaseIndex + 1] : undefined;
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL is required');
  if (!targetDatabase || !/^[A-Za-z0-9_]+_restore_test$/.test(targetDatabase)) {
    throw new Error('--target-database must be a safe name ending in _restore_test');
  }
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/';
  const admin = await mysql.createConnection({ uri: adminUrl.toString() });
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
    console.log(JSON.stringify({ dropped: targetDatabase }));
  } finally {
    await admin.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
