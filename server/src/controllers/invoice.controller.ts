import { Request, Response, NextFunction } from 'express';
import { InvoiceService } from '../services/invoice.service';
import { getErrorMessage } from '../utils/error';

export class InvoiceController {

    static async getInvoiceData(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const invoiceData = await InvoiceService.generateInvoice(id, companyId);

            res.json({
                success: true,
                data: invoiceData
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getInvoicePDF(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const pdfBuffer = await InvoiceService.generateInvoicePDF(id, companyId);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=invoice-${id}.pdf`);
            res.send(pdfBuffer);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
