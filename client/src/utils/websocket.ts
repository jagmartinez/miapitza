// WebSocket utility for real-time POS-Kitchen communication

import { resolveWebSocketBaseUrl } from './runtime-routing';
import { publishNotice } from '../services/notify';

export interface WebSocketMessage {
    type: string;
    payload?: Record<string, unknown>;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let isConnecting = false;
let isManuallyClosed = false;
const listeners = new Set<(data: WebSocketMessage) => void>();

const MAX_RECONNECT_ATTEMPTS = 20;
const BASE_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_DELAY = 60000; // 60 seconds
const CONNECTION_ERROR_EVENT = 'WEBSOCKET_CONNECTION_ERROR';
/** Consecutive failed reconnects before the operator is told live updates stopped. */
const NOTIFY_AFTER_FAILED_ATTEMPTS = 2;
const REALTIME_NOTICE_KEY = 'realtime-connection';
export const REALTIME_LOST_MESSAGE = 'Se perdió la conexión en tiempo real. Reintentando… Pedidos y mesas podrían no actualizarse solos; recarga si ves datos desactualizados.';
export const REALTIME_RESTORED_MESSAGE = 'Conexión en tiempo real restablecida.';
export const REALTIME_GAVE_UP_MESSAGE = 'No se pudo restablecer la conexión en tiempo real. Recarga la página para volver a recibir actualizaciones.';
let connectionLostNotified = false;

const isBrowserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
/**
 * Grace period before closing an unused socket. Route changes unmount one
 * subscriber and mount the next in the same commit; closing immediately would
 * tear down and rebuild the connection on every navigation.
 */
export const IDLE_CLOSE_DELAY_MS = 3000;

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

/** A subscriber that keeps failing warns the operator at most once per window. */
export const SUBSCRIBER_FAILURE_NOTICE_INTERVAL_MS = 60_000;
const lastSubscriberFailureNoticeAt = new WeakMap<(data: WebSocketMessage) => void, number>();

const notifyListeners = (data: WebSocketMessage) => {
    listeners.forEach((listener) => {
        try {
            listener(data);
        } catch (error) {
            // Isolate subscribers so one broken view cannot stop the others,
            // but keep the failure observable for operational diagnosis.
            console.error('[WebSocket] subscriber failed while handling an event:', error);
            const now = Date.now();
            const last = lastSubscriberFailureNoticeAt.get(listener);
            if (last !== undefined && now - last < SUBSCRIBER_FAILURE_NOTICE_INTERVAL_MS) return;
            lastSubscriberFailureNoticeAt.set(listener, now);
            publishNotice({
                type: 'warning',
                dedupeKey: 'realtime-subscriber',
                message: 'No se pudo aplicar una actualización en tiempo real. Si la pantalla no se actualiza, recarga la página.',
            });
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

const cancelIdleClose = () => {
    if (idleCloseTimer) {
        clearTimeout(idleCloseTimer);
        idleCloseTimer = null;
    }
};

/** Detach and close the current socket without firing reconnect logic. */
const dropSocket = () => {
    if (!socket) return;
    const previousSocket = socket;
    socket = null;
    previousSocket.onclose = null;
    previousSocket.onerror = null;
    previousSocket.close();
};

/**
 * Close the connection once nobody listens. Unlike closeWebSocket() this is not
 * a manual/logout close: a later subscribe reopens normally.
 */
const scheduleIdleClose = () => {
    if (listeners.size > 0 || idleCloseTimer) return;
    idleCloseTimer = setTimeout(() => {
        idleCloseTimer = null;
        if (listeners.size > 0) return;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectAttempts = 0;
        dropSocket();
        isConnecting = false;
    }, IDLE_CLOSE_DELAY_MS);
};

const scheduleReconnect = () => {
    if (isManuallyClosed || listeners.size === 0 || reconnectTimer) return;

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        notifyConnectionIssue('RECONNECT_LIMIT_REACHED');
        publishNotice({ type: 'error', dedupeKey: REALTIME_NOTICE_KEY, duration: 15000, message: REALTIME_GAVE_UP_MESSAGE });
        connectionLostNotified = true;
        return;
    }

    // The browser-offline notice already covers lost connectivity.
    if (!connectionLostNotified && reconnectAttempts >= NOTIFY_AFTER_FAILED_ATTEMPTS && !isBrowserOffline()) {
        connectionLostNotified = true;
        publishNotice({ type: 'warning', dedupeKey: REALTIME_NOTICE_KEY, message: REALTIME_LOST_MESSAGE });
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
    cancelIdleClose();

    // Prevent duplicate connection attempts
    if (isConnecting || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))) {
        // An init without subscribers must not pin the socket open forever.
        scheduleIdleClose();
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
            if (connectionLostNotified) {
                connectionLostNotified = false;
                publishNotice({ type: 'success', dedupeKey: REALTIME_NOTICE_KEY, message: REALTIME_RESTORED_MESSAGE });
            }
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

        scheduleIdleClose();
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

    let active = true;
    return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        scheduleIdleClose();
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
    connectionLostNotified = false;
    cancelIdleClose();

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
