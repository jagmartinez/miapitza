import crypto from 'crypto';
import prisma from '../utils/prisma';

function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function parseDevice(ua: string): string {
    if (!ua) return 'Desconocido';
    if (/Mobile|Android|iPhone/i.test(ua)) return 'Móvil';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac/i.test(ua)) return 'Mac';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Navegador';
}

export class SessionService {
    /** Create a session record after login */
    static async create(userId: number, token: string, ip?: string, userAgent?: string) {
        // Keep session lifetime aligned with the JWT expiry (8h) issued in AuthService.login.
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 8);

        return prisma.userSession.create({
            data: {
                userId,
                tokenHash: hashToken(token),
                ipAddress: ip || null,
                userAgent: userAgent || null,
                device: parseDevice(userAgent || ''),
                expiresAt,
            },
        });
    }

    /** List active sessions for a user */
    static async listActive(userId: number) {
        const sessions = await prisma.userSession.findMany({
            where: { userId, revoked: false, expiresAt: { gt: new Date() } },
            select: { id: true, device: true, ipAddress: true, createdAt: true, tokenHash: true },
            orderBy: { createdAt: 'desc' },
        });
        return sessions;
    }

    /** Revoke a specific session */
    static async revoke(sessionId: string, userId: number) {
        return prisma.userSession.updateMany({
            where: { id: sessionId, userId },
            data: { revoked: true },
        });
    }

    /** Revoke all sessions except the current one */
    static async revokeAllExcept(userId: number, currentToken: string) {
        const currentHash = hashToken(currentToken);
        return prisma.userSession.updateMany({
            where: { userId, tokenHash: { not: currentHash }, revoked: false },
            data: { revoked: true },
        });
    }

    /** Revoke every active session for a user (e.g. after a password change) */
    static async revokeAll(userId: number) {
        return prisma.userSession.updateMany({
            where: { userId, revoked: false },
            data: { revoked: true },
        });
    }

    /** Revoke the session identified by a raw token (e.g. on logout) */
    static async revokeByToken(token: string) {
        return prisma.userSession.updateMany({
            where: { tokenHash: hashToken(token), revoked: false },
            data: { revoked: true },
        });
    }

    /** Check if a token's session is still valid (not revoked) */
    static async isValid(token: string): Promise<boolean> {
        const session = await prisma.userSession.findUnique({
            where: { tokenHash: hashToken(token) },
        });
        if (!session) return false; // Reject tokens without a tracked session
        return !session.revoked && new Date(session.expiresAt) > new Date();
    }

    /** Purge all expired or revoked sessions from the database */
    static async purgeExpired(): Promise<number> {
        const result = await prisma.userSession.deleteMany({
            where: {
                OR: [
                    { expiresAt: { lte: new Date() } },
                    { revoked: true },
                ],
            },
        });
        return result.count;
    }

    /** Get current session hash for marking "current" in the list */
    static hashToken = hashToken;
}
