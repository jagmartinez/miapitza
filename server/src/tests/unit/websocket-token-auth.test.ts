import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'events';
import jwt from 'jsonwebtoken';
import { WebSocketService } from '../../services/websocket.service';
import { SessionService } from '../../services/session.service';
import prisma from '../../utils/prisma';

class FakeSocket extends EventEmitter {
    readyState = 1;
    send = jest.fn();
    ping = jest.fn();
    terminate = jest.fn();
    close = jest.fn((_code?: number, _reason?: string) => {
        this.readyState = 3;
        this.emit('close');
    });
}

type Access = {
    clients: Map<string, unknown>;
    handleConnection(ws: unknown, req: unknown): Promise<void>;
};
const svc = () => WebSocketService as unknown as Access;

const activeUser = (id: number, companyId = 10) => ({
    id, companyId, branchId: 2, status: 'ACTIVE', mustChangePassword: false,
    company: { active: true }, branch: { status: 'ACTIVE' }, allowedBranches: [],
    role: { name: 'MESERO' }, userRoles: []
});

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const authMsg = (token: unknown) => Buffer.from(JSON.stringify({ type: 'AUTH', payload: { token } }));

describe('WebSocket message-based token auth', () => {
    const previousSecret = process.env.JWT_SECRET;

    beforeEach(() => {
        process.env.JWT_SECRET = 'test-secret';
        svc().clients = new Map();
    });

    afterEach(() => {
        jest.useRealTimers();
        svc().clients.clear();
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    });

    it('exposes a 5000 ms auth timeout', () => {
        expect(WebSocketService.AUTH_TIMEOUT_MS).toBe(5000);
    });

    it('authenticates a cookieless client that sends AUTH with a valid session token', async () => {
        jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 7 } as never);
        jest.spyOn(SessionService, 'isValid').mockResolvedValue(true);
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(activeUser(7) as never);
        const ws = new FakeSocket();

        await svc().handleConnection(ws, { headers: {} });
        expect(ws.send).not.toHaveBeenCalled();
        expect(svc().clients.size).toBe(0);

        ws.emit('message', authMsg('good-token'));
        await flush();

        expect(ws.close).not.toHaveBeenCalled();
        expect(svc().clients.size).toBe(1);
        expect(ws.send).toHaveBeenCalledTimes(1);
        expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('CONNECTED');
        expect(SessionService.isValid).toHaveBeenCalledWith('good-token');
    });

    it('closes with 4001 when AUTH is not received within 5000 ms', async () => {
        jest.useFakeTimers();
        const ws = new FakeSocket();
        await svc().handleConnection(ws, { headers: {} });

        jest.advanceTimersByTime(4999);
        expect(ws.close).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
        expect(svc().clients.size).toBe(0);
    });

    it('closes with 4001 when AUTH carries a revoked session', async () => {
        jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 7 } as never);
        jest.spyOn(SessionService, 'isValid').mockResolvedValue(false);
        const findUser = jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(activeUser(7) as never);
        const ws = new FakeSocket();
        await svc().handleConnection(ws, { headers: {} });

        ws.emit('message', authMsg('revoked-token'));
        await flush();

        expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
        expect(ws.send).not.toHaveBeenCalled();
        expect(svc().clients.size).toBe(0);
        expect(findUser).not.toHaveBeenCalled();
    });

    it('closes with 4001 for an invalid token, malformed AUTH or any non-AUTH first message', async () => {
        jest.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('bad'); });
        const cases: Buffer[] = [
            authMsg('garbage'),
            authMsg(''),
            authMsg(12345),
            Buffer.from(JSON.stringify({ type: 'AUTH' })),
            Buffer.from(JSON.stringify({ type: 'PING' })),
            Buffer.from('not json'),
        ];
        for (const data of cases) {
            const ws = new FakeSocket();
            await svc().handleConnection(ws, { headers: {} });
            ws.emit('message', data);
            await flush();
            expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
            expect(ws.send).not.toHaveBeenCalled();
        }
        expect(svc().clients.size).toBe(0);
    });

    it('does not deliver broadcasts to unauthenticated clients', async () => {
        const ws = new FakeSocket();
        await svc().handleConnection(ws, { headers: {} });

        WebSocketService.broadcast({ type: 'ORDER_UPDATE', payload: { id: 1 } }, { companyId: 10 });
        WebSocketService.broadcast({ type: 'X' }, { allowCrossTenant: true });

        expect(ws.send).not.toHaveBeenCalled();
        expect(svc().clients.size).toBe(0);
    });

    it('ignores a second AUTH on an authenticated socket and does not switch users', async () => {
        jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 7 } as never);
        jest.spyOn(SessionService, 'isValid').mockResolvedValue(true);
        const findUser = jest.spyOn(prisma.user, 'findUnique')
            .mockResolvedValueOnce(activeUser(7, 10) as never)
            .mockResolvedValue(activeUser(8, 99) as never);
        const ws = new FakeSocket();
        await svc().handleConnection(ws, { headers: {} });
        ws.emit('message', authMsg('token-a'));
        await flush();
        ws.send.mockClear();

        ws.emit('message', authMsg('token-b'));
        await flush();

        expect(findUser).toHaveBeenCalledTimes(1);
        expect(ws.send).not.toHaveBeenCalled();
        const client = [...svc().clients.values()][0] as { userId: number; companyId: number };
        expect(client.userId).toBe(7);
        expect(client.companyId).toBe(10);

        WebSocketService.broadcast({ type: 'T' }, { companyId: 99 });
        expect(ws.send).not.toHaveBeenCalled();
    });

    it('rejects a second message while the first AUTH is still pending', async () => {
        jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 7 } as never);
        let release: (v: boolean) => void = () => undefined;
        jest.spyOn(SessionService, 'isValid').mockReturnValue(new Promise<boolean>((r) => { release = r; }));
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(activeUser(7) as never);
        const ws = new FakeSocket();
        await svc().handleConnection(ws, { headers: {} });

        ws.emit('message', authMsg('slow'));
        ws.emit('message', authMsg('slow-2'));
        await flush();
        expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));

        release(true);
        await flush();
        expect(svc().clients.size).toBe(0);
        expect(ws.send).not.toHaveBeenCalled();
    });

    it('never logs the token', async () => {
        jest.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('bad'); });
        const spies = [
            jest.spyOn(console, 'log').mockImplementation(() => undefined),
            jest.spyOn(console, 'warn').mockImplementation(() => undefined),
            jest.spyOn(console, 'error').mockImplementation(() => undefined),
        ];
        const ws = new FakeSocket();
        await svc().handleConnection(ws, { headers: {} });
        ws.emit('message', authMsg('SECRET-TOKEN-VALUE'));
        ws.emit('message', Buffer.from('{"type":"AUTH","payload":{"token":"SECRET-TOKEN-VALUE"'));
        await flush();
        for (const spy of spies) {
            expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-TOKEN-VALUE');
        }
    });

    it('keeps cookie auth working: registers and sends CONNECTED immediately', async () => {
        jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 7 } as never);
        jest.spyOn(SessionService, 'isValid').mockResolvedValue(true);
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(activeUser(7) as never);
        const ws = new FakeSocket();

        await svc().handleConnection(ws, { headers: { cookie: 'auth_token=cookie-token' } });

        expect(svc().clients.size).toBe(1);
        expect(JSON.parse(ws.send.mock.calls[0][0] as string).type).toBe('CONNECTED');
        expect(SessionService.isValid).toHaveBeenCalledWith('cookie-token');
    });

    it('closes a cookie client with an invalid session with 4001', async () => {
        jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 7 } as never);
        jest.spyOn(SessionService, 'isValid').mockResolvedValue(false);
        const ws = new FakeSocket();
        await svc().handleConnection(ws, { headers: { cookie: 'auth_token=x' } });
        expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
        expect(svc().clients.size).toBe(0);
    });

    it('isOriginAllowed accepts capacitor://localhost when listed', () => {
        const list = ['https://app.example.com', 'https://localhost', 'capacitor://localhost'];
        expect(WebSocketService.isOriginAllowed('capacitor://localhost', list, 'production')).toBe(true);
        expect(WebSocketService.isOriginAllowed('https://localhost', list, 'production')).toBe(true);
        expect(WebSocketService.isOriginAllowed('capacitor://evil', list, 'production')).toBe(false);
        expect(WebSocketService.isOriginAllowed('capacitor://localhost', ['https://app.example.com'], 'production')).toBe(false);
    });
});
