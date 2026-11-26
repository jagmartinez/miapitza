import { Request, Response, NextFunction } from 'express';
import { InvoiceService } from '../services/invoice.service';
import { OrderService } from '../services/order.service';
import { getErrorMessage } from '../utils/error';
import { assertBranchAccess, BranchScopeError } from '../utils/branch-scope';
import { resolveBranchScope } from '../utils/branch-scope';
import { InvalidQueryDateError, parseQueryDateFrom, parseQueryDateTo } from '../utils/date-range';
import { SettingService } from '../services/setting.service';
import { CreditNoteService } from '../services/credit-note.service';
import { InvoiceCancellationService } from '../services/invoice-cancellation.service';

const INVOICE_NOT_FOUND_ERRORS = new Set([
    'Order not found',
    'Order not found or unauthorized',
    'Orden no encontrada o no autorizada'
]);

// Integrity failures raised in Spanish by CreditNoteService (snapshot/order mismatches).
const CREDIT_NOTE_INTEGRITY_PREFIXES = [
    'Las líneas de la factura',
    'El subtotal bruto de la factura',
    'La factura no corresponde a su orden',
    'Los totales de la factura no se pueden distribuir',
    'La instantánea de la nota de crédito',
    'La nota de crédito no corresponde',
    'Los totales de la nota de crédito no concilian',
];

function forwardInvoiceError(error: unknown, next: NextFunction) {
    if (error instanceof BranchScopeError) return next(error);

    const message = getErrorMessage(error);
    if (INVOICE_NOT_FOUND_ERRORS.has(message)) {
        return next({ statusCode: 404, message: 'Orden no encontrada' });
    }
    if (message.startsWith('Solo se puede emitir una factura')) {
        return next({ statusCode: 400, message });
    }
    if (
        message.startsWith('Solo se puede emitir una prefactura')
        || message.startsWith('La factura fiscal original')
        || message.startsWith('La factura fiscal ya fue emitida')
        || message.startsWith('La orden no tiene una prefactura')
        || message.startsWith('La prefactura solo puede revertirse')
    ) {
        return next({ statusCode: 409, message });
    }
    if (message.startsWith('El motivo para revertir la prefactura')) {
        return next({ statusCode: 400, message });
    }
    if (message === 'Invoice not issued') {
        return next({ statusCode: 409, message: 'La orden todavía no tiene una factura emitida' });
    }
    if (message.startsWith('Invoice snapshot')) {
        return next({ statusCode: 500, message: 'La factura emitida no tiene un respaldo fiscal íntegro' });
    }
    if (message === 'Order fiscal totals do not reconcile') {
        return next({ statusCode: 409, message: 'Los totales fiscales de la orden no concilian' });
    }
    if (message === 'La sucursal de la orden cambió durante la facturación') {
        return next({ statusCode: 409, message });
    }
    if (message.includes('cambió durante la reversión')) {
        return next({ statusCode: 409, message });
    }

    // Preserve infrastructure failures as 500s. Mapping every exception to a
    // 404 hid schema/database incidents and made valid orders look missing.
    return next(error);
}

function forwardCreditNoteError(error: unknown, next: NextFunction) {
    if (error instanceof BranchScopeError) return next(error);
    const message = getErrorMessage(error);
    if (INVOICE_NOT_FOUND_ERRORS.has(message)) return next({ statusCode: 404, message: 'Orden no encontrada' });
    if (message === 'Credit note not issued' || message === 'La nota de crédito no ha sido emitida') return next({ statusCode: 409, message: 'La factura no tiene nota de crédito emitida' });
    if (message === 'Invoice cancellation not issued') return next({ statusCode: 409, message: 'La factura no tiene anulación registrada' });
    if (
        message.startsWith('Configure ') || message.startsWith('Solo una factura')
        || message.startsWith('Invoice snapshot') || message.startsWith('Credit note snapshot')
        || message.startsWith('Invoice cancellation snapshot')
        || CREDIT_NOTE_INTEGRITY_PREFIXES.some((prefix) => message.startsWith(prefix))
    ) return next({ statusCode: 409, message });
    if (
        /idempotencia|motivo|mercadería|bodega|reembolso|pago|RUC|orden no entregada|factura ya tiene|cantidad|línea|excede|saldo fiscal/i.test(message)
    ) return next({ statusCode: 400, message });
    return next(error);
}

