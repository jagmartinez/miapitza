import crypto from 'crypto';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { DeliveryService } from '../../services/delivery.service';

describe('DeliveryService webhook authentication', () => {
    afterEach(() => {
        delete process.env.UBER_EATS_WEBHOOK_SECRET;
        jest.restoreAllMocks();
    });

    it('fails closed for platforms without tenant-bound secrets', async () => {
        process.env.UBER_EATS_WEBHOOK_SECRET = 'shared-secret-must-not-authorize-tenants';
        const payload = '{"id":"order-1"}';
        const signature = crypto.createHmac('sha256', process.env.UBER_EATS_WEBHOOK_SECRET).update(payload).digest('hex');

        await expect(DeliveryService.validateWebhookSignature('uber-eats', signature, payload, 99))
            .resolves.toBe(false);
    });

    it('binds PedidosYa signatures to the requested tenant secret', async () => {
        jest.spyOn(prisma.pedidosYaConfig, 'findFirst')
            .mockResolvedValueOnce({ webhookSecret: 'tenant-seven' } as never)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ webhookSecret: 'tenant-seven' } as never);
        const payload = '{"id":"order-2"}';
        const signature = crypto.createHmac('sha256', 'tenant-seven').update(payload).digest('hex');

        await expect(DeliveryService.validateWebhookSignature('pedidosya', signature, payload, 7)).resolves.toBe(true);
        await expect(DeliveryService.validateWebhookSignature('pedidosya', signature, payload, 8)).resolves.toBe(false);
        await expect(DeliveryService.validateWebhookSignature('pedidosya', '', payload, 7)).resolves.toBe(false);
        await expect(DeliveryService.validateWebhookSignature('pedidosya', 'invalid', payload, 7)).resolves.toBe(false);
    });
});
