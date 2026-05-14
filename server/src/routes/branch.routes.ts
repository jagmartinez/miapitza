import { Router } from 'express';
import { BranchController } from '../controllers/branch.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', BranchController.getAll);
router.get('/:id', validate(s.idParam), BranchController.getById);
router.post('/', requireRole('SUPERADMIN'), validate(s.createBranch), BranchController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), BranchController.update);
router.delete('/:id', requireRole('SUPERADMIN'), validate(s.idParam), BranchController.delete);

export default router;
