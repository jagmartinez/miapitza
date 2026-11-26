import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import prisma from '../../utils/prisma';
import {
    checkStorageReadiness,
    STORAGE_IDENTITY_SINGLETON_KEY,
    StorageIdentityMismatchError,
} from '../../services/storage-identity.service';

const identityKey = `storage-integration-${process.pid}-${Date.now()}`;
const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-storage-shared-'));
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-storage-isolated-'));
const distinctIdentityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-storage-distinct-'));

beforeAll(async () => {
    await prisma.storageIdentity.deleteMany({
        where: { singletonKey: STORAGE_IDENTITY_SINGLETON_KEY },
    });
});

afterAll(async () => {
    await prisma.storageIdentity.deleteMany({
        where: { singletonKey: STORAGE_IDENTITY_SINGLETON_KEY },
    });
    fs.rmSync(sharedRoot, { recursive: true, force: true });
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
    fs.rmSync(distinctIdentityRoot, { recursive: true, force: true });
});

describe('storage identity with migrated MySQL', () => {
    it('accepts a common volume and rejects an isolated replica against the same database', async () => {
        const sharedEnv = {
            NODE_ENV: 'production',
            STORAGE_SHARED_ID: identityKey,
        };

        const first = await checkStorageReadiness(prisma, {
            ...sharedEnv,
            STORAGE_DIR: sharedRoot,
        });
        const second = await checkStorageReadiness(prisma, {
            ...sharedEnv,
            STORAGE_DIR: sharedRoot,
        });

        expect(second.identityHash).toBe(first.identityHash);
        await expect(checkStorageReadiness(prisma, {
            ...sharedEnv,
            STORAGE_DIR: isolatedRoot,
        })).rejects.toBeInstanceOf(StorageIdentityMismatchError);
        await expect(checkStorageReadiness(prisma, {
            NODE_ENV: 'production',
            STORAGE_SHARED_ID: `${identityKey}-different`,
            STORAGE_DIR: distinctIdentityRoot,
        })).rejects.toBeInstanceOf(StorageIdentityMismatchError);
        await expect(checkStorageReadiness(prisma, {
            NODE_ENV: 'production',
            STORAGE_SHARED_ID: `${identityKey}-different`,
            STORAGE_DIR: sharedRoot,
        })).rejects.toBeInstanceOf(StorageIdentityMismatchError);
        await expect(prisma.storageIdentity.count({
            where: { singletonKey: STORAGE_IDENTITY_SINGLETON_KEY },
        })).resolves.toBe(1);
        await expect(prisma.$executeRaw`
            INSERT INTO StorageIdentity (singletonKey, fingerprint, createdAt, updatedAt)
            VALUES ('SECONDARY', ${'f'.repeat(64)}, NOW(3), NOW(3))
        `).rejects.toThrow();
        await expect(prisma.storageIdentity.count()).resolves.toBe(1);
    });
});
