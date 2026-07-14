import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller';
import { auth as authenticate, requirePermission } from '../middlewares/auth';

const router = Router();

// Apply auth middleware to all invoice routes
router.use(authenticate);

// Both endpoints call InvoiceService.generateInvoice(), which assigns the
// official number when one does not exist. They are issuance operations rather
// than read-only invoice views and therefore require the stronger permission.
// Debt: invoices.view needs a pure read endpoint that never assigns a number.
const canIssueInvoice = requirePermission('invoices.issue', 'SUPERADMIN', 'ADMIN', 'CAJERO');

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
router.get('/:id', canIssueInvoice, InvoiceController.getInvoiceData);

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
router.get('/:id/pdf', canIssueInvoice, InvoiceController.getInvoicePDF);

export default router;
