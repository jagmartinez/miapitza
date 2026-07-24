import { describe, expect, it } from 'vitest';
import { getIdempotentAttempt } from './idempotency';

describe('ambiguous mutation idempotency', () => {
    it('reuses the key only while the logical request is identical', () => {
        const first = getIdempotentAttempt(null, 'payment:1:100');
        expect(getIdempotentAttempt(first, 'payment:1:100')).toBe(first);
        expect(getIdempotentAttempt(first, 'payment:1:120').key).not.toBe(first.key);
    });
});
