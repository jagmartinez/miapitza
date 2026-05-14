import { WebSocket, WebSocketServer } from 'ws';
import { Server, IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { SessionService } from './session.service';

interface WebSocketClient extends WebSocket {
    id: string;
    isAlive: boolean;
    authenticated?: boolean;
    userId?: number;
    companyId?: number;
    branchId?: number;
    roles?: string[];
    authTimeout?: ReturnType<typeof setTimeout> | null;
}

interface WebSocketMessage {
    type: string;
    payload?: unknown;
}

interface BroadcastCriteria {
    companyId?: number;
    branchId?: number;
    roles?: string[];
    userIds?: number[];
}

export class WebSocketService {
    private static wss: WebSocketServer | null = null;
    private static clients: Map<string, WebSocketClient> = new Map();

    static initialize(server: Server): void {
        const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000').split(',').map(o => o.trim());

        this.wss = new WebSocketServer({
            server,
            maxPayload: 128 * 1024, // 128KB max message size
            verifyClient: ({ origin }, callback) => {
                if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
                    callback(true);
                } else {
                    console.warn(`[WS] Rejected connection from origin: ${origin}`);
                    callback(false, 403, 'Forbidden origin');
                }
            }
        });

        this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
            const client = ws as WebSocketClient;
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const token = url.searchParams.get('token') || this.extractTokenFromCookieHeader(req.headers.cookie);
            const allowUnauthenticated = process.env.WS_ALLOW_UNAUTHENTICATED === 'true' && process.env.NODE_ENV !== 'production';
            client.authenticated = false;
            client.authTimeout = null;

            if (token && process.env.JWT_SECRET) {
                if (!await this.authenticateClient(client, token)) {
                    ws.close(4001, 'Authentication failed');
                    return;
                }
            } else if (allowUnauthenticated) {
                client.authenticated = true;
                client.roles = [];
            } else {
                client.authTimeout = setTimeout(() => {
                    if (!client.authenticated) {
                        client.close(4001, 'Authentication required');
                    }
                }, 5000);
            }

            client.id = this.generateClientId();
            client.isAlive = true;

            this.clients.set(client.id, client);

            this.sendToClient(client.id, {
                type: 'CONNECTED',
                payload: { clientId: client.id, timestamp: new Date() }
            });

            client.on('message', (data: Buffer) => {
                try {
                    const message: unknown = JSON.parse(data.toString());
                    void this.handleMessage(client.id, message);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            });

            client.on('pong', () => {
                client.isAlive = true;
            });

            client.on('close', () => {
                if (client.authTimeout) {
                    clearTimeout(client.authTimeout);
                    client.authTimeout = null;
                }
                this.clients.delete(client.id);
            });

            client.on('error', (error) => {
                console.error(`WebSocket error for client ${client.id}:`, error);
            });
        });

        this.startHeartbeat();
    }

    private static extractAuthTokenFromRawMessage(message: Record<string, unknown>): string | undefined {
        const payload = message.payload;
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const token = (payload as Record<string, unknown>).token;
            if (typeof token === 'string') return token;
        }
        const top = message.token;
        if (typeof top === 'string') return top;
        return undefined;
    }

    private static async handleMessage(clientId: string, raw: unknown): Promise<void> {
        const client = this.clients.get(clientId);
        if (!client) {
            return;
        }

        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return;
        }
        const message = raw as Record<string, unknown>;
        const msgType = message.type;
        if (typeof msgType !== 'string') {
            return;
        }

        if (msgType === 'AUTH') {
            const token = this.extractAuthTokenFromRawMessage(message);

            if (!token || !await this.authenticateClient(client, token)) {
                client.close(4001, 'Authentication failed');
                return;
            }

            this.sendToClient(clientId, {
                type: 'AUTHENTICATED',
                payload: { timestamp: new Date() }
            });
            return;
        }

        if (!client.authenticated) {
            client.close(4001, 'Authentication required');
            return;
        }

        switch (msgType) {
            case 'PING':
                this.sendToClient(clientId, { type: 'PONG', payload: { timestamp: new Date() } });
                break;

            case 'SUBSCRIBE':
                break;

            default:
                break;
        }
    }

    private static async authenticateClient(client: WebSocketClient, token: string): Promise<boolean> {
        if (!process.env.JWT_SECRET) {
            return false;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }) as {
                userId?: number;
                companyId?: number;
                branchId?: number;
                role?: string;
                roles?: string[];
            };
            const sessionIsValid = await SessionService.isValid(token);
            if (!sessionIsValid) {
                return false;
            }

            client.userId = decoded.userId;
            client.companyId = decoded.companyId;
            client.branchId = decoded.branchId;
            client.roles = Array.isArray(decoded.roles)
                ? decoded.roles
                : decoded.role
                    ? [decoded.role]
                    : [];
            client.authenticated = true;

            if (client.authTimeout) {
                clearTimeout(client.authTimeout);
                client.authTimeout = null;
            }

            return true;
        } catch {
            return false;
        }
    }

    private static extractTokenFromCookieHeader(cookieHeader?: string): string | null {
        if (!cookieHeader) return null;

        const cookies = cookieHeader.split(';');
        for (const rawCookie of cookies) {
            const [key, ...valueParts] = rawCookie.trim().split('=');
            if (key === 'auth_token') {
                const value = valueParts.join('=');
                if (value) return decodeURIComponent(value);
            }
        }

        return null;
    }

    private static isClientAllowed(client: WebSocketClient, criteria: BroadcastCriteria): boolean {
        if (!client.authenticated && client.companyId === undefined) {
            return false;
        }

        if (criteria.companyId !== undefined && client.companyId !== criteria.companyId) {
            return false;
        }

        if (criteria.branchId !== undefined && client.branchId !== criteria.branchId) {
            return false;
        }

        if (criteria.userIds?.length) {
            if (!client.userId || !criteria.userIds.includes(client.userId)) {
                return false;
            }
        }

        if (criteria.roles?.length) {
            const clientRoles = client.roles || [];
            if (!clientRoles.some(role => criteria.roles!.includes(role))) {
                return false;
            }
        }

        return true;
    }

    static broadcast(message: WebSocketMessage, criteria: BroadcastCriteria = {}): void {
        const data = JSON.stringify(message);

        this.clients.forEach((client) => {
            if (client.readyState !== WebSocket.OPEN) {
                return;
            }

            if (!this.isClientAllowed(client, criteria)) {
                return;
            }

            try {
                client.send(data);
            } catch (err) {
                console.error(`[WS] Failed to send to client ${clientId}:`, err);
            }
        });
    }

    static sendToClient(clientId: string, message: WebSocketMessage): void {
        const client = this.clients.get(clientId);

        if (client && client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(message));
            } catch (err) {
                console.error(`[WS] Failed to send to client ${clientId}:`, err);
            }
        }
    }

    static broadcastOrderUpdate(orderId: number, status: string, order?: unknown, criteria: BroadcastCriteria = {}): void {
        this.broadcast({
            type: 'ORDER_UPDATE',
            payload: {
                orderId,
                status,
                order,
                timestamp: new Date()
            }
        }, criteria);
    }

    static broadcastOrderToKitchen(order: unknown, criteria: BroadcastCriteria = {}): void {
        this.broadcast({
            type: 'ORDER_SENT_TO_KITCHEN',
            payload: {
                order,
                timestamp: new Date()
            }
        }, criteria);
    }

    static broadcastOrderReady(orderId: number, tableNumber?: string, criteria: BroadcastCriteria = {}): void {
        this.broadcast({
            type: 'ORDER_READY',
            payload: {
                orderId,
                tableNumber,
                timestamp: new Date()
            }
        }, criteria);
    }

    static broadcastOrderInPreparation(orderId: number, tableNumber?: string, criteria: BroadcastCriteria = {}): void {
        this.broadcast({
            type: 'ORDER_IN_PREPARATION',
            payload: {
                orderId,
                tableNumber,
                timestamp: new Date()
            }
        }, criteria);
    }

    static broadcastTableUpdate(tableId: number, status: string, table?: unknown, criteria: BroadcastCriteria = {}): void {
        this.broadcast({
            type: 'TABLE_STATUS_CHANGED',
            payload: {
                tableId,
                status,
                table,
                timestamp: new Date()
            }
        }, criteria);
    }

    static broadcastKitchenNotification(notification: Record<string, unknown>, criteria: BroadcastCriteria = {}): void {
        this.broadcast({
            type: 'KITCHEN_NOTIFICATION',
            payload: {
                ...notification,
                timestamp: new Date()
            }
        }, criteria);
    }

    private static generateClientId(): string {
        return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private static startHeartbeat(): void {
        const interval = setInterval(() => {
            this.clients.forEach((client, clientId) => {
                if (!client.isAlive) {
                    client.terminate();
                    this.clients.delete(clientId);
                    return;
                }

                client.isAlive = false;
                client.ping();
            });
        }, 30000);

        if (this.wss) {
            this.wss.on('close', () => {
                clearInterval(interval);
            });
        }
    }

    static getClientCount(): number {
        return this.clients.size;
    }

    static shutdown(): void {
        this.clients.forEach((client) => {
            client.close(1000, 'Server shutting down');
        });

        this.clients.clear();

        if (this.wss) {
            this.wss.close();
        }
    }
}
