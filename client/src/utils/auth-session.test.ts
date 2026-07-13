import { describe, expect, it } from 'vitest';
import { isAuthoritativeSessionFailure } from './auth-session';

describe('isAuthoritativeSessionFailure', () => {
    it('accepts only an explicit HTTP 401 as proof that the session is invalid', () => {
        expect(isAuthoritativeSessionFailure({ response: { status: 401 } })).toBe(true);
        expect(isAuthoritativeSessionFailure({ response: { status: 500 } })).toBe(false);
        expect(isAuthoritativeSessionFailure(new Error('Network Error'))).toBe(false);
        expect(isAuthoritativeSessionFailure(undefined)).toBe(false);
    });
});
