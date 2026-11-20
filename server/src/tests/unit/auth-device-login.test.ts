import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { AuthService } from '../../services/auth.service';
import { OperationalDeviceService } from '../../services/operational-device.service';

const GENERIC = 'Credenciales inválidas';

beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-device-login';
});

afterEach(() => {
    jest.restoreAllMocks();
});

const kitchenDevice = (over: Record<string, unknown> = {}) => ({
    id: 11, companyId: 5, branchId: 1, type: 'KITCHEN_TABLET', status: 'ACTIVE', kitchenUserId: 40, ...over,
});

const cook = (over: Record<string, unknown> = {}) => ({
    id: 40, companyId: 5, branchId: 1, name: 'Cocina', email: 'k@x.co', username: 'cocina', color: null,
    accountType: 'STAFF', status: 'ACTIVE', passwordChangedAt: null, mustChangePassword: false,
    role: { id: 8, name: 'COCINA', permissions: [{ name: 'kds.view' }] },
    userRoles: [],
    company: { id: 5, name: 'Co', ruc: '1', active: true },
    branch: { status: 'ACTIVE' },
    allowedBranches: [],
    employee: null,
    ...over,
});

type CreateArgs = { data: Record<string, unknown> };

function mockInfra(opts: { deviceActiveInTx?: boolean } = {}) {
    const sessionCreate = jest.fn(async (args: CreateArgs) => ({ id: 1, device: args.data.device }));
    const auditCreate = jest.fn(async (_args: CreateArgs) => ({}));
    const queryRaw = jest.fn(async () => [{ status: opts.deviceActiveInTx === false ? 'REVOKED' : 'ACTIVE' }]);
    jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (tx: unknown) => unknown) =>
        cb({ userSession: { create: sessionCreate }, auditLog: { create: auditCreate }, $queryRaw: queryRaw })) as never);
    jest.spyOn(prisma.setting, 'findFirst').mockResolvedValue(null);
    return { sessionCreate, auditCreate, queryRaw };
}

const setup = (user: unknown, device: unknown = kitchenDevice()) => {
    jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(device as never);
    return jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(user as never);
};

describe('AuthService.deviceLogin', () => {
    it('issues a session for the kitchen user with 1440 idle minutes', async () => {
        const find = setup(cook());
        const { sessionCreate, auditCreate } = mockInfra();

        const result = await AuthService.deviceLogin({ deviceToken: 'tok', ip: '10.0.0.5', userAgent: 'KDS' });

        expect((find.mock.calls[0][0] as { where: { id: number } }).where.id).toBe(40);
        const data = sessionCreate.mock.calls[0][0].data;
        expect(data.userId).toBe(40);
        expect(data.idleTimeoutMinutes).toBe(1440);
        expect(data.device).toBe('op-device:11');
        expect(result.sessionTimeoutMinutes).toBe(1440);
        expect((jwt.decode(result.token) as { userId: number }).userId).toBe(40);
        expect(JSON.stringify(auditCreate.mock.calls)).toContain('DEVICE_LOGIN');
        expect(JSON.stringify([sessionCreate.mock.calls, auditCreate.mock.calls])).not.toContain('tok"');
    });

    it('rejects SERVICE_TABLET devices', async () => {
        const find = setup(cook(), kitchenDevice({ type: 'SERVICE_TABLET', kitchenUserId: null }));
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toThrow(GENERIC);
        expect(find).not.toHaveBeenCalled();
    });

    it('rejects when the kitchen user is INACTIVE', async () => {
        setup(cook({ status: 'INACTIVE' }));
        const { sessionCreate } = mockInfra();
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toThrow(GENERIC);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('rejects revoked or unknown devices with the generic message', async () => {
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(null);
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toThrow(GENERIC);
    });

    it('rejects when the kitchen user was moved to another branch or gained an elevated role', async () => {
        const find = setup(cook({ branchId: 2 }));
        const { sessionCreate } = mockInfra();
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toThrow(GENERIC);

        find.mockResolvedValue(cook({ userRoles: [{ role: { id: 1, name: 'ADMIN', permissions: [] } }] }) as never);
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toThrow(GENERIC);

        find.mockResolvedValue(cook({ role: { id: 3, name: 'MESERO', permissions: [] } }) as never);
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toThrow(GENERIC);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('does not create a session when the device is revoked concurrently (FOR UPDATE re-check)', async () => {
        setup(cook());
        const { sessionCreate, queryRaw } = mockInfra({ deviceActiveInTx: false });

        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toThrow(GENERIC);

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(sessionCreate).not.toHaveBeenCalled();
    });
});

describe('CSRF exemption for /auth/device-login', () => {
    it('lets the request through without a CSRF token', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { csrfProtection } = require('../../middlewares/csrf');
        const next = jest.fn();
        const res = { cookie: jest.fn(), setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        csrfProtection({ path: '/auth/device-login', method: 'POST', headers: {} }, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});
