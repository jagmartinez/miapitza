import { Router } from 'express';
import { MenuBrandController } from '../controllers/menu-brand.controller';
import { authenticate, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authenticate);

router.get('/', MenuBrandController.getAll);
router.get('/:id', validate(s.idParam), MenuBrandController.getById);
router.post('/', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.createMenuBrand), MenuBrandController.create);
router.put('/:id', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.idParam), MenuBrandController.update);
router.delete('/:id', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.idParam), MenuBrandController.delete);

export default router;
