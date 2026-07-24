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
