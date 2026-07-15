import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { PedidosYaService } from '../../services/pedidosya.service';

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
});
