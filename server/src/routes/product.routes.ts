import { Router } from 'express';
import { ProductController } from '../controllers/product.controller';
import { CostingController } from '../controllers/costing.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All product routes require authentication
router.use(authMiddleware);

router.get('/', ProductController.getAll);
router.get('/low-stock', ProductController.getLowStock);
router.get('/:id', ProductController.getById);
router.get('/:id/cost-history', CostingController.getCostHistory);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), ProductController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), ProductController.update);
router.delete('/:id', requireRole('SUPERADMIN'), ProductController.delete);
router.post('/:id/recalculate-cost', requireRole('SUPERADMIN'), CostingController.recalculateCost);

export default router;
