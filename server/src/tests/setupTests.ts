import {
    beforeAll,
    afterAll,
} from '@jest/globals';
import dotenv from 'dotenv';
// Load test env first — must point to restaurante_test DB
const usesDisposableMigratedDatabase = process.env.INTEGRATION_DATABASE_LIFECYCLE === 'DISPOSABLE_MIGRATED';
dotenv.config({ path: '.env.test', override: !usesDisposableMigratedDatabase });

import prisma from '../utils/prisma';
import { execSync } from 'child_process';

beforeAll(async () => {
    // Safety: ensure we're using the test database, never production
    const dbUrl = process.env.DATABASE_URL || '';
    const databaseName = dbUrl ? decodeURIComponent(new URL(dbUrl).pathname.replace(/^\//, '')) : '';
    if (!/^[A-Za-z0-9_]+_test$/.test(databaseName)) {
        throw new Error('FATAL: Tests must run against a _test database. Check .env.test');
    }

    if (usesDisposableMigratedDatabase) {
        const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
            SELECT migration_name
            FROM _prisma_migrations
            WHERE migration_name IN ('20260715_hr_statutory_payroll_v2', '20260715_hr_statutory_payroll_v3_art19')
              AND finished_at IS NOT NULL
              AND rolled_back_at IS NULL
        `;
        const triggers = await prisma.$queryRaw<Array<{ triggerName: string }>>`
            SELECT TRIGGER_NAME AS triggerName
            FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE()
              AND TRIGGER_NAME IN (
                'PayrollEmployerContribution_no_update',
                'PayrollEmployerContribution_no_delete',
                'PayrollStatutoryCalculation_no_update',
                'PayrollStatutoryCalculation_no_delete'
              )
        `;
        if (migrations.length !== 2 || triggers.length !== 4) {
            throw new Error('FATAL: Disposable integration database is not the fully migrated append-only schema');
        }
        return;
    }

    console.log('Syncing test database schema...');
    try {
        execSync('npx prisma db push --accept-data-loss --skip-generate', {
            stdio: 'inherit',
            env: { ...process.env }
        });
    } catch (error) {
        console.error('Error syncing test database:', error);
        throw new Error('Unable to initialize the integration test database. Ensure .env.test points to a reachable _test database.');
    }
});

afterAll(async () => {
    await prisma.$disconnect();
});

export { prisma };
