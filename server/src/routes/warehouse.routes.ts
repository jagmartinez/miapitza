import { Router } from 'express';
import { WarehouseController } from '../controllers/warehouse.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', WarehouseController.getAll);
router.get('/:id', validate(s.idParam), WarehouseController.getById);
router.get('/:id/stock', validate(s.idParam), WarehouseController.getStock);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.createWarehouse), WarehouseController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.idParam), WarehouseController.update);
router.delete('/:id', requireRole('SUPERADMIN'), validate(s.idParam), WarehouseController.delete);

export default router;
