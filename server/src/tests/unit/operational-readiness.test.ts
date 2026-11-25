import { afterEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

import app from '../../app';
import prisma from '../../utils/prisma';
import { WebSocketService } from '../../services/websocket.service';

afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.READINESS_DB_TIMEOUT_MS;
});

describe('Operational readiness endpoint', () => {
    it('fails closed when the database is available but WebSocket was not initialized', async () => {
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }] as never);
        jest.spyOn(WebSocketService, 'isInitialized').mockReturnValue(false);

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(503);
        expect(response.body.data.checks).toEqual(expect.objectContaining({
            database: expect.objectContaining({ status: 'ok' }),
            websocket: { status: 'error', latencyMs: 0 }
        }));
    });

    it('remains available beyond the public v1 rate limit', async () => {
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }] as never);
        jest.spyOn(WebSocketService, 'isInitialized').mockReturnValue(true);

        const responses = await Promise.all(
            Array.from({ length: 140 }, () => request(app).get('/api/v1/health'))
        );

        expect(responses.every((response) => response.status === 200)).toBe(true);
    });

    it('returns 503 within its own deadline when the database check stalls', async () => {
        process.env.READINESS_DB_TIMEOUT_MS = '50';
        jest.spyOn(prisma, '$queryRaw').mockReturnValue(new Promise(() => undefined) as never);
        jest.spyOn(WebSocketService, 'isInitialized').mockReturnValue(true);
        const started = Date.now();

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(503);
        expect(response.body.data.checks.database.status).toBe('error');
        expect(Date.now() - started).toBeLessThan(500);
    });
});
