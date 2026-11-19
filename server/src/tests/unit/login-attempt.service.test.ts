import { describe, expect, it, jest } from '@jest/globals';
import type { LoginAttempt, PrismaClient } from '@prisma/client';
import { GLOBAL_IP_KEY, LoginAttemptService, normalizeIpKey } from '../../services/login-attempt.service';

type Where = { userId: number; ipKey?: { in: string[] } };

function createSharedDatabase() {
    const rows = new Map<string, LoginAttempt>();
    let nextId = 1;
    let transactionTail: Promise<unknown> = Promise.resolve();
    const key = (userId: number, ipKey: string) => `${userId}|${ipKey}`;
    const matching = (where: Where) => [...rows.values()].filter((row) =>
        row.userId === where.userId && (!where.ipKey || where.ipKey.in.includes(row.ipKey)));

    const model = {
        findMany: jest.fn(async ({ where }: { where: Where }) => matching(where)),
        update: jest.fn(async ({ where, data }: {
            where: { id: number };
            data: { failedCount: number; lockedUntil: Date | null; lastAttemptAt: Date };
        }) => {
            const row = [...rows.values()].find((candidate) => candidate.id === where.id);
            if (!row) throw new Error('missing');
            const updated = { ...row, ...data, updatedAt: data.lastAttemptAt };
            rows.set(key(row.userId, row.ipKey), updated);
            return updated;
        }),
        deleteMany: jest.fn(async (args?: { where?: Where }) => {
            const victims = args?.where?.userId !== undefined ? matching(args.where) : [...rows.values()];
            victims.forEach((row) => rows.delete(key(row.userId, row.ipKey)));
            return { count: victims.length };
        }),
    };
    const tx = {
        loginAttempt: model,
        // INSERT IGNORE (userId, globalKey, ..., now x3), (userId, ipKey, ..., now x3)
        $executeRaw: jest.fn(async (_sql: TemplateStringsArray, ...values: unknown[]) => {
            for (const offset of [0, 5]) {
                const userId = values[offset] as number;
                const ipKey = values[offset + 1] as string;
                const at = values[offset + 2] as Date;
                if (!rows.has(key(userId, ipKey))) {
                    rows.set(key(userId, ipKey), {
                        id: nextId++,
                        userId,
                        ipKey,
                        failedCount: 0,
                        lockedUntil: null,
                        lastAttemptAt: at,
                        createdAt: at,
                        updatedAt: at,
                    });
                }
            }
            return 2;
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

    return { db, getRow: (userId: number, ipKey: string) => rows.get(key(userId, ipKey)) ?? null };
}

const NOW = new Date('2026-07-23T12:00:00.000Z');
const IP_A = '198.51.100.7';
const IP_B = '203.0.113.9';

describe('LoginAttemptService', () => {
    it('shares and serializes per-IP failures from independent replicas', async () => {
        const shared = createSharedDatabase();
        const options = { maxAttempts: 2, lockoutDurationMs: 60_000, now: () => NOW };
        const replicaA = new LoginAttemptService(shared.db, options);
        const replicaB = new LoginAttemptService(shared.db, options);

        await Promise.all([
            replicaA.recordFailure(17, IP_A),
            replicaB.recordFailure(17, IP_A),
        ]);

        expect(shared.getRow(17, IP_A)?.lockedUntil).toEqual(new Date(NOW.getTime() + 60_000));
        await expect(replicaA.assertAllowed(17, IP_A)).rejects.toThrow('temporarily locked');
        await expect(replicaB.assertAllowed(17, IP_A)).rejects.toThrow('temporarily locked');
    });

    it('does not let failures from one IP lock the account for another IP', async () => {
        const shared = createSharedDatabase();
        const service = new LoginAttemptService(shared.db, { maxAttempts: 3, now: () => NOW });

        for (let i = 0; i < 3; i += 1) await service.recordFailure(5, IP_A);

        await expect(service.assertAllowed(5, IP_A)).rejects.toThrow('temporarily locked');
        await expect(service.assertAllowed(5, IP_B)).resolves.toBeUndefined();
        await expect(service.recordSuccess(5, IP_B)).resolves.toBeUndefined();
    });

    it('applies only a short per-user backoff when failures come from many IPs', async () => {
        let now = NOW;
        const shared = createSharedDatabase();
        const service = new LoginAttemptService(shared.db, {
            maxAttempts: 5,
            lockoutDurationMs: 15 * 60_000,
            globalMaxAttempts: 4,
            globalBackoffMs: 30_000,
            now: () => now,
        });

        for (let i = 0; i < 4; i += 1) await service.recordFailure(9, `192.0.2.${i}`);

        expect(shared.getRow(9, GLOBAL_IP_KEY)?.lockedUntil).toEqual(new Date(NOW.getTime() + 30_000));
        await expect(service.assertAllowed(9, IP_B)).rejects.toThrow('temporarily locked');

        now = new Date(NOW.getTime() + 31_000);
        await expect(service.assertAllowed(9, IP_B)).resolves.toBeUndefined();
    });

    it('does not let a verified request clear a lock established concurrently', async () => {
        const shared = createSharedDatabase();
        const service = new LoginAttemptService(shared.db, {
            maxAttempts: 1,
            lockoutDurationMs: 60_000,
            now: () => NOW,
        });

        await service.recordFailure(22, IP_A);

        await expect(service.recordSuccess(22, IP_A)).rejects.toThrow('temporarily locked');
        expect(shared.getRow(22, IP_A)?.lockedUntil).toEqual(new Date(NOW.getTime() + 60_000));
    });

    it('clears the IP and global rows after a successful login', async () => {
        const shared = createSharedDatabase();
        const service = new LoginAttemptService(shared.db, { maxAttempts: 5, now: () => NOW });
        await service.recordFailure(31, IP_A);
        await service.recordFailure(31, IP_B);

        await service.recordSuccess(31, IP_A);

        expect(shared.getRow(31, IP_A)).toBeNull();
        expect(shared.getRow(31, GLOBAL_IP_KEY)).toBeNull();
        expect(shared.getRow(31, IP_B)?.failedCount).toBe(1);
    });

    it('retries a MySQL deadlock without losing the failure increment', async () => {
        const shared = createSharedDatabase();
        const transaction = shared.db.$transaction as unknown as ReturnType<typeof jest.fn>;
        transaction.mockRejectedValueOnce({
            code: 'P2010',
            meta: { code: '1213' },
            message: 'Deadlock found when trying to get lock',
        });
        const service = new LoginAttemptService(shared.db, { maxAttempts: 5, now: () => NOW });

        await service.recordFailure(44, IP_A);

        expect(transaction).toHaveBeenCalledTimes(2);
        expect(shared.getRow(44, IP_A)?.failedCount).toBe(1);
        expect(shared.getRow(44, GLOBAL_IP_KEY)?.failedCount).toBe(1);
    });

    it('normalizes IPv4-mapped addresses and never collides with the global key', () => {
        expect(normalizeIpKey('::ffff:10.0.0.1')).toBe('10.0.0.1');
        expect(normalizeIpKey(undefined)).toBe('unknown');
        expect(normalizeIpKey(GLOBAL_IP_KEY)).toBe('unknown');
    });
});
