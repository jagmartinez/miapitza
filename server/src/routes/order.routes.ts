import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', OrderController.getAll);
router.get('/active', OrderController.getActive);
router.get('/:id', validate(s.idParam), OrderController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.createOrder), OrderController.create);

router.post('/:id/items', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.addOrderItem), OrderController.addItem);
router.delete('/items/:itemId', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), OrderController.removeItem);

router.post('/:id/send-to-kitchen', requireRole('SUPERADMIN', 'ADMIN', 'MESERO'), validate(s.idParam), OrderController.sendToKitchen);
router.patch('/:id/status', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.updateOrderStatus), OrderController.updateStatus);
router.patch('/:id/pricing', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.idParam), OrderController.updatePricing);
router.post('/:id/complete', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), validate(s.idParam), OrderController.complete);
router.post('/:id/cancel', requireRole('SUPERADMIN', 'ADMIN', 'MESERO'), validate(s.idParam), OrderController.cancel);

router.patch('/:id/items/:itemId/start', requireRole('SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.startItem);
router.patch('/:id/items/:itemId/finish', requireRole('SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.finishItem);

router.post('/:id/report-problem', requireRole('SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.reportProblem);

export default router;
