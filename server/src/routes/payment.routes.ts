import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All payment routes require authentication
router.use(authMiddleware);

router.get('/methods', PaymentController.getPaymentMethods);
router.get('/order/:orderId', PaymentController.getByOrderId);
router.get('/order/:orderId/summary', PaymentController.getOrderSummary);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), PaymentController.create);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), PaymentController.delete);

export default router;
