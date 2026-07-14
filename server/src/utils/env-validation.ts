const WEAK_JWT_SECRETS = new Set([
    'change-me-in-production',
    'change-me-to-a-long-random-secret',
    'changeme',
    'secret',
]);

export function collectEnvironmentErrors(env: NodeJS.ProcessEnv): string[] {
    const errors: string[] = [];
    const isProduction = env.NODE_ENV === 'production';
    const jwtSecret = env.JWT_SECRET;
    const normalizedJwtSecret = jwtSecret?.trim().toLowerCase();

    if (!jwtSecret || jwtSecret.trim() === '') {
        errors.push('JWT_SECRET is required but not set.');
    } else if (normalizedJwtSecret && WEAK_JWT_SECRETS.has(normalizedJwtSecret)) {
        errors.push('JWT_SECRET is set to a known-weak default; use a long random secret.');
    } else if (isProduction && Buffer.byteLength(jwtSecret, 'utf8') < 32) {
        errors.push('JWT_SECRET must contain at least 32 bytes in production.');
    }


    if (isProduction) {
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
