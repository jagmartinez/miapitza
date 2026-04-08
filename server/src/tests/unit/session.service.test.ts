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

        await expect(SessionService.isValid('active-token')).resolves.toBe(true);
    });
});
