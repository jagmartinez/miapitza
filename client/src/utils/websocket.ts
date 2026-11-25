// WebSocket utility for real-time POS-Kitchen communication

import { resolveWebSocketBaseUrl } from './runtime-routing';

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
const CONNECTION_ERROR_EVENT = 'WEBSOCKET_CONNECTION_ERROR';

const resolveWebSocketUrl = () => {
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    const sameOriginProxy = import.meta.env.VITE_API_PROXY_ENABLED === 'true';
    return resolveWebSocketBaseUrl(
        envUrl,
        sameOriginProxy,
        typeof window !== 'undefined' ? window.location : undefined,
    );
};

/** Build WS URL without token in query string (security fix) */
export const buildWebSocketUrl = (baseUrl: string) => {
    const trimmed = baseUrl.trim();
    if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
    if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
    return trimmed;
};

const notifyListeners = (data: WebSocketMessage) => {
    listeners.forEach((listener) => {
        try {
            listener(data);
        } catch (error) {
            // Isolate subscribers so one broken view cannot stop the others,
            // but keep the failure observable for operational diagnosis.
            console.error('[WebSocket] subscriber failed while handling an event:', error);
        }
    });
};

const notifyConnectionIssue = (code: string, error?: unknown) => {
    notifyListeners({
        type: CONNECTION_ERROR_EVENT,
        payload: {
            code,
            reconnectAttempts,
            ...(error instanceof Error && error.message ? { message: error.message } : {}),
        },
    });
};

const scheduleReconnect = () => {
    if (isManuallyClosed || listeners.size === 0 || reconnectTimer) return;

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        notifyConnectionIssue('RECONNECT_LIMIT_REACHED');
        return;
    }

    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!isManuallyClosed && listeners.size > 0) {
            initializeWebSocket();
        }
    }, delay);
};

export const initializeWebSocket = (onMessage?: (data: WebSocketMessage) => void) => {
    if (onMessage) {
        listeners.add(onMessage);
    }

    // Prevent duplicate connection attempts
    if (isConnecting) return socket;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return socket;
    }

    isManuallyClosed = false;

    const WS_URL = buildWebSocketUrl(resolveWebSocketUrl());

    try {
        isConnecting = true;
        // The browser sends the HttpOnly auth cookie with the handshake.
        const nextSocket = new WebSocket(WS_URL);
        socket = nextSocket;

        nextSocket.onopen = () => {
            if (socket !== nextSocket) return;
            isConnecting = false;
            reconnectAttempts = 0; // Reset on successful connection
            // Backward compatibility: explicit AUTH for legacy bearer flow.
        };

        nextSocket.onmessage = (event) => {
            if (socket !== nextSocket) return;
            try {
                const data = JSON.parse(event.data);
                notifyListeners(data);
            } catch (error) {
                notifyConnectionIssue('INVALID_MESSAGE', error);
            }
        };

        nextSocket.onerror = () => {
            if (socket !== nextSocket) return;
            isConnecting = false;
        };

        nextSocket.onclose = () => {
            // An explicitly superseded socket must not clear or reconnect the
            // replacement connection.
            if (socket !== nextSocket) return;
            socket = null;
            isConnecting = false;
            scheduleReconnect();
        };

        return nextSocket;
    } catch (error) {
        socket = null;
        isConnecting = false;
        notifyConnectionIssue('CONSTRUCTION_FAILED', error);
        scheduleReconnect();
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
        const previousSocket = socket;
        socket = null;
        // Prevent the superseded connection from scheduling a second retry or
        // clearing the new connection when its close event arrives later.
        previousSocket.onclose = null;
        previousSocket.onerror = null;
        previousSocket.close();
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
        const previousSocket = socket;
        socket = null;
        // This close is a hand-off, not a transport failure. Its late events
        // must not race with the replacement socket below.
        previousSocket.onclose = null;
        previousSocket.onerror = null;
        previousSocket.close();
    }

    isConnecting = false;

    return initializeWebSocket();
};

// Message types
export const WS_EVENTS = {
    CONNECTED: 'CONNECTED',
    ORDER_CREATED: 'ORDER_CREATED',
    ORDER_SENT_TO_KITCHEN: 'ORDER_SENT_TO_KITCHEN',
    ORDER_IN_PREPARATION: 'ORDER_IN_PREPARATION',
    ORDER_READY: 'ORDER_READY',
    ORDER_COMPLETED: 'ORDER_COMPLETED',
    ORDER_UPDATE: 'ORDER_UPDATE',
    TABLE_STATUS_CHANGED: 'TABLE_STATUS_CHANGED',
    KITCHEN_NOTIFICATION: 'KITCHEN_NOTIFICATION',
    CONNECTION_ERROR: CONNECTION_ERROR_EVENT,
};
