import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
    const hex = process.env.TWO_FA_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
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
    // Format: base64(iv + tag + ciphertext)
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(encoded: string): string {
    const key = getKey();
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
}

export function isEncrypted(value: string): boolean {
    if (!value) return false;
    try {
        const buf = Buffer.from(value, 'base64');
        return buf.length > IV_LENGTH + TAG_LENGTH && value !== buf.toString('utf8');
    } catch {
        return false;
    }
}
