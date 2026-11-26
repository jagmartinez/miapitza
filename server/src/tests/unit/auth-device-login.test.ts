import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { AuthService, DeviceAuthError } from '../../services/auth.service';
import { AuthController } from '../../controllers/auth.controller';
import { OperationalDeviceService } from '../../services/operational-device.service';
import { WebSocketService } from '../../services/websocket.service';

const NOT_ACTIVE = { code: 'DEVICE_NOT_ACTIVE', statusCode: 401 };
const KITCHEN_UNAVAILABLE = { code: 'KITCHEN_ACCOUNT_UNAVAILABLE', statusCode: 403 };

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
    const calls: string[] = [];
    const sessionCreate = jest.fn(async (args: CreateArgs) => { calls.push('create'); return { id: 1, device: args.data.device }; });
    const sessionUpdateMany = jest.fn(async (_args: unknown) => { calls.push('updateMany'); return { count: 1 }; });
    const auditCreate = jest.fn(async (_args: CreateArgs) => ({}));
    const queryRaw = jest.fn(async () => [{ status: opts.deviceActiveInTx === false ? 'REVOKED' : 'ACTIVE' }]);
    jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (tx: unknown) => unknown) =>
        cb({ userSession: { create: sessionCreate, updateMany: sessionUpdateMany, findMany: jest.fn(async () => [{ tokenHash: 'h-old-1' }, { tokenHash: 'h-old-2' }]) }, auditLog: { create: auditCreate }, $queryRaw: queryRaw })) as never);
    jest.spyOn(prisma.setting, 'findFirst').mockResolvedValue(null);
    return { sessionCreate, sessionUpdateMany, auditCreate, queryRaw, calls };
}

