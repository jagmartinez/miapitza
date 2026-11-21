import { createRealtime } from './realtime';
import { appEvents } from './events';

class FakeWS {
    static instances: FakeWS[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    sent: string[] = [];
    closed = false;
    constructor(public url: string) {
        FakeWS.instances.push(this);
    }
    send(d: string) {
        this.sent.push(d);
    }
    close() {
        this.closed = true;
    }
    open() {
        this.onopen?.();
    }
    serverClose(code = 1006) {
        this.onclose?.({ code });
    }
    serverSend(obj: unknown) {
        this.onmessage?.({ data: JSON.stringify(obj) });
    }
}

const make = (getToken: () => Promise<string | null> = async () => 'tok') =>
    createRealtime({ url: 'ws://x', getToken, WebSocketImpl: FakeWS as unknown as typeof WebSocket });
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor exactly 1
    FakeWS.instances = [];
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('realtime', () => {
    it('sends AUTH first on open', async () => {
        const rt = make();
        rt.connect();
        FakeWS.instances[0].open();
        await flush();
        expect(FakeWS.instances[0].sent).toEqual([JSON.stringify({ type: 'AUTH', payload: { token: 'tok' } })]);
        rt.close();
    });

    it('goes online on CONNECTED and dispatches typed messages', async () => {
        const status = vi.fn();
        const off = appEvents.on('realtime-status', status);
        const rt = make();
        const got = vi.fn();
        rt.subscribe('ORDER_UPDATED', got);
        rt.connect();
        const ws = FakeWS.instances[0];
        ws.open();
        await flush();
        ws.serverSend({ type: 'CONNECTED', payload: {} });
        ws.serverSend({ type: 'ORDER_UPDATED', payload: { id: 5 } });
        expect(status).toHaveBeenLastCalledWith('online');
        expect(got).toHaveBeenCalledWith({ id: 5 });
        off();
        rt.close();
    });

    it('reconnects with growing backoff capped at 30000 ms', async () => {
        const rt = make();
        rt.connect();
        const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
        for (let i = 0; i < delays.length; i++) {
            expect(FakeWS.instances).toHaveLength(i + 1);
            FakeWS.instances[i].serverClose(1006);
            await vi.advanceTimersByTimeAsync(delays[i] - 1);
            expect(FakeWS.instances).toHaveLength(i + 1);
            await vi.advanceTimersByTimeAsync(1);
            expect(FakeWS.instances).toHaveLength(i + 2);
        }
        rt.close();
    });

    it('reconnect delay has ±20 % jitter within [800 ms, 36 s]', async () => {
        const rand = vi.spyOn(Math, 'random');
        const firstDelay = async (r: number) => {
            FakeWS.instances = [];
            rand.mockReturnValue(r);
            const rt = make();
            rt.connect();
            FakeWS.instances[0].serverClose(1006);
            let waited = 0;
            while (FakeWS.instances.length < 2 && waited < 40_000) {
                await vi.advanceTimersByTimeAsync(10);
                waited += 10;
            }
            rt.close();
            return waited;
        };
        expect(await firstDelay(0)).toBe(800);
        expect(await firstDelay(1)).toBe(1200);
        // capped delay (30 s) stays within 36 s at the top of the jitter range
        rand.mockReturnValue(1);
        const rt = make();
        FakeWS.instances = [];
        rt.connect();
        for (let i = 0; i < 6; i++) {
            FakeWS.instances[i].serverClose(1006);
            await vi.advanceTimersByTimeAsync(36_000);
        }
        expect(FakeWS.instances).toHaveLength(7);
        rt.close();
    });

    it('resets backoff after an authenticated connection', async () => {
        const rt = make();
        rt.connect();
        FakeWS.instances[0].serverClose();
        await vi.advanceTimersByTimeAsync(1000);
        FakeWS.instances[1].serverClose();
        await vi.advanceTimersByTimeAsync(2000);
        const ws = FakeWS.instances[2];
        ws.open();
        await flush();
        ws.serverSend({ type: 'CONNECTED' });
        ws.serverClose();
        await vi.advanceTimersByTimeAsync(1000);
        expect(FakeWS.instances).toHaveLength(4);
        rt.close();
    });

    it('does not reconnect on 4001; emits session-expired', async () => {
        const expired = vi.fn();
        const off = appEvents.on('session-expired', expired);
        const rt = make();
        rt.connect();
        FakeWS.instances[0].serverClose(4001);
        await vi.advanceTimersByTimeAsync(120000);
        expect(FakeWS.instances).toHaveLength(1);
        expect(expired).toHaveBeenCalledTimes(1);
        off();
    });

    it('stops without AUTH when there is no token', async () => {
        const expired = vi.fn();
        const off = appEvents.on('session-expired', expired);
        const rt = make(async () => null);
        rt.connect();
        FakeWS.instances[0].open();
        await flush();
        expect(FakeWS.instances[0].sent).toEqual([]);
        expect(FakeWS.instances[0].closed).toBe(true);
        await vi.advanceTimersByTimeAsync(60000);
        expect(FakeWS.instances).toHaveLength(1);
        expect(expired).toHaveBeenCalledTimes(1);
        off();
    });

    it('close() stops reconnecting', async () => {
        const rt = make();
        rt.connect();
        FakeWS.instances[0].serverClose();
        rt.close();
        await vi.advanceTimersByTimeAsync(60000);
        expect(FakeWS.instances).toHaveLength(1);
    });

    it('4001 on an old-session socket after a PIN switch reconnects with the new token, no logout', async () => {
        let token = 'old';
        const expired = vi.fn();
        const off = appEvents.on('session-expired', expired);
        const rt = make(async () => token);
        rt.connect();
        const first = FakeWS.instances[0];
        first.open();
        await flush();
        first.serverSend({ type: 'CONNECTED' });
        token = 'new'; // PIN switch; server revokes the old session and closes its socket
        first.serverClose(4001);
        await flush();
        expect(expired).not.toHaveBeenCalled();
        expect(FakeWS.instances).toHaveLength(2);
        FakeWS.instances[1].open();
        await flush();
        expect(FakeWS.instances[1].sent).toEqual([JSON.stringify({ type: 'AUTH', payload: { token: 'new' } })]);
        off();
        rt.close();
    });

    it('4001 with the still-current token expires the session', async () => {
        const expired = vi.fn();
        const off = appEvents.on('session-expired', expired);
        const rt = make(async () => 'same');
        rt.connect();
        FakeWS.instances[0].open();
        await flush();
        FakeWS.instances[0].serverClose(4001);
        await flush();
        await vi.advanceTimersByTimeAsync(60000);
        expect(expired).toHaveBeenCalledTimes(1);
        expect(FakeWS.instances).toHaveLength(1);
        off();
    });

    it('reconnect() closes the socket intentionally and re-auths with the current token', async () => {
        let token = 'old';
        const expired = vi.fn();
        const off = appEvents.on('session-expired', expired);
        const rt = make(async () => token);
        rt.connect();
        const first = FakeWS.instances[0];
        first.open();
        await flush();
        token = 'new';
        rt.reconnect();
        expect(first.closed).toBe(true);
        first.serverClose(4001); // late close of the old socket must be ignored
        await flush();
        expect(expired).not.toHaveBeenCalled();
        expect(FakeWS.instances).toHaveLength(2);
        FakeWS.instances[1].open();
        await flush();
        expect(FakeWS.instances[1].sent).toEqual([JSON.stringify({ type: 'AUTH', payload: { token: 'new' } })]);
        off();
        rt.close();
    });

    it('a throwing WebSocket constructor does not throw from connect() and retries with backoff', async () => {
        let calls = 0;
        const Throwing = class {
            constructor() {
                calls++;
                throw new Error('bad url');
            }
        };
        const rt = createRealtime({ url: 'nope', getToken: async () => 't', WebSocketImpl: Throwing as unknown as typeof WebSocket });
        expect(() => rt.connect()).not.toThrow();
        expect(calls).toBe(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(calls).toBe(2);
        await vi.advanceTimersByTimeAsync(2000);
        expect(calls).toBe(3);
        rt.close();
    });
});

describe('realtime subscriber gating', () => {
    it('delivers messages only after CONNECTED on the current socket', async () => {
        const rt = make();
        const got: unknown[] = [];
        rt.subscribe('ORDER_UPDATED', (p) => got.push(p));
        rt.connect();
        const ws = FakeWS.instances[0];
        ws.open();
        await flush();
        ws.serverSend({ type: 'ORDER_UPDATED', payload: 'early' });
        expect(got).toEqual([]);
        ws.serverSend({ type: 'CONNECTED', payload: {} });
        ws.serverSend({ type: 'ORDER_UPDATED', payload: 'late' });
        expect(got).toEqual(['late']);
        rt.close();
    });

    it('a reconnect must be re-authenticated before subscribers hear anything again', async () => {
        const rt = make();
        const got: unknown[] = [];
        rt.subscribe('ORDER_UPDATED', (p) => got.push(p));
        rt.connect();
        const first = FakeWS.instances[0];
        first.open();
        await flush();
        first.serverSend({ type: 'CONNECTED' });
        rt.reconnect();
        const second = FakeWS.instances[1];
        second.open();
        await flush();
        second.serverSend({ type: 'ORDER_UPDATED', payload: 'unauthenticated' });
        expect(got).toEqual([]);
        rt.close();
    });

    it('pings every 25 s while connected', async () => {
        const rt = make();
        rt.connect();
        const ws = FakeWS.instances[0];
        ws.open();
        await flush();
        ws.serverSend({ type: 'CONNECTED' });
        await vi.advanceTimersByTimeAsync(25_000);
        expect(ws.sent.filter((m) => JSON.parse(m).type === 'PING')).toHaveLength(1);
        ws.serverSend({ type: 'PONG' });
        await vi.advanceTimersByTimeAsync(25_000);
        expect(ws.sent.filter((m) => JSON.parse(m).type === 'PING')).toHaveLength(2);
    });

    it('silent socket is closed and reconnected after 60 s', async () => {
        const statuses: string[] = [];
        const off = appEvents.on('realtime-status', (s) => statuses.push(String(s)));
        const rt = make();
        rt.connect();
        const ws = FakeWS.instances[0];
        ws.open();
        await flush();
        ws.serverSend({ type: 'CONNECTED' });
        await vi.advanceTimersByTimeAsync(59_000);
        expect(ws.closed).toBe(false);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(ws.closed).toBe(true);
        expect(statuses.at(-1)).toBe('offline');
        await vi.advanceTimersByTimeAsync(1_000);
        expect(FakeWS.instances).toHaveLength(2);
        off();
    });

    it('any message keeps the socket alive', async () => {
        const rt = make();
        rt.connect();
        const ws = FakeWS.instances[0];
        ws.open();
        await flush();
        ws.serverSend({ type: 'CONNECTED' });
        for (let i = 0; i < 4; i++) {
            await vi.advanceTimersByTimeAsync(30_000);
            ws.serverSend({ type: 'PONG' });
        }
        expect(ws.closed).toBe(false);
    });
});
