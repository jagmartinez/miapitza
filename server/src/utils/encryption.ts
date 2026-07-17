import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENVELOPE_PREFIX = 'enc:v1.';

function getKey(): Buffer {
    const hex = process.env.TWO_FA_ENCRYPTION_KEY;
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error('TWO_FA_ENCRYPTION_KEY must be a 64-char hex string (256 bits)');
    }
    return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext: string): string {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Self-describing envelope. The reserved `enc:` namespace makes new
    // ciphertext unambiguous and leaves room for future key/version rotation.
    return `${ENVELOPE_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decodeBase64Url(value: string, label: string, expectedLength?: number): Buffer {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid encrypted ${label}`);
    const result = Buffer.from(value, 'base64url');
    if (result.toString('base64url') !== value) throw new Error(`Invalid encrypted ${label}`);
    if (expectedLength !== undefined && result.length !== expectedLength) throw new Error(`Invalid encrypted ${label}`);
    return result;
}

function decryptVersioned(encoded: string): string {
    const parts = encoded.split('.');
    if (parts.length !== 4 || parts[0] !== 'enc:v1') throw new Error('Unsupported encrypted value format');
    const key = getKey();
    const iv = decodeBase64Url(parts[1], 'iv', IV_LENGTH);
    const tag = decodeBase64Url(parts[2], 'tag', TAG_LENGTH);
    const ciphertext = decodeBase64Url(parts[3], 'ciphertext');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isLegacyEncryptionCandidate(value: string): boolean {
    if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > IV_LENGTH + TAG_LENGTH && decoded.toString('base64') === value;
}

function decryptLegacy(encoded: string): string {
    if (!isLegacyEncryptionCandidate(encoded)) throw new Error('Invalid legacy encrypted value');
    const key = getKey();
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function decrypt(encoded: string): string {
    if (encoded.startsWith('enc:')) return decryptVersioned(encoded);
    return decryptLegacy(encoded);
}

export function isEncrypted(value: string): boolean {
    if (!value) return false;
    // `enc:` is reserved for ciphertext. Even a malformed or future envelope
    // stays classified as encrypted so callers never downgrade it to plaintext.
    if (value.startsWith('enc:')) return true;
    if (!isLegacyEncryptionCandidate(value)) return false;
    try {
        decryptLegacy(value);
        return true;
    } catch {
        return false;
    }
}
