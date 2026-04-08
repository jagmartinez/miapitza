import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All user routes require authentication
router.use(authMiddleware);

router.get('/', UserController.getAll);
router.get('/profile', UserController.getById); // Note: frontend uses /users/:id usually, but /profile will use req.user.id
router.get('/:id', UserController.getById);
router.put('/profile', UserController.updateMe);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), UserController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), UserController.update);
router.delete('/:id', requireRole('SUPERADMIN'), UserController.delete);

export default router;
