import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { PinService } from '../../services/pin.service';

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
    const userWith = (role: string, extra: string[] = []) => ({
        id: 9, companyId: 5, status: 'ACTIVE',
        role: { name: role },
        userRoles: extra.map((name) => ({ role: { name } })),
    });

    it('rejects an ADMIN user and writes nothing', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(userWith('ADMIN') as never);
        const tx = jest.spyOn(prisma, '$transaction');
        await expect(PinService.setPin(9, '2580')).rejects.toThrow();
        expect(tx).not.toHaveBeenCalled();
    });

    it('rejects a MESERO who also holds an ADMIN secondary role', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(userWith('MESERO', ['ADMIN']) as never);
        await expect(PinService.setPin(9, '2580')).rejects.toThrow();
    });

    it('stores a bcrypt hash, never the PIN', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(userWith('MESERO') as never);
        const update = jest.fn(async (_args: unknown) => ({}));
        const audit = jest.fn(async (_args: unknown) => ({}));
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (tx: unknown) => unknown) =>
            cb({ user: { update }, auditLog: { create: audit } })) as never);

        await PinService.setPin(9, '2580');

        const data = (update.mock.calls[0][0] as { data: { pinHash: string; pinUpdatedAt: Date } }).data;
        expect(data.pinHash).toMatch(/^\$2[aby]\$/);
        expect(data.pinHash).not.toContain('2580');
        expect(data.pinUpdatedAt).toBeInstanceOf(Date);
        expect(JSON.stringify(audit.mock.calls)).not.toContain('2580');
    });
});
