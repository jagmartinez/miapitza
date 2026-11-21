import { createAccountApi } from './accountApi';
import { fakeApi, pathOf } from '../../test/helpers';

const loginUser = { id: 9, name: 'Eva', email: 'e@x', username: 'eva', role: { id: 1, name: 'MESERO' }, roles: ['MESERO'], branchId: 1, companyId: 1, permissions: [] };

function build(handler: Parameters<typeof fakeApi>[0]) {
    const api = fakeApi(handler);
    const realtime = { close: vi.fn(), reconnect: vi.fn().mockResolvedValue(undefined) };
    return { ...api, realtime, account: createAccountApi({ http: api.http, sessions: api.sessions, realtime }) };
}

describe('accountApi', () => {
    it('login keeps mustChangePassword/passwordExpired/sessionTimeoutMinutes', async () => {
        const { account, sessions } = build(() => ({
            data: { success: true, data: { token: 't', user: loginUser, mustChangePassword: true, passwordExpired: false, sessionTimeoutMinutes: 30 } },
        }));
        const result = await account.login('eva', 'pw');
        expect(result.status).toBe('ok');
        const stored = await sessions.load();
        expect(stored).toMatchObject({ mustChangePassword: true, passwordExpired: false, sessionTimeoutMinutes: 30 });
    });

    it('login 2FA flow is unchanged', async () => {
        const bodies: unknown[] = [];
        const { account } = build((c) => {
            bodies.push(JSON.parse(String(c.data)));
            return bodies.length === 1
                ? { data: { success: true, data: { requires2FA: true } } }
                : { data: { success: true, data: { token: 't', user: loginUser } } };
        });
        expect((await account.login('eva', 'pw')).status).toBe('2fa');
        expect((await account.login('eva', 'pw', '123456')).status).toBe('ok');
        expect(bodies[1]).toEqual({ username: 'eva', password: 'pw', twoFactorCode: '123456' });
    });

    it('changePassword posts both passwords and clears the local session', async () => {
        const { account, sessions, calls, realtime } = build(() => ({ data: { success: true } }));
        await sessions.save({ token: 't', issuedAt: 1, user: loginUser });
        await account.changePassword('old', 'newpassword');
        expect(pathOf(calls[0])).toBe('POST /auth/change-password');
        expect(JSON.parse(String(calls[0].data))).toEqual({ oldPassword: 'old', newPassword: 'newpassword' });
        expect(await sessions.load()).toBeNull();
        expect(realtime.close).toHaveBeenCalled();
    });

    it('changePassword failure keeps the session', async () => {
        const { account, sessions } = build(() => ({ status: 400, data: { success: false, message: 'Contraseña actual incorrecta' } }));
        await sessions.save({ token: 't', issuedAt: 1, user: loginUser });
        await expect(account.changePassword('x', 'newpassword')).rejects.toBeTruthy();
        expect(await sessions.load()).not.toBeNull();
    });
});
