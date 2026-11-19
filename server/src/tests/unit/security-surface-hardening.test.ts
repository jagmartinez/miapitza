import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import prisma from '../../utils/prisma';
import { WebSocketService } from '../../services/websocket.service';
import { createApiRateLimiter, isApiRateLimitExempt, parseTrustProxy } from '../../middlewares/api-rate-limit';
import { ReservationController } from '../../controllers/reservation.controller';
import { ReservationService } from '../../services/reservation.service';
import { SettingService } from '../../services/setting.service';
import { DeliveryService, resolveIntegrationUser } from '../../services/delivery.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('WebSocket origin policy', () => {
    const allowed = ['https://pos.example.com'];

    it('enforces the CORS allowlist in production and in unset/staging environments', () => {
        for (const env of ['production', 'staging', '']) {
            expect(WebSocketService.isOriginAllowed('https://evil.example', allowed, env)).toBe(false);
            expect(WebSocketService.isOriginAllowed('https://pos.example.com', allowed, env)).toBe(true);
        }
    });

    it('relaxes only for explicit development or test', () => {
        expect(WebSocketService.isOriginAllowed('https://evil.example', allowed, 'development')).toBe(true);
        expect(WebSocketService.isOriginAllowed('https://evil.example', allowed, 'test')).toBe(true);
    });
});

describe('global /api rate limiter', () => {
    function call(limiter: ReturnType<typeof createApiRateLimiter>, path = '/orders') {
        const req = { ip: '198.51.100.1', path, method: 'GET', headers: {}, app: { get: () => 1 } } as unknown as Request;
        const res = {
            statusCode: 200,
            headersSent: false,
            setHeader: jest.fn(),
            getHeader: jest.fn(),
            append: jest.fn(),
            status(this: { statusCode: number }, code: number) { this.statusCode = code; return this; },
            send: jest.fn(),
            json: jest.fn(),
            on: jest.fn(),
        } as unknown as Response & { statusCode: number };
        return new Promise<number>((resolve) => {
            const next = (() => resolve(200)) as NextFunction;
            (res.send as unknown as jest.Mock).mockImplementation(() => resolve(res.statusCode));
            (res.json as unknown as jest.Mock).mockImplementation(() => resolve(res.statusCode));
            void limiter(req, res, next);
        });
    }

    it('limits per IP once enabled, but never health checks or webhooks', async () => {
        const limiter = createApiRateLimiter({
            env: { NODE_ENV: 'production', API_RATE_LIMIT_PER_MINUTE: '2' },
        });
        expect(await call(limiter)).toBe(200);
        expect(await call(limiter)).toBe(200);
        expect(await call(limiter)).toBe(429);
        expect(await call(limiter, '/health')).toBe(200);
        expect(await call(limiter, '/delivery/webhook/rappi')).toBe(200);
    });

    it('is disabled under NODE_ENV=test unless explicitly opted in', async () => {
        const limiter = createApiRateLimiter({ env: { NODE_ENV: 'test', API_RATE_LIMIT_PER_MINUTE: '1' } });
        expect(await call(limiter)).toBe(200);
        expect(await call(limiter)).toBe(200);
    });

    it('exempts websocket upgrades but not webhook log listings', () => {
        expect(isApiRateLimitExempt({ path: '/ws', headers: { upgrade: 'websocket' } })).toBe(true);
        expect(isApiRateLimitExempt({ path: '/pedidosya/webhook/3', headers: {} })).toBe(true);
        expect(isApiRateLimitExempt({ path: '/pedidosya/webhook-logs', headers: {} })).toBe(false);
    });

    it('parses TRUST_PROXY like Express', () => {
        expect(parseTrustProxy(undefined)).toBe(1);
        expect(parseTrustProxy('2')).toBe(2);
        expect(parseTrustProxy('false')).toBe(false);
        expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
    });
});

