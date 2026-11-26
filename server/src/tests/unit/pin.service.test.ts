import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import bcrypt from 'bcryptjs';
import { PinService } from '../../services/pin.service';
import { loginAttemptService } from '../../services/login-attempt.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('PinService.validateFormat', () => {
    it.each(['1111', '1234', '987654', '12a4', '123', '1234567', '', '0000', '4321'])('rejects %p', (pin) => {
        expect(() => PinService.validateFormat(pin)).toThrow();
    });

    it.each(['2580', '739164', '1357'])('accepts %p', (pin) => {
        expect(() => PinService.validateFormat(pin)).not.toThrow();
    });
});

describe('PinService.setPin', () => {
    const PASSWORD = 'Correct-Horse-9';
    const passwordHash = bcrypt.hashSync(PASSWORD, 4);
    const userWith = (role: string, extra: string[] = []) => ({
        id: 9, companyId: 5, status: 'ACTIVE', password: passwordHash,
        role: { name: role },
        userRoles: extra.map((name) => ({ role: { name } })),
    });

    beforeEach(() => {
        jest.spyOn(loginAttemptService, 'assertAllowed').mockResolvedValue(undefined);
        jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);
        jest.spyOn(loginAttemptService, 'recordSuccess').mockResolvedValue(undefined);
    });

    describe('current password', () => {
        it.each([undefined, '', 123])('rejects a missing/invalid password %p with a generic 401 and writes nothing', async (pw) => {
            const find = jest.spyOn(prisma.user, 'findUnique');
            const tx = jest.spyOn(prisma, '$transaction');
            await expect(PinService.setPin(9, '2580', pw, '10.0.0.1'))
                .rejects.toMatchObject({ statusCode: 401, message: 'Credenciales inválidas' });
            expect(find).not.toHaveBeenCalled();
            expect(tx).not.toHaveBeenCalled();
            expect(loginAttemptService.recordFailure).not.toHaveBeenCalled();
        });

        it('rejects a wrong password with the same generic 401 and records a lockout failure', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(userWith('MESERO') as never);
            const tx = jest.spyOn(prisma, '$transaction');
            const error = await PinService.setPin(9, '2580', 'wrong-password', '10.0.0.1').catch((e) => e);
            expect(error).toMatchObject({ statusCode: 401, message: 'Credenciales inválidas' });
            expect(loginAttemptService.recordFailure).toHaveBeenCalledWith(9, '10.0.0.1');
            expect(tx).not.toHaveBeenCalled();
            expect(String(error.message)).not.toContain('wrong-password');
        });

        it('rejects with the generic 401 while the user is locked out, without loading the user', async () => {
            jest.spyOn(loginAttemptService, 'assertAllowed')
                .mockRejectedValue(new Error('Account temporarily locked. Try again in 5 minutes'));
            const find = jest.spyOn(prisma.user, 'findUnique');
            await expect(PinService.setPin(9, '2580', PASSWORD, '10.0.0.1'))
                .rejects.toMatchObject({ statusCode: 401, message: 'Credenciales inválidas' });
            expect(find).not.toHaveBeenCalled();
        });

        it('accepts the correct password, clears the counter and sets the PIN', async () => {
            jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(userWith('MESERO') as never);
            const update = jest.fn(async (_args: unknown) => ({}));
            jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (tx: unknown) => unknown) =>
                cb({ user: { update }, auditLog: { create: jest.fn(async () => ({})) } })) as never);
            await PinService.setPin(9, '2580', PASSWORD, '10.0.0.1');
            expect(update).toHaveBeenCalledTimes(1);
            expect(loginAttemptService.recordSuccess).toHaveBeenCalledWith(9, '10.0.0.1');
            expect(loginAttemptService.recordFailure).not.toHaveBeenCalled();
        });
    });

    it('rejects an ADMIN user and writes nothing', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(userWith('ADMIN') as never);
        const tx = jest.spyOn(prisma, '$transaction');
        await expect(PinService.setPin(9, '2580', PASSWORD, '10.0.0.1')).rejects.toThrow();
        expect(tx).not.toHaveBeenCalled();
    });

    it('rejects a MESERO who also holds an ADMIN secondary role', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(userWith('MESERO', ['ADMIN']) as never);
        await expect(PinService.setPin(9, '2580', PASSWORD, '10.0.0.1')).rejects.toThrow();
    });

    it('stores a bcrypt hash, never the PIN', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(userWith('MESERO') as never);
        const update = jest.fn(async (_args: unknown) => ({}));
        const audit = jest.fn(async (_args: unknown) => ({}));
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (tx: unknown) => unknown) =>
            cb({ user: { update }, auditLog: { create: audit } })) as never);

        await PinService.setPin(9, '2580', PASSWORD, '10.0.0.1');

        const data = (update.mock.calls[0][0] as { data: { pinHash: string; pinUpdatedAt: Date } }).data;
        expect(data.pinHash).toMatch(/^\$2[aby]\$/);
        expect(data.pinHash).not.toContain('2580');
        expect(data.pinUpdatedAt).toBeInstanceOf(Date);
        expect(JSON.stringify(audit.mock.calls)).not.toContain('2580');
    });
});
