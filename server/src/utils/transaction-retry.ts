import { Prisma } from '@prisma/client';
import prisma from './prisma';

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 250;

type TransactionOptions = {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
};

/**
 * Interactive-transaction budget for settlement paths (payment, kitchen
 * release) that may also auto-deliver the order and consume its inventory.
 * Prisma's 5 s default is too tight for large orders.
 */
export const SETTLEMENT_TRANSACTION_OPTIONS: TransactionOptions = { maxWait: 5_000, timeout: 20_000 };

// MySQL/MariaDB: 1213 = ER_LOCK_DEADLOCK, 1205 = ER_LOCK_WAIT_TIMEOUT.
const RETRYABLE_MYSQL_CODES = new Set(['1213', '1205']);
const RETRYABLE_MESSAGE = /deadlock found|lock wait timeout exceeded|\b1213\b|\b1205\b/i;

/**
 * True only for transient lock conflicts that are safe to replay as a whole
 * interactive transaction:
 *  - P2034: Prisma write conflict / deadlock on typed queries.
 *  - P2010: raw query failure (e.g. `SELECT ... FOR UPDATE`) whose MySQL code
 *    is 1213 (deadlock) or 1205 (lock wait timeout). MySQL already rolled the
 *    victim transaction back (1213) or the statement (1205; Prisma then
 *    aborts the interactive transaction), so a full replay is consistent.
 * Domain, validation and other infrastructure errors are never retried.
 */
export function isRetryableTransactionError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const { code, meta, message } = error as { code?: unknown; meta?: unknown; message?: unknown };
    if (code === 'P2034') return true;
    if (code !== 'P2010') return false;
    const metaRecord = (meta && typeof meta === 'object') ? meta as Record<string, unknown> : {};
    const metaCode = metaRecord.code === undefined || metaRecord.code === null ? '' : String(metaRecord.code);
    if (RETRYABLE_MYSQL_CODES.has(metaCode)) return true;
    const texts = [metaRecord.message, message].filter((value): value is string => typeof value === 'string');
    return texts.some((text) => RETRYABLE_MESSAGE.test(text));
}

function backoffDelay(attempt: number): number {
    const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
    // Full jitter keeps two colliding transactions from replaying in lockstep.
    return Math.floor(Math.random() * ceiling) + 1;
}

/**
 * Replays the complete interactive transaction only on transient lock
 * conflicts (see isRetryableTransactionError), bounded by maxAttempts with
 * jittered exponential backoff. The operation must only write through `tx`.
 */
export async function transactionWithP2034Retry<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TransactionOptions,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new Error('maxAttempts must be a positive integer');
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return options
                ? await prisma.$transaction(operation, options)
                : await prisma.$transaction(operation);
        } catch (error) {
            if (!isRetryableTransactionError(error) || attempt === maxAttempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt)));
        }
    }

    throw new Error('Unreachable transaction retry state');
}

/** Alias with a name that reflects the broader retry policy. */
export const transactionWithLockRetry = transactionWithP2034Retry;
