import { InvoiceController } from '../../controllers/invoice.controller';
import { OrderService } from '../../services/order.service';
import type { NextFunction, Request, Response } from 'express';

function requestFor(orderId = 32): Request {
    return {
        params: { id: String(orderId) },
        user: { companyId: 7 }
    } as unknown as Request;
}

describe('InvoiceController error classification', () => {
    const response = {} as Response;

    it('returns 404 only when the order is actually missing', async () => {
        jest.spyOn(OrderService, 'getById').mockRejectedValue(new Error('Order not found'));
        const next = jest.fn() as NextFunction;

        await InvoiceController.getInvoiceData(requestFor(), response, next);

        expect(next).toHaveBeenCalledWith({
            statusCode: 404,
            message: 'Orden no encontrada'
        });
    });

    it('does not disguise database failures as missing invoices', async () => {
        const databaseError = new Error('The column Branch.timezone does not exist');
        jest.spyOn(OrderService, 'getById').mockRejectedValue(databaseError);
        const next = jest.fn() as NextFunction;

        await InvoiceController.getInvoiceData(requestFor(), response, next);

        expect(next).toHaveBeenCalledWith(databaseError);
    });
});
