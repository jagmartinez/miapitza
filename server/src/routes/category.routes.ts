import { Router } from 'express';
import { CategoryController } from '../controllers/category.controller';
import { authenticate, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authenticate);

router.get('/', CategoryController.getAll);
router.get('/:id', validate(s.idParam), CategoryController.getById);
router.post('/', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.createCategory), CategoryController.create);
router.put('/:id', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.idParam), CategoryController.update);
router.delete('/:id', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.idParam), CategoryController.delete);
router.post('/ensure-defaults', requireRole('ADMIN', 'SUPERADMIN'), CategoryController.ensureDefaults);

export default router;
