import { describe, expect, it, jest } from '@jest/globals';
import type { FileCleanupTask, PrismaClient } from '@prisma/client';
import { FileCleanupService, UnsafeStorageKeyError } from '../../services/file-cleanup.service';

type Task = FileCleanupTask;

function createOutboxDatabase(initial?: Task) {
    const tasks = new Map<string, Task>();
    if (initial) tasks.set(initial.id, initial);

    const matches = (task: Task, where: Record<string, unknown>): boolean => {
        if (where.id !== undefined && task.id !== where.id) return false;
        if (where.companyId !== undefined && task.companyId !== where.companyId) return false;
        if (where.area !== undefined && task.area !== where.area) return false;
        if (where.storageKey !== undefined && task.storageKey !== where.storageKey) return false;
        if (where.claimToken !== undefined && task.claimToken !== where.claimToken) return false;
        if (where.status !== undefined) {
            const condition = where.status as string | { in: string[] };
            if (typeof condition === 'string' ? task.status !== condition : !condition.in.includes(task.status)) {
                return false;
            }
        }
        if (where.leaseUntil && typeof where.leaseUntil === 'object') {
            const lte = (where.leaseUntil as { lte: Date }).lte;
            if (!task.leaseUntil || task.leaseUntil > lte) return false;
        }
        return true;
    };
    const applyData = (task: Task, data: Record<string, unknown>): Task => {
        const attempts = data.attempts && typeof data.attempts === 'object'
            ? task.attempts + Number((data.attempts as { increment: number }).increment)
            : data.attempts ?? task.attempts;
        return {
            ...task,
            ...data,
            attempts: Number(attempts),
            updatedAt: new Date(),
        } as Task;
    };

    const model = {
        upsert: jest.fn(async (args: {
            where: { companyId_area_storageKey: { companyId: number; area: Task['area']; storageKey: string } };
            create: Partial<Task> & Pick<Task, 'companyId' | 'area' | 'storageKey' | 'reason' | 'status'>;
            update: Record<string, unknown>;
        }) => {
            const key = args.where.companyId_area_storageKey;
            const existing = [...tasks.values()].find((task) =>
                task.companyId === key.companyId
                && task.area === key.area
                && task.storageKey === key.storageKey);
            if (existing) {
                const changed = applyData(existing, args.update);
                tasks.set(existing.id, changed);
                return changed;
            }
            const now = new Date();
            const created = {
                id: `task-${tasks.size + 1}`,
                attempts: 0,
                nextAttemptAt: null,
                leaseUntil: null,
                claimToken: null,
                lastError: null,
                completedAt: null,
                createdAt: now,
                updatedAt: now,
                ...args.create,
            } as Task;
            tasks.set(created.id, created);
            return created;
        }),
        findUnique: jest.fn(async (args: {
            where: { id?: string; companyId_area_storageKey?: { companyId: number; area: Task['area']; storageKey: string } };
            select?: { id: boolean };
        }) => {
            const task = args.where.id
                ? tasks.get(args.where.id)
                : [...tasks.values()].find((candidate) => {
                    const key = args.where.companyId_area_storageKey!;
                    return candidate.companyId === key.companyId
                        && candidate.area === key.area
                        && candidate.storageKey === key.storageKey;
                });
            if (!task) return null;
            return args.select ? { id: task.id } : task;
        }),
        updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            let count = 0;
            for (const [id, task] of tasks) {
                if (!matches(task, args.where)) continue;
                tasks.set(id, applyData(task, args.data));
                count += 1;
            }
            return { count };
        }),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        findMany: jest.fn(async (args: { where: Record<string, unknown>; take: number }) => {
            const now = ((args.where.OR as Array<{ nextAttemptAt?: { lte?: Date } }>)[1]
                ?.nextAttemptAt?.lte) ?? new Date();
            return [...tasks.values()]
                .filter((task) =>
                    ['PENDING', 'FAILED'].includes(task.status)
                    && (!task.nextAttemptAt || task.nextAttemptAt <= now))
                .slice(0, args.take)
                .map(({ id }) => ({ id }));
        }),
    };
    const db = { fileCleanupTask: model } as unknown as Pick<PrismaClient, 'fileCleanupTask'>;
    return {
        db,
        task: () => [...tasks.values()][0],
    };
}

