import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller';
import { auth as authenticate, requirePermission } from '../middlewares/auth';

const router = Router();

// Apply auth middleware to all invoice routes
router.use(authenticate);

const canIssueInvoice = requirePermission('invoices.issue', 'SUPERADMIN', 'ADMIN', 'CAJERO');
const canViewInvoice = requirePermission('invoices.view', 'SUPERADMIN', 'ADMIN', 'CAJERO');
const canCancelInvoice = requirePermission('invoices.cancel', 'SUPERADMIN', 'ADMIN');
const canIssueCreditNote = requirePermission('invoices.credit', 'SUPERADMIN', 'ADMIN');

// Issuance is intentionally a POST: it consumes a fiscal sequence and captures
// an immutable rendering snapshot. Idempotent retries return that same snapshot.
router.post('/:id/issue', canIssueInvoice, InvoiceController.issueInvoice);

// Static report path must precede the parameterized invoice reads.
router.get('/credit-notes', canViewInvoice, InvoiceController.listCreditNotes);
router.get('/cancellations', canViewInvoice, InvoiceController.listInvoiceCancellations);

// Fiscal mutation and its immutable reads are intentionally separate. GET never
// consumes a sequence, reverses money or touches stock.
router.post('/:id/credit-note', canIssueCreditNote, InvoiceController.issueCreditNote);
router.get('/:id/credit-note', canViewInvoice, InvoiceController.getCreditNote);
router.get('/:id/credit-note/pdf', canViewInvoice, InvoiceController.getCreditNotePDF);
router.post('/:id/cancel', canCancelInvoice, InvoiceController.cancelInvoice);
router.get('/:id/cancellation', canViewInvoice, InvoiceController.getInvoiceCancellation);
router.get('/:id/cancellation/pdf', canViewInvoice, InvoiceController.getInvoiceCancellationPDF);

/**
 * @swagger
 * tags:
 *   name: Invoices
 *   description: Invoice management and PDF generation
 */

/**
 * @swagger
 * /api/invoices/{id}:
 *   get:
 *     summary: Get invoice data for an order
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Invoice data retrieved successfully
 *       404:
 *         description: Order not found
 */
router.get('/:id', canViewInvoice, InvoiceController.getInvoiceData);

/**
 * @swagger
 * /api/invoices/{id}/pdf:
 *   get:
 *     summary: Generate PDF invoice for an order
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order ID
 *     responses:
 *       200:
 *         description: PDF file generated successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:id/pdf', canViewInvoice, InvoiceController.getInvoicePDF);

export default router;
