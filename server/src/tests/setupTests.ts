import {
    beforeAll,
    afterAll,
} from '@jest/globals';
import dotenv from 'dotenv';
// Load test env first — must point to restaurante_test DB
dotenv.config({ path: '.env.test', override: true });

import prisma from '../utils/prisma';
import { execSync } from 'child_process';

beforeAll(async () => {
    // Safety: ensure we're using the test database, never production
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl.includes('_test')) {
        throw new Error('FATAL: Tests must run against a _test database. Check .env.test');
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
