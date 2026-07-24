import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { collectEnvironmentErrors } from '../../utils/env-validation';

const validProductionEnv = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a-production-secret-with-more-than-32-bytes',
    TWO_FA_ENCRYPTION_KEY: 'a'.repeat(64),
    CLIENT_URL: 'https://restaurant.example.com',
    PLATFORM_TENANCY_MODE: 'single',
    STORAGE_DIR: path.resolve(process.cwd(), 'storage-production-test'),
    STORAGE_SHARED_ID: 'restaurant-production-primary',
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

    it('accepts a fully configured HTTPS face provider in production', () => {
        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            HR_FACE_PROVIDER: 'http',
            HR_FACE_PROVIDER_BASE_URL: 'https://faces.internal.example',
            HR_FACE_PROVIDER_TOKEN: 'provider-token-with-at-least-32-bytes',
            HR_FACE_PROVIDER_MODEL: 'buffalo_l',
            HR_FACE_PROVIDER_VERSION: '1.2.3',
            HR_FACE_PROVIDER_TIMEOUT_MS: '5000',
            HR_BIOMETRIC_ENCRYPTION_KEY: 'b'.repeat(64),
        })).toEqual([]);
    });

    it('rejects incomplete or insecure HTTP face-provider configuration', () => {
        const incomplete = collectEnvironmentErrors({
            ...validProductionEnv,
            HR_FACE_PROVIDER: 'http',
        });
        expect(incomplete).toEqual(expect.arrayContaining([
            'HR_FACE_PROVIDER_BASE_URL is required for the http face provider.',
            'HR_FACE_PROVIDER_TOKEN is required for the http face provider.',
            'HR_BIOMETRIC_ENCRYPTION_KEY must be a 64-character hexadecimal key when facial verification is enabled.',
        ]));

        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            HR_FACE_PROVIDER: 'http',
            HR_FACE_PROVIDER_BASE_URL: 'http://faces.internal.example',
            HR_FACE_PROVIDER_TOKEN: 'provider-token-with-at-least-32-bytes',
            HR_BIOMETRIC_ENCRYPTION_KEY: 'b'.repeat(64),
        })).toContain('HR_FACE_PROVIDER_BASE_URL must use HTTPS in production.');

        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            HR_FACE_PROVIDER: 'http',
            HR_FACE_PROVIDER_BASE_URL: 'http://faces.public.example',
            HR_FACE_PROVIDER_ALLOW_HTTP_INTERNAL: 'true',
            HR_FACE_PROVIDER_TOKEN: 'provider-token-with-at-least-32-bytes',
            HR_BIOMETRIC_ENCRYPTION_KEY: 'b'.repeat(64),
        })).toContain('HR_FACE_PROVIDER_BASE_URL must use HTTPS in production.');
    });

    it('allows explicit plain HTTP only for a private service-network hostname', () => {
        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            HR_FACE_PROVIDER: 'http',
            HR_FACE_PROVIDER_BASE_URL: 'http://face-provider.railway.internal:8080',
            HR_FACE_PROVIDER_ALLOW_HTTP_INTERNAL: 'true',
            HR_FACE_PROVIDER_TOKEN: 'provider-token-with-at-least-32-bytes',
            HR_FACE_PROVIDER_MODEL: 'buffalo_l',
            HR_FACE_PROVIDER_VERSION: '1.2.3',
            HR_BIOMETRIC_ENCRYPTION_KEY: 'b'.repeat(64),
        })).toEqual([]);
    });

    it('rejects a short face-provider bearer token', () => {
        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            HR_FACE_PROVIDER: 'http',
            HR_FACE_PROVIDER_BASE_URL: 'https://faces.internal.example',
            HR_FACE_PROVIDER_TOKEN: 'short-token',
            HR_BIOMETRIC_ENCRYPTION_KEY: 'b'.repeat(64),
        })).toContain('HR_FACE_PROVIDER_TOKEN must contain at least 32 bytes.');
    });

    it('requires an absolute durable root and a stable shared identity in production', () => {
        const missing = { ...validProductionEnv };
        delete missing.STORAGE_DIR;
        delete missing.STORAGE_SHARED_ID;
        expect(collectEnvironmentErrors(missing)).toEqual(expect.arrayContaining([
            'STORAGE_DIR is required in production.',
            'STORAGE_SHARED_ID is required in production.',
        ]));

        expect(collectEnvironmentErrors({
            ...validProductionEnv,
            STORAGE_DIR: 'relative/storage',
            STORAGE_SHARED_ID: 'short',
        })).toEqual(expect.arrayContaining([
            'STORAGE_DIR must be an absolute path when set.',
            'STORAGE_SHARED_ID must contain 8-128 alphanumeric, dot, dash or underscore characters.',
        ]));
    });

    it('requires pinned face model and provider version for production HTTP readiness', () => {
        const errors = collectEnvironmentErrors({
            ...validProductionEnv,
            HR_FACE_PROVIDER: 'http',
            HR_FACE_PROVIDER_BASE_URL: 'https://faces.internal.example',
            HR_FACE_PROVIDER_TOKEN: 'provider-token-with-at-least-32-bytes',
            HR_BIOMETRIC_ENCRYPTION_KEY: 'b'.repeat(64),
        });
        expect(errors).toEqual(expect.arrayContaining([
            'HR_FACE_PROVIDER_MODEL is required for the http face provider in production.',
            'HR_FACE_PROVIDER_VERSION is required for the http face provider in production.',
        ]));
    });
});
