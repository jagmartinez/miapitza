/** Stable operation key generator shared by financial mutations. */
export function newIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export interface IdempotentAttempt {
    fingerprint: string;
    key: string;
}

/** Reuse a key only for the exact same logical request after an ambiguous failure. */
export function getIdempotentAttempt(
    current: IdempotentAttempt | null,
    fingerprint: string,
): IdempotentAttempt {
    if (current?.fingerprint === fingerprint) return current;
    return { fingerprint, key: newIdempotencyKey() };
}

/**
 * True when a failed mutation may or may not have been applied server-side
 * (network loss, timeout, 5xx, in-flight conflict). Only then must a retry of
 * the same action reuse its key; a definitive rejection starts a fresh attempt.
 */
export function isAmbiguousMutationFailure(error: unknown): boolean {
    const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
    if (typeof status !== 'number') return true;
    return status >= 500 || status === 408 || status === 409 || status === 429;
}