function task(overrides: Partial<Task> = {}): Task {
    const now = new Date('2026-07-23T12:00:00.000Z');
    return {
        id: 'task-1',
        companyId: 3,
        area: 'LOGO',
        storageKey: 'logo-100-200.png',
        status: 'PENDING',
        reason: 'TEST',
        attempts: 0,
        nextAttemptAt: now,
        leaseUntil: null,
        claimToken: null,
        lastError: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe('FileCleanupService', () => {
    it('persists a failed unlink and retries it successfully in a later cycle', async () => {
        let now = new Date('2026-07-23T12:00:00.000Z');
        const shared = createOutboxDatabase(task());
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const unlinkFile = jest.fn<(filePath: string) => Promise<void>>()
            .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
            .mockResolvedValueOnce(undefined);
        const service = new FileCleanupService(shared.db, {
            now: () => now,
            unlinkFile,
        });

        await expect(service.processTask('task-1')).resolves.toBe(false);
        expect(shared.task().status).toBe('FAILED');
        expect(shared.task().lastError).toBe('Error:EACCES');
        expect(errorLog).toHaveBeenCalledWith(
            expect.stringContaining('retry scheduled'),
            expect.objectContaining({ taskId: 'task-1', companyId: 3, area: 'LOGO' }),
        );

        now = new Date(shared.task().nextAttemptAt!.getTime() + 1);
        await expect(service.runDue()).resolves.toEqual({ examined: 1, completed: 1 });
        expect(shared.task().status).toBe('COMPLETED');
        expect(unlinkFile).toHaveBeenCalledTimes(2);
    });

    it('recovers an expired worker lease and converges ENOENT as success', async () => {
        const now = new Date('2026-07-23T12:00:00.000Z');
        const shared = createOutboxDatabase(task({
            status: 'PROCESSING',
            claimToken: 'abandoned',
            leaseUntil: new Date(now.getTime() - 1),
        }));
        const unlinkFile = jest.fn<(filePath: string) => Promise<void>>()
            .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        const service = new FileCleanupService(shared.db, { now: () => now, unlinkFile });

        await expect(service.runDue()).resolves.toEqual({ examined: 1, completed: 1 });
        expect(shared.task().status).toBe('COMPLETED');
        expect(shared.task().lastError).toBeNull();
    });

    it('allows only one replica to claim the same deletion', async () => {
        const now = new Date('2026-07-23T12:00:00.000Z');
        const shared = createOutboxDatabase(task());
        const unlinkFile = jest.fn<(filePath: string) => Promise<void>>().mockResolvedValue(undefined);
        const replicaA = new FileCleanupService(shared.db, { now: () => now, unlinkFile });
        const replicaB = new FileCleanupService(shared.db, { now: () => now, unlinkFile });

        const results = await Promise.all([
            replicaA.processTask('task-1'),
            replicaB.processTask('task-1'),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        expect(unlinkFile).toHaveBeenCalledTimes(1);
        expect(shared.task().status).toBe('COMPLETED');
    });

    it('rejects cross-tenant or traversal-like document keys before touching disk', async () => {
        const shared = createOutboxDatabase();
        const unlinkFile = jest.fn<(filePath: string) => Promise<void>>();
        const service = new FileCleanupService(shared.db, { unlinkFile });

        await expect(service.reserveUpload(3, 'HR_DOCUMENT', '4/9/00000000-0000-0000-0000-000000000000.pdf'))
            .rejects.toBeInstanceOf(UnsafeStorageKeyError);
        await expect(service.reserveUpload(3, 'HR_DOCUMENT', '3/9/../secret.pdf'))
            .rejects.toBeInstanceOf(UnsafeStorageKeyError);
        expect(unlinkFile).not.toHaveBeenCalled();
    });
});
