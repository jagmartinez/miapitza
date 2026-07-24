import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
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
    static async create(
        userId: number,
        token: string,
        ip?: string,
        userAgent?: string,
        idleTimeoutMinutes = 30,
        db: SessionClient = prisma,
    ) {
        // Keep session lifetime aligned with the JWT expiry (8h) issued in AuthService.login.
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 8);
        const normalizedIdleTimeout = Number.isInteger(idleTimeoutMinutes)
            ? Math.min(Math.max(idleTimeoutMinutes, 1), 24 * 60)
            : 30;

        return db.userSession.create({
            data: {
                userId,
                tokenHash: hashToken(token),
                ipAddress: ip || null,
                userAgent: userAgent || null,
                device: parseDevice(userAgent || ''),
                lastActivityAt: new Date(),
                idleTimeoutMinutes: normalizedIdleTimeout,
                expiresAt,
            },
        });
    }

    /** List active sessions for a user */
    static async listActive(userId: number) {
        const sessions = await prisma.userSession.findMany({
            where: { userId, revoked: false, expiresAt: { gt: new Date() } },
            select: {
                id: true,
                device: true,
                ipAddress: true,
                createdAt: true,
                tokenHash: true,
                lastActivityAt: true,
                idleTimeoutMinutes: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        const now = Date.now();
        return sessions
            .filter((session) => (
                new Date(session.lastActivityAt).getTime() + session.idleTimeoutMinutes * 60_000 > now
            ))
            .map(({ lastActivityAt: _lastActivityAt, idleTimeoutMinutes: _idleTimeoutMinutes, ...session }) => session);
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
    static async revokeAll(userId: number, db: SessionClient = prisma) {
        return db.userSession.updateMany({
            where: { userId, revoked: false },
            data: { revoked: true },
        });
    }

    /** Revoke the session identified by a raw token (e.g. on logout) */
    static async revokeByToken(token: string, db: SessionClient = prisma) {
        return db.userSession.updateMany({
            where: { tokenHash: hashToken(token), revoked: false },
            data: { revoked: true },
        });
    }

    /** Check if a token's session is still valid (not revoked) */
    static async isValid(token: string, options: SessionValidationOptions = {}): Promise<boolean> {
        return this.isHashValid(hashToken(token), options);
    }

    /** Validate a previously hashed token without retaining the bearer token in memory. */
    static async isHashValid(
        tokenHash: string,
        options: SessionValidationOptions = {},
    ): Promise<boolean> {
        const session = await prisma.userSession.findUnique({ where: { tokenHash } });
        if (!session) return false; // Reject tokens without a tracked session
        const now = new Date();
        const idleDeadline = new Date(session.lastActivityAt).getTime()
            + session.idleTimeoutMinutes * 60_000;
        if (session.revoked || new Date(session.expiresAt) <= now || idleDeadline <= now.getTime()) {
            return false;
        }
        if (options.touch !== false) {
            const updated = await prisma.userSession.updateMany({
                where: {
                    id: session.id,
                    revoked: false,
                    expiresAt: { gt: now },
                },
                data: { lastActivityAt: now },
            });
            return updated.count === 1;
        }
        return true;
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

type SessionClient = Pick<Prisma.TransactionClient, 'userSession'>;

interface SessionValidationOptions {
    /** HTTP activity extends idle expiry; background WebSocket probes must not. */
    touch?: boolean;
}
