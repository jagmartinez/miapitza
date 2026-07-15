import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { FaceProviderUnavailableError } from '../services/hr-face-provider';

function keyFromEnv(env: NodeJS.ProcessEnv): Buffer {
    const value = env.HR_BIOMETRIC_ENCRYPTION_KEY?.trim();
    if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
        throw new FaceProviderUnavailableError('La clave de cifrado biométrico no está configurada');
    }
    return Buffer.from(value, 'hex');
}

export function encryptBiometricTemplate(plainText: string, env: NodeJS.ProcessEnv = process.env): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyFromEnv(env), iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptBiometricTemplate(value: string, env: NodeJS.ProcessEnv = process.env): string {
    const [version, ivValue, tagValue, encryptedValue] = value.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('Plantilla biométrica cifrada inválida');
    const decipher = createDecipheriv('aes-256-gcm', keyFromEnv(env), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}
