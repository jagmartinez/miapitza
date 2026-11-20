import { appEvents } from './events';

const AUTH_FAILED_CLOSE_CODE = 4001;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export interface RealtimeOptions {
    url: string;
    getToken: () => Promise<string | null>;
    /** Test seam; defaults to the platform WebSocket. */
    WebSocketImpl?: typeof WebSocket;
}

export function createRealtime(opts: RealtimeOptions) {
    const subscribers = new Map<string, Set<(payload: unknown) => void>>();
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = MIN_DELAY_MS;
    // Bumped on every connect/close so late async work from an old attempt is ignored.
    let generation = 0;
    let wanted = false;

    const setStatus = (status: 'online' | 'offline') => appEvents.emit('realtime-status', status);

    function scheduleReconnect() {
        if (!wanted || timer) return;
        const wait = delay;
        delay = Math.min(delay * 2, MAX_DELAY_MS);
        timer = setTimeout(() => {
            timer = null;
            open();
        }, wait);
    }

    async function handleAuthFailure(mine: number, usedToken: string | null) {
        let current: string | null = null;
        try {
            current = await opts.getToken();
        } catch {
            current = null;
        }
        if (mine !== generation) return; // closed or reconnected meanwhile
        if (current && usedToken && current !== usedToken) {
            // The session was switched (PIN switch): the old socket was revoked, not the new user.
            delay = MIN_DELAY_MS;
            open();
            return;
        }
        // The current token itself is bad; retrying with it would only hammer the server.
        wanted = false;
        appEvents.emit('session-expired');
    }

    function teardownSocket() {
        generation++;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        const socket = ws;
        ws = null;
        if (socket) {
            socket.onclose = null;
            socket.close();
        }
    }

    function open() {
        if (!wanted) return;
        const mine = ++generation;
        const Impl = opts.WebSocketImpl ?? WebSocket;
        let socket: WebSocket;
        try {
            socket = new Impl(opts.url);
        } catch {
            // Bad URL or platform refusal: back off and retry instead of throwing to the caller.
            ws = null;
            setStatus('offline');
            scheduleReconnect();
            return;
        }
        ws = socket;
        // Token this socket authenticated with; lets a 4001 tell "old session" from "bad session".
        let usedToken: string | null = null;
        // Subscribers only hear from a socket the server has authenticated.
        let connected = false;

        socket.onopen = () => {
            if (mine !== generation) return;
            void opts.getToken().then((token) => {
                if (mine !== generation) return;
                if (!token) {
                    // No session: nothing to authenticate with, so do not retry.
                    wanted = false;
                    socket.onclose = null;
                    socket.close();
                    ws = null;
                    setStatus('offline');
                    appEvents.emit('session-expired');
                    return;
                }
                usedToken = token;
                socket.send(JSON.stringify({ type: 'AUTH', payload: { token } }));
            });
        };

        socket.onmessage = (event: MessageEvent) => {
            if (mine !== generation) return;
            let message: { type?: unknown; payload?: unknown };
            try {
                message = JSON.parse(String(event.data));
            } catch {
                return;
            }
            if (!message || typeof message.type !== 'string') return;
            if (message.type === 'CONNECTED') {
                connected = true;
                delay = MIN_DELAY_MS; // authenticated: the connection is healthy
                setStatus('online');
            }
            if (!connected) return;
            for (const fn of [...(subscribers.get(message.type) ?? [])]) fn(message.payload);
        };

        socket.onclose = (event: CloseEvent) => {
            if (mine !== generation) return;
            ws = null;
            setStatus('offline');
            if (event.code === AUTH_FAILED_CLOSE_CODE) {
                void handleAuthFailure(mine, usedToken);
                return;
            }
            scheduleReconnect();
        };

        // onclose follows and drives the reconnect. Never log: frames may carry tokens.
        socket.onerror = () => {};
    }

    return {
        connect() {
            if (wanted) return;
            wanted = true;
            delay = MIN_DELAY_MS;
            open();
        },
        /** Re-authenticate with the current token (call after a PIN switch / re-login). */
        reconnect() {
            if (!wanted) {
                wanted = true;
                delay = MIN_DELAY_MS;
                open();
                return;
            }
            teardownSocket();
            delay = MIN_DELAY_MS;
            open();
        },
        close() {
            wanted = false;
            teardownSocket();
            setStatus('offline');
        },
        subscribe(type: string, fn: (payload: unknown) => void): () => void {
            let set = subscribers.get(type);
            if (!set) {
                set = new Set();
                subscribers.set(type, set);
            }
            const mine = set;
            mine.add(fn);
            return () => {
                mine.delete(fn);
            };
        },
    };
}

export type Realtime = ReturnType<typeof createRealtime>;
