import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { UserService } from '../../services/user.service';

afterEach(() => { jest.restoreAllMocks(); });

describe('UserService security transitions', () => {
    it('revokes active sessions atomically when an administrator deactivates a user', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 7,
            role: { name: 'CAJERO' },
            userRoles: []
        } as never);
        const tx = {
            user: { update: jest.fn().mockResolvedValue({ id: 7, status: 'INACTIVE' } as never) },
            userSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 } as never) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);

        await UserService.update(7, 1, { status: 'INACTIVE' }, ['ADMIN']);

        expect(tx.userSession.updateMany).toHaveBeenCalledWith({
            where: { userId: 7, revoked: false },
            data: { revoked: true }
        });
    });

    it('uses the same symbol-strength requirement as the login registration flow', async () => {
        await expect(UserService.create(1, {
            name: 'User', email: 'user@example.com', username: 'user', password: 'NoSymbol123', roleId: 2
        }, ['ADMIN'])).rejects.toThrow(/símbolo/i);
    });
});
