import { Router } from 'express';
import { PurchaseOrderController } from '../controllers/purchase-order.controller';
import { PurchaseOrderImportController } from '../controllers/purchase-order-import.controller';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { getUploadsDir } from '../utils/storage';

// Configure multer for invoice uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = getUploadsDir('invoices');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'invoice-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadInvoice = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF and images are allowed'));
        }
    }
});

const upload = multer();

const router = Router();

// All purchase order routes require authentication
router.use(authMiddleware);

// Bulk import — must be registered BEFORE '/:id' so '/import/*' isn't captured as an id
router.get('/import/template', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderImportController.getTemplate);
router.post('/import/validate', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), upload.single('file'), PurchaseOrderImportController.validate);
router.post('/import/confirm', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderImportController.confirm);

router.get('/', PurchaseOrderController.getAll);
router.get('/:id', validate(s.idParam), PurchaseOrderController.getById);
router.get('/:id/invoice', validate(s.idParam), PurchaseOrderController.downloadInvoice);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), uploadInvoice.single('invoicePdf'), PurchaseOrderController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.idParam), uploadInvoice.single('invoicePdf'), PurchaseOrderController.update);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), PurchaseOrderController.delete);

router.post('/:id/items', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.addPOItem), PurchaseOrderController.addItem);
router.delete('/items/:itemId', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderController.removeItem);

router.post('/:id/receive', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.idParam), PurchaseOrderController.receive);
router.post('/:id/reverse-receipt', requireRole('SUPERADMIN', 'ADMIN'), validate(s.reversePurchaseReceipt), PurchaseOrderController.reverseReceipt);

router.get('/:id/payments', validate(s.idParam), PurchaseOrderController.getPayments);
router.post('/:id/payments', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.addPurchasePayment), PurchaseOrderController.addPayment);
router.post('/:id/payments/:paymentId/reverse', requireRole('SUPERADMIN', 'ADMIN'), validate(s.reversePurchasePayment), PurchaseOrderController.reversePayment);

export default router;
