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
    it('adds Bearer and X-Device-Token', async () => {
        const { sessions, http, seen } = setup();
        await sessions.save(session);
        await sessions.saveDeviceToken('dev-9');
        await http.get('/orders');
        expect(seen[0].headers.get('Authorization')).toBe('Bearer jwt-123');
        expect(seen[0].headers.get('X-Device-Token')).toBe('dev-9');
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

describe('session store', () => {
    it('round-trips and ignores corrupt data', async () => {
        const store = memoryStore();
        const sessions = createSessionStore(store);
        await sessions.save(session);
        expect(await sessions.load()).toEqual(session);
        await store.set('session', '{not json');
        expect(await sessions.load()).toBeNull();
    });
});
