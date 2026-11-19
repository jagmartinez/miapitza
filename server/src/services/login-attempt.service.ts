import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../utils/prisma';

// Per (user, client IP): a single source guessing passwords is locked quickly.
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000;
// Per user across all IPs: a much higher threshold with only a short backoff,
// so a distributed attacker slows guessing without holding the owner out.
const DEFAULT_GLOBAL_MAX_ATTEMPTS = 50;
const DEFAULT_GLOBAL_BACKOFF_MS = 60 * 1000;
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** ipKey of the per-user global counter row. */
export const GLOBAL_IP_KEY = '*';
const UNKNOWN_IP_KEY = 'unknown';
const MAX_IP_KEY_LENGTH = 64;

type LoginAttemptDatabase = Pick<PrismaClient, '$transaction' | 'loginAttempt'>;

export interface LoginAttemptServiceOptions {
    maxAttempts?: number;
    lockoutDurationMs?: number;
    globalMaxAttempts?: number;
    globalBackoffMs?: number;
    staleAfterMs?: number;
    now?: () => Date;
}

export function normalizeIpKey(ip?: string | null): string {
    let value = typeof ip === 'string' ? ip.trim() : '';
    if (value.startsWith('::ffff:')) value = value.slice(7);
    if (!value || value === GLOBAL_IP_KEY) return UNKNOWN_IP_KEY;
    return value.slice(0, MAX_IP_KEY_LENGTH);
}

export class LoginAttemptService {
    private readonly maxAttempts: number;
    private readonly lockoutDurationMs: number;
    private readonly globalMaxAttempts: number;
    private readonly globalBackoffMs: number;
    private readonly staleAfterMs: number;
    private readonly now: () => Date;

    constructor(
        private readonly db: LoginAttemptDatabase = prisma,
        options: LoginAttemptServiceOptions = {},
    ) {
        this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.lockoutDurationMs = options.lockoutDurationMs ?? DEFAULT_LOCKOUT_MS;
        this.globalMaxAttempts = options.globalMaxAttempts ?? DEFAULT_GLOBAL_MAX_ATTEMPTS;
        this.globalBackoffMs = options.globalBackoffMs ?? DEFAULT_GLOBAL_BACKOFF_MS;
        this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
        this.now = options.now ?? (() => new Date());
    }

    private lockError(lockedUntil: Date): Error {
        const minutesLeft = Math.max(1, Math.ceil(
            (lockedUntil.getTime() - this.now().getTime()) / 60_000,
        ));
        return new Error(`Account temporarily locked. Try again in ${minutesLeft} minutes`);
    }

    private latestActiveLock(rows: Array<{ lockedUntil: Date | null }>, now: Date): Date | null {
        let latest: Date | null = null;
        for (const row of rows) {
            if (row.lockedUntil && row.lockedUntil > now && (!latest || row.lockedUntil > latest)) {
                latest = row.lockedUntil;
            }
        }
        return latest;
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

    /** Row keys in a fixed order ('*' sorts first) so replicas lock consistently. */
    private keysFor(ip?: string | null): string[] {
        return [GLOBAL_IP_KEY, normalizeIpKey(ip)];
    }

    async assertAllowed(userId: number, ip?: string | null): Promise<void> {
        const rows = await this.db.loginAttempt.findMany({
            where: { userId, ipKey: { in: this.keysFor(ip) } },
            select: { lockedUntil: true },
        });
        const lockedUntil = this.latestActiveLock(rows, this.now());
        if (lockedUntil) throw this.lockError(lockedUntil);
    }

    /**
     * Serialize both counter rows (per-IP and per-user global) with
     * SELECT ... FOR UPDATE. Authoritative across application replicas.
     */
    async recordFailure(userId: number, ip?: string | null): Promise<void> {
        const now = this.now();
        const [globalKey, ipKey] = this.keysFor(ip);
        for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
                await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
                    // Prisma 5 emulates some MySQL upserts with a read/create
                    // sequence. INSERT IGNORE provides an atomic seed row.
                    await tx.$executeRaw`
                        INSERT IGNORE INTO \`LoginAttempt\`
                            (\`userId\`, \`ipKey\`, \`failedCount\`, \`lastAttemptAt\`, \`createdAt\`, \`updatedAt\`)
                        VALUES
                            (${userId}, ${globalKey}, 0, ${now}, ${now}, ${now}),
                            (${userId}, ${ipKey}, 0, ${now}, ${now}, ${now})
                    `;
                    await tx.$queryRaw`
                        SELECT id FROM \`LoginAttempt\`
                        WHERE userId = ${userId} AND ipKey IN (${globalKey}, ${ipKey})
                        ORDER BY ipKey
                        FOR UPDATE
                    `;
                    const rows = await tx.loginAttempt.findMany({
                        where: { userId, ipKey: { in: [globalKey, ipKey] } },
                    });
                    for (const current of rows) {
                        // Do not shorten or continuously extend an active lock.
                        if (current.lockedUntil && current.lockedUntil > now) continue;
                        const isGlobal = current.ipKey === GLOBAL_IP_KEY;
                        const threshold = isGlobal ? this.globalMaxAttempts : this.maxAttempts;
                        const duration = isGlobal ? this.globalBackoffMs : this.lockoutDurationMs;
                        const nextCount = current.failedCount + 1;
                        const lockReached = nextCount >= threshold;
                        await tx.loginAttempt.update({
                            where: { id: current.id },
                            data: {
                                failedCount: lockReached ? 0 : nextCount,
                                lockedUntil: lockReached ? new Date(now.getTime() + duration) : null,
                                lastAttemptAt: now,
                            },
                        });
                    }
                });
                return;
            } catch (error) {
                if (attempt === 4 || !this.isRetryableTransactionError(error)) throw error;
                await this.waitBeforeRetry(attempt);
            }
        }
    }

    /**
     * A successful password/2FA verification also locks the rows before
     * clearing them. If another replica established a lock while verification
     * was running, this request cannot bypass that new lock. Counters from
     * other IPs are left in place: they belong to other sources.
     */
    async recordSuccess(userId: number, ip?: string | null): Promise<void> {
        const now = this.now();
        const [globalKey, ipKey] = this.keysFor(ip);
        await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.$queryRaw`
                SELECT id FROM \`LoginAttempt\`
                WHERE userId = ${userId} AND ipKey IN (${globalKey}, ${ipKey})
                ORDER BY ipKey
                FOR UPDATE
            `;
            const rows = await tx.loginAttempt.findMany({
                where: { userId, ipKey: { in: [globalKey, ipKey] } },
            });
            const lockedUntil = this.latestActiveLock(rows, now);
            if (lockedUntil) throw this.lockError(lockedUntil);
            if (rows.length > 0) {
                await tx.loginAttempt.deleteMany({
                    where: { userId, ipKey: { in: [globalKey, ipKey] } },
                });
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
