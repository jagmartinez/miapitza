import { Router } from 'express';
import { CashRegisterController } from '../controllers/cash-register.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All cash register routes require authentication
router.use(authMiddleware);

router.get('/', CashRegisterController.getAll);
router.get('/:id', CashRegisterController.getById);
router.get('/:id/active-shift', CashRegisterController.getActiveShift);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), CashRegisterController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), CashRegisterController.update);
router.delete('/:id', requireRole('SUPERADMIN'), CashRegisterController.delete);

export default router;
