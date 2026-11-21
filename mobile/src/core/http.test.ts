import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { createHttp } from './http';
import { appEvents } from './events';
import { createSessionStore, memoryStore, type Session } from './session';

const session: Session = {
    token: 'jwt-123',
    issuedAt: 1,
    user: { id: 1, name: 'A', email: 'a@x', username: 'a', role: { id: 1, name: 'ADMIN' }, roles: ['ADMIN'], branchId: 1, companyId: 1, permissions: [] },
};

function setup(status = 200) {
    const sessions = createSessionStore(memoryStore());
    const seen: InternalAxiosRequestConfig[] = [];
    const http = createHttp({ baseURL: 'http://x/api', sessions });
    const adapter: AxiosAdapter = async (config) => {
        seen.push(config);
        const response = { data: {}, status, statusText: '', headers: {}, config };
        if (status >= 400) throw new AxiosError('fail', String(status), config, null, response);
        return response;
    };
    http.defaults.adapter = adapter;
    return { sessions, http, seen };
}

describe('http', () => {
    it('adds Bearer, and X-Device-Token only on the device endpoints', async () => {
        const { sessions, http, seen } = setup();
        await sessions.save(session);
        await sessions.saveDeviceToken('dev-9');
        await http.get('/orders');
        expect(seen[0].headers.get('Authorization')).toBe('Bearer jwt-123');
        expect(seen[0].headers.get('X-Device-Token')).toBeFalsy();
        for (const path of ['/auth/device-roster', '/auth/device-roster/', '/auth/pin-login', '/auth/device-login']) {
            await http.get(path);
            expect(seen[seen.length - 1].headers.get('X-Device-Token'), path).toBe('dev-9');
        }
        for (const path of ['/auth/logout', '/reports/auth/pin-login', '/auth/device-roster-x', '/auth/login']) {
            await http.get(path);
            expect(seen[seen.length - 1].headers.get('X-Device-Token'), path).toBeFalsy();
        }
    });

    it('never sends the device token to a foreign origin even on a device path', async () => {
        const { sessions, http, seen } = setup();
        await sessions.saveDeviceToken('dev-9');
        await http.get('http://evil.test/api/auth/device-roster');
        expect(seen[0].headers.get('X-Device-Token')).toBeFalsy();
    });

    it('has a default timeout so a hung request fails', () => {
        expect(setup().http.defaults.timeout).toBe(15000);
    });

    it('an explicit Authorization header is not overridden by the stored session', async () => {
        const { sessions, http, seen } = setup();
        await sessions.save(session);
        await http.post('/auth/logout', undefined, { headers: { Authorization: 'Bearer old' } });
        expect(seen[0].headers.get('Authorization')).toBe('Bearer old');
    });

    it('a 401 still surfaces as the original error and emits session-expired when storage throws', async () => {
        const sessions = createSessionStore({
            get: async () => JSON.stringify(session),
            set: async () => {},
            remove: async () => {
                throw new Error('keystore');
            },
        });
        const http = createHttp({ baseURL: 'http://x/api', sessions });
        http.defaults.adapter = async (config) => {
            throw new AxiosError('fail', '401', config, null, { data: {}, status: 401, statusText: '', headers: {}, config });
        };
        const fn = vi.fn();
        const off = appEvents.on('session-expired', fn);
        await expect(http.get('/orders')).rejects.toMatchObject({ response: { status: 401 } });
        off();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('sends neither header when nothing is stored', async () => {
        const { http, seen } = setup();
        await http.get('/orders');
        expect(seen[0].headers.get('Authorization')).toBeFalsy();
        expect(seen[0].headers.get('X-Device-Token')).toBeFalsy();
    });

    it('401 clears only the session and emits session-expired', async () => {
        const { sessions, http } = setup(401);
        await sessions.save(session);
        await sessions.saveDeviceToken('dev-9');
        const fn = vi.fn();
        const off = appEvents.on('session-expired', fn);
        await expect(http.get('/orders')).rejects.toBeTruthy();
        off();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(await sessions.load()).toBeNull();
        expect(await sessions.deviceToken()).toBe('dev-9');
    });

    it('a 401 from a login endpoint (bad credentials) does not expire the session', async () => {
        const { sessions, http } = setup(401);
        await sessions.save(session);
        const fn = vi.fn();
        const off = appEvents.on('session-expired', fn);
        await expect(http.post('/auth/pin-login', {})).rejects.toBeTruthy();
        off();
        expect(fn).not.toHaveBeenCalled();
        expect(await sessions.load()).not.toBeNull();
    });
});

describe('http hardening', () => {
    const session2: Session = { ...session, token: 'jwt-NEW' };

    it('does not attach credentials to absolute URLs on other origins', async () => {
        const { sessions, http, seen } = setup();
        await sessions.save(session);
        await sessions.saveDeviceToken('dev-9');
        await http.get('https://evil.example/steal');
        expect(seen[0].headers.get('Authorization')).toBeFalsy();
        expect(seen[0].headers.get('X-Device-Token')).toBeFalsy();
        await http.get('http://x/api/other');
        expect(seen[1].headers.get('Authorization')).toBe('Bearer jwt-123');
    });

    it('late 401 from an old-token request does not wipe the new session', async () => {
        const sessions = createSessionStore(memoryStore());
        const http = createHttp({ baseURL: 'http://x/api', sessions });
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        http.defaults.adapter = async (config) => {
            await gate;
            throw new AxiosError('fail', '401', config, null, { data: {}, status: 401, statusText: '', headers: {}, config });
        };
        await sessions.save(session);
        const fn = vi.fn();
        const off = appEvents.on('session-expired', fn);
        const pending = http.get('/orders').catch(() => 'rejected');
        await new Promise((r) => setTimeout(r, 0)); // request is in flight with the old token
        await sessions.save(session2); // PIN switch
        release();
        expect(await pending).toBe('rejected');
        off();
        expect(fn).not.toHaveBeenCalled();
        expect((await sessions.load())?.token).toBe('jwt-NEW');
    });

    it('a burst of 401s clears once and emits once', async () => {
        const { sessions, http } = setup(401);
        await sessions.save(session);
        const clear = vi.spyOn(sessions, 'clear');
        const fn = vi.fn();
        const off = appEvents.on('session-expired', fn);
        await Promise.allSettled([http.get('/a'), http.get('/b'), http.get('/c'), http.get('/d')]);
        off();
        expect(clear).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('login-path exception is exact, tolerating a trailing slash', async () => {
        const check = async (url: string) => {
            const { sessions, http } = setup(401);
            await sessions.save(session);
            const fn = vi.fn();
            const off = appEvents.on('session-expired', fn);
            await http.get(url).catch(() => undefined);
            off();
            return fn.mock.calls.length;
        };
        expect(await check('/auth/login/')).toBe(0);
        expect(await check('/auth/device-login')).toBe(0);
        expect(await check('/auth/login?x=1')).toBe(0);
        expect(await check('/reports/auth/login')).toBe(1);
        expect(await check('/auth/login-history')).toBe(1);
    });
});

describe('session store', () => {
    it('round-trips and ignores corrupt data', async () => {
        const store = memoryStore();
        const sessions = createSessionStore(store);
        await sessions.save(session);
        expect(await sessions.load()).toEqual(session);
        await store.set('session', '{not json');
        expect(await createSessionStore(store).load()).toBeNull();
    });
});

describe('http discount endpoints', () => {
    it('sends X-Device-Token only to the discount supervisor endpoints, by pattern', async () => {
        const { sessions, http, seen } = setup();
        await sessions.save(session);
        await sessions.saveDeviceToken('dev-9');
        for (const [method, path] of [['get', '/orders/discount/supervisors'], ['get', '/orders/discount/supervisors/'], ['post', '/orders/12/discount/authorize'], ['post', '/orders/12/discount/authorize/']] as const) {
            await http.request({ method, url: path });
            expect(seen[seen.length - 1].headers.get('X-Device-Token'), path).toBe('dev-9');
        }
        for (const path of ['/orders/discount/supervisors/x', '/orders/12/discount', '/orders/x/discount/authorize', '/orders/12/pricing', '/orders/12/discount/authorize/extra', '/x/orders/12/discount/authorize']) {
            await http.post(path);
            expect(seen[seen.length - 1].headers.get('X-Device-Token'), path).toBeFalsy();
        }
    });

    it('a 401 from the discount endpoints is a wrong PIN, not session expiry', async () => {
        const { sessions, http } = setup(401);
        await sessions.save(session);
        const fn = vi.fn();
        const off = appEvents.on('session-expired', fn);
        await expect(http.post('/orders/12/discount/authorize')).rejects.toMatchObject({ response: { status: 401 } });
        await expect(http.get('/orders/discount/supervisors')).rejects.toMatchObject({ response: { status: 401 } });
        expect(fn).not.toHaveBeenCalled();
        expect(await sessions.load()).not.toBeNull();
        await expect(http.post('/orders/12/pricing')).rejects.toMatchObject({ response: { status: 401 } });
        off();
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('http 403 PASSWORD_CHANGE_REQUIRED', () => {
    function setup403(code: string) {
        const sessions = createSessionStore(memoryStore());
        const http = createHttp({ baseURL: 'http://x/api', sessions });
        http.defaults.adapter = async (config) => {
            throw new AxiosError('fail', '403', config, null, { data: { success: false, code }, status: 403, statusText: '', headers: {}, config });
        };
        return { sessions, http };
    }

    it('emits password-change-required and keeps the session', async () => {
        const { sessions, http } = setup403('PASSWORD_CHANGE_REQUIRED');
        await sessions.save(session);
        const required = vi.fn();
        const expired = vi.fn();
        const off1 = appEvents.on('password-change-required', required);
        const off2 = appEvents.on('session-expired', expired);
        await expect(http.get('/orders')).rejects.toBeTruthy();
        off1();
        off2();
        expect(required).toHaveBeenCalledTimes(1);
        expect(expired).not.toHaveBeenCalled();
        expect(await sessions.load()).not.toBeNull();
    });

    it('other 403s emit nothing', async () => {
        const { sessions, http } = setup403('FORBIDDEN');
        await sessions.save(session);
        const required = vi.fn();
        const off = appEvents.on('password-change-required', required);
        await expect(http.get('/orders')).rejects.toBeTruthy();
        off();
        expect(required).not.toHaveBeenCalled();
    });
});
