import { Router } from 'express';
import { TableController } from '../controllers/table.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All table routes require authentication
router.use(authMiddleware);

router.get('/', TableController.getAll);
router.get('/branch/:branchId', TableController.getByBranch);
router.get('/:id', TableController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), TableController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'HOST'), TableController.update);
router.patch('/:id/status', requireRole('SUPERADMIN', 'ADMIN', 'HOST', 'MESERO'), TableController.updateStatus);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), TableController.delete);

export default router;