const setup = (user: unknown, device: unknown = kitchenDevice()) => {
    jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(device as never);
    jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 1, name: 'Bamboo' } as never);
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
        expect(result.branch).toEqual({ id: 1, name: 'Bamboo' });
        expect((jwt.decode(result.token) as { userId: number }).userId).toBe(40);
        expect(JSON.stringify(auditCreate.mock.calls)).toContain('DEVICE_LOGIN');
        expect(JSON.stringify([sessionCreate.mock.calls, auditCreate.mock.calls])).not.toContain('tok"');
    });

    it('device-login: non-kitchen device type → DEVICE_NOT_ACTIVE', async () => {
        const find = setup(cook(), kitchenDevice({ type: 'SERVICE_TABLET', kitchenUserId: null }));
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toMatchObject(NOT_ACTIVE);
        expect(find).not.toHaveBeenCalled();
    });

    it('device-login: kitchen user inactive → KITCHEN_ACCOUNT_UNAVAILABLE', async () => {
        setup(cook({ status: 'INACTIVE' }));
        const { sessionCreate } = mockInfra();
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toMatchObject(KITCHEN_UNAVAILABLE);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('device-login: unknown or revoked token → DeviceAuthError DEVICE_NOT_ACTIVE', async () => {
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(null);
        const err = await AuthService.deviceLogin({ deviceToken: 'tok' }).catch((e) => e);
        expect(err).toBeInstanceOf(DeviceAuthError);
        expect(err).toMatchObject({ code: 'DEVICE_NOT_ACTIVE', statusCode: 401 });
    });

    it('device-login: kitchen user other branch / not COCINA → KITCHEN_ACCOUNT_UNAVAILABLE', async () => {
        const find = setup(cook({ branchId: 2 }));
        const { sessionCreate } = mockInfra();
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toMatchObject(KITCHEN_UNAVAILABLE);

        find.mockResolvedValue(cook({ userRoles: [{ role: { id: 1, name: 'ADMIN', permissions: [] } }] }) as never);
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toMatchObject(KITCHEN_UNAVAILABLE);

        find.mockResolvedValue(cook({ role: { id: 3, name: 'MESERO', permissions: [] } }) as never);
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toMatchObject(KITCHEN_UNAVAILABLE);

        // Kitchen kiosks are COCINA only: a CHEF role (alone or combined) never signs in by token.
        find.mockResolvedValue(cook({ userRoles: [{ role: { id: 4, name: 'CHEF', permissions: [] } }] }) as never);
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toMatchObject(KITCHEN_UNAVAILABLE);
        find.mockResolvedValue(cook({ role: { id: 4, name: 'CHEF', permissions: [] } }) as never);
        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toMatchObject(KITCHEN_UNAVAILABLE);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('does not create a session when the device is revoked concurrently (FOR UPDATE re-check)', async () => {
        setup(cook());
        const { sessionCreate, queryRaw } = mockInfra({ deviceActiveInTx: false });

        await expect(AuthService.deviceLogin({ deviceToken: 'tok' })).rejects.toMatchObject(NOT_ACTIVE);

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(sessionCreate).not.toHaveBeenCalled();
    });
});

describe('device-login guard errors', () => {
    it('device-login: DB error in the guard propagates and is not DEVICE_NOT_ACTIVE', async () => {
        setup(cook());
        const { sessionCreate, queryRaw } = mockInfra();
        queryRaw.mockRejectedValueOnce(new Error('Lock wait timeout exceeded'));

        const err = await AuthService.deviceLogin({ deviceToken: 'tok' }).catch((e) => e);

        expect(err).not.toBeInstanceOf(DeviceAuthError);
        expect(err.message).toBe('Lock wait timeout exceeded');
        expect(sessionCreate).not.toHaveBeenCalled();
    });
});

describe('device-login single session per device', () => {
    it('device-login: revokes previous unrevoked sessions with the same device tag inside the issuing transaction', async () => {
        setup(cook());
        const { sessionUpdateMany, calls } = mockInfra();

        await AuthService.deviceLogin({ deviceToken: 'tok' });

        expect(sessionUpdateMany).toHaveBeenCalledWith({
            where: { device: 'op-device:11', revoked: false },
            data: { revoked: true },
        });
        expect(calls).toEqual(['updateMany', 'create']);
    });

    it('device-login: closes the sockets of the replaced sessions after commit', async () => {
        setup(cook());
        mockInfra();
        const close = jest.spyOn(WebSocketService, 'closeBySessionHashes').mockReturnValue(0);

        await AuthService.deviceLogin({ deviceToken: 'tok' });

        expect(close).toHaveBeenCalledWith(['h-old-1', 'h-old-2'], 'Session replaced');
    });
});

describe('AuthController device-login error mapping', () => {
    const run = async (error: unknown) => {
        jest.spyOn(AuthService, 'deviceLogin').mockRejectedValue(error);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const next = jest.fn();
        await AuthController.deviceLogin({ headers: {}, body: {}, ip: '1.1.1.1' } as never, { json: jest.fn() } as never, next);
        return next.mock.calls[0][0] as Record<string, unknown>;
    };

    it('controller maps DEVICE_NOT_ACTIVE to 401 with code', async () => {
        expect(await run(new DeviceAuthError('DEVICE_NOT_ACTIVE'))).toMatchObject({
            statusCode: 401, code: 'DEVICE_NOT_ACTIVE', message: 'Dispositivo no autorizado',
        });
    });

    it('controller maps KITCHEN_ACCOUNT_UNAVAILABLE to 403 with code', async () => {
        expect(await run(new DeviceAuthError('KITCHEN_ACCOUNT_UNAVAILABLE'))).toMatchObject({
            statusCode: 403, code: 'KITCHEN_ACCOUNT_UNAVAILABLE',
            message: 'La cuenta de cocina no está disponible. Avisa al administrador.',
        });
    });

    it('forwards Prisma errors to the central handler instead of a generic 401', async () => {
        const named = Object.assign(new Error('Transaction already closed'), { name: 'PrismaClientKnownRequestError', code: 'P2028' });
        expect(await run(named)).toBe(named);
        const coded = Object.assign(new Error('deadlock'), { code: 'P2034' });
        expect(await run(coded)).toBe(coded);
    });

    it('keeps the generic 401 for other failures (PIN login / roster path unchanged)', async () => {
        const out = await run(new Error('Credenciales inválidas'));
        expect(out).toEqual({ statusCode: 401, message: 'Credenciales inválidas' });
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
