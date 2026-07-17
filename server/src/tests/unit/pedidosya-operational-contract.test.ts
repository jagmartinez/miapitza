import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { PedidosYaService } from '../../services/pedidosya.service';
import { OrderService } from '../../services/order.service';

const originalTimeout = process.env.PEDIDOSYA_HTTP_TIMEOUT_MS;

afterEach(() => {
    jest.restoreAllMocks();
    if (originalTimeout === undefined) delete process.env.PEDIDOSYA_HTTP_TIMEOUT_MS;
    else process.env.PEDIDOSYA_HTTP_TIMEOUT_MS = originalTimeout;
});

describe('PedidosYa outbound operational contract', () => {
    it('uses sandbox plus an abortable deadline and persists only a successful token', async () => {
        process.env.PEDIDOSYA_HTTP_TIMEOUT_MS = '750';
        jest.spyOn(prisma.pedidosYaConfig, 'findFirst').mockResolvedValue({
            id: 3,
            companyId: 1,
            branchId: null,
            active: true,
            environment: 'sandbox',
            clientId: 'sandbox-client',
            clientSecret: 'sandbox-secret',
            refreshToken: null
        } as never);
        const update = jest.spyOn(prisma.pedidosYaConfig, 'update').mockResolvedValue({} as never);
        const network = jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ access_token: 'ephemeral-token', expires_in: 60 })
        } as Response);

        await expect(PedidosYaService.refreshAccessToken(1, null)).resolves.toBe('ephemeral-token');

        expect(network).toHaveBeenCalledWith(
            'https://api-sandbox.pedidosya.com/oauth/token',
            expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
        );
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('does not open a network request with an invalid timeout configuration', async () => {
        process.env.PEDIDOSYA_HTTP_TIMEOUT_MS = 'infinite';
        jest.spyOn(prisma.pedidosYaConfig, 'findFirst').mockResolvedValue({
            id: 3,
            companyId: 1,
            branchId: null,
            active: true,
            environment: 'sandbox',
            clientId: 'sandbox-client',
            clientSecret: 'sandbox-secret'
        } as never);
        const network = jest.spyOn(global, 'fetch');

        await expect(PedidosYaService.refreshAccessToken(1, null)).rejects.toThrow(/250 y 60000/);

        expect(network).not.toHaveBeenCalled();
    });

    it('acknowledges a replayed NEW_ORDER without creating a duplicate local order', async () => {
        jest.spyOn(prisma.pedidosYaWebhookLog, 'create').mockResolvedValue({ id: 20 } as never);
        const logUpdate = jest.spyOn(prisma.pedidosYaWebhookLog, 'update').mockResolvedValue({} as never);
        jest.spyOn(prisma.pedidosYaOrderSync, 'findFirst').mockResolvedValue({ id: 4, orderId: 9 } as never);
        const orderCreate = jest.spyOn(prisma.order, 'create');

        await expect(PedidosYaService.processWebhook(1, 'NEW_ORDER', { id: 'PY-100' }))
            .resolves.toEqual({ status: 'PROCESSED', logId: 20 });

        expect(orderCreate).not.toHaveBeenCalled();
        expect(logUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 20 },
            data: expect.objectContaining({ status: 'PROCESSED' })
        }));
    });

    it('treats an already-cancelled provider replay as idempotent and reconciles the sync row', async () => {
        jest.spyOn(prisma.pedidosYaWebhookLog, 'create').mockResolvedValue({ id: 21 } as never);
        jest.spyOn(prisma.pedidosYaWebhookLog, 'update').mockResolvedValue({} as never);
        jest.spyOn(prisma.pedidosYaOrderSync, 'findFirst').mockResolvedValue({
            id: 4, orderId: 9, externalId: 'PY-100'
        } as never);
        jest.spyOn(prisma.pedidosYaConfig, 'findMany').mockResolvedValue([{
            id: 2, companyId: 1, branchId: null, active: true, defaultWarehouseId: 5
        }] as never);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 7 } as never);
        jest.spyOn(OrderService, 'cancel').mockRejectedValue(new Error('Order is already cancelled'));
        const syncUpdate = jest.spyOn(prisma.pedidosYaOrderSync, 'update').mockResolvedValue({} as never);

        await expect(PedidosYaService.processWebhook(1, 'ORDER_CANCELLED', { id: 'PY-100' }))
            .resolves.toEqual({ status: 'PROCESSED', logId: 21 });

        expect(syncUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 4 },
            data: expect.objectContaining({ externalStatus: 'CANCELLED', internalStatus: 'CANCELLED' })
        }));
    });

    it('rejects an unmapped NEW_ORDER before opening the order transaction', async () => {
        jest.spyOn(prisma.pedidosYaWebhookLog, 'create').mockResolvedValue({ id: 22 } as never);
        const logUpdate = jest.spyOn(prisma.pedidosYaWebhookLog, 'update').mockResolvedValue({} as never);
        jest.spyOn(prisma.pedidosYaOrderSync, 'findFirst').mockResolvedValue(null);
        jest.spyOn(prisma.pedidosYaConfig, 'findMany').mockResolvedValue([{
            id: 2, companyId: 1, branchId: 3, active: true, autoAcceptOrders: false
        }] as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 3 } as never);
        jest.spyOn(prisma.salesChannelConfig, 'findUnique').mockResolvedValue(null);
        jest.spyOn(
            PedidosYaService as unknown as { mapOrderItems: (...args: unknown[]) => Promise<unknown> },
            'mapOrderItems'
        ).mockResolvedValue({ mapped: [], unmapped: ['Producto externo'] });
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(PedidosYaService.processWebhook(1, 'NEW_ORDER', {
            id: 'PY-UNMAPPED',
            items: [{ id: 'ext-1', name: 'Producto externo', quantity: 1, price: 10 }]
        })).rejects.toThrow(/sin mapeo/i);

        expect(transaction).not.toHaveBeenCalled();
        expect(logUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
            where: { id: 22 },
            data: expect.objectContaining({ status: 'FAILED', errorMessage: expect.stringMatching(/sin mapeo/i) })
        }));
    });
});
