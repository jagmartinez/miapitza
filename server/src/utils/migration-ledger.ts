import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface ExpectedMigration {
    name: string;
    checksum: string;
}

export interface MigrationLedgerRow {
    migration_name: string;
    checksum: string;
    finished_at: unknown | null;
    rolled_back_at: unknown | null;
}

export interface MigrationLedgerIssue {
    check: string;
    count: number;
    detail?: string;
}

function summarize(names: string[]): string | undefined {
    if (names.length === 0) return undefined;
    const visible = names.slice(0, 10);
    return `${visible.join(', ')}${names.length > visible.length ? ` (+${names.length - visible.length} más)` : ''}`;
}

export function loadExpectedMigrations(migrationsDirectory: string): ExpectedMigration[] {
    return readdirSync(migrationsDirectory, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => ({
            name: entry.name,
            file: path.join(migrationsDirectory, entry.name, 'migration.sql'),
        }))
        .map(entry => {
            const contents = readFileSync(entry.file);
            return {
                name: entry.name,
                checksum: createHash('sha256').update(contents).digest('hex'),
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
}

export function compareMigrationLedger(
    expected: ExpectedMigration[],
    rows: MigrationLedgerRow[],
): {
    expected: number;
    successful: number;
    rolledBack: number;
    unresolved: number;
    issues: MigrationLedgerIssue[];
} {
    const issues: MigrationLedgerIssue[] = [];
    const expectedByName = new Map(expected.map(migration => [migration.name, migration]));
    const successfulRows = rows.filter(row => row.finished_at !== null && row.rolled_back_at === null);
    const unresolvedRows = rows.filter(row => row.finished_at === null && row.rolled_back_at === null);
    const rolledBackRows = rows.filter(row => row.rolled_back_at !== null);

    const missing: string[] = [];
    const checksumMismatch: string[] = [];
    const duplicateSuccessful: string[] = [];

    for (const migration of expected) {
        const applied = successfulRows.filter(row => row.migration_name === migration.name);
        if (applied.length === 0) {
            missing.push(migration.name);
            continue;
        }
        if (!applied.some(row => row.checksum.toLowerCase() === migration.checksum.toLowerCase())) {
            checksumMismatch.push(migration.name);
        }
        if (applied.length > 1) duplicateSuccessful.push(migration.name);
    }

    const unexpected = successfulRows
        .filter(row => !expectedByName.has(row.migration_name))
        .map(row => row.migration_name);

    if (missing.length > 0) {
        issues.push({ check: 'migration-ledger-missing', count: missing.length, detail: summarize(missing) });
    }
    if (checksumMismatch.length > 0) {
        issues.push({
            check: 'migration-checksum-mismatch',
            count: checksumMismatch.length,
            detail: summarize(checksumMismatch),
        });
    }
    if (unexpected.length > 0) {
        issues.push({
            check: 'migration-ledger-unexpected',
            count: unexpected.length,
            detail: summarize(unexpected),
        });
    }
    if (duplicateSuccessful.length > 0) {
        issues.push({
            check: 'migration-ledger-duplicate-success',
            count: duplicateSuccessful.length,
            detail: summarize(duplicateSuccessful),
        });
    }
    if (unresolvedRows.length > 0) {
        issues.push({
            check: 'migration-ledger-unresolved',
            count: unresolvedRows.length,
            detail: summarize(unresolvedRows.map(row => row.migration_name)),
        });
    }

    return {
        expected: expected.length,
        successful: successfulRows.length,
        rolledBack: rolledBackRows.length,
        unresolved: unresolvedRows.length,
        issues,
    };
}