describe('reservation create allowlist', () => {
    it('drops server-controlled fields from the request body', async () => {
        const create = jest.spyOn(ReservationService, 'create').mockResolvedValue({ id: 1 } as never);
        const req = {
            user: { userId: 1, companyId: 7, branchId: 3, role: 'WAITER', roles: ['WAITER'] },
            body: {
                customerName: 'Ana', peopleCount: '2', date: '2099-01-01T20:00:00Z',
                status: 'COMPLETED', tableId: 99, companyId: 999, id: 5, createdAt: '2000-01-01',
            },
        } as unknown as Request;
        const res = { status: jest.fn(() => res), json: jest.fn() } as unknown as Response;

        await ReservationController.create(req, res, jest.fn() as unknown as NextFunction);

        expect(create).toHaveBeenCalledWith(7, {
            branchId: 3,
            customerName: 'Ana',
            date: new Date('2099-01-01T20:00:00Z'),
            peopleCount: 2,
        });
    });

    it('inserts only explicit columns and always starts as PENDING', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 3, status: 'ACTIVE' } as never);
        jest.spyOn(SettingService, 'getReservationTableWindowMinutes').mockResolvedValue(120 as never);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            table: { findMany: jest.fn(async () => [{ id: 4, capacity: 4 }]) },
            reservation: {
                findMany: jest.fn(async () => []),
                create: jest.fn(async (args: unknown) => args),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never,
        );

        await ReservationService.create(7, {
            branchId: 3, customerName: 'Ana', date: new Date('2099-01-01T20:00:00Z'), peopleCount: 2,
            ...({ status: 'COMPLETED', tableId: 99 } as object),
        } as Parameters<typeof ReservationService.create>[1]);

        const data = (tx.reservation.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data).toEqual({
            branchId: 3, customerName: 'Ana', phone: null, email: null,
            date: new Date('2099-01-01T20:00:00Z'), peopleCount: 2, notes: null,
            companyId: 7, tableId: 4, status: 'PENDING',
        });
    });
});

describe('delivery webhook attribution', () => {
    it('prefers the per-company "system-<id>" (or legacy "system") integration user over the first active user', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 2 } as never);
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue(null as never);
        const findUser = jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 900 } as never);
        jest.spyOn(DeliveryService as unknown as { matchDeliveryItems: () => unknown }, 'matchDeliveryItems')
            .mockResolvedValue([{ menuItemId: 1, quantity: 1, price: 10 }] as never);
        const createOrder = jest.spyOn(prisma.order, 'create').mockResolvedValue({ id: 55 } as never);

        await DeliveryService.processIncomingOrder(1, 2, {
            externalId: 'X1', platform: 'RAPPI', customerName: 'C', customerAddress: 'A',
            items: [{ name: 'Burger', quantity: 1, price: 10 }], total: 10,
        } as Parameters<typeof DeliveryService.processIncomingOrder>[2]).catch(() => undefined);

        expect(findUser.mock.calls[0][0]).toEqual(expect.objectContaining({
            where: { companyId: 1, username: { in: ['system-1', 'system'] }, status: 'ACTIVE' },
        }));
        expect(createOrder.mock.calls[0][0]).toEqual(expect.objectContaining({
            data: expect.objectContaining({ userId: 900 }),
        }));
    });

    it('falls back to an active user only when allowed, never for money-moving integration actions', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const findUser = jest.spyOn(prisma.user, 'findFirst')
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce({ id: 31 } as never);
        await expect(resolveIntegrationUser(4, 'PEDIDOSYA')).resolves.toEqual({ id: 31 });
        expect(warn).toHaveBeenCalled();

        findUser.mockReset().mockResolvedValue(null as never);
        await expect(resolveIntegrationUser(4, 'PedidosYa (cancelación)', { allowFallback: false }))
            .rejects.toThrow(/system-4/);
        expect(findUser).toHaveBeenCalledTimes(1);
    });
});
