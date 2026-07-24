import { describe, expect, it, jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import prisma from '../../utils/prisma';
import { AuthService } from '../../services/auth.service';

describe('AuthService unknown-user contract', () => {
    it('runs the bcrypt verifier and preserves the generic error without creating lockout rows', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
        const compare = jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
        const lockoutCreate = jest.spyOn(prisma.loginAttempt, 'upsert');

        await expect(AuthService.login('missing-user', 'incorrect-secret'))
            .rejects.toThrow('Credenciales inv');

        expect(compare).toHaveBeenCalledTimes(1);
        expect(compare.mock.calls[0][1]).toMatch(/^\$2a\$12\$/);
        expect(lockoutCreate).not.toHaveBeenCalled();
    });
});
