import { Router } from 'express';
import { RoleController } from '../controllers/role.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', RoleController.getAll);
router.get('/:id', validate(s.idParam), RoleController.getById);
router.post('/', requireRole('ADMIN', 'SUPERADMIN'), validate(s.createRole), RoleController.create);
router.put('/:id', requireRole('ADMIN', 'SUPERADMIN'), validate(s.idParam), RoleController.update);
router.delete('/:id', requireRole('SUPERADMIN'), validate(s.idParam), RoleController.delete);

export default router;
