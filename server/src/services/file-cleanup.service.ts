import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
    FileCleanupStatus,
    FileStorageArea,
    Prisma,
    PrismaClient,
} from '@prisma/client';
import prisma from '../utils/prisma';
import { getUploadsDir } from '../utils/storage';

const RESERVATION_GRACE_MS = 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type FileCleanupDatabase = Pick<PrismaClient, 'fileCleanupTask'>;
type OutboxTransaction = Pick<Prisma.TransactionClient, 'fileCleanupTask'>;
type UnlinkFile = (filePath: string) => Promise<void>;

export interface FileCleanupServiceOptions {
    now?: () => Date;
    unlinkFile?: UnlinkFile;
}

export class UnsafeStorageKeyError extends Error {
    constructor() {
        super('La referencia del archivo no pertenece al almacenamiento autorizado');
        this.name = 'UnsafeStorageKeyError';
    }
}

function isDue(status: FileCleanupStatus, nextAttemptAt: Date | null, now: Date): boolean {
    return (status === 'PENDING' || status === 'FAILED')
        && (!nextAttemptAt || nextAttemptAt <= now);
}

export class FileCleanupService {
    private readonly now: () => Date;
    private readonly unlinkFile: UnlinkFile;

    constructor(
        private readonly db: FileCleanupDatabase = prisma,
        options: FileCleanupServiceOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.unlinkFile = options.unlinkFile ?? unlink;
    }

    private resolve(companyId: number, area: FileStorageArea, storageKey: string): string {
        if (!Number.isInteger(companyId) || companyId <= 0) throw new UnsafeStorageKeyError();

        let root: string;
        let segments: string[];
        if (area === 'INVOICE') {
            if (!/^invoice-\d+-\d+\.(pdf|jpg|png|webp)$/i.test(storageKey)) {
                throw new UnsafeStorageKeyError();
            }
            root = path.resolve(getUploadsDir('invoices'));
            segments = [storageKey];
        } else if (area === 'LOGO') {
            if (!/^logo-\d+-\d+\.(jpeg|jpg|png|webp)$/i.test(storageKey)) {
                throw new UnsafeStorageKeyError();
            }
            root = path.resolve(getUploadsDir());
            segments = [storageKey];
        } else {
            segments = storageKey.split('/');
            if (
                segments.length !== 3
                || segments[0] !== String(companyId)
                || !/^\d+$/.test(segments[1])
                || !/^[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(segments[2])
            ) {
                throw new UnsafeStorageKeyError();
            }
            root = path.resolve(getUploadsDir('hr-documents'));
        }

        const resolved = path.resolve(root, ...segments);
        if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
            throw new UnsafeStorageKeyError();
        }
        return resolved;
    }

    async reserveUpload(
        companyId: number,
        area: FileStorageArea,
        storageKey: string,
        reason = 'UPLOAD_RESERVATION',
    ): Promise<void> {
        this.resolve(companyId, area, storageKey);
        const now = this.now();
        await this.db.fileCleanupTask.upsert({
            where: { companyId_area_storageKey: { companyId, area, storageKey } },
            create: {
                companyId,
                area,
                storageKey,
                reason,
                status: 'PENDING',
                nextAttemptAt: new Date(now.getTime() + RESERVATION_GRACE_MS),
            },
            update: {
                reason,
                status: 'PENDING',
                attempts: 0,
                nextAttemptAt: new Date(now.getTime() + RESERVATION_GRACE_MS),
                leaseUntil: null,
                claimToken: null,
                lastError: null,
                completedAt: null,
            },
        });
    }

    async cancelReservation(
        tx: OutboxTransaction,
        companyId: number,
        area: FileStorageArea,
        storageKey: string,
    ): Promise<void> {
        this.resolve(companyId, area, storageKey);
        const changed = await tx.fileCleanupTask.updateMany({
            where: {
                companyId,
                area,
                storageKey,
                status: { in: ['PENDING', 'FAILED'] },
            },
            data: {
                status: 'CANCELLED',
                nextAttemptAt: null,
                leaseUntil: null,
                claimToken: null,
                lastError: null,
            },
        });
        if (changed.count !== 1) {
            throw new Error('No existe una reserva de archivo activa para confirmar');
        }
    }

