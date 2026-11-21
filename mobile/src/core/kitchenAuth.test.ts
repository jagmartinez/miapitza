import { createKitchenAuth } from './kitchenAuth';
import { appEvents } from './events';
import { fakeApi, pathOf, user } from '../test/helpers';

function setup(responses: Array<{ status?: number; data?: unknown }>) {
    let i = 0;
    const api = fakeApi(() => responses[Math.min(i++, responses.length - 1)]);
    const log: string[] = [];
    const realtime = {
        reconnect: vi.fn(async () => {
            log.push(`reconnect(${(await api.sessions.load())?.token ?? 'none'})`);
        }),
    };
    const onRevoked = vi.fn();
    const onSession = vi.fn();
    const auth = createKitchenAuth({ http: api.http, sessions: api.sessions, realtime, onRevoked, onSession });
    return { ...api, realtime, log, onRevoked, onSession, auth };
}

const ok = (token: string, extra: object = {}) => ({ data: { success: true, data: { token, user, ...extra } } });
const logins = (calls: Array<Parameters<typeof pathOf>[0]>) => calls.filter((c) => pathOf(c) === 'POST /auth/device-login').length;

describe('kitchenAuth', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('logs in with the stored device token at start, saves the session, then connects realtime', async () => {
        const { auth, sessions, calls, log, onSession } = setup([ok('k-1', { mustChangePassword: true, passwordExpired: true })]);
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        expect(calls[0].headers.get('X-Device-Token')).toBe('dev-1');
        expect((await sessions.load())?.token).toBe('k-1');
        expect(log).toEqual(['reconnect(k-1)']);
        expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ token: 'k-1' })); // flags ignored
        auth.stop();
    });

    it('silently re-runs device-login on session-expired', async () => {
        const { auth, sessions, calls } = setup([ok('k-1'), ok('k-2')]);
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        await sessions.clear();
        appEvents.emit('session-expired');
        await vi.advanceTimersByTimeAsync(10_000);
        expect(logins(calls)).toBe(2);
        expect((await sessions.load())?.token).toBe('k-2');
        auth.stop();
    });

    it('backs off on transient failures instead of storming the server', async () => {
        const { auth, sessions, calls } = setup([{ status: 503 }]);
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        expect(logins(calls)).toBe(1);
        await vi.advanceTimersByTimeAsync(10_000);
        const afterTen = logins(calls);
        expect(afterTen).toBeGreaterThan(1);
        expect(afterTen).toBeLessThanOrEqual(4); // exponential, not a tight loop
        await vi.advanceTimersByTimeAsync(300_000);
        expect(logins(calls) - afterTen).toBeLessThanOrEqual(15); // capped delay
        auth.stop();
    });

    it('rate-limits repeated expiries right after a successful login', async () => {
        const { auth, sessions, calls } = setup([ok('k-1')]);
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        for (let n = 0; n < 5; n++) {
            appEvents.emit('session-expired');
            await vi.advanceTimersByTimeAsync(100);
        }
        expect(logins(calls)).toBeLessThanOrEqual(2);
        auth.stop();
    });

    it('grows the re-login backoff when the socket never reaches CONNECTED, and resets on online', async () => {
        const { auth, sessions, calls } = setup([ok('k-1')]);
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        const waits: number[] = [];
        for (let n = 0; n < 4; n++) {
            const before = logins(calls);
            appEvents.emit('session-expired');
            let waited = 0;
            while (logins(calls) === before && waited < 60_000) {
                await vi.advanceTimersByTimeAsync(100);
                waited += 100;
            }
            waits.push(waited);
        }
        expect(waits[0]).toBeGreaterThanOrEqual(900);
        expect(waits[1]).toBeGreaterThanOrEqual(1900);
        expect(waits[2]).toBeGreaterThanOrEqual(3900);
        appEvents.emit('realtime-status', 'online');
        const before = logins(calls);
        appEvents.emit('session-expired');
        await vi.advanceTimersByTimeAsync(50);
        expect(logins(calls)).toBe(before + 1);
        auth.stop();
    });

    it('unpairs only on 401 with code DEVICE_NOT_ACTIVE: clears the device and stops retrying', async () => {
        const { auth, sessions, calls, onRevoked } = setup([{ status: 401, data: { success: false, code: 'DEVICE_NOT_ACTIVE' } }]);
        await sessions.saveDeviceToken('dev-1');
        await sessions.saveDeviceType('KITCHEN_TABLET');
        await auth.start();
        expect(onRevoked).toHaveBeenCalledTimes(1);
        expect(await sessions.deviceToken()).toBeNull();
        expect(await sessions.deviceType()).toBeNull();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(logins(calls)).toBe(1);
        auth.stop();
    });

    it('401 without a code backs off and retries, never unpairs', async () => {
        const { auth, sessions, calls, onRevoked } = setup([{ status: 401, data: { success: false } }, ok('k-1')]);
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        expect(onRevoked).not.toHaveBeenCalled();
        expect(await sessions.deviceToken()).toBe('dev-1');
        await vi.advanceTimersByTimeAsync(1500);
        expect(logins(calls)).toBe(2);
        expect((await sessions.load())?.token).toBe('k-1');
        auth.stop();
    });

    it('403 KITCHEN_ACCOUNT_UNAVAILABLE reports account-unavailable and retries every 60 s without unpairing', async () => {
        const { auth, sessions, calls, onRevoked } = setup([
            { status: 403, data: { success: false, code: 'KITCHEN_ACCOUNT_UNAVAILABLE' } },
            { status: 403, data: { success: false, code: 'KITCHEN_ACCOUNT_UNAVAILABLE' } },
            ok('k-1'),
        ]);
        const statuses: unknown[] = [];
        const off = appEvents.on('kitchen-auth-status', (s) => statuses.push(s));
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        expect(statuses).toContain('account-unavailable');
        expect(logins(calls)).toBe(1);
        await vi.advanceTimersByTimeAsync(59_000);
        expect(logins(calls)).toBe(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(logins(calls)).toBe(2);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(logins(calls)).toBe(3);
        expect(onRevoked).not.toHaveBeenCalled();
        expect(await sessions.deviceToken()).toBe('dev-1');
        off();
        auth.stop();
    });

    it('session-expired reports renewing, re-logs in, then online once the socket connects', async () => {
        const { auth, sessions, calls } = setup([ok('k-1'), ok('k-2')]);
        const statuses: unknown[] = [];
        const off = appEvents.on('kitchen-auth-status', (s) => statuses.push(s));
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        appEvents.emit('realtime-status', 'online');
        expect(statuses[statuses.length - 1]).toBe('online');
        await sessions.clear();
        appEvents.emit('session-expired');
        expect(statuses[statuses.length - 1]).toBe('renewing');
        await vi.advanceTimersByTimeAsync(100);
        expect(logins(calls)).toBe(2);
        expect(statuses[statuses.length - 1]).toBe('renewing');
        appEvents.emit('realtime-status', 'online');
        expect(statuses[statuses.length - 1]).toBe('online');
        off();
        auth.stop();
    });

    it('stop() unsubscribes from session-expired and cancels pending retries', async () => {
        const { auth, sessions, calls } = setup([{ status: 503 }]);
        await sessions.saveDeviceToken('dev-1');
        await auth.start();
        auth.stop();
        appEvents.emit('session-expired');
        await vi.advanceTimersByTimeAsync(120_000);
        expect(logins(calls)).toBe(1);
    });
});
