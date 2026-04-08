import { Router } from 'express';
import { PurchaseOrderController } from '../controllers/purchase-order.controller';
import { PurchaseOrderImportController } from '../controllers/purchase-order-import.controller';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware, requireRole } from '../middlewares/auth';

// Configure multer for invoice uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/invoices';
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

router.get('/', PurchaseOrderController.getAll);
router.get('/:id', PurchaseOrderController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), uploadInvoice.single('invoicePdf'), PurchaseOrderController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), uploadInvoice.single('invoicePdf'), PurchaseOrderController.update);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), PurchaseOrderController.delete);

// Item management
router.post('/:id/items', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderController.addItem);
router.delete('/items/:itemId', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderController.removeItem);

// Receive order (updates inventory)
router.post('/:id/receive', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderController.receive);

// Bulk import
router.get('/import/template', PurchaseOrderImportController.getTemplate);
router.post('/import/validate', upload.single('file'), PurchaseOrderImportController.validate);
router.post('/import/confirm', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), PurchaseOrderImportController.confirm);

export default router;
