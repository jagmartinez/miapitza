// WebSocket utility for real-time POS-Kitchen communication

export interface WebSocketMessage {
    type: string;
    payload?: Record<string, unknown>;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let isConnecting = false;
let isManuallyClosed = false;
const listeners = new Set<(data: WebSocketMessage) => void>();

const MAX_RECONNECT_ATTEMPTS = 20;
const BASE_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_DELAY = 60000; // 60 seconds

const resolveWebSocketUrl = () => {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    if (envUrl) return envUrl;

    if (typeof window !== 'undefined') {
        const host = window.location.hostname;
        if (host.includes('-web-') && host.endsWith('.up.railway.app')) {
            return `wss://${host.replace('-web-', '-')}`;
        }
    }

    return 'ws://localhost:3001';
};

/** Build WS URL without token in query string (security fix) */
export const buildWebSocketUrl = (baseUrl: string) => {
    return baseUrl;
};

const notifyListeners = (data: WebSocketMessage) => {
    listeners.forEach((listener) => {
        try {
            listener(data);
        } catch {
            // Listener error silently caught
        }
    });
};

export const initializeWebSocket = (onMessage?: (data: WebSocketMessage) => void) => {
    if (onMessage) {
        listeners.add(onMessage);
    }

    // Prevent duplicate connection attempts
    if (isConnecting) return socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
        return socket;
    }

    isManuallyClosed = false;

    const WS_URL = resolveWebSocketUrl();

    try {
        isConnecting = true;
        // Connect without token in URL — send via first message instead
        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            isConnecting = false;
            reconnectAttempts = 0; // Reset on successful connection
            // Backward compatibility: explicit AUTH for legacy bearer flow.
            const authToken = localStorage.getItem('token');
            if (authToken && socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'AUTH', token: authToken }));
            }
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                notifyListeners(data);
            } catch {
                // Failed to parse WebSocket message
            }
        };

        socket.onerror = () => {
            isConnecting = false;
        };

        socket.onclose = () => {
            socket = null;
            isConnecting = false;

            // Don't reconnect if manually closed (logout)
            if (isManuallyClosed) return;

            // Don't reconnect if max attempts reached
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                return;
            }

            // Clear any existing reconnect timer
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }

            // Exponential backoff: 5s, 10s, 20s, 40s... max 60s
            const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
            reconnectAttempts++;

            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (listeners.size > 0) {
                    initializeWebSocket();
                }
            }, delay);
        };

        return socket;
    } catch {
        isConnecting = false;
        return null;
    }
};

export const subscribeWebSocket = (listener: (data: WebSocketMessage) => void) => {
    listeners.add(listener);
    initializeWebSocket();

    return () => {
        listeners.delete(listener);
    };
};

export const sendWebSocketMessage = (type: string, payload: Record<string, unknown>) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, payload }));
    }
};

export const closeWebSocket = () => {
    isManuallyClosed = true;
    reconnectAttempts = 0;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (socket) {
        socket.close();
        socket = null;
    }
    isConnecting = false;
    // Drop all subscribers so a manual close (logout/401) doesn't trigger a
    // reconnect via lingering listeners and doesn't leak across sessions.
    listeners.clear();
};

/** Manually trigger reconnection (e.g., after re-login) */
export const reconnectWebSocket = (onMessage?: (data: WebSocketMessage) => void) => {
    if (onMessage) {
        listeners.add(onMessage);
    }
    reconnectAttempts = 0;
    isManuallyClosed = false;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (socket) {
        socket.close();
        socket = null;
    }

    isConnecting = false;

    return initializeWebSocket();
};

// Message types
export const WS_EVENTS = {
    ORDER_CREATED: 'ORDER_CREATED',
    ORDER_SENT_TO_KITCHEN: 'ORDER_SENT_TO_KITCHEN',
    ORDER_IN_PREPARATION: 'ORDER_IN_PREPARATION',
    ORDER_READY: 'ORDER_READY',
    ORDER_COMPLETED: 'ORDER_COMPLETED',
    ORDER_UPDATE: 'ORDER_UPDATE',
    TABLE_STATUS_CHANGED: 'TABLE_STATUS_CHANGED',
};
