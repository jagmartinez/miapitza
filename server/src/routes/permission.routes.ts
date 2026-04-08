import { Router } from 'express';
import { PermissionController } from '../controllers/permission.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', PermissionController.getAll);
router.get('/:id', PermissionController.getById);
router.post('/', requireRole('SUPERADMIN'), PermissionController.create);
router.put('/:id', requireRole('SUPERADMIN'), PermissionController.update);
router.delete('/:id', requireRole('SUPERADMIN'), PermissionController.delete);

export default router;
