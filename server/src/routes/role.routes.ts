import { Router } from 'express';
import { RoleController } from '../controllers/role.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { ADMINS, ROLES } from '../constants/roles';

const router = Router();

router.use(authMiddleware);

router.get('/', requireRole(...ADMINS), RoleController.getAll);
router.get('/:id', requireRole(...ADMINS), validate(s.idParam), RoleController.getById);
router.post('/', requireRole(...ADMINS), validate(s.createRole), RoleController.create);
router.put('/:id', requireRole(...ADMINS), validate(s.updateRole), RoleController.update);
router.delete('/:id', requireRole(ROLES.SUPERADMIN), validate(s.idParam), RoleController.delete);

export default router;
