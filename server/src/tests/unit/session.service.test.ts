import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { UserSession } from '@prisma/client';

import prisma from '../../utils/prisma';
import { SessionService } from '../../services/session.service';

function mockSession(overrides: Partial<UserSession> & Pick<UserSession, 'expiresAt' | 'revoked'>): UserSession {
    const now = new Date();
    return {
        id: 'test-session-id',
        userId: 1,
        tokenHash: 'hash',
        ipAddress: null,
        userAgent: null,
        device: null,
        createdAt: now,
        lastActivityAt: now,
        idleTimeoutMinutes: 30,
        ...overrides,
    };
}

describe('SessionService.isValid', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects tokens without tracked session records', async () => {
        jest.spyOn(prisma.userSession, 'findUnique').mockResolvedValue(null);

        await expect(SessionService.isValid('legacy-token')).resolves.toBe(false);
    });

    it('rejects revoked sessions', async () => {
        jest.spyOn(prisma.userSession, 'findUnique').mockResolvedValue(
            mockSession({
                revoked: true,
                expiresAt: new Date(Date.now() + 60_000),
            })
        );

        await expect(SessionService.isValid('revoked-token')).resolves.toBe(false);
    });

    it('rejects expired sessions', async () => {
        jest.spyOn(prisma.userSession, 'findUnique').mockResolvedValue(
            mockSession({
                revoked: false,
                expiresAt: new Date(Date.now() - 60_000),
            })
        );

        await expect(SessionService.isValid('expired-token')).resolves.toBe(false);
    });

    it('accepts active tracked sessions', async () => {
        jest.spyOn(prisma.userSession, 'findUnique').mockResolvedValue(
            mockSession({
                revoked: false,
                expiresAt: new Date(Date.now() + 60_000),
            })
        );
        jest.spyOn(prisma.userSession, 'updateMany').mockResolvedValue({ count: 1 });

        await expect(SessionService.isValid('active-token')).resolves.toBe(true);
    });

    it('rejects a session after its server-side idle timeout', async () => {
        jest.spyOn(prisma.userSession, 'findUnique').mockResolvedValue(
            mockSession({
                revoked: false,
                lastActivityAt: new Date(Date.now() - 31 * 60_000),
                idleTimeoutMinutes: 30,
                expiresAt: new Date(Date.now() + 60_000),
            })
        );
        const touch = jest.spyOn(prisma.userSession, 'updateMany');

        await expect(SessionService.isValid('idle-expired')).resolves.toBe(false);
        expect(touch).not.toHaveBeenCalled();
    });

    it('does not extend idle expiry during background validation', async () => {
        jest.spyOn(prisma.userSession, 'findUnique').mockResolvedValue(
            mockSession({
                revoked: false,
                lastActivityAt: new Date(),
                idleTimeoutMinutes: 30,
                expiresAt: new Date(Date.now() + 60_000),
            })
        );
        const touch = jest.spyOn(prisma.userSession, 'updateMany');

        await expect(SessionService.isValid('active-token', { touch: false })).resolves.toBe(true);
        expect(touch).not.toHaveBeenCalled();
    });

    it('accepts concurrent valid activity without a lastActivityAt compare-and-swap race', async () => {
        const session = mockSession({
            revoked: false,
            lastActivityAt: new Date(),
            idleTimeoutMinutes: 30,
            expiresAt: new Date(Date.now() + 60_000),
        });
        jest.spyOn(prisma.userSession, 'findUnique').mockResolvedValue(session);
        const touch = jest.spyOn(prisma.userSession, 'updateMany')
            .mockResolvedValue({ count: 1 });

        await expect(Promise.all([
            SessionService.isValid('active-token'),
            SessionService.isValid('active-token'),
        ])).resolves.toEqual([true, true]);
        expect(touch).toHaveBeenCalledTimes(2);
        expect(touch.mock.calls[0][0].where).not.toHaveProperty('lastActivityAt');
    });
});
