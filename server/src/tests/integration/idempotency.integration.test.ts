import { afterAll, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { idempotency } from '../../middlewares/idempotency';
import prisma from '../../utils/prisma';

function instance(counters: { success: number; failure: number }) {
    const app = express();
    app.use(express.json());
    app.use(idempotency);
    app.post('/payments', async (req, res) => {
        counters.success += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        res.status(201).json({ execution: counters.success, amount: req.body.amount });
    });
    app.post('/refunds', (_req, res) => res.status(201).json({ kind: 'refund' }));
    app.post('/failure', (_req, res) => res.status(500).json({ execution: ++counters.failure }));
    app.post('/invalid', (_req, res) => res.status(400).json({ execution: ++counters.failure }));
    return app;
}

describe('durable idempotency across application instances', () => {
    const counters = { success: 0, failure: 0 };
    const firstInstance = instance(counters);
    const secondInstance = instance(counters);

    afterAll(async () => {
        await prisma.idempotencyRecord.deleteMany({
            where: {
                OR: [
                    { namespace: 'anon' },
                    { namespace: { startsWith: 'k:' } },
                    { namespace: { startsWith: 'w:' } }
                ]
            }
        });
    });

    it('executes a concurrent request on exactly one instance and durably replays it', async () => {
        const key = `multi-${Date.now()}`;
        const [left, right] = await Promise.all([
            request(firstInstance).post('/payments').set('X-Idempotency-Key', key).send({ amount: 10 }),
            request(secondInstance).post('/payments').set('X-Idempotency-Key', key).send({ amount: 10 })
        ]);
        expect([left.status, right.status].sort()).toEqual([201, 409]);
        expect(counters.success).toBe(1);
        const replay = await request(secondInstance).post('/payments/').set('X-Idempotency-Key', key).send({ amount: 10 });
        expect(replay.status).toBe(201);
        expect(replay.body.execution).toBe(1);
        expect(counters.success).toBe(1);
    });

    it('binds a key to canonical payload and normalized route without storing plaintext payload', async () => {
        const key = `binding-${Date.now()}`;
        await request(firstInstance).post('/payments').set('X-Idempotency-Key', key)
            .send({ amount: 10, metadata: { b: 2, a: 1 } }).expect(201);
        await request(secondInstance).post('/payments/').set('X-Idempotency-Key', key)
            .send({ metadata: { a: 1, b: 2 }, amount: 10 }).expect(201);
        await request(secondInstance).post('/payments').set('X-Idempotency-Key', key).send({ amount: 11 }).expect(409);
        // Scope is part of the unique identity, so the same client key is safe on another endpoint.
        await request(secondInstance).post('/refunds').set('X-Idempotency-Key', key).send({ amount: 10 }).expect(201);
        const rows = await prisma.idempotencyRecord.findMany({ where: { namespace: 'anon', key } });
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.fingerprint))).toBe(true);
        expect(JSON.stringify(rows)).not.toContain('metadata');
    });

    it('deletes failed attempts so 4xx and 5xx remain retryable on another instance', async () => {
        const invalidKey = `invalid-${Date.now()}`;
        const invalid1 = await request(firstInstance).post('/invalid').set('X-Idempotency-Key', invalidKey).send({ value: 1 });
        const invalid2 = await request(secondInstance).post('/invalid').set('X-Idempotency-Key', invalidKey).send({ value: 1 });
        expect([invalid1.body.execution, invalid2.body.execution]).toEqual([1, 2]);
        const failureKey = `failure-${Date.now()}`;
        const failure1 = await request(firstInstance).post('/failure').set('X-Idempotency-Key', failureKey).send({ value: 1 });
        const failure2 = await request(secondInstance).post('/failure').set('X-Idempotency-Key', failureKey).send({ value: 1 });
        expect([failure1.body.execution, failure2.body.execution]).toEqual([3, 4]);
    });

    it('isolates identical keys used by different API keys and webhook signatures', async () => {
        const key = `credentials-${Date.now()}`;
        const before = counters.success;
        await request(firstInstance).post('/payments').set('X-Api-Key', 'integration-a').set('X-Idempotency-Key', key).send({ amount: 10 }).expect(201);
        await request(firstInstance).post('/payments').set('X-Api-Key', 'integration-b').set('X-Idempotency-Key', key).send({ amount: 10 }).expect(201);
        await request(firstInstance).post('/payments').set('X-Webhook-Signature', 'signature-a').set('X-Idempotency-Key', key).send({ amount: 10 }).expect(201);
        await request(firstInstance).post('/payments').set('X-Webhook-Signature', 'signature-b').set('X-Idempotency-Key', key).send({ amount: 10 }).expect(201);
        expect(counters.success - before).toBe(4);

        await request(secondInstance).post('/payments').set('X-Api-Key', 'integration-a').set('X-Idempotency-Key', key).send({ amount: 10 }).expect(201);
        await request(secondInstance).post('/payments').set('X-Webhook-Signature', 'signature-a').set('X-Idempotency-Key', key).send({ amount: 10 }).expect(201);
        expect(counters.success - before).toBe(4);

        const rows = await prisma.idempotencyRecord.findMany({ where: { key } });
        expect(rows).toHaveLength(4);
        expect(new Set(rows.map((row) => row.namespace)).size).toBe(4);
        expect(JSON.stringify(rows)).not.toContain('integration-a');
        expect(JSON.stringify(rows)).not.toContain('signature-a');
    });

    it('preserves a committed 2xx response if durable response finalization fails', async () => {
        const key = `finalize-failure-${Date.now()}`;
        const update = jest.spyOn(prisma.idempotencyRecord, 'update').mockRejectedValueOnce(new Error('simulated finalization outage'));
        const response = await request(firstInstance).post('/payments').set('X-Idempotency-Key', key).send({ amount: 77 });
        update.mockRestore();

        expect(response.status).toBe(201);
        expect(response.body.amount).toBe(77);
        const record = await prisma.idempotencyRecord.findUnique({
            where: { namespace_scope_key: { namespace: 'anon', scope: 'POST:/payments', key } }
        });
        expect(record?.status).toBe('PROCESSING');
    });
});
