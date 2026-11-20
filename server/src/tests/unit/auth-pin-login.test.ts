import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { AuthService } from '../../services/auth.service';
import { OperationalDeviceService } from '../../services/operational-device.service';
import { loginAttemptService } from '../../services/login-attempt.service';

const GENERIC = 'Credenciales inválidas';
const PIN = '2580';
let pinHash: string;

beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-pin-login';
    pinHash = await bcrypt.hash(PIN, 4);
});

afterEach(() => {
    jest.restoreAllMocks();
});

const device = (over: Record<string, unknown> = {}) => ({
    id: 7, companyId: 5, branchId: 1, type: 'SERVICE_TABLET', status: 'ACTIVE', kitchenUserId: null, ...over,
});

const waiter = (over: Record<string, unknown> = {}) => ({
    id: 21, companyId: 5, branchId: 1, name: 'Ana Mesera', email: 'a@x.co', username: 'ana', color: '#fff',
    accountType: 'STAFF', status: 'ACTIVE', pinHash, passwordChangedAt: null, mustChangePassword: false,
    role: { id: 3, name: 'MESERO', permissions: [{ name: 'orders.create' }] },
    userRoles: [],
    company: { id: 5, name: 'Co', ruc: '1', active: true },
    branch: { status: 'ACTIVE' },
    allowedBranches: [],
    employee: { id: 99 },
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
    jest.spyOn(prisma.loginAttempt, 'findMany').mockResolvedValue([]);
    jest.spyOn(loginAttemptService, 'recordSuccess').mockResolvedValue(undefined);
    jest.spyOn(loginAttemptService, 'assertAllowed').mockResolvedValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    return { sessionCreate, auditCreate, queryRaw };
}

const input = (over: Record<string, unknown> = {}) => ({ deviceToken: 'tok', userId: 21, pin: PIN, ...over });
const withDeviceAndUser = (user: unknown, dev: unknown = device()) => {
    jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(dev as never);
    return jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(user as never);
};

describe('AuthService.pinLogin', () => {
    it('issues a session tagged op-device:<id> with idle timeout 15', async () => {
        withDeviceAndUser(waiter());
        const { sessionCreate, auditCreate } = mockInfra();

        const result = await AuthService.pinLogin(input());

        const data = sessionCreate.mock.calls[0][0].data;
        expect(data.device).toBe('op-device:7');
        expect(data.idleTimeoutMinutes).toBe(15);
        expect(data.userId).toBe(21);
        expect(result.sessionTimeoutMinutes).toBe(15);
        expect((jwt.decode(result.token) as { userId: number }).userId).toBe(21);
        expect(JSON.stringify(auditCreate.mock.calls)).toContain('PIN_LOGIN');
        expect(JSON.stringify([sessionCreate.mock.calls, auditCreate.mock.calls])).not.toContain(PIN);
    });

    it('does not create a session when the device is revoked concurrently (FOR UPDATE re-check)', async () => {
        withDeviceAndUser(waiter());
        const { sessionCreate, queryRaw } = mockInfra({ deviceActiveInTx: false });

        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('rejects KITCHEN_TABLET devices', async () => {
        const find = withDeviceAndUser(waiter(), device({ type: 'KITCHEN_TABLET' }));
        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);
        expect(find).not.toHaveBeenCalled();
    });

    it('rejects an unknown or revoked device token', async () => {
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(null);
        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);
    });

    it('rejects a user from another branch with the generic message', async () => {
        withDeviceAndUser(waiter({ branchId: 2 }));
        const { sessionCreate } = mockInfra();
        const fail = jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);

        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);
        expect(sessionCreate).not.toHaveBeenCalled();
        expect(fail).toHaveBeenCalledWith(21, 'device:7');
    });

    it('accepts a tenant-wide user only with an explicit UserBranch grant', async () => {
        const find = withDeviceAndUser(waiter({ branchId: null, allowedBranches: [] }));
        mockInfra();
        jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);

        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);

        find.mockResolvedValue(waiter({ branchId: null, allowedBranches: [{ branchId: 1 }] }) as never);
        await expect(AuthService.pinLogin(input())).resolves.toHaveProperty('token');
    });

    it('rejects INACTIVE users', async () => {
        withDeviceAndUser(waiter({ status: 'INACTIVE' }));
        const { sessionCreate } = mockInfra();
        jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);
        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('rejects ADMIN even with a valid pinHash', async () => {
        withDeviceAndUser(waiter({ role: { id: 1, name: 'ADMIN', permissions: [] } }));
        const { sessionCreate } = mockInfra();
        jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);
        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('rejects a MESERO carrying an ADMIN secondary role', async () => {
        withDeviceAndUser(waiter({ userRoles: [{ role: { id: 1, name: 'ADMIN', permissions: [] } }] }));
        const { sessionCreate } = mockInfra();
        jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);
        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('rejects users without a pinHash and wrong PINs, recording each failure', async () => {
        const find = withDeviceAndUser(waiter({ pinHash: null }));
        mockInfra();
        const fail = jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);

        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);
        find.mockResolvedValue(waiter() as never);
        await expect(AuthService.pinLogin(input({ pin: '1357' }))).rejects.toThrow(GENERIC);
        expect(fail).toHaveBeenCalledTimes(2);
    });

    it('locks after 5 wrong PINs for the same user without revealing the lock', async () => {
        withDeviceAndUser(waiter());
        const { sessionCreate } = mockInfra();
        // Simulate the shared lockout: failures accumulate and the 5th sets a lock.
        let failures = 0;
        jest.spyOn(loginAttemptService, 'assertAllowed').mockImplementation(async () => {
            if (failures >= 5) throw new Error('Account temporarily locked. Try again in 15 minutes');
        });
        const fail = jest.spyOn(loginAttemptService, 'recordFailure').mockImplementation(async () => { failures += 1; });

        for (let i = 0; i < 5; i += 1) {
            await expect(AuthService.pinLogin(input({ pin: '1357' }))).rejects.toThrow(GENERIC);
        }
        expect(fail).toHaveBeenCalledTimes(5);
        expect(fail.mock.calls[0]).toEqual([21, 'device:7']);

        // Locked now: even the correct PIN gets the same generic error.
        const locked = AuthService.pinLogin(input());
        await expect(locked).rejects.toThrow(GENERIC);
        await expect(locked).rejects.not.toThrow(/lock/i);
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('rejects every user once the device accumulated 20 failures in 15 minutes', async () => {
        const find = withDeviceAndUser(waiter());
        const { sessionCreate } = mockInfra();
        const locked = new Date(Date.now() + 60_000);
        const rows = jest.spyOn(prisma.loginAttempt, 'findMany').mockResolvedValue([
            { failedCount: 4, lockedUntil: null },
            { failedCount: 4, lockedUntil: null },
            { failedCount: 0, lockedUntil: locked }, // a locked row stands for 5 guesses
            { failedCount: 0, lockedUntil: locked },
            { failedCount: 2, lockedUntil: null },
        ] as never);

        await expect(AuthService.pinLogin(input())).rejects.toThrow(GENERIC);

        const where = (rows.mock.calls[0][0] as { where: { ipKey: string; lastAttemptAt: { gte: Date } } }).where;
        expect(where.ipKey).toBe('device:7');
        expect(Date.now() - where.lastAttemptAt.gte.getTime()).toBeGreaterThan(14 * 60_000);
        expect(find).not.toHaveBeenCalled();
        expect(sessionCreate).not.toHaveBeenCalled();
    });

    it('login() still returns the same payload shape after the issueSession refactor', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(
            waiter({ password: 'x', twoFactorEnabled: false }) as never);
        jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
        const { sessionCreate } = mockInfra();

        const result = await AuthService.login('ana', 'Whatever1!', undefined, '10.0.0.1', 'Mozilla Windows');

        expect(Object.keys(result).sort()).toEqual(
            ['mustChangePassword', 'passwordExpired', 'sessionTimeoutMinutes', 'token', 'user']);
        const payload = result as { user: object; sessionTimeoutMinutes: number };
        expect(Object.keys(payload.user).sort()).toEqual([
            'accountType', 'branchId', 'color', 'company', 'companyId', 'email', 'employeeId', 'id', 'name',
            'permissions', 'role', 'roles', 'username']);
        expect(payload.sessionTimeoutMinutes).toBe(30);
        expect(sessionCreate.mock.calls[0][0].data.device).toBe('Windows');
    });
});

