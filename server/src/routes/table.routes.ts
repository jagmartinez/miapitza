import { Router } from 'express';
import { TableController } from '../controllers/table.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', TableController.getAll);
router.get('/branch/:branchId', TableController.getByBranch);
router.get('/:id', validate(s.idParam), TableController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), validate(s.createTable), TableController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'HOST'), validate(s.idParam), TableController.update);
router.patch('/:id/status', requireRole('SUPERADMIN', 'ADMIN', 'HOST', 'MESERO'), validate(s.updateTableStatus), TableController.updateStatus);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), TableController.delete);

export default router;
