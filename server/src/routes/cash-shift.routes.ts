import { Router } from 'express';
import { CashShiftController } from '../controllers/cash-shift.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All cash shift routes require authentication
router.use(authMiddleware);

router.get('/active-status', CashShiftController.getActiveStatus);
router.get('/', CashShiftController.getAll);
router.get('/:id', CashShiftController.getById);
router.get('/:id/summary', CashShiftController.getSummary);
router.post('/open', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), CashShiftController.open);
router.post('/:id/close', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), CashShiftController.close);

// Movement management
router.post('/:id/movements', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), CashShiftController.addMovement);
router.delete('/movements/:movementId', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), CashShiftController.deleteMovement);

export default router;
