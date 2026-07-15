import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { UserService } from '../../services/user.service';

const linkedUser = {
    id: 21,
    name: 'Ana Pérez',
    accountType: 'INTERNAL',
    employee: { id: 8, employeeCode: 'EMP-21', status: 'ACTIVE' },
    role: { name: 'MESERO' },
    userRoles: [],
    allowedBranches: [],
    branchId: null,
};

describe('HR user-account transitions', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('fails closed when an employee-linked account is requested as EXTERNAL', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(linkedUser as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(UserService.update(21, 4, { accountType: 'EXTERNAL' }, ['SUPERADMIN'], 3))
            .rejects.toThrow('expediente histórico');

        expect(transaction).not.toHaveBeenCalled();
    });

    it('requires the real employee endpoint instead of inventing an INTERNAL profile', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            ...linkedUser,
            accountType: 'EXTERNAL',
            employee: null,
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(UserService.update(21, 4, { accountType: 'INTERNAL' }, ['SUPERADMIN'], 3))
            .rejects.toThrow('/api/v1/hr/employees');

        expect(transaction).not.toHaveBeenCalled();
    });

    it('does not create an INTERNAL user without a complete employee payload', async () => {
        await expect(UserService.create(4, {
            name: 'Ana Pérez',
            email: 'ana@example.com',
            username: 'ana',
            password: 'Strong!Password123',
            roleId: 2,
            accountType: 'INTERNAL',
        }, ['SUPERADMIN'])).rejects.toThrow('/api/v1/hr/employees');
    });
});
