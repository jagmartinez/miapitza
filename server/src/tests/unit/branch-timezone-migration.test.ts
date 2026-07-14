import fs from 'node:fs';
import path from 'node:path';

describe('Branch timezone migration contract', () => {
    it('adds the non-null column required by the Prisma model', () => {
        const migration = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/migrations/20260714_add_branch_timezone/migration.sql'),
            'utf8'
        );
        const schema = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/schema.prisma'),
            'utf8'
        );

        expect(migration).toContain("ADD COLUMN `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Managua'");
        expect(schema).toMatch(/timezone\s+String\s+@default\("America\/Managua"\)\s+@db\.VarChar\(64\)/);
    });
});
