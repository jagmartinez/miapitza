import crypto from 'crypto';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { DeliveryService } from '../../services/delivery.service';

const originalEncryptionKey = process.env.TWO_FA_ENCRYPTION_KEY;

function legacyEncrypt(plaintext: string, keyHex: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

describe('DeliveryService webhook authentication', () => {
    afterEach(() => {
        delete process.env.UBER_EATS_WEBHOOK_SECRET;
        if (originalEncryptionKey === undefined) delete process.env.TWO_FA_ENCRYPTION_KEY;
        else process.env.TWO_FA_ENCRYPTION_KEY = originalEncryptionKey;
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

    it('rejects a signature when an encrypted PedidosYa secret cannot be decrypted', async () => {
        process.env.TWO_FA_ENCRYPTION_KEY = '11'.repeat(32);
        // The `enc:` namespace is always classified as encrypted; a malformed
        // envelope must never be downgraded to plaintext.
        const corruptCiphertext = 'enc:v1.invalid';
        jest.spyOn(prisma.pedidosYaConfig, 'findFirst')
            .mockResolvedValue({ webhookSecret: corruptCiphertext } as never);
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const payload = '{"id":"order-corrupt-secret"}';
        const ciphertextSignature = crypto.createHmac('sha256', corruptCiphertext).update(payload).digest('hex');

        await expect(DeliveryService.validateWebhookSignature(
            'pedidosya', ciphertextSignature, payload, 7
        )).resolves.toBe(false);
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining('descifrar el secreto webhook'),
            expect.anything()
        );
    });

    it('never treats wrong-key legacy ciphertext as a plaintext webhook secret', async () => {
        const ciphertext = legacyEncrypt('tenant-secret', '11'.repeat(32));
        process.env.TWO_FA_ENCRYPTION_KEY = '22'.repeat(32);
        jest.spyOn(prisma.pedidosYaConfig, 'findFirst')
            .mockResolvedValue({ webhookSecret: ciphertext } as never);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const payload = '{"id":"legacy-wrong-key"}';
        const ciphertextSignature = crypto.createHmac('sha256', ciphertext).update(payload).digest('hex');

        await expect(DeliveryService.validateWebhookSignature(
            'pedidosya', ciphertextSignature, payload, 7
        )).resolves.toBe(false);
    });

    it('maps only explicit supported platform states and never defaults to acceptance', () => {
        expect(DeliveryService.mapStatusToPlatform('RAPPI', 'IN_PREPARATION')).toBe('PREPARING');
        expect(DeliveryService.mapStatusToPlatform('UBER_EATS', 'READY')).toBe('READY_FOR_PICKUP');
        expect(DeliveryService.mapStatusToPlatform('RAPPI', 'UNKNOWN')).toBeNull();
        expect(DeliveryService.mapStatusToPlatform('UNKNOWN', 'OPEN')).toBeNull();
    });

    it('fails closed instead of reporting a simulated outbound success', async () => {
        await expect(DeliveryService.sendStatusUpdate('UBER_EATS', 'external-1', 'ACCEPTED'))
            .rejects.toThrow('not configured');
    });

    it('rejects invalid line quantities before creating a delivery order', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 12 } as never);
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue(null);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 3 } as never);
        const create = jest.spyOn(prisma.order, 'create');

        await expect(DeliveryService.processIncomingOrder(7, 12, {
            externalId: 'bad-quantity', platform: 'RAPPI', customerName: 'Cliente',
            customerAddress: 'Dirección', total: 10,
            items: [{ externalId: 'x', name: 'Pizza', quantity: 0, price: 10 }]
        })).rejects.toThrow('Invalid delivery quantity');
        expect(create).not.toHaveBeenCalled();
    });

    it('matches only global or destination-branch menu items', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 12 } as never);
        jest.spyOn(prisma.order, 'findFirst').mockResolvedValue(null);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 3 } as never);
        const menuLookup = jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([]);

        await expect(DeliveryService.processIncomingOrder(7, 12, {
            externalId: 'branch-menu', platform: 'RAPPI', customerName: 'Cliente',
            customerAddress: 'Dirección', total: 10,
            items: [{ externalId: 'x', name: 'Pizza', quantity: 1, price: 10 }]
        })).rejects.toThrow('unmapped menu items');
        expect(menuLookup).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 7,
                AND: expect.arrayContaining([
                    { OR: [{ branchId: null }, { branchId: 12 }] },
                    {
                        OR: [
                            { type: 'DIRECT' },
                            { type: 'PREPARED', recipes: { some: {} } }
                        ]
                    }
                ])
            })
        }));
    });
});
