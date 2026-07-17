const WEAK_JWT_SECRETS = new Set([
    'change-me-in-production',
    'change-me-to-a-long-random-secret',
    'changeme',
    'secret',
]);

function isInternalHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.internal') || normalized.endsWith('.local')) return true;
    if (!normalized.includes('.')) return true;
    if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^169\.254\./.test(normalized)) return true;
    const private172 = normalized.match(/^172\.(\d{1,3})\./);
    return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

export function collectEnvironmentErrors(env: NodeJS.ProcessEnv): string[] {
    const errors: string[] = [];
    const isProduction = env.NODE_ENV === 'production';
    const jwtSecret = env.JWT_SECRET;
    const normalizedJwtSecret = jwtSecret?.trim().toLowerCase();
    const faceProvider = env.HR_FACE_PROVIDER?.trim().toLowerCase() || 'disabled';
    const supportedFaceProviders = new Set(['disabled', 'fake', 'http']);
    const tenancyMode = env.PLATFORM_TENANCY_MODE?.trim().toLowerCase();
    const platformCompanyRaw = env.PLATFORM_ADMIN_COMPANY_ID?.trim();
    const platformCompanyId = platformCompanyRaw ? Number(platformCompanyRaw) : null;

    if (!jwtSecret || jwtSecret.trim() === '') {
        errors.push('JWT_SECRET is required but not set.');
    } else if (normalizedJwtSecret && WEAK_JWT_SECRETS.has(normalizedJwtSecret)) {
        errors.push('JWT_SECRET is set to a known-weak default; use a long random secret.');
    } else if (isProduction && Buffer.byteLength(jwtSecret, 'utf8') < 32) {
        errors.push('JWT_SECRET must contain at least 32 bytes in production.');
    }

    if (!supportedFaceProviders.has(faceProvider)) {
        errors.push('HR_FACE_PROVIDER must be one of: disabled, fake, http.');
    }
    if (faceProvider === 'fake' && env.HR_ALLOW_FAKE_FACE_PROVIDER !== 'true') {
        errors.push('HR_ALLOW_FAKE_FACE_PROVIDER=true is required to opt in to the fake provider.');
    }
    if (isProduction && faceProvider === 'fake') {
        errors.push('The fake face provider is forbidden in production.');
    }
    if (faceProvider === 'http') {
        const rawUrl = env.HR_FACE_PROVIDER_BASE_URL?.trim();
        const token = env.HR_FACE_PROVIDER_TOKEN?.trim();
        const timeout = Number(env.HR_FACE_PROVIDER_TIMEOUT_MS || 5000);
        if (!rawUrl) {
            errors.push('HR_FACE_PROVIDER_BASE_URL is required for the http face provider.');
        } else {
            try {
                const url = new URL(rawUrl);
                if (!['http:', 'https:'].includes(url.protocol)) {
                    errors.push('HR_FACE_PROVIDER_BASE_URL must use HTTP or HTTPS.');
                } else if (url.username || url.password) {
                    errors.push('HR_FACE_PROVIDER_BASE_URL must not contain credentials.');
                } else if (
                    isProduction && url.protocol !== 'https:'
                    && !(env.HR_FACE_PROVIDER_ALLOW_HTTP_INTERNAL === 'true' && isInternalHostname(url.hostname))
                ) {
                    errors.push('HR_FACE_PROVIDER_BASE_URL must use HTTPS in production.');
                }
            } catch {
                errors.push('HR_FACE_PROVIDER_BASE_URL must be a valid URL.');
            }
        }
        if (!token) {
            errors.push('HR_FACE_PROVIDER_TOKEN is required for the http face provider.');
        } else if (Buffer.byteLength(token, 'utf8') < 32) {
            errors.push('HR_FACE_PROVIDER_TOKEN must contain at least 32 bytes.');
        }
        if (!Number.isInteger(timeout) || timeout < 500 || timeout > 15000) {
            errors.push('HR_FACE_PROVIDER_TIMEOUT_MS must be between 500 and 15000.');
        }
    }
    if (faceProvider !== 'disabled') {
        const biometricKey = env.HR_BIOMETRIC_ENCRYPTION_KEY;
        if (!biometricKey || !/^[0-9a-fA-F]{64}$/.test(biometricKey)) {
            errors.push('HR_BIOMETRIC_ENCRYPTION_KEY must be a 64-character hexadecimal key when facial verification is enabled.');
        }
    }

    if (tenancyMode && !['single', 'multi'].includes(tenancyMode)) {
        errors.push('PLATFORM_TENANCY_MODE must be either single or multi.');
    }
    if (platformCompanyRaw && (!Number.isInteger(platformCompanyId) || Number(platformCompanyId) <= 0)) {
        errors.push('PLATFORM_ADMIN_COMPANY_ID must be a positive integer when set.');
    }
    if (tenancyMode === 'single' && platformCompanyRaw) {
        errors.push('PLATFORM_ADMIN_COMPANY_ID must be empty in single tenancy mode.');
    }
    if (tenancyMode === 'multi' && (!Number.isInteger(platformCompanyId) || Number(platformCompanyId) <= 0)) {
        errors.push('PLATFORM_ADMIN_COMPANY_ID is required in multi tenancy mode.');
    }

    if (isProduction) {
        if (!tenancyMode || !['single', 'multi'].includes(tenancyMode)) {
            errors.push('PLATFORM_TENANCY_MODE is required in production (single or multi).');
        }
        const encryptionKey = env.TWO_FA_ENCRYPTION_KEY;
        if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
            errors.push('TWO_FA_ENCRYPTION_KEY must be a 64-character hexadecimal key in production.');
        }

        const clientOrigins = env.CLIENT_URL;
        if (!clientOrigins) {
            errors.push('CLIENT_URL is required in production.');
        } else {
            for (const origin of clientOrigins.split(',').map(value => value.trim()).filter(Boolean)) {
                try {
                    const parsed = new URL(origin);
                    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
                        errors.push(`CLIENT_URL contains an invalid origin: ${origin}`);
                    }
                } catch {
                    errors.push(`CLIENT_URL contains an invalid origin: ${origin}`);
                }
            }
        }
    }

    return errors;
}
