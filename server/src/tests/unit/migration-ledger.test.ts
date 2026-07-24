import { describe, expect, it } from '@jest/globals';
import path from 'node:path';
import {
    compareMigrationLedger,
    loadExpectedMigrations,
    type ExpectedMigration,
    type MigrationLedgerRow,
} from '../../utils/migration-ledger';

const expected: ExpectedMigration[] = [
    { name: '001_initial', checksum: 'aaa' },
    { name: '002_feature', checksum: 'bbb' },
];

function row(
    migration_name: string,
    checksum: string,
    state: 'SUCCESS' | 'FAILED' | 'ROLLED_BACK' = 'SUCCESS',
): MigrationLedgerRow {
    return {
        migration_name,
        checksum,
        finished_at: state === 'SUCCESS' ? new Date('2026-07-23T00:00:00Z') : null,
        rolled_back_at: state === 'ROLLED_BACK' ? new Date('2026-07-23T00:00:00Z') : null,
    };
}

describe('migration ledger verification', () => {
    it('accepts exactly the successful migrations and checksums shipped in the artifact', () => {
        const result = compareMigrationLedger(expected, [
            row('001_initial', 'aaa'),
            row('002_feature', 'BBB'),
        ]);

        expect(result).toEqual({
            expected: 2,
            successful: 2,
            rolledBack: 0,
            unresolved: 0,
            issues: [],
        });
    });

    it('fails closed for missing, unexpected, unresolved and checksum-drifted migrations', () => {
        const result = compareMigrationLedger(expected, [
            row('001_initial', 'changed'),
            row('003_unknown', 'ccc'),
            row('004_failed', 'ddd', 'FAILED'),
        ]);

        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ check: 'migration-ledger-missing', count: 1 }),
            expect.objectContaining({ check: 'migration-checksum-mismatch', count: 1 }),
            expect.objectContaining({ check: 'migration-ledger-unexpected', count: 1 }),
            expect.objectContaining({ check: 'migration-ledger-unresolved', count: 1 }),
        ]));
    });

    it('allows a rolled-back attempt only when a later matching migration succeeded', () => {
        const result = compareMigrationLedger(expected, [
            row('001_initial', 'aaa', 'ROLLED_BACK'),
            row('001_initial', 'aaa'),
            row('002_feature', 'bbb'),
        ]);

        expect(result.rolledBack).toBe(1);
        expect(result.issues).toEqual([]);
    });

    it('rejects duplicate successful migration rows', () => {
        const result = compareMigrationLedger(expected, [
            row('001_initial', 'aaa'),
            row('001_initial', 'aaa'),
            row('002_feature', 'bbb'),
        ]);

        expect(result.issues).toContainEqual(expect.objectContaining({
            check: 'migration-ledger-duplicate-success',
            count: 1,
        }));
    });

    it('hashes every migration shipped in the current server artifact', () => {
        const shipped = loadExpectedMigrations(path.resolve(process.cwd(), 'prisma/migrations'));
        const result = compareMigrationLedger(
            shipped,
            shipped.map(migration => row(migration.name, migration.checksum)),
        );

        expect(shipped.length).toBeGreaterThan(0);
        expect(result.expected).toBe(shipped.length);
        expect(result.issues).toEqual([]);
    });
});
