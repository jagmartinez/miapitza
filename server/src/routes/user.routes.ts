import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { ADMINS, ROLES } from '../constants/roles';

const router = Router();

router.use(authMiddleware);

router.get('/', requireRole(...ADMINS), UserController.getAll);
router.get('/profile', UserController.getProfile);
router.get('/:id', validate(s.idParam), UserController.getById);
router.put('/profile', UserController.updateMe);
router.post('/', requireRole(...ADMINS), validate(s.createUser), UserController.create);
router.put('/:id', requireRole(...ADMINS), validate(s.updateUser), UserController.update);
router.delete('/:id', requireRole(ROLES.SUPERADMIN), validate(s.idParam), UserController.delete);

export default router;
