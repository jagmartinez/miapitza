import crypto from 'crypto';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { TwoFactorService } from '../../services/twoFactor.service';
import { decrypt, encrypt, isEncrypted, isLegacyEncryptionCandidate } from '../../utils/encryption';

const KEY_A = '11'.repeat(32);
const KEY_B = '22'.repeat(32);

function legacyEncrypt(plaintext: string, keyHex = KEY_A): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

describe('versioned secret encryption envelope', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.TWO_FA_ENCRYPTION_KEY;
    });

    it('writes an unambiguous versioned envelope and authenticates round trips', () => {
        process.env.TWO_FA_ENCRYPTION_KEY = KEY_A;
        const encoded = encrypt('JBSWY3DPEHPK3PXP');

        expect(encoded).toMatch(/^enc:v1\./);
        expect(isEncrypted(encoded)).toBe(true);
        expect(decrypt(encoded)).toBe('JBSWY3DPEHPK3PXP');
    });

    it('does not classify arbitrary long base64 plaintext as encrypted', () => {
        process.env.TWO_FA_ENCRYPTION_KEY = KEY_A;
        const plaintextBase64 = Buffer.from('this is plaintext that merely happens to be base64 encoded').toString('base64');

        expect(isLegacyEncryptionCandidate(plaintextBase64)).toBe(true);
        expect(isEncrypted(plaintextBase64)).toBe(false);
    });

    it('continues to decrypt authenticated legacy ciphertext', () => {
        process.env.TWO_FA_ENCRYPTION_KEY = KEY_A;
        const encoded = legacyEncrypt('legacy-secret');

        expect(isEncrypted(encoded)).toBe(true);
        expect(decrypt(encoded)).toBe('legacy-secret');
    });

    it('never downgrades a corrupt versioned envelope to plaintext', () => {
        process.env.TWO_FA_ENCRYPTION_KEY = KEY_A;
        const encoded = encrypt('secret');
        const corrupted = `${encoded.slice(0, -1)}${encoded.endsWith('A') ? 'B' : 'A'}`;

        expect(isEncrypted(corrupted)).toBe(true);
        expect(() => decrypt(corrupted)).toThrow();
    });

    it('fails closed when a legacy 2FA ciphertext cannot authenticate with the configured key', async () => {
        const encoded = legacyEncrypt('JBSWY3DPEHPK3PXP', KEY_A);
        process.env.TWO_FA_ENCRYPTION_KEY = KEY_B;
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ twoFactorSecret: encoded } as never);

        await expect(TwoFactorService.validateCode(7, '123456'))
            .rejects.toThrow('no se puede descifrar');
    });
});
