import { describe, expect, it, jest } from '@jest/globals';
import type { LoginAttempt, PrismaClient } from '@prisma/client';
import { LoginAttemptService } from '../../services/login-attempt.service';

function createSharedDatabase() {
    let record: LoginAttempt | null = null;
    let transactionTail: Promise<unknown> = Promise.resolve();

    const model = {
        findUnique: jest.fn(async () => record),
        findUniqueOrThrow: jest.fn(async () => {
            if (!record) throw new Error('missing');
            return record;
        }),
        update: jest.fn(async ({ data }: {
            data: { failedCount: number; lockedUntil: Date | null; lastAttemptAt: Date };
        }) => {
            if (!record) throw new Error('missing');
            record = { ...record, ...data, updatedAt: data.lastAttemptAt };
            return record;
        }),
        delete: jest.fn(async () => {
            const deleted = record;
            record = null;
            return deleted;
        }),
        deleteMany: jest.fn(async () => {
            const count = record ? 1 : 0;
            record = null;
            return { count };
        }),
    };
    const tx = {
        loginAttempt: model,
        $executeRaw: jest.fn(async (
            _sql: TemplateStringsArray,
            userId: number,
            attemptAt: Date,
        ) => {
            if (!record) {
                record = {
                    userId,
                    failedCount: 0,
                    lockedUntil: null,
                    lastAttemptAt: attemptAt,
                    createdAt: attemptAt,
                    updatedAt: attemptAt,
                };
            }
            return 1;
        }),
        $queryRaw: jest.fn(async () => []),
    };
    const db = {
        loginAttempt: model,
        $transaction: jest.fn(<T>(callback: (value: typeof tx) => Promise<T>) => {
            const current = transactionTail.then(() => callback(tx));
            transactionTail = current.then(() => undefined, () => undefined);
            return current;
        }),
    } as unknown as Pick<PrismaClient, '$transaction' | 'loginAttempt'>;

    return { db, getRecord: () => record };
}

describe('LoginAttemptService', () => {
    it('shares and serializes failures from independent replicas', async () => {
        const now = new Date('2026-07-23T12:00:00.000Z');
        const shared = createSharedDatabase();
        const replicaA = new LoginAttemptService(shared.db, {
            maxAttempts: 2,
            lockoutDurationMs: 60_000,
            now: () => now,
        });
        const replicaB = new LoginAttemptService(shared.db, {
            maxAttempts: 2,
            lockoutDurationMs: 60_000,
            now: () => now,
        });

        await Promise.all([
            replicaA.recordFailure(17),
            replicaB.recordFailure(17),
        ]);

        expect(shared.getRecord()?.failedCount).toBe(0);
        expect(shared.getRecord()?.lockedUntil).toEqual(new Date(now.getTime() + 60_000));
        await expect(replicaA.assertAllowed(17)).rejects.toThrow('temporarily locked');
        await expect(replicaB.assertAllowed(17)).rejects.toThrow('temporarily locked');
    });

    it('does not let a verified request clear a lock established concurrently', async () => {
        const now = new Date('2026-07-23T12:00:00.000Z');
        const shared = createSharedDatabase();
        const service = new LoginAttemptService(shared.db, {
            maxAttempts: 1,
            lockoutDurationMs: 60_000,
            now: () => now,
        });

        await service.recordFailure(22);

        await expect(service.recordSuccess(22)).rejects.toThrow('temporarily locked');
        expect(shared.getRecord()?.lockedUntil).toEqual(new Date(now.getTime() + 60_000));
    });

    it('clears an unlocked failure row after a successful login', async () => {
        const now = new Date('2026-07-23T12:00:00.000Z');
        const shared = createSharedDatabase();
        const service = new LoginAttemptService(shared.db, {
            maxAttempts: 5,
            now: () => now,
        });
        await service.recordFailure(31);

        await service.recordSuccess(31);

        expect(shared.getRecord()).toBeNull();
    });

    it('retries a MySQL deadlock without losing the failure increment', async () => {
        const now = new Date('2026-07-23T12:00:00.000Z');
        const shared = createSharedDatabase();
        const transaction = shared.db.$transaction as unknown as ReturnType<typeof jest.fn>;
        transaction.mockRejectedValueOnce({
            code: 'P2010',
            meta: { code: '1213' },
            message: 'Deadlock found when trying to get lock',
        });
        const service = new LoginAttemptService(shared.db, {
            maxAttempts: 5,
            now: () => now,
        });

        await service.recordFailure(44);

        expect(transaction).toHaveBeenCalledTimes(2);
        expect(shared.getRecord()).toEqual(expect.objectContaining({
            userId: 44,
            failedCount: 1,
        }));
    });
});
