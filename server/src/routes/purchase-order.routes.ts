import { Router } from 'express';
import { PurchaseOrderController } from '../controllers/purchase-order.controller';
import { PurchaseOrderImportController } from '../controllers/purchase-order-import.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import {
    excelImportUpload,
    invoiceUpload,
    validateExcelUpload,
    validateInvoiceUpload,
} from '../middlewares/upload-security';

const router = Router();

// Purchase orders expose supplier costs, payments and invoice PDFs. Reads are
// limited to the same warehouse roles the client exposes the module to
// (constants/roles.ts WAREHOUSE), never to floor roles like MESERO/COCINA.
const PURCHASE_READ_ROLES = ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'] as const;

// All purchase order routes require authentication
router.use(authMiddleware);

// Bulk import — must be registered BEFORE '/:id' so '/import/*' isn't captured as an id
router.get('/import/template', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderImportController.getTemplate);
router.post(
    '/import/validate',
    requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'),
    excelImportUpload.single('file'),
    validateExcelUpload,
    PurchaseOrderImportController.validate,
);
router.post('/import/confirm', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderImportController.confirm);

router.get('/', requireRole(...PURCHASE_READ_ROLES), PurchaseOrderController.getAll);
router.get('/:id', requireRole(...PURCHASE_READ_ROLES), validate(s.idParam), PurchaseOrderController.getById);
router.get('/:id/invoice', requireRole(...PURCHASE_READ_ROLES), validate(s.idParam), PurchaseOrderController.downloadInvoice);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), invoiceUpload.single('invoicePdf'), validateInvoiceUpload, PurchaseOrderController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.idParam), invoiceUpload.single('invoicePdf'), validateInvoiceUpload, PurchaseOrderController.update);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), PurchaseOrderController.delete);

router.post('/:id/items', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.addPOItem), PurchaseOrderController.addItem);
router.delete('/items/:itemId', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderController.removeItem);

router.post('/:id/receive', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.idParam), PurchaseOrderController.receive);
// "Cerrar saldo": same shape as reverse-receipt (id param + required reason).
router.post('/:id/close-remaining', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.reversePurchaseReceipt), PurchaseOrderController.closeRemaining);
router.post('/:id/reverse-receipt', requireRole('SUPERADMIN', 'ADMIN'), validate(s.reversePurchaseReceipt), PurchaseOrderController.reverseReceipt);

router.get('/:id/payments', requireRole(...PURCHASE_READ_ROLES), validate(s.idParam), PurchaseOrderController.getPayments);
router.post('/:id/payments', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.addPurchasePayment), PurchaseOrderController.addPayment);
router.post('/:id/payments/:paymentId/reverse', requireRole('SUPERADMIN', 'ADMIN'), validate(s.reversePurchasePayment), PurchaseOrderController.reversePayment);

export default router;
