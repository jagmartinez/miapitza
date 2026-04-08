import { Router } from 'express';
import { ReservationController } from '../controllers/reservation.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.get('/', ReservationController.getAll);
router.get('/today', ReservationController.getTodayReservations);
router.get('/upcoming', ReservationController.getUpcoming);
router.get('/branch/:branchId', ReservationController.getByBranch);
router.get('/branch/:branchId/available-tables', ReservationController.getAvailableTables);
router.get('/:id', ReservationController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'HOST'), ReservationController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'HOST'), ReservationController.update);
router.patch('/:id/status', requireRole('SUPERADMIN', 'ADMIN', 'HOST'), ReservationController.updateStatus);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), ReservationController.delete);

export default router;
