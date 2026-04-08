import { Router } from 'express';
import { WarehouseController } from '../controllers/warehouse.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All warehouse routes require authentication
router.use(authMiddleware);

router.get('/', WarehouseController.getAll);
router.get('/:id', WarehouseController.getById);
router.get('/:id/stock', WarehouseController.getStock);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), WarehouseController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), WarehouseController.update);
router.delete('/:id', requireRole('SUPERADMIN'), WarehouseController.delete);

export default router;