describe('AuthService.deviceRoster', () => {
    it('returns only id, name, initials and color, filtered to PIN-capable users of the branch', async () => {
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(device() as never);
        const find = jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
            { id: 21, name: 'Ana María Pérez', color: null },
        ] as never);

        const roster = await AuthService.deviceRoster('tok');

        expect(roster).toEqual([{ id: 21, name: 'Ana María Pérez', initials: 'AP', color: null }]);
        const args = find.mock.calls[0][0] as { where: Record<string, unknown>; select: Record<string, boolean> };
        expect(args.select).toEqual({ id: true, name: true, color: true });
        expect(args.where).toMatchObject({ companyId: 5, status: 'ACTIVE', pinHash: { not: null } });
        expect(JSON.stringify(args.where)).toContain('MESERO');
        expect(JSON.stringify(args.where)).not.toContain('ADMIN');
    });

    it('rejects kitchen and unknown devices', async () => {
        const resolve = jest.spyOn(OperationalDeviceService, 'resolveActive');
        resolve.mockResolvedValue(device({ type: 'KITCHEN_TABLET' }) as never);
        await expect(AuthService.deviceRoster('tok')).rejects.toThrow(GENERIC);
        resolve.mockResolvedValue(null);
        await expect(AuthService.deviceRoster('tok')).rejects.toThrow(GENERIC);
    });
});

describe('CSRF exemption for device-token auth routes', () => {
    it('lets /auth/pin-login through without a CSRF token', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { csrfProtection } = require('../../middlewares/csrf');
        const next = jest.fn();
        const res = { cookie: jest.fn(), setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        csrfProtection({ path: '/auth/pin-login', method: 'POST', headers: {} }, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });
});
