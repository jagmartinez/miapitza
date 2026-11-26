import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWebSocketUrl } from './websocket';

describe('buildWebSocketUrl', () => {
    it('returns the base URL as-is (token no longer in URL for security)', () => {
        expect(buildWebSocketUrl('ws://localhost:3001'))
            .toBe('ws://localhost:3001');
    });

    it('preserves the URL without adding token', () => {
        expect(buildWebSocketUrl('ws://localhost:3001/socket?branch=4'))
            .toBe('ws://localhost:3001/socket?branch=4');
    });

    it('normalizes accidental HTTP(S) build-time values to WebSocket schemes', () => {
        expect(buildWebSocketUrl('https://api.example.com')).toBe('wss://api.example.com');
        expect(buildWebSocketUrl(' http://localhost:3000 ')).toBe('ws://localhost:3000');
    });
});

describe('WebSocket recovery', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('reports a constructor failure and retries while subscribers remain', async () => {
        vi.useFakeTimers();
        let constructionCount = 0;

        class ThrowingWebSocket {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;

            constructor(_url: string) {
                constructionCount++;
                throw new Error('invalid websocket endpoint');
            }
        }

        vi.stubGlobal('WebSocket', ThrowingWebSocket);
        vi.resetModules();
        const websocket = await import('./websocket');
        const received: Array<{ type: string; payload?: Record<string, unknown> }> = [];

        const unsubscribe = websocket.subscribeWebSocket((message) => received.push(message));

        expect(constructionCount).toBe(1);
        expect(received).toContainEqual(expect.objectContaining({
            type: websocket.WS_EVENTS.CONNECTION_ERROR,
            payload: expect.objectContaining({ code: 'CONSTRUCTION_FAILED' }),
        }));

        await vi.advanceTimersByTimeAsync(5_000);
        expect(constructionCount).toBe(2);

        unsubscribe();
        websocket.closeWebSocket();
    });

    it('ignores a late close from a superseded connection', async () => {
        vi.useFakeTimers();
        const instances: MockWebSocket[] = [];

        class MockWebSocket {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;
            readyState = MockWebSocket.CONNECTING;
            onopen: ((event: Event) => void) | null = null;
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: Event) => void) | null = null;
            onclose: ((event: CloseEvent) => void) | null = null;

            constructor(_url: string) {
                instances.push(this);
            }

            close() {
                this.readyState = 3;
            }

            send(_data: string) {
                // Not needed by this lifecycle test.
            }
        }

        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.resetModules();
        const websocket = await import('./websocket');
        const unsubscribe = websocket.subscribeWebSocket(() => undefined);
        const staleClose = instances[0].onclose;

        websocket.reconnectWebSocket();
        expect(instances).toHaveLength(2);

        staleClose?.({} as CloseEvent);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(instances).toHaveLength(2);

        unsubscribe();
        websocket.closeWebSocket();
    });
    it('warns about a failing subscriber at most once per minute', async () => {
        vi.useFakeTimers();
        const instances: Array<{ onmessage: ((event: MessageEvent) => void) | null }> = [];

        class MockWebSocket {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;
            readyState = MockWebSocket.CONNECTING;
            onopen: ((event: Event) => void) | null = null;
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: Event) => void) | null = null;
            onclose: ((event: CloseEvent) => void) | null = null;
            constructor(_url: string) { instances.push(this); }
            close() { this.readyState = 3; }
            send(_data: string) { /* unused */ }
        }

        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.resetModules();
        const notify = await import('../services/notify');
        notify.__resetNoticesForTests();
        const notices: string[] = [];
        const stopNotices = notify.subscribeNotices((n) => notices.push(n.message));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const websocket = await import('./websocket');

        const unsubscribe = websocket.subscribeWebSocket(() => { throw new Error('vista rota'); });
        const deliver = () => instances[0].onmessage?.({ data: JSON.stringify({ type: 'ORDER_UPDATED' }) } as MessageEvent);

        deliver();
        deliver();
        deliver();
        expect(notices).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(websocket.SUBSCRIBER_FAILURE_NOTICE_INTERVAL_MS);
        deliver();
        expect(notices).toHaveLength(2);

        unsubscribe();
        websocket.closeWebSocket();
        stopNotices();
        consoleError.mockRestore();
    });

    it('closes the socket after the last subscriber leaves and reopens on a new subscribe', async () => {
        vi.useFakeTimers();
        const instances: Array<{ readyState: number; closed: boolean }> = [];

        class MockWebSocket {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;
            readyState = MockWebSocket.CONNECTING;
            closed = false;
            onopen: ((event: Event) => void) | null = null;
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: Event) => void) | null = null;
            onclose: ((event: CloseEvent) => void) | null = null;

            constructor(_url: string) {
                instances.push(this);
            }

            close() {
                this.closed = true;
                this.readyState = 3;
            }

            send(_data: string) {
                // Not needed by this lifecycle test.
            }
        }

        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.resetModules();
        const websocket = await import('./websocket');

        const first = websocket.subscribeWebSocket(() => undefined);
        const second = websocket.subscribeWebSocket(() => undefined);
        expect(instances).toHaveLength(1);

        first();
        await vi.advanceTimersByTimeAsync(websocket.IDLE_CLOSE_DELAY_MS);
        expect(instances[0].closed).toBe(false);

        // Route hand-off: last listener leaves and a new one arrives within the grace period.
        second();
        const third = websocket.subscribeWebSocket(() => undefined);
        await vi.advanceTimersByTimeAsync(websocket.IDLE_CLOSE_DELAY_MS);
        expect(instances[0].closed).toBe(false);
        expect(instances).toHaveLength(1);

        third();
        third(); // idempotent unsubscribe
        await vi.advanceTimersByTimeAsync(websocket.IDLE_CLOSE_DELAY_MS);
        expect(instances[0].closed).toBe(true);

        // Idle close is not a manual logout close: no reconnect loop, but a new subscriber reopens.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(instances).toHaveLength(1);
        const fourth = websocket.subscribeWebSocket(() => undefined);
        expect(instances).toHaveLength(2);

        fourth();
        websocket.closeWebSocket();
    });

    it('does not keep a socket opened by a bare initialize call without subscribers', async () => {
        vi.useFakeTimers();
        const instances: Array<{ closed: boolean }> = [];

        class MockWebSocket {
            static readonly CONNECTING = 0;
            static readonly OPEN = 1;
            readyState = MockWebSocket.CONNECTING;
            closed = false;
            onopen: ((event: Event) => void) | null = null;
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: ((event: Event) => void) | null = null;
            onclose: ((event: CloseEvent) => void) | null = null;

            constructor(_url: string) {
                instances.push(this);
            }

            close() {
                this.closed = true;
            }
        }

        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.resetModules();
        const websocket = await import('./websocket');

        websocket.initializeWebSocket();
        await vi.advanceTimersByTimeAsync(websocket.IDLE_CLOSE_DELAY_MS);
        expect(instances[0].closed).toBe(true);
        websocket.closeWebSocket();
    });
});
