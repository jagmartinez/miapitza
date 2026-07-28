import { Prisma } from '@prisma/client';
import prisma from './prisma';

const DEFAULT_MAX_ATTEMPTS = 3;

type TransactionOptions = {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
};

function isP2034(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: unknown }).code === 'P2034';
}

/**
 * Replays the complete interactive transaction only when Prisma confirms a
 * write conflict/deadlock (P2034). Domain, validation and infrastructure
 * errors are returned unchanged and are never retried.
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
            if (!isP2034(error) || attempt === maxAttempts) throw error;
        }
    }

    throw new Error('Unreachable transaction retry state');
}
