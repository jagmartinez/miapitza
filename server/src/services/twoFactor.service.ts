import { generateSecret, verify, generateURI } from 'otplib';
import * as qrcode from 'qrcode';
import prisma from '../utils/prisma';

async function checkCode(token: string, secret: string): Promise<boolean> {
    const result = await verify({ secret, token });
    return result.valid === true;
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

        // Only return QR code — never expose raw secret to client
        return { qrCodeDataUrl };
    }

    static async verify(userId: number, code: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorSecret: true },
        });
        if (!user?.twoFactorSecret) throw new Error('2FA not set up');

        if (!(await checkCode(code, user.twoFactorSecret))) throw new Error('Código inválido');

        await prisma.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: true },
        });

        return { enabled: true };
    }

    static async disable(userId: number, code: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { twoFactorSecret: true, twoFactorEnabled: true },
        });
        if (!user?.twoFactorEnabled) throw new Error('2FA is not enabled');

        const secret = user.twoFactorSecret;
        if (!secret) throw new Error('Código inválido');

        if (!(await checkCode(code, secret))) throw new Error('Código inválido');

        await prisma.user.update({
            where: { id: userId },
            data: { twoFactorEnabled: false, twoFactorSecret: null },
        });

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
}
