import { describe, expect, it } from 'vitest';
import { getIdempotentAttempt, isAmbiguousMutationFailure } from './idempotency';

describe('ambiguous mutation idempotency', () => {
    it('reuses the key only while the logical request is identical', () => {
        const first = getIdempotentAttempt(null, 'payment:1:100');
        expect(getIdempotentAttempt(first, 'payment:1:100')).toBe(first);
        expect(getIdempotentAttempt(first, 'payment:1:120').key).not.toBe(first.key);
    });
});

describe('isAmbiguousMutationFailure', () => {
    it('keeps the key for network loss, timeouts, conflicts and server errors', () => {
        expect(isAmbiguousMutationFailure(new Error('Network Error'))).toBe(true);
        expect(isAmbiguousMutationFailure({ response: { status: 502 } })).toBe(true);
        expect(isAmbiguousMutationFailure({ response: { status: 408 } })).toBe(true);
        expect(isAmbiguousMutationFailure({ response: { status: 409 } })).toBe(true);
        expect(isAmbiguousMutationFailure({ response: { status: 429 } })).toBe(true);
        // P2034 deadlock: rolled back server-side, retry must reuse the key.
        expect(isAmbiguousMutationFailure({ response: { status: 503, data: { code: 'CONCURRENT_UPDATE' } } })).toBe(true);
        expect(isAmbiguousMutationFailure({ response: { status: 409, data: { code: 'IDEMPOTENCY_IN_PROGRESS' } } })).toBe(true);
    });

    it('drops the key after a definitive client rejection', () => {
        expect(isAmbiguousMutationFailure({ response: { status: 400 } })).toBe(false);
        expect(isAmbiguousMutationFailure({ response: { status: 403 } })).toBe(false);
        expect(isAmbiguousMutationFailure({ response: { status: 422 } })).toBe(false);
    });
});
