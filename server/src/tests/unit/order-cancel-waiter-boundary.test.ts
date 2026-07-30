import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { OrderController } from '../../controllers/order.controller';
import { OrderService } from '../../services/order.service';
import { WebSocketService } from '../../services/websocket.service';

afterEach(() => {
    jest.restoreAllMocks();
});

function requestFor(roles: string[]): Request {
    return {
        params: { id: '41' },
        body: { cancelReason: 'Solicitado por cliente' },
        user: {
            userId: 7,
            companyId: 1,
            branchId: 2,
            role: roles[0] ?? 'MESERO',
            roles,
            timezone: 'America/Managua',
        },
    } as unknown as Request;
}

describe('waiter order cancellation boundary', () => {
    it('denies a waiter after any product was sent to kitchen', async () => {
        jest.spyOn(OrderService, 'getById').mockResolvedValue({
            id: 41,
            branchId: 2,
            items: [{ id: 1, sentAt: new Date('2026-07-29T12:00:00.000Z') }],
        } as never);
        const cancel = jest.spyOn(OrderService, 'cancel');
        const next = jest.fn() as unknown as NextFunction;

        await OrderController.cancel(
            requestFor(['MESERO']),
            { json: jest.fn() } as unknown as Response,
            next,
        );

        expect(cancel).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            message: expect.stringMatching(/mesero.*después.*cocina/i),
        }));
    });

    it('preserves the administrative cancellation and waste counterflow', async () => {
        const sentOrder = {
            id: 41,
            branchId: 2,
            items: [{ id: 1, sentAt: new Date('2026-07-29T12:00:00.000Z') }],
        };
        jest.spyOn(OrderService, 'getById').mockResolvedValue(sentOrder as never);
        const cancel = jest.spyOn(OrderService, 'cancel').mockResolvedValue({
            ...sentOrder,
            status: 'CANCELLED',
        } as never);
        jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined);
        const json = jest.fn();
        const next = jest.fn() as unknown as NextFunction;

        await OrderController.cancel(
            requestFor(['MESERO', 'ADMIN']),
            { json } as unknown as Response,
            next,
        );

        expect(cancel).toHaveBeenCalledWith(
            41,
            1,
            7,
            'Solicitado por cliente',
            { wasteWarehouseId: undefined },
        );
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        expect(next).not.toHaveBeenCalled();
    });
});
