import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
    checkStorageReadiness,
    STORAGE_IDENTITY_SINGLETON_KEY,
    StorageIdentityMismatchError,
} from '../../services/storage-identity.service';

interface IdentityRow {
    singletonKey: string;
    fingerprint: string;
}

function fakeDatabase(rows = new Map<string, IdentityRow>()): PrismaClient {
    return {
        storageIdentity: {
            findUnique: async ({ where }: { where: { singletonKey: string } }) => rows.get(where.singletonKey) || null,
            create: async ({ data }: { data: IdentityRow }) => {
                if (rows.has(data.singletonKey) || Array.from(rows.values()).some(row => row.fingerprint === data.fingerprint)) {
                    throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
                }
                rows.set(data.singletonKey, { ...data });
                return { ...data };
            },
        },
    } as unknown as PrismaClient;
}

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-storage-identity-'));
    temporaryRoots.push(root);
    return root;
}

afterEach(() => {
    jest.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('shared storage identity readiness', () => {
    it('keeps development compatible without registering a shared identity', async () => {
        const database = fakeDatabase();
        const result = await checkStorageReadiness(database, {
            NODE_ENV: 'test',
            STORAGE_DIR: temporaryRoot(),
        });

        expect(result).toEqual({
            mode: 'local-development',
            identityVerified: false,
        });
    });

    it('allows replicas that use the same volume and database identity', async () => {
        const rows = new Map<string, IdentityRow>();
        const database = fakeDatabase(rows);
        const root = temporaryRoot();
        const env = {
            NODE_ENV: 'production',
            STORAGE_DIR: root,
            STORAGE_SHARED_ID: 'restaurant-production-primary',
        };

        const first = await checkStorageReadiness(database, env);
        const second = await checkStorageReadiness(database, env);

        expect(first).toEqual(expect.objectContaining({
            mode: 'verified-shared',
            identityVerified: true,
            identityHash: expect.stringMatching(/^[0-9a-f]{12}$/),
        }));
        expect(second.identityHash).toBe(first.identityHash);
        expect(rows.size).toBe(1);
        expect(rows.has(STORAGE_IDENTITY_SINGLETON_KEY)).toBe(true);
    });

    it('fails closed when two replicas share MySQL but mount isolated volumes', async () => {
        const database = fakeDatabase();
        const sharedEnv = {
            NODE_ENV: 'production',
            STORAGE_SHARED_ID: 'restaurant-production-primary',
        };

        await expect(checkStorageReadiness(database, {
            ...sharedEnv,
            STORAGE_DIR: temporaryRoot(),
        })).resolves.toEqual(expect.objectContaining({ identityVerified: true }));
        await expect(checkStorageReadiness(database, {
            ...sharedEnv,
            STORAGE_DIR: temporaryRoot(),
        })).rejects.toBeInstanceOf(StorageIdentityMismatchError);
    });

    it('rejects isolated volumes with different configured IDs against one database', async () => {
        const database = fakeDatabase();
        await checkStorageReadiness(database, {
            NODE_ENV: 'production',
            STORAGE_DIR: temporaryRoot(),
            STORAGE_SHARED_ID: 'restaurant-production-primary',
        });

        await expect(checkStorageReadiness(database, {
            NODE_ENV: 'production',
            STORAGE_DIR: temporaryRoot(),
            STORAGE_SHARED_ID: 'restaurant-production-secondary',
        })).rejects.toBeInstanceOf(StorageIdentityMismatchError);
    });

    it('rejects changing the configured ID on the same volume', async () => {
        const database = fakeDatabase();
        const root = temporaryRoot();
        await checkStorageReadiness(database, {
            NODE_ENV: 'production',
            STORAGE_DIR: root,
            STORAGE_SHARED_ID: 'restaurant-production-primary',
        });

        await expect(checkStorageReadiness(database, {
            NODE_ENV: 'production',
            STORAGE_DIR: root,
            STORAGE_SHARED_ID: 'restaurant-production-secondary',
        })).rejects.toBeInstanceOf(StorageIdentityMismatchError);
    });

    it('rejects a corrupt marker instead of silently replacing it', async () => {
        const database = fakeDatabase();
        const root = temporaryRoot();
        const env = {
            NODE_ENV: 'production',
            STORAGE_DIR: root,
            STORAGE_SHARED_ID: 'restaurant-production-primary',
        };
        await checkStorageReadiness(database, env);
        fs.writeFileSync(path.join(root, '.restaurant-storage-identity-v1.json'), '{"version":1}\n', 'utf8');

        await expect(checkStorageReadiness(database, env)).rejects.toBeInstanceOf(StorageIdentityMismatchError);
    });

    it('fails readiness when the volume cannot delete the completed probe', async () => {
        jest.spyOn(fsPromises, 'rm').mockRejectedValueOnce(new Error('delete denied'));

        await expect(checkStorageReadiness(fakeDatabase(), {
            NODE_ENV: 'test',
            STORAGE_DIR: temporaryRoot(),
        })).rejects.toThrow('delete denied');
    });

    it('fails readiness when the volume cannot create the probe', async () => {
        jest.spyOn(fsPromises, 'open').mockRejectedValueOnce(new Error('create denied'));

        await expect(checkStorageReadiness(fakeDatabase(), {
            NODE_ENV: 'test',
            STORAGE_DIR: temporaryRoot(),
        })).rejects.toThrow('create denied');
    });

    it('fails readiness when fsync does not confirm the probe', async () => {
        jest.spyOn(fsPromises, 'open').mockResolvedValueOnce({
            writeFile: jest.fn(async () => undefined),
            sync: jest.fn(async () => { throw new Error('fsync denied'); }),
            close: jest.fn(async () => undefined),
        } as never);

        await expect(checkStorageReadiness(fakeDatabase(), {
            NODE_ENV: 'test',
            STORAGE_DIR: temporaryRoot(),
        })).rejects.toThrow('fsync denied');
    });

    it('fails readiness when the probe readback differs from what was written', async () => {
        jest.spyOn(fsPromises, 'readFile').mockResolvedValueOnce(Buffer.from('tampered') as never);

        await expect(checkStorageReadiness(fakeDatabase(), {
            NODE_ENV: 'test',
            STORAGE_DIR: temporaryRoot(),
        })).rejects.toThrow('datos distintos');
    });
});
