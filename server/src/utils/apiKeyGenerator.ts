import crypto from 'crypto';

interface GeneratedApiKey {
    plainKey: string;
    keyHash: string;
    keyPrefix: string;
}

/**
 * Generates a new API key with the format `rk_live_<32 hex chars>`.
 * Returns the plain key (shown once to the user), its SHA-256 hash
 * (stored in the database), and a short prefix for display/lookup.
 */
export function generateApiKey(): GeneratedApiKey {
    const randomHex = crypto.randomBytes(16).toString('hex'); // 32 hex chars
    const plainKey = `rk_live_${randomHex}`;
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');
    const keyPrefix = plainKey.substring(0, 8);

    return { plainKey, keyHash, keyPrefix };
}

/**
 * Hashes a plain API key with SHA-256 for database lookup.
 */
export function hashApiKey(plainKey: string): string {
    return crypto.createHash('sha256').update(plainKey).digest('hex');
}
