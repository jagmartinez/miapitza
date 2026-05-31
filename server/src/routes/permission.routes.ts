import { Router } from 'express';
import { PermissionController } from '../controllers/permission.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { ROLES } from '../constants/roles';

const router = Router();

router.use(authMiddleware);

router.get('/', PermissionController.getAll);
router.get('/:id', validate(s.idParam), PermissionController.getById);
router.post('/', requireRole(ROLES.SUPERADMIN), validate(s.createPermission), PermissionController.create);
router.put('/:id', requireRole(ROLES.SUPERADMIN), validate(s.idParam), PermissionController.update);
router.delete('/:id', requireRole(ROLES.SUPERADMIN), validate(s.idParam), PermissionController.delete);

export default router;
