import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PaymentController } from '../../controllers/payment.controller';
import { InvoiceService } from '../../services/invoice.service';
import { OrderService } from '../../services/order.service';
import { PaymentService } from '../../services/payment.service';
import { WebSocketService } from '../../services/websocket.service';

afterEach(() => {
    jest.restoreAllMocks();
});

function paymentRequest(): Request {
    return {
        body: { orderId: 41, paymentMethodId: 3, amount: 100 },
        headers: { 'x-idempotency-key': 'payment-41-final' },
        user: {
            userId: 7,
            companyId: 1,
            branchId: 2,
            role: 'CAJERO',
            roles: ['CAJERO'],
            timezone: 'America/Managua',
        },
    } as unknown as Request;
}

function responseRecorder() {
    const json = jest.fn();
    const response = { status: jest.fn(), json } as unknown as Response;
    (response.status as unknown as jest.Mock).mockReturnValue(response);
    return { response, json };
}

describe('payment to final invoice controller handoff', () => {
    it('issues and returns the original fiscal invoice after the payment settles the order', async () => {
        jest.spyOn(OrderService, 'getById')
            .mockResolvedValueOnce({ id: 41, branchId: 2, financialStatus: 'UNPAID' } as never)
            .mockResolvedValueOnce({ id: 41, branchId: 2, financialStatus: 'PAID' } as never)
            .mockResolvedValueOnce({
                id: 41,
                branchId: 2,
                financialStatus: 'PAID',
                invoiceNumber: 'FAC-2-000041',
            } as never);
        jest.spyOn(PaymentService, 'create').mockResolvedValue({ id: 8, orderId: 41 } as never);
        const fiscalInvoice = {
            orderId: 41,
            invoiceNumber: 'FAC-2-000041',
            total: 100,
        };
        const issue = jest.spyOn(InvoiceService, 'generateInvoice').mockResolvedValue(fiscalInvoice as never);
        jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined);
        const { response, json } = responseRecorder();
        const next = jest.fn() as unknown as NextFunction;

        await PaymentController.create(paymentRequest(), response, next);

        expect(issue).toHaveBeenCalledWith(41, 1, 7);
        expect(response.status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            fiscalInvoice,
            fiscalInvoiceError: null,
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('keeps the confirmed payment successful when fiscal issuance needs an idempotent retry', async () => {
        jest.spyOn(OrderService, 'getById')
            .mockResolvedValueOnce({ id: 41, branchId: 2, financialStatus: 'UNPAID' } as never)
            .mockResolvedValueOnce({ id: 41, branchId: 2, financialStatus: 'PAID' } as never);
        jest.spyOn(PaymentService, 'create').mockResolvedValue({ id: 8, orderId: 41 } as never);
        jest.spyOn(InvoiceService, 'generateInvoice').mockRejectedValue(new Error('Secuencia fiscal temporalmente no disponible'));
        jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined);
        const { response, json } = responseRecorder();
        const next = jest.fn() as unknown as NextFunction;

        await PaymentController.create(paymentRequest(), response, next);

        expect(response.status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            fiscalInvoice: null,
            fiscalInvoiceError: 'Secuencia fiscal temporalmente no disponible',
        }));
        expect(next).not.toHaveBeenCalled();
    });
});
