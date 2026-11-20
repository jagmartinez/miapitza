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
    FakeWS.instances = [];
});
afterEach(() => vi.useRealTimers());

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
});
