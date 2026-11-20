import crypto from 'crypto';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import {
    OperationalDeviceService,
    deviceSessionTag,
} from '../../services/operational-device.service';
import { SessionService } from '../../services/session.service';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const actor = { userId: 3, companyId: 5 };

afterEach(() => {
    jest.restoreAllMocks();
});

describe('OperationalDeviceService', () => {
    it('register returns a token whose sha256 is persisted, never the raw token', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 9 } as never);
        const create = jest.spyOn(prisma.operationalDevice, 'create')
            .mockImplementation((async (args: { data: Record<string, unknown> }) => ({ id: 7, ...args.data })) as never);
        const audit = jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);

        const { device, deviceToken } = await OperationalDeviceService.register(actor, {
            branchId: 9, type: 'SERVICE_TABLET', name: 'Tablet salon',
        });

        expect(deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const data = create.mock.calls[0][0].data as Record<string, unknown>;
        expect(data.tokenHash).toBe(sha256(deviceToken));
        expect(data.companyId).toBe(5);
        expect(JSON.stringify(create.mock.calls)).not.toContain(deviceToken);
        expect(JSON.stringify(audit.mock.calls)).not.toContain(deviceToken);
        expect(JSON.stringify(audit.mock.calls)).toContain('OPERATIONAL_DEVICE_REGISTERED');
        expect(device.id).toBe(7);
    });

    it('register rejects KITCHEN_TABLET without an active COCINA kitchenUserId', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 9 } as never);
        const userFind = jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
        const create = jest.spyOn(prisma.operationalDevice, 'create');

        await expect(OperationalDeviceService.register(actor, {
            branchId: 9, type: 'KITCHEN_TABLET', name: 'KDS',
        })).rejects.toThrow();
        await expect(OperationalDeviceService.register(actor, {
            branchId: 9, type: 'KITCHEN_TABLET', name: 'KDS', kitchenUserId: 44,
        })).rejects.toThrow();

        const where = userFind.mock.calls[0][0]!.where as Record<string, unknown>;
        expect(where).toMatchObject({ id: 44, companyId: 5, status: 'ACTIVE' });
        expect(create).not.toHaveBeenCalled();
    });

    it('register rejects a branch outside the actor company', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue(null);
        const create = jest.spyOn(prisma.operationalDevice, 'create');
        await expect(OperationalDeviceService.register(actor, {
            branchId: 99, type: 'SERVICE_TABLET', name: 'X',
        })).rejects.toThrow();
        expect(create).not.toHaveBeenCalled();
    });

    it('resolveActive returns null for unknown or REVOKED tokens', async () => {
        const find = jest.spyOn(prisma.operationalDevice, 'findUnique').mockResolvedValue(null);
        const update = jest.spyOn(prisma.operationalDevice, 'update');
        expect(await OperationalDeviceService.resolveActive('nope')).toBeNull();
        expect(find.mock.calls[0][0]).toMatchObject({ where: { tokenHash: sha256('nope') } });

        find.mockResolvedValue({ id: 1, status: 'REVOKED' } as never);
        expect(await OperationalDeviceService.resolveActive('revoked')).toBeNull();
        expect(await OperationalDeviceService.resolveActive('')).toBeNull();
        expect(update).not.toHaveBeenCalled();
    });

    it('resolveActive returns the device and touches lastSeenAt when ACTIVE', async () => {
        jest.spyOn(prisma.operationalDevice, 'findUnique')
            .mockResolvedValue({ id: 2, status: 'ACTIVE' } as never);
        const update = jest.spyOn(prisma.operationalDevice, 'update')
            .mockResolvedValue({ id: 2, status: 'ACTIVE', lastSeenAt: new Date() } as never);
        const device = await OperationalDeviceService.resolveActive('good');
        expect(device?.id).toBe(2);
        expect(update.mock.calls[0][0]).toMatchObject({ where: { id: 2 } });
    });

    it('revoke revokes every session tagged op-device:<id>', async () => {
        jest.spyOn(prisma.operationalDevice, 'findFirst')
            .mockResolvedValue({ id: 7, companyId: 5, status: 'ACTIVE' } as never);
        jest.spyOn(prisma.operationalDevice, 'updateMany').mockResolvedValue({ count: 1 } as never);
        jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
        const sessions = jest.spyOn(prisma.userSession, 'updateMany').mockResolvedValue({ count: 2 } as never);

        await OperationalDeviceService.revoke(actor, 7);

        expect(deviceSessionTag(7)).toBe('op-device:7');
        expect(sessions).toHaveBeenCalledWith({
            where: { device: 'op-device:7', revoked: false },
            data: { revoked: true },
        });
    });

    it('revoke hides devices of other companies behind a generic not-found', async () => {
        jest.spyOn(prisma.operationalDevice, 'findFirst').mockResolvedValue(null);
        const revokeSessions = jest.spyOn(SessionService, 'revokeByDevice');
        await expect(OperationalDeviceService.revoke(actor, 7)).rejects.toThrow('Dispositivo no encontrado');
        expect(revokeSessions).not.toHaveBeenCalled();
    });
});
