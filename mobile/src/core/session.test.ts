import { appEvents } from './events';
import { createSessionStore, memoryStore } from './session';

describe('session store device pairing', () => {
    it('stores device type next to the token and clears both together', async () => {
        const sessions = createSessionStore(memoryStore());
        expect(await sessions.deviceType()).toBeNull();
        await sessions.saveDeviceToken('d-1');
        await sessions.saveDeviceType('KITCHEN_TABLET');
        expect(await sessions.deviceType()).toBe('KITCHEN_TABLET');
        await sessions.clearDevice();
        expect(await sessions.deviceToken()).toBeNull();
        expect(await sessions.deviceType()).toBeNull();
    });

    it('ignores an unknown stored device type', async () => {
        const store = memoryStore();
        await store.set('deviceType', 'TOASTER');
        expect(await createSessionStore(store).deviceType()).toBeNull();
    });
});

describe('session store resilience', () => {
    const failing = (over: Partial<Record<'get' | 'set' | 'remove', boolean>>) => {
        const inner = memoryStore();
        const calls = { get: 0, set: 0 };
        return {
            calls,
            store: {
                async get(k: string) {
                    calls.get++;
                    if (over.get) throw new Error('keystore');
                    return inner.get(k);
                },
                async set(k: string, v: string) {
                    calls.set++;
                    if (over.set) throw new Error('keystore');
                    return inner.set(k, v);
                },
                async remove(k: string) {
                    if (over.remove) throw new Error('keystore');
                    return inner.remove(k);
                },
            },
        };
    };

    it('reads from memory after the first load', async () => {
        const { store, calls } = failing({});
        const sessions = createSessionStore(store);
        await sessions.saveDeviceToken('d-1');
        await sessions.deviceToken();
        await sessions.deviceToken();
        expect(calls.get).toBe(0);
        const fresh = createSessionStore(store);
        await fresh.deviceToken();
        await fresh.deviceToken();
        expect(calls.get).toBe(1);
    });

    it('a throwing read is treated as absent and reported without values', async () => {
        const sessions = createSessionStore(failing({ get: true }).store);
        const events: unknown[] = [];
        const off = appEvents.on('storage-error', (p) => events.push(p));
        expect(await sessions.load()).toBeNull();
        expect(await sessions.deviceType()).toBeNull();
        expect(await sessions.deviceToken()).toBeNull();
        off();
        expect(events[0]).toEqual({ op: 'read', key: 'session' });
    });

    it('a throwing write keeps the value in memory and reports a non-secret event', async () => {
        const sessions = createSessionStore(failing({ set: true }).store);
        const events: unknown[] = [];
        const off = appEvents.on('storage-error', (p) => events.push(p));
        await sessions.save({ token: 'secret-tok', issuedAt: 1, user: {} as never });
        await sessions.saveDeviceToken('secret-dev');
        off();
        expect((await sessions.load())?.token).toBe('secret-tok');
        expect(await sessions.deviceToken()).toBe('secret-dev');
        expect(events).toEqual([{ op: 'write', key: 'session' }, { op: 'write', key: 'deviceToken' }]);
        expect(JSON.stringify(events)).not.toContain('secret');
    });

    it('clear and clearDevice never throw and clear the memory copy even if remove fails', async () => {
        const sessions = createSessionStore(failing({ remove: true }).store);
        await sessions.save({ token: 't', issuedAt: 1, user: {} as never });
        await sessions.saveDeviceToken('d');
        await sessions.saveDeviceType('SERVICE_TABLET');
        await expect(sessions.clear()).resolves.toBeUndefined();
        await expect(sessions.clearDevice()).resolves.toBeUndefined();
        expect(await sessions.load()).toBeNull();
        expect(await sessions.deviceToken()).toBeNull();
        expect(await sessions.deviceType()).toBeNull();
    });

    it('clear drops the memory copy synchronously', async () => {
        const sessions = createSessionStore(memoryStore());
        await sessions.save({ token: 't', issuedAt: 1, user: {} as never });
        void sessions.clear();
        expect(await sessions.load()).toBeNull();
    });

    it('a write during a slow first read wins over the stale read', async () => {
        const inner = memoryStore();
        await inner.set('deviceToken', 'old');
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const sessions = createSessionStore({
            get: async (k) => {
                const v = await inner.get(k);
                await gate;
                return v;
            },
            set: inner.set,
            remove: inner.remove,
        });
        const pending = sessions.deviceToken();
        await sessions.saveDeviceToken('new');
        release();
        expect(await pending).toBe('new');
    });
});

describe('nativeSecureStore', () => {
    afterEach(() => {
        vi.doUnmock('@aparajita/capacitor-secure-storage');
        vi.resetModules();
    });

    async function withPlugin(plugin: Record<string, unknown>) {
        vi.resetModules();
        vi.doMock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: plugin }));
        const mod = await import('./session');
        return mod.nativeSecureStore();
    }

    it('never awaits the plugin proxy itself (Capacitor proxies throw on .then)', async () => {
        const proxyLike = {
            then: () => {
                throw new Error('"SecureStorage.then()" is not implemented on android');
            },
            getItem: vi.fn().mockResolvedValue('stored'),
            setItem: vi.fn().mockResolvedValue(undefined),
        };
        const store = await withPlugin(proxyLike);
        expect(await store.get('session')).toBe('stored');
        await expect(store.set('session', 'x')).resolves.toBeUndefined();
        expect(proxyLike.setItem).toHaveBeenCalledWith('session', 'x');
    });

    it('a failing or non-string read is null, never a throw', async () => {
        const failingStore = await withPlugin({ getItem: vi.fn().mockRejectedValue(new Error('keystore')) });
        expect(await failingStore.get('session')).toBeNull();
        const odd = await withPlugin({ getItem: vi.fn().mockResolvedValue({ weird: true }) });
        expect(await odd.get('session')).toBeNull();
    });

    it('a failing remove does not throw; a failing set does so the session store can report it', async () => {
        const store = await withPlugin({
            removeItem: vi.fn().mockRejectedValue(new Error('keystore')),
            setItem: vi.fn().mockRejectedValue(new Error('keystore')),
        });
        await expect(store.remove('session')).resolves.toBeUndefined();
        await expect(store.set('session', 'x')).rejects.toThrow();
    });

    it('passes values through when the plugin works', async () => {
        const setItem = vi.fn().mockResolvedValue(undefined);
        const store = await withPlugin({ getItem: vi.fn().mockResolvedValue('v'), setItem });
        expect(await store.get('k')).toBe('v');
        await store.set('k', 'v2');
        expect(setItem).toHaveBeenCalledWith('k', 'v2');
    });
});
