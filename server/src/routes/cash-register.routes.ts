import { Router } from 'express';
import { CashRegisterController } from '../controllers/cash-register.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', CashRegisterController.getAll);
router.get('/:id', validate(s.idParam), CashRegisterController.getById);
router.get('/:id/active-shift', validate(s.idParam), CashRegisterController.getActiveShift);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), validate(s.createCashRegister), CashRegisterController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), CashRegisterController.update);
router.delete('/:id', requireRole('SUPERADMIN'), validate(s.idParam), CashRegisterController.delete);

export default router;
