import { Router } from 'express';
import { RoleController } from '../controllers/role.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', RoleController.getAll);
router.get('/:id', RoleController.getById);
router.post('/', requireRole('ADMIN', 'SUPERADMIN'), RoleController.create);
router.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), RoleController.update);
router.delete('/:id', requireRole('SUPERADMIN'), RoleController.delete);

export default router;
