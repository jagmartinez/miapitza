import { Router } from 'express';
import { SupplierController } from '../controllers/supplier.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All supplier routes require authentication
router.use(authMiddleware);

router.get('/', SupplierController.getAll);
router.get('/:id', SupplierController.getById);
router.get('/:id/price-history', SupplierController.getPriceHistory);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), SupplierController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), SupplierController.update);
router.delete('/:id', requireRole('SUPERADMIN'), SupplierController.delete);

export default router;
