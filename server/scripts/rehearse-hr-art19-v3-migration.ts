import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config({ path: '.env.test', override: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const parsed = new URL(databaseUrl);
const sourceDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || !sourceDatabase) {
    throw new Error(`Refusing migration rehearsal outside local MySQL (received ${parsed.hostname}/${sourceDatabase})`);
}

const rehearsalDatabase = `${sourceDatabase}_hr_art19_v3_rehearsal`;
if (!/^[A-Za-z0-9_]+_hr_art19_v3_rehearsal$/.test(rehearsalDatabase)) throw new Error('Unsafe rehearsal database name');
const quotedDatabase = `\`${rehearsalDatabase}\``;
const migrationDirectory = path.resolve(__dirname, '../prisma/migrations/20260715_hr_statutory_payroll_v3_art19');
const migration = fs.readFileSync(path.join(migrationDirectory, 'migration.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(migrationDirectory, 'rollback.sql'), 'utf8');

const statutoryColumns = [
    'methodVersion',
    'incomeTaxMethod',
    'regularEmployeeInss',
    'occasionalEmployeeInss',
    'fixedIncomeTaxGross',
    'variableIncomeTaxGross',
    'occasionalIncomeTaxGross',
    'fixedCompensationAmount',
    'currentRegularIncomeTaxNet',
    'currentOccasionalIncomeTaxNet',
    'priorOccasionalIncomeTaxNet',
    'priorHadVariableIncome',
    'elapsedFiscalMonths',
    'regularAnnualIncomeTax',
    'annualIncomeTaxWithOccasional',
    'priorRegularIncomeTaxWithheld',
    'priorOccasionalIncomeTaxWithheld',
    'regularIncomeTaxWithheld',
    'occasionalIncomeTaxWithheld',
    'incomeTaxCreditBalance',
] as const;

async function v3ColumnCount(connection: mysql.Connection): Promise<number> {
    const [columns] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND (
            (TABLE_NAME = 'PayrollComponent' AND COLUMN_NAME = 'incomeTaxTreatment') OR
            (TABLE_NAME = 'PayrollStatutoryCalculation' AND COLUMN_NAME IN (?))
        )
    `, [rehearsalDatabase, [...statutoryColumns]]);
    return columns.length;
}

async function treatmentConstraintCount(connection: mysql.Connection): Promise<number> {
    const [constraints] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT CONSTRAINT_NAME
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = 'PayrollComponent'
          AND CONSTRAINT_NAME = 'PayrollComponent_ir_treatment_ck'
          AND CONSTRAINT_TYPE = 'CHECK'
    `, [rehearsalDatabase]);
    return constraints.length;
}

async function main() {
    const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: true });
    let rehearsalDatabaseCreated = false;
    try {
        const [existing] = await connection.query<mysql.RowDataPacket[]>(
            'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
            [rehearsalDatabase],
        );
        if (existing.length > 0) throw new Error(`Refusing to replace existing rehearsal database ${rehearsalDatabase}`);
        await connection.query(`CREATE DATABASE ${quotedDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        rehearsalDatabaseCreated = true;
        await connection.query(`USE ${quotedDatabase}`);
        await connection.query(`
            CREATE TABLE \`PayrollComponent\` (
                \`id\` INT NOT NULL AUTO_INCREMENT,
                \`type\` ENUM('INCOME', 'DEDUCTION') NOT NULL,
                \`taxable\` BOOLEAN NULL,
                PRIMARY KEY (\`id\`)
            );
            CREATE TABLE \`PayrollStatutoryCalculation\` (
                \`id\` INT NOT NULL AUTO_INCREMENT,
                PRIMARY KEY (\`id\`)
            );
        `);
        await connection.query('INSERT INTO `PayrollStatutoryCalculation` (`id`) VALUES (1)');
        await connection.query(migration);

        const expectedColumnCount = statutoryColumns.length + 1;
        const migratedColumnCount = await v3ColumnCount(connection);
        if (migratedColumnCount !== expectedColumnCount) {
            throw new Error(`Migration column verification failed: expected ${expectedColumnCount}, received ${migratedColumnCount}`);
        }
        if (await treatmentConstraintCount(connection) !== 1) throw new Error('Migration did not create the treatment CHECK');

        const [legacyRows] = await connection.query<mysql.RowDataPacket[]>(
            'SELECT `methodVersion`, `elapsedFiscalMonths` FROM `PayrollStatutoryCalculation` WHERE `id` = 1',
        );
        if (legacyRows[0]?.methodVersion !== 'LEGACY_UNCLASSIFIED' || Number(legacyRows[0]?.elapsedFiscalMonths) !== 0) {
            throw new Error('Migration did not preserve legacy rows with explicit V3 defaults');
        }

        await connection.query("INSERT INTO `PayrollComponent` (`type`, `taxable`, `incomeTaxTreatment`) VALUES ('INCOME', TRUE, 'REGULAR_FIXED')");
        let invalidTreatmentRejected = false;
        try {
            await connection.query("INSERT INTO `PayrollComponent` (`type`, `taxable`, `incomeTaxTreatment`) VALUES ('DEDUCTION', FALSE, 'OCCASIONAL')");
        } catch {
            invalidTreatmentRejected = true;
        }
        if (!invalidTreatmentRejected) throw new Error('The income-tax treatment CHECK did not reject an invalid deduction treatment');

        const [versionRows] = await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version');
        const serverVersion = String(versionRows[0]?.version ?? '');
        const dialect = /mariadb/i.test(serverVersion) ? 'mariadb' : 'mysql';

        await connection.query("INSERT INTO `PayrollStatutoryCalculation` (`methodVersion`, `incomeTaxMethod`) VALUES ('ART19_V3', 'FIXED_PERIOD_PROJECTION')");
        let guardedRollbackRejected = false;
        let guardedRollbackError: unknown;
        try {
            await connection.query(rollback);
        } catch (error) {
            guardedRollbackError = error;
            guardedRollbackRejected = String(error).toLowerCase().includes('__hr_art19_v3_rollback_blocked_active_rows__');
            try { await connection.query('DEALLOCATE PREPARE hr_art19_v3_guard_stmt'); } catch { /* statement may already be gone */ }
        }
        if (!guardedRollbackRejected) {
            throw new Error(`Rollback preflight did not reject an existing ART19_V3 trace: ${String(guardedRollbackError ?? 'no error')}`);
        }
        if (await v3ColumnCount(connection) !== expectedColumnCount || await treatmentConstraintCount(connection) !== 1) {
            throw new Error('Guarded rollback changed the V3 schema before aborting');
        }

        await connection.query("DELETE FROM `PayrollStatutoryCalculation` WHERE `methodVersion` = 'ART19_V3'");
        await connection.query('DELETE FROM `PayrollComponent` WHERE `incomeTaxTreatment` IS NOT NULL');
        await connection.query(rollback);
        if (await v3ColumnCount(connection) !== 0) throw new Error('Rollback left V3 columns behind');
        if (await treatmentConstraintCount(connection) !== 0) throw new Error('Rollback left the treatment CHECK behind');
        console.log(JSON.stringify({
            migration: '20260715_hr_statutory_payroll_v3_art19', serverVersion, dialect,
            apply: 'PASS', checkConstraint: 'PASS', rollbackGuard: 'PASS', emptyRollback: 'PASS',
        }));
    } finally {
        if (rehearsalDatabaseCreated) await connection.query(`DROP DATABASE IF EXISTS ${quotedDatabase}`);
        await connection.end();
    }
}

void main();
