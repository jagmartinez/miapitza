import { describe, expect, it } from '@jest/globals';
import { collectEnvironmentErrors } from '../../utils/env-validation';

const validProductionEnv = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a-production-secret-with-more-than-32-bytes',
    TWO_FA_ENCRYPTION_KEY: 'a'.repeat(64),
    CLIENT_URL: 'https://restaurant.example.com',
} as NodeJS.ProcessEnv;

describe('production environment validation', () => {
    it('rejects the public JWT placeholder shipped in the example environment', () => {
        const errors = collectEnvironmentErrors({
            ...validProductionEnv,
            JWT_SECRET: 'change-me-to-a-long-random-secret',
        });

        expect(errors).toContain('JWT_SECRET is set to a known-weak default; use a long random secret.');
    });

    it('accepts a non-placeholder secret with the required production controls', () => {
        expect(collectEnvironmentErrors(validProductionEnv)).toEqual([]);
    });

});
