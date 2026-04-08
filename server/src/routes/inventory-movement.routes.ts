import { Router } from 'express';
import { InventoryMovementController } from '../controllers/inventory-movement.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All inventory movement routes require authentication
router.use(authMiddleware);

router.get('/', InventoryMovementController.getAll);
router.get('/product/:productId/kardex', InventoryMovementController.getKardex);
router.get('/:id', InventoryMovementController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO', 'BODEGA'), InventoryMovementController.create);
router.post('/transfer', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), InventoryMovementController.transfer);

export default router;
