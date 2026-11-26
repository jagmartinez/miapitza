import { describe, expect, it } from '@jest/globals';

import { safeReadinessDetails } from '../../utils/release-readiness-diagnostics';

describe('release operational harness diagnostics', () => {
    it('keeps failing readiness checks visible without emitting arbitrary fields', () => {
        const details = safeReadinessDetails({
            success: false,
            secret: 'outer-secret',
            data: {
                status: 'degraded',
                checks: {
                    database: { status: 'ok', latencyMs: 3, connectionString: 'mysql://secret' },
                    biometric: {
                        status: 'error',
                        required: true,
                        provider: 'disabled',
                        model: 'none',
                        version: 'none',
                        token: 'provider-secret',
                    },
                    storage: {
                        status: 'ok',
                        required: false,
                        mode: 'local-development',
                        verified: false,
                        identityHash: 'internal-hash',
                    },
                },
            },
        });

        expect(details).toEqual({
            status: 'degraded',
            checks: {
                database: { status: 'ok' },
                biometric: {
                    status: 'error',
                    required: true,
                    provider: 'disabled',
                    model: 'none',
                    version: 'none',
                },
                storage: {
                    status: 'ok',
                    required: false,
                    mode: 'local-development',
                    verified: false,
                },
            },
        });
        expect(JSON.stringify(details)).not.toMatch(/secret|connectionString|token|identityHash/);
    });

    it('returns null for an unexpected readiness payload', () => {
        expect(safeReadinessDetails({ success: false, message: 'unstructured' })).toBeNull();
    });
});
