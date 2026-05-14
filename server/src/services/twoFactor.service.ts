import { generateSecret, verify, generateURI } from 'otplib';
import * as qrcode from 'qrcode';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../utils/prisma';

const RECOVERY_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;

async function checkCode(token: string, secret: string): Promise<boolean> {
    const result = await verify({ secret, token });
    return result.valid === true;
}

function generateRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        const raw = crypto.randomBytes(4).toString('hex');
        codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
    }
    return codes;
}

async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map(c => bcrypt.hash(c, BCRYPT_ROUNDS)));
}

export class TwoFactorService {
    static async setup(userId: number) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { username: true, company: { select: { name: true } } },
        });
        if (!user) throw new Error('User not found');

        const secret = generateSecret();
        const issuer = user.company?.name || 'RestaurantPOS';
        const otpAuthUrl = generateURI({
            issuer,
            label: user.username,
            secret,
        });
        const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);

        await prisma.user.update({
            where: { id: userId },
            data: { twoFactorSecret: secret, twoFactorEnabled: false },
        });

        return { qrCodeDataUrl };
    }

    static async verify(userId: number, code: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorSecret: true, companyId: true },
        });
        if (!user?.twoFactorSecret) throw new Error('2FA not set up');

        if (!(await checkCode(code, user.twoFactorSecret))) throw new Error('Código inválido');

        const plainCodes = generateRecoveryCodes();
        const hashedCodes = await hashRecoveryCodes(plainCodes);

        await prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorEnabled: true,
                twoFactorEnabledAt: new Date(),
                twoFactorRecoveryCodes: hashedCodes,
            },
        });

        await TwoFactorService.logAudit(userId, user.companyId, '2FA_ENABLED');

        return { enabled: true, recoveryCodes: plainCodes };
    }

    static async disable(userId: number, code: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorSecret: true, twoFactorEnabled: true, companyId: true },
        });
        if (!user?.twoFactorEnabled) throw new Error('2FA is not enabled');

        const secret = user.twoFactorSecret;
        if (!secret) throw new Error('Código inválido');

        if (!(await checkCode(code, secret))) throw new Error('Código inválido');

        await prisma.user.update({
            where: { id: userId },
            data: {
                twoFactorEnabled: false,
                twoFactorSecret: null,
                twoFactorRecoveryCodes: null,
                twoFactorEnabledAt: null,
            },
        });

        await TwoFactorService.logAudit(userId, user.companyId, '2FA_DISABLED');

        return { enabled: false };
    }

    static async validateCode(userId: number, code: string): Promise<boolean> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorSecret: true },
        });
        if (!user?.twoFactorSecret) return false;
        return await checkCode(code, user.twoFactorSecret);
    }

    static async validateRecoveryCode(userId: number, code: string): Promise<boolean> {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorRecoveryCodes: true, companyId: true },
        });

        const stored = user?.twoFactorRecoveryCodes;
        if (!stored || !Array.isArray(stored) || stored.length === 0) return false;

        const normalizedCode = code.trim().toLowerCase();

        for (let i = 0; i < stored.length; i++) {
            const match = await bcrypt.compare(normalizedCode, stored[i] as string);
            if (match) {
                const remaining = [...stored];
                remaining.splice(i, 1);
                await prisma.user.update({
                    where: { id: userId },
                    data: { twoFactorRecoveryCodes: remaining },
                });

                await TwoFactorService.logAudit(
                    userId,
                    user!.companyId,
                    '2FA_RECOVERY_USED',
                    { remainingCodes: remaining.length }
                );

                return true;
            }
        }

        return false;
    }

    static async regenerateRecoveryCodes(userId: number, code: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorSecret: true, twoFactorEnabled: true, companyId: true },
        });
        if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
            throw new Error('2FA is not enabled');
        }

        if (!(await checkCode(code, user.twoFactorSecret))) {
            throw new Error('Código inválido');
        }

        const plainCodes = generateRecoveryCodes();
        const hashedCodes = await hashRecoveryCodes(plainCodes);

        await prisma.user.update({
            where: { id: userId },
            data: { twoFactorRecoveryCodes: hashedCodes },
        });

        await TwoFactorService.logAudit(userId, user.companyId, '2FA_RECOVERY_REGENERATED');

        return { recoveryCodes: plainCodes };
    }

    private static async logAudit(
        userId: number,
        companyId: number | null,
        action: string,
        details?: Record<string, unknown>
    ) {
        if (!companyId) return;
        try {
            await prisma.auditLog.create({
                data: {
                    companyId,
                    entityType: 'User',
                    entityId: userId,
                    action,
                    userId,
                    details: details ?? null,
                },
            });
        } catch {
            // Audit failure must not block the 2FA operation
        }
    }
}
