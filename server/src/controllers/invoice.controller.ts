import { Request, Response, NextFunction } from 'express';
import { InvoiceService } from '../services/invoice.service';
import { OrderService } from '../services/order.service';
import { getErrorMessage } from '../utils/error';
import { assertBranchAccess, BranchScopeError } from '../utils/branch-scope';

const INVOICE_NOT_FOUND_ERRORS = new Set([
    'Order not found',
    'Order not found or unauthorized'
]);

function forwardInvoiceError(error: unknown, next: NextFunction) {
    if (error instanceof BranchScopeError) return next(error);

    const message = getErrorMessage(error);
    if (INVOICE_NOT_FOUND_ERRORS.has(message)) {
        return next({ statusCode: 404, message: 'Orden no encontrada' });
    }
    if (message.startsWith('Solo se puede emitir una factura')) {
        return next({ statusCode: 400, message });
    }
    if (message === 'La sucursal de la orden cambió durante la facturación') {
        return next({ statusCode: 409, message });
    }

    // Preserve infrastructure failures as 500s. Mapping every exception to a
    // 404 hid schema/database incidents and made valid orders look missing.
    return next(error);
}

export class InvoiceController {

    static async getInvoiceData(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const invoiceData = await InvoiceService.generateInvoice(id, companyId);

            res.json({
                success: true,
                data: invoiceData
            });
        } catch (error: unknown) {
            forwardInvoiceError(error, next);
        }
    }

    static async getInvoicePDF(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const pdfBuffer = await InvoiceService.generateInvoicePDF(id, companyId);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=invoice-${id}.pdf`);
            res.send(pdfBuffer);
        } catch (error: unknown) {
            forwardInvoiceError(error, next);
        }
    }
}
