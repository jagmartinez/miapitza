import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

import app from '../../app';
import prisma from '../../utils/prisma';
import { WebSocketService } from '../../services/websocket.service';
import { resetOperationalReadinessCache } from '../../routes/v1.router';

const originalStorageDir = process.env.STORAGE_DIR;
const originalStorageSharedId = process.env.STORAGE_SHARED_ID;
const originalNodeEnv = process.env.NODE_ENV;
let readinessStorageRoot = '';

beforeEach(() => {
    readinessStorageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-readiness-'));
    process.env.STORAGE_DIR = readinessStorageRoot;
    delete process.env.STORAGE_SHARED_ID;
});

afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.READINESS_DB_TIMEOUT_MS;
    delete process.env.READINESS_STORAGE_TIMEOUT_MS;
    delete process.env.READINESS_BIOMETRIC_TIMEOUT_MS;
    delete process.env.HR_FACE_PROVIDER;
    if (originalStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = originalStorageDir;
    if (originalStorageSharedId === undefined) delete process.env.STORAGE_SHARED_ID;
    else process.env.STORAGE_SHARED_ID = originalStorageSharedId;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    fs.rmSync(readinessStorageRoot, { recursive: true, force: true });
    resetOperationalReadinessCache();
});

describe('Operational readiness endpoint', () => {
    it('fails closed when the database is available but WebSocket was not initialized', async () => {
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }] as never);
        jest.spyOn(prisma.attendancePolicy, 'count').mockResolvedValue(0);
        jest.spyOn(WebSocketService, 'isInitialized').mockReturnValue(false);

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(503);
        expect(response.body.data.checks).toEqual(expect.objectContaining({
            database: expect.objectContaining({ status: 'ok' }),
            storage: expect.objectContaining({
                status: 'ok',
                mode: 'local-development',
                verified: false,
            }),
            websocket: { status: 'error', latencyMs: 0 }
        }));
    });

    it('remains available beyond the public v1 rate limit', async () => {
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }] as never);
        jest.spyOn(prisma.attendancePolicy, 'count').mockResolvedValue(0);
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
        expect(response.body.data.checks.biometric.status).toBe('error');
        expect(Date.now() - started).toBeLessThan(500);
    });

    it('does not query storage identity after the authoritative database probe fails', async () => {
        process.env.NODE_ENV = 'production';
        process.env.STORAGE_SHARED_ID = 'restaurant-production-primary';
        jest.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('database unavailable') as never);
        const storageIdentityQuery = jest.spyOn(prisma.storageIdentity, 'findUnique');
        jest.spyOn(WebSocketService, 'isInitialized').mockReturnValue(true);

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(503);
        expect(response.body.data.checks).toEqual(expect.objectContaining({
            database: expect.objectContaining({ status: 'error' }),
            storage: { status: 'error', required: true },
        }));
        expect(storageIdentityQuery).not.toHaveBeenCalled();
    });

    it('times out one shared storage probe without accumulating identity queries', async () => {
        process.env.NODE_ENV = 'production';
        process.env.STORAGE_SHARED_ID = 'restaurant-production-primary';
        // This case exercises the shared in-flight database identity probe, so
        // leave enough room for the real Windows filesystem/fsync preflight.
        // The separate test below keeps the strict 100 ms filesystem timeout.
        process.env.READINESS_STORAGE_TIMEOUT_MS = '1000';
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }] as never);
        const storageIdentityQuery = jest.spyOn(prisma.storageIdentity, 'findUnique')
            .mockReturnValue(new Promise(() => undefined) as never);
        jest.spyOn(prisma.attendancePolicy, 'count').mockResolvedValue(0);
        jest.spyOn(WebSocketService, 'isInitialized').mockReturnValue(true);
        const started = Date.now();

        const responses = await Promise.all(
            Array.from({ length: 12 }, () => request(app).get('/api/v1/health')),
        );

        expect(responses.every(response => response.status === 503)).toBe(true);
        expect(responses.every(response => response.body.data.checks.storage.status === 'error')).toBe(true);
        expect(storageIdentityQuery).toHaveBeenCalledTimes(1);
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('times out a blocked filesystem operation without blocking the event loop or duplicating probes', async () => {
        process.env.NODE_ENV = 'production';
        process.env.STORAGE_SHARED_ID = 'restaurant-production-primary';
        process.env.READINESS_STORAGE_TIMEOUT_MS = '100';
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }] as never);
        const mkdir = jest.spyOn(fsPromises, 'mkdir')
            .mockReturnValue(new Promise(() => undefined) as never);
        const storageIdentityQuery = jest.spyOn(prisma.storageIdentity, 'findUnique');
        jest.spyOn(prisma.attendancePolicy, 'count').mockResolvedValue(0);
        jest.spyOn(WebSocketService, 'isInitialized').mockReturnValue(true);
        const started = Date.now();

        const responses = await Promise.all(
            Array.from({ length: 8 }, () => request(app).get('/api/v1/health')),
        );

        expect(responses.every(response => response.status === 503)).toBe(true);
        expect(mkdir).toHaveBeenCalledTimes(1);
        expect(storageIdentityQuery).not.toHaveBeenCalled();
        expect(Date.now() - started).toBeLessThan(600);
    });

    it('fails closed when an enabled branch requires biometrics but its provider is disabled', async () => {
        process.env.HR_FACE_PROVIDER = 'disabled';
        jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }] as never);
        jest.spyOn(prisma.attendancePolicy, 'count').mockResolvedValue(1);
        jest.spyOn(WebSocketService, 'isInitialized').mockReturnValue(true);

        const response = await request(app).get('/api/v1/health');

        expect(response.status).toBe(503);
        expect(response.body.data.checks.biometric).toEqual(expect.objectContaining({
            status: 'error',
            required: true,
        }));
    });
});
