import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', UserController.getAll);
router.get('/profile', UserController.getById);
router.get('/:id', validate(s.idParam), UserController.getById);
router.put('/profile', UserController.updateMe);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), validate(s.createUser), UserController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.updateUser), UserController.update);
router.delete('/:id', requireRole('SUPERADMIN'), validate(s.idParam), UserController.delete);

export default router;
