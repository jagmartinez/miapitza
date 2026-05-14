import { Router } from 'express';
import { ReservationController } from '../controllers/reservation.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', ReservationController.getAll);
router.get('/today', ReservationController.getTodayReservations);
router.get('/upcoming', ReservationController.getUpcoming);
router.get('/branch/:branchId', ReservationController.getByBranch);
router.get('/branch/:branchId/available-tables', ReservationController.getAvailableTables);
router.get('/:id', validate(s.idParam), ReservationController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'HOST'), validate(s.createReservation), ReservationController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'HOST'), validate(s.idParam), ReservationController.update);
router.patch('/:id/status', requireRole('SUPERADMIN', 'ADMIN', 'HOST'), validate(s.idParam), ReservationController.updateStatus);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), ReservationController.delete);

export default router;