    async requestDeletion(
        tx: OutboxTransaction,
        companyId: number,
        area: FileStorageArea,
        storageKey: string,
        reason: string,
    ): Promise<void> {
        this.resolve(companyId, area, storageKey);
        await tx.fileCleanupTask.upsert({
            where: { companyId_area_storageKey: { companyId, area, storageKey } },
            create: {
                companyId,
                area,
                storageKey,
                reason: reason.slice(0, 100),
                status: 'PENDING',
                nextAttemptAt: this.now(),
            },
            update: {
                reason: reason.slice(0, 100),
                status: 'PENDING',
                nextAttemptAt: this.now(),
                leaseUntil: null,
                claimToken: null,
                lastError: null,
                completedAt: null,
            },
        });
    }

    private retryAt(attempts: number): Date {
        const delay = Math.min(30_000 * (2 ** Math.min(Math.max(attempts - 1, 0), 11)), MAX_BACKOFF_MS);
        return new Date(this.now().getTime() + delay);
    }

    private safeError(error: unknown): string {
        const type = error instanceof Error ? error.name : typeof error;
        const code = error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'UNKNOWN';
        return `${type}:${code}`.slice(0, 1000);
    }

    async processTask(id: string, force = false): Promise<boolean> {
        const candidate = await this.db.fileCleanupTask.findUnique({ where: { id } });
        if (!candidate) return false;
        const now = this.now();
        if (!force && !isDue(candidate.status, candidate.nextAttemptAt, now)) return false;
        if (force && candidate.status !== 'PENDING' && candidate.status !== 'FAILED') return false;

        // Compare-and-swap claim: exactly one replica owns the filesystem side
        // effect until the bounded lease expires.
        const claimToken = randomUUID();
        const claimed = await this.db.fileCleanupTask.updateMany({
            where: { id, status: candidate.status, claimToken: candidate.claimToken },
            data: {
                status: 'PROCESSING',
                claimToken,
                leaseUntil: new Date(now.getTime() + LEASE_MS),
                attempts: { increment: 1 },
            },
        });
        if (claimed.count !== 1) return false;

        const active = await this.db.fileCleanupTask.findUnique({ where: { id } });
        if (!active || active.claimToken !== claimToken) return false;

        try {
            const absolutePath = this.resolve(active.companyId, active.area, active.storageKey);
            await this.unlinkFile(absolutePath).catch((error: unknown) => {
                const code = error && typeof error === 'object' && 'code' in error
                    ? String(error.code)
                    : '';
                if (code !== 'ENOENT') throw error;
            });
            await this.db.fileCleanupTask.updateMany({
                where: { id, status: 'PROCESSING', claimToken },
                data: {
                    status: 'COMPLETED',
                    completedAt: this.now(),
                    nextAttemptAt: null,
                    leaseUntil: null,
                    claimToken: null,
                    lastError: null,
                },
            });
            return true;
        } catch (error) {
            await this.db.fileCleanupTask.updateMany({
                where: { id, status: 'PROCESSING', claimToken },
                data: {
                    status: 'FAILED',
                    nextAttemptAt: this.retryAt(active.attempts),
                    leaseUntil: null,
                    claimToken: null,
                    lastError: this.safeError(error),
                },
            });
            console.error('[FileCleanup] Durable deletion failed; retry scheduled', {
                taskId: id,
                companyId: active.companyId,
                area: active.area,
                attempts: active.attempts,
                error: this.safeError(error),
            });
            return false;
        }
    }

    async processByStorageKey(
        companyId: number,
        area: FileStorageArea,
        storageKey: string,
    ): Promise<boolean> {
        const task = await this.db.fileCleanupTask.findUnique({
            where: { companyId_area_storageKey: { companyId, area, storageKey } },
            select: { id: true },
        });
        return task ? this.processTask(task.id, true) : false;
    }

    async runDue(limit = 50): Promise<{ examined: number; completed: number }> {
        const now = this.now();
        await this.db.fileCleanupTask.deleteMany({
            where: {
                status: { in: ['COMPLETED', 'CANCELLED'] },
                updatedAt: { lte: new Date(now.getTime() - TERMINAL_RETENTION_MS) },
            },
        });
        await this.db.fileCleanupTask.updateMany({
            where: { status: 'PROCESSING', leaseUntil: { lte: now } },
            data: {
                status: 'FAILED',
                nextAttemptAt: now,
                leaseUntil: null,
                claimToken: null,
                lastError: 'LeaseExpired:WORKER_INTERRUPTED',
            },
        });
        const due = await this.db.fileCleanupTask.findMany({
            where: {
                status: { in: ['PENDING', 'FAILED'] },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
            take: Math.max(1, Math.min(limit, 200)),
            select: { id: true },
        });
        let completed = 0;
        for (const task of due) {
            if (await this.processTask(task.id)) completed += 1;
        }
        return { examined: due.length, completed };
    }
}

export const fileCleanupService = new FileCleanupService();