export class InvoiceController {
    static async issuePreInvoice(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const invoiceData = await InvoiceService.generatePreInvoice(id, companyId, req.user!.userId);

            res.status(201).json({ success: true, data: invoiceData });
        } catch (error: unknown) {
            forwardInvoiceError(error, next);
        }
    }

    static async reversePreInvoice(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const data = await InvoiceService.reversePreInvoice(
                id,
                companyId,
                req.user!.userId,
                req.body?.reason,
            );
            res.json({ success: true, data });
        } catch (error: unknown) {
            forwardInvoiceError(error, next);
        }
    }

    static async listInvoices(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requestedBranchId = req.query.branchId ? Number(req.query.branchId) : undefined;
            const branchId = resolveBranchScope(req.user!, requestedBranchId);
            const timeZone = await SettingService.getTimezone(companyId);
            const page = req.query.page ? Number.parseInt(String(req.query.page), 10) : undefined;
            const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : undefined;
            const result = await InvoiceService.listInvoices(companyId, {
                branchId,
                startDate: req.query.startDate ? parseQueryDateFrom(String(req.query.startDate), timeZone) : undefined,
                endDate: req.query.endDate ? parseQueryDateTo(String(req.query.endDate), timeZone) : undefined,
                search: typeof req.query.search === 'string' ? req.query.search : undefined,
                page,
                limit,
            });
            res.json({ success: true, ...result });
        } catch (error: unknown) {
            if (error instanceof InvalidQueryDateError) return next({ statusCode: 400, message: error.message });
            forwardInvoiceError(error, next);
        }
    }

    static async listInvoiceCancellations(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requestedBranchId = req.query.branchId ? Number(req.query.branchId) : undefined;
            const branchId = resolveBranchScope(req.user!, requestedBranchId);
            const data = await InvoiceCancellationService.list(companyId, {
                branchId,
                startDate: req.query.startDate ? parseQueryDateFrom(String(req.query.startDate)) : undefined,
                endDate: req.query.endDate ? parseQueryDateTo(String(req.query.endDate)) : undefined
            });
            res.json({ success: true, data });
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async cancelInvoice(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const data = await InvoiceCancellationService.cancel(id, companyId, req.user!.userId, req.body);
            res.status(201).json({ success: true, data });
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async getInvoiceCancellation(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const data = await InvoiceCancellationService.getByOrder(id, companyId);
            res.json({ success: true, data });
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async getInvoiceCancellationPDF(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const pdf = await InvoiceCancellationService.generatePDF(id, companyId);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=invoice-cancellation-order-${id}.pdf`);
            res.send(pdf);
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async listCreditNotes(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requestedBranchId = req.query.branchId ? Number(req.query.branchId) : undefined;
            const branchId = resolveBranchScope(req.user!, requestedBranchId);
            const data = await CreditNoteService.list(companyId, {
                branchId,
                startDate: req.query.startDate ? parseQueryDateFrom(String(req.query.startDate)) : undefined,
                endDate: req.query.endDate ? parseQueryDateTo(String(req.query.endDate)) : undefined
            });
            res.json({ success: true, data });
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async getCreditNoteById(req: Request, res: Response, next: NextFunction) {
        try {
            const record = await CreditNoteService.getById(Number(req.params.creditNoteId), req.user!.companyId);
            assertBranchAccess(req.user!, record.branchId);
            res.json({ success: true, data: record.data });
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async getCreditNotePDFById(req: Request, res: Response, next: NextFunction) {
        try {
            const record = await CreditNoteService.generatePDFById(Number(req.params.creditNoteId), req.user!.companyId);
            assertBranchAccess(req.user!, record.branchId);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=credit-note-${req.params.creditNoteId}.pdf`);
            res.send(record.pdf);
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async issueCreditNote(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const data = await CreditNoteService.issue(id, companyId, req.user!.userId, req.body);
            res.status(201).json({ success: true, data });
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async getCreditNote(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const data = await CreditNoteService.getByOrder(id, companyId);
            res.json({ success: true, data });
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async getCreditNotePDF(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const pdf = await CreditNoteService.generatePDF(id, companyId);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=credit-note-order-${id}.pdf`);
            res.send(pdf);
        } catch (error) {
            forwardCreditNoteError(error, next);
        }
    }

    static async issueInvoice(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const invoiceData = await InvoiceService.generateInvoice(id, companyId, req.user!.userId);

            res.status(201).json({ success: true, data: invoiceData });
        } catch (error: unknown) {
            forwardInvoiceError(error, next);
        }
    }

    static async getInvoiceData(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const invoiceData = await InvoiceService.getInvoice(id, companyId);

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
