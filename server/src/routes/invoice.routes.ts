import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller';
import { auth as authenticate, requireRole } from '../middlewares/auth';

const router = Router();

// Apply auth middleware to all invoice routes
router.use(authenticate);
router.use(requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'));

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
router.get('/:id', InvoiceController.getInvoiceData);

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
router.get('/:id/pdf', InvoiceController.getInvoicePDF);

export default router;
