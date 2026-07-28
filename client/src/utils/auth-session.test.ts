import { describe, expect, it } from 'vitest';
import { isAuthoritativeSessionFailure, normalizeSessionRoles } from './auth-session';

describe('isAuthoritativeSessionFailure', () => {
    it('accepts only an explicit HTTP 401 as proof that the session is invalid', () => {
        expect(isAuthoritativeSessionFailure({ response: { status: 401 } })).toBe(true);
        expect(isAuthoritativeSessionFailure({ response: { status: 500 } })).toBe(false);
        expect(isAuthoritativeSessionFailure(new Error('Network Error'))).toBe(false);
        expect(isAuthoritativeSessionFailure(undefined)).toBe(false);
    });
});

describe('normalizeSessionRoles', () => {
    it('distinguishes an omitted role payload from an explicit revocation', () => {
        expect(normalizeSessionRoles(undefined)).toBeUndefined();
        expect(normalizeSessionRoles([])).toEqual([]);
        expect(normalizeSessionRoles([null, { name: '' }])).toEqual([]);
    });

    it('normalizes string, role and nested user-role payloads', () => {
        expect(normalizeSessionRoles([
            'ADMIN',
            { id: 7, name: 'CAJERO' },
            { role: { id: 9, name: 'MESERO' } },
        ])).toEqual([
            { id: 0, name: 'ADMIN' },
            { id: 7, name: 'CAJERO' },
            { id: 9, name: 'MESERO' },
        ]);
    });
});
