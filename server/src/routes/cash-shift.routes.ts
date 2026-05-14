import { Router } from 'express';
import { CashShiftController } from '../controllers/cash-shift.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/active-status', CashShiftController.getActiveStatus);
router.get('/', CashShiftController.getAll);
router.get('/:id', validate(s.idParam), CashShiftController.getById);
router.get('/:id/summary', validate(s.idParam), CashShiftController.getSummary);
router.post('/open', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), validate(s.openShift), CashShiftController.open);
router.post('/:id/close', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), validate(s.idParam), CashShiftController.close);

router.post('/:id/movements', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), validate(s.addCashMovement), CashShiftController.addMovement);
router.delete('/movements/:movementId', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), CashShiftController.deleteMovement);

export default router;
