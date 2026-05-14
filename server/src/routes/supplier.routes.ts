import { Router } from 'express';
import { SupplierController } from '../controllers/supplier.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', SupplierController.getAll);
router.get('/:id', validate(s.idParam), SupplierController.getById);
router.get('/:id/price-history', validate(s.idParam), SupplierController.getPriceHistory);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.createSupplier), SupplierController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.idParam), SupplierController.update);
router.delete('/:id', requireRole('SUPERADMIN'), validate(s.idParam), SupplierController.delete);

export default router;
