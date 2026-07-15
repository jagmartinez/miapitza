import { WebSocket, WebSocketServer } from 'ws';
import { Server, IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { SessionService } from './session.service';
import prisma from '../utils/prisma';

interface WebSocketClient extends WebSocket {
    id: string;
    isAlive: boolean;
    authenticated?: boolean;
    userId?: number;
    companyId?: number;
    branchId?: number;
    roles?: string[];
    sessionTokenHash?: string;
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
        const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(o => o.trim());

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
        const initializedServer = this.wss;
        initializedServer.on('close', () => {
            if (this.wss === initializedServer) this.wss = null;
        });

        this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
            const client = ws as WebSocketClient;
            const token = this.extractTokenFromCookieHeader(req.headers.cookie);
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
                client.close(4001, 'Authentication required');
                return;
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
            };
            if (!Number.isInteger(decoded.userId) || !decoded.userId) return false;
            const sessionIsValid = await SessionService.isValid(token);
            if (!sessionIsValid) {
                return false;
            }

            // JWT claims are a login-time snapshot. Reload the authoritative
            // tenant, branch, status and roles so a disabled/transferred user or
            // stale role token cannot keep receiving another scope's events.
            const user = await prisma.user.findUnique({
                where: { id: decoded.userId },
                select: {
                    id: true,
                    companyId: true,
                    branchId: true,
                    status: true,
                    mustChangePassword: true,
                    company: { select: { active: true } },
                    branch: { select: { status: true } },
                    allowedBranches: { select: { branchId: true } },
                    role: { select: { name: true } },
                    userRoles: { select: { role: { select: { name: true } } } }
                }
            });
            if (!user || user.status !== 'ACTIVE' || user.mustChangePassword || !user.companyId) return false;

            const authoritativeRoles = Array.from(new Set([
                user.role.name,
                ...user.userRoles.map((entry) => entry.role.name)
            ])).filter((name) => name !== 'SUPERADMIN' || user.role.name === 'SUPERADMIN');
            const isSuperAdmin = authoritativeRoles.includes('SUPERADMIN');
            if ((user.company?.active !== true || (user.branchId && user.branch?.status !== 'ACTIVE')) && !isSuperAdmin) return false;
            if (
                !isSuperAdmin && user.branchId && user.allowedBranches.length > 0 &&
                !user.allowedBranches.some((entry) => entry.branchId === user.branchId)
            ) return false;

            client.userId = user.id;
            client.companyId = user.companyId;
            client.branchId = user.branchId ?? undefined;
            client.roles = authoritativeRoles;
            client.sessionTokenHash = SessionService.hashToken(token);
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

    /**
     * Revalidate the authoritative session and scope for long-lived sockets.
     * HTTP authorization is checked on every request, while a WebSocket can stay
     * open for hours; without this check a revoked/deactivated/transferred user
     * would continue receiving events until reconnecting.
     */
    private static async revalidateClient(client: WebSocketClient): Promise<boolean> {
        if (!client.userId || !client.sessionTokenHash) {
            // Only the explicit non-production unauthenticated mode lacks these.
            return process.env.WS_ALLOW_UNAUTHENTICATED === 'true' && process.env.NODE_ENV !== 'production';
        }

        const [sessionIsValid, user] = await Promise.all([
            SessionService.isHashValid(client.sessionTokenHash),
            prisma.user.findUnique({
                where: { id: client.userId },
                select: {
                    id: true,
                    companyId: true,
                    branchId: true,
                    status: true,
                    mustChangePassword: true,
                    company: { select: { active: true } },
                    branch: { select: { status: true } },
                    allowedBranches: { select: { branchId: true } },
                    role: { select: { name: true } },
                    userRoles: { select: { role: { select: { name: true } } } }
                }
            })
        ]);

        if (!sessionIsValid || !user || user.status !== 'ACTIVE' || user.mustChangePassword || !user.companyId) return false;

        const authoritativeRoles = Array.from(new Set([
            user.role.name,
            ...user.userRoles.map((entry) => entry.role.name)
        ])).filter((name) => name !== 'SUPERADMIN' || user.role.name === 'SUPERADMIN');
        const isSuperAdmin = authoritativeRoles.includes('SUPERADMIN');
        if ((user.company?.active !== true || (user.branchId && user.branch?.status !== 'ACTIVE')) && !isSuperAdmin) return false;
        if (
            !isSuperAdmin && user.branchId && user.allowedBranches.length > 0 &&
            !user.allowedBranches.some((entry) => entry.branchId === user.branchId)
        ) return false;

        client.companyId = user.companyId;
        client.branchId = user.branchId ?? undefined;
        client.roles = authoritativeRoles;
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
                console.error('[WS] Failed to send to client:', err);
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

                void this.revalidateClient(client).then((valid) => {
                    if (!valid) {
                        client.close(4001, 'Session revoked or scope changed');
                        this.clients.delete(clientId);
                    }
                }).catch(() => {
                    // Fail closed when the session/scope store cannot be checked.
                    client.close(1011, 'Session validation failed');
                    this.clients.delete(clientId);
                });
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

    static isInitialized(): boolean {
        return this.wss !== null;
    }

    static shutdown(): void {
        this.clients.forEach((client) => {
            client.close(1000, 'Server shutting down');
        });

        this.clients.clear();

        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
    }
}
