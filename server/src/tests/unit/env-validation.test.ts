import { describe, expect, it } from '@jest/globals';
import { collectEnvironmentErrors } from '../../utils/env-validation';

const validProductionEnv = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a-production-secret-with-more-than-32-bytes',
    TWO_FA_ENCRYPTION_KEY: 'a'.repeat(64),
    CLIENT_URL: 'https://restaurant.example.com',
    PLATFORM_TENANCY_MODE: 'single',
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

    it('requires an explicit tenancy mode in production', () => {
        const env = { ...validProductionEnv };
        delete env.PLATFORM_TENANCY_MODE;
        expect(collectEnvironmentErrors(env)).toContain(
            'PLATFORM_TENANCY_MODE is required in production (single or multi).',
        );
    });

    it('requires a valid operator company in multi mode and forbids it in single mode', () => {
        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            PLATFORM_TENANCY_MODE: 'multi',
        })).toContain('PLATFORM_ADMIN_COMPANY_ID is required in multi tenancy mode.');
        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            PLATFORM_ADMIN_COMPANY_ID: '1',
        })).toContain('PLATFORM_ADMIN_COMPANY_ID must be empty in single tenancy mode.');
        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            PLATFORM_TENANCY_MODE: 'multi',
            PLATFORM_ADMIN_COMPANY_ID: '1',
        })).toEqual([]);
    });

    it('forbids fake face verification in production', () => {
        const errors = collectEnvironmentErrors({
            ...validProductionEnv,
            HR_FACE_PROVIDER: 'fake',
            HR_ALLOW_FAKE_FACE_PROVIDER: 'true',
            HR_BIOMETRIC_ENCRYPTION_KEY: 'b'.repeat(64),
        });
        expect(errors).toContain('The fake face provider is forbidden in production.');
    });

    it('requires a biometric encryption key when a face provider is enabled', () => {
        const errors = collectEnvironmentErrors({
            ...validProductionEnv,
            NODE_ENV: 'development',
            HR_FACE_PROVIDER: 'fake',
            HR_ALLOW_FAKE_FACE_PROVIDER: 'true',
        });
        expect(errors).toContain('HR_BIOMETRIC_ENCRYPTION_KEY must be a 64-character hexadecimal key when facial verification is enabled.');
    });
});
