import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All order routes require authentication
router.use(authMiddleware);

router.get('/', OrderController.getAll);
router.get('/active', OrderController.getActive);
router.get('/:id', OrderController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), OrderController.create);

// Item management
router.post('/:id/items', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), OrderController.addItem);
router.delete('/items/:itemId', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), OrderController.removeItem);

// Order flow
router.post('/:id/send-to-kitchen', requireRole('SUPERADMIN', 'ADMIN', 'MESERO'), OrderController.sendToKitchen);
router.patch('/:id/status', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), OrderController.updateStatus);
router.patch('/:id/pricing', requireRole('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), OrderController.updatePricing);
router.post('/:id/complete', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), OrderController.complete);
router.post('/:id/cancel', requireRole('SUPERADMIN', 'ADMIN', 'MESERO'), OrderController.cancel);

// Kitchen item-level control
router.patch('/:id/items/:itemId/start', requireRole('SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), OrderController.startItem);
router.patch('/:id/items/:itemId/finish', requireRole('SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), OrderController.finishItem);

// Report problem from kitchen
router.post('/:id/report-problem', requireRole('SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), OrderController.reportProblem);

export default router;
