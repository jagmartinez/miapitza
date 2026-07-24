import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../utils/prisma';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

type LoginAttemptDatabase = Pick<PrismaClient, '$transaction' | 'loginAttempt'>;

export interface LoginAttemptServiceOptions {
    maxAttempts?: number;
    lockoutDurationMs?: number;
    staleAfterMs?: number;
    now?: () => Date;
}

export class LoginAttemptService {
    private readonly maxAttempts: number;
    private readonly lockoutDurationMs: number;
    private readonly staleAfterMs: number;
    private readonly now: () => Date;

    constructor(
        private readonly db: LoginAttemptDatabase = prisma,
        options: LoginAttemptServiceOptions = {},
    ) {
        this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.lockoutDurationMs = options.lockoutDurationMs ?? DEFAULT_LOCKOUT_MS;
        this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
        this.now = options.now ?? (() => new Date());
    }

    private lockError(lockedUntil: Date): Error {
        const minutesLeft = Math.max(1, Math.ceil(
            (lockedUntil.getTime() - this.now().getTime()) / 60_000,
        ));
        return new Error(`Account temporarily locked. Try again in ${minutesLeft} minutes`);
    }

    private isRetryableTransactionError(error: unknown): boolean {
        if (!error || typeof error !== 'object') return false;
        const candidate = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
        return candidate.code === 'P2034'
            || candidate.meta?.code === '1213'
            || (typeof candidate.message === 'string' && /deadlock/i.test(candidate.message));
    }

    private async waitBeforeRetry(attempt: number): Promise<void> {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, Math.min(10 * (2 ** attempt), 160));
        });
    }

    async assertAllowed(userId: number): Promise<void> {
        const attempt = await this.db.loginAttempt.findUnique({
            where: { userId },
            select: { lockedUntil: true },
        });
        if (attempt?.lockedUntil && attempt.lockedUntil > this.now()) {
            throw this.lockError(attempt.lockedUntil);
        }
    }

    /**
     * Serialize the counter row with SELECT ... FOR UPDATE. This is the
     * authoritative increment used by every application replica.
     */
    async recordFailure(userId: number): Promise<void> {
        const now = this.now();
        for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
                await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
                    // Prisma 5 emulates some MySQL upserts with a read/create
                    // sequence. INSERT IGNORE provides an atomic seed row.
                    await tx.$executeRaw`
                        INSERT IGNORE INTO \`LoginAttempt\`
                            (\`userId\`, \`failedCount\`, \`lastAttemptAt\`, \`createdAt\`, \`updatedAt\`)
                        VALUES
                            (${userId}, 0, ${now}, ${now}, ${now})
                    `;
                    await tx.$queryRaw`SELECT userId FROM \`LoginAttempt\` WHERE userId = ${userId} FOR UPDATE`;
                    const current = await tx.loginAttempt.findUniqueOrThrow({ where: { userId } });

                    // Do not shorten or continuously extend an active lock.
                    if (current.lockedUntil && current.lockedUntil > now) return;

                    const nextCount = current.failedCount + 1;
                    const lockReached = nextCount >= this.maxAttempts;
                    await tx.loginAttempt.update({
                        where: { userId },
                        data: {
                            failedCount: lockReached ? 0 : nextCount,
                            lockedUntil: lockReached
                                ? new Date(now.getTime() + this.lockoutDurationMs)
                                : null,
                            lastAttemptAt: now,
                        },
                    });
                });
                return;
            } catch (error) {
                if (attempt === 4 || !this.isRetryableTransactionError(error)) throw error;
                await this.waitBeforeRetry(attempt);
            }
        }
    }

    /**
     * A successful password/2FA verification also locks the row before clearing
     * it. If another replica established a lock while verification was running,
     * this request cannot bypass that new lock.
     */
    async recordSuccess(userId: number): Promise<void> {
        const now = this.now();
        await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`SELECT userId FROM \`LoginAttempt\` WHERE userId = ${userId} FOR UPDATE`;
            const current = await tx.loginAttempt.findUnique({ where: { userId } });
            if (current?.lockedUntil && current.lockedUntil > now) {
                throw this.lockError(current.lockedUntil);
            }
            if (current) {
                await tx.loginAttempt.delete({ where: { userId } });
            }
        });
    }

    async purgeStale(): Promise<number> {
        const cutoff = new Date(this.now().getTime() - this.staleAfterMs);
        const result = await this.db.loginAttempt.deleteMany({
            where: {
                lastAttemptAt: { lte: cutoff },
                OR: [{ lockedUntil: null }, { lockedUntil: { lte: this.now() } }],
            },
        });
        return result.count;
    }
}

export const loginAttemptService = new LoginAttemptService();
