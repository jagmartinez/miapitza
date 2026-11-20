import { createPinApi } from './pinApi';
import { fakeApi, pathOf, session, user } from '../../test/helpers';

function setup(handler: Parameters<typeof fakeApi>[0] = () => ({})) {
    const log: string[] = [];
    const api = fakeApi((config) => {
        log.push(pathOf(config));
        return handler(config);
    });
    const realtime = {
        close: vi.fn(() => void log.push('realtime.close')),
        reconnect: vi.fn(async () => {
            log.push(`realtime.reconnect(session=${(await api.sessions.load())?.token ?? 'none'})`);
        }),
    };
    return { ...api, realtime, log, pin: createPinApi({ http: api.http, sessions: api.sessions, realtime }) };
}

describe('pinApi', () => {
    it('roster returns the users the server lists', async () => {
        const roster = [{ id: 1, name: 'Ana Perez', initials: 'AP', color: null }];
        const { pin } = setup(() => ({ data: { success: true, data: roster } }));
        expect(await pin.roster()).toEqual(roster);
    });

    it('login saves the session BEFORE reconnecting realtime', async () => {
        const { pin, log, sessions } = setup(() => ({ data: { success: true, data: { token: 'tok-new', user } } }));
        const result = await pin.login(7, '1234');
        expect(result.token).toBe('tok-new');
        expect((await sessions.load())?.token).toBe('tok-new');
        expect(log).toEqual(['POST /auth/pin-login', 'realtime.reconnect(session=tok-new)']);
    });

    it('login failure leaves no session and does not touch realtime', async () => {
        const { pin, realtime, sessions } = setup(() => ({ status: 401 }));
        await expect(pin.login(7, '0000')).rejects.toBeTruthy();
        expect(await sessions.load()).toBeNull();
        expect(realtime.reconnect).not.toHaveBeenCalled();
    });

    it('logout resolves and clears the session even if the server call never returns', async () => {
        const { pin, realtime, sessions, calls } = setup(() => new Promise(() => {}));
        await sessions.save(session);
        await pin.logout(); // would hang forever if it waited on the network
        expect(realtime.close).toHaveBeenCalled();
        expect(await sessions.load()).toBeNull();
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].headers.get('Authorization')).toBe('Bearer tok-1');
        expect(calls[0].timeout).toBe(5000);
    });

    it('logout closes realtime BEFORE revoking the session, then clears it', async () => {
        const { pin, log, sessions, calls } = setup();
        await sessions.save(session);
        await pin.logout();
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(log).toEqual(['realtime.close', 'POST /auth/logout']);
        expect(calls[0].headers.get('Authorization')).toBe('Bearer tok-1');
        expect(await sessions.load()).toBeNull();
    });

    it('logout still clears the local session when the server call fails', async () => {
        const { pin, sessions } = setup(() => ({ status: 500 }));
        await sessions.save(session);
        await pin.logout();
        expect(await sessions.load()).toBeNull();
    });
});
