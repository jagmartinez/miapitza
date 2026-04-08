import { Router } from 'express';
import { BranchController } from '../controllers/branch.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All branch routes require authentication
router.use(authMiddleware);

router.get('/', BranchController.getAll);
router.get('/:id', BranchController.getById);
router.post('/', requireRole('SUPERADMIN'), BranchController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), BranchController.update);
router.delete('/:id', requireRole('SUPERADMIN'), BranchController.delete);

export default router;
