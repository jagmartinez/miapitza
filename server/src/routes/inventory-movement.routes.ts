import { Router } from 'express';
import { InventoryMovementController } from '../controllers/inventory-movement.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', InventoryMovementController.getAll);
router.get('/product/:productId/kardex', InventoryMovementController.getKardex);
router.get('/:id', validate(s.idParam), InventoryMovementController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.createInventoryMovement), InventoryMovementController.create);
router.post('/transfer', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.transferInventory), InventoryMovementController.transfer);

export default router;
