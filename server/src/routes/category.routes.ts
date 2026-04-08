import { Router } from 'express';
import { CategoryController } from '../controllers/category.controller';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

router.get('/', CategoryController.getAll);
router.get('/:id', CategoryController.getById);
router.post('/', requireRole('ADMIN', 'SUPERADMIN'), CategoryController.create);
router.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), CategoryController.update);
router.delete('/:id', requireRole('ADMIN', 'SUPERADMIN'), CategoryController.delete);

export default router;
