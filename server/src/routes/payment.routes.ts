import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/methods', PaymentController.getPaymentMethods);
router.get('/order/:orderId', PaymentController.getByOrderId);
router.get('/order/:orderId/summary', PaymentController.getOrderSummary);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'), validate(s.createPayment), PaymentController.create);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), PaymentController.delete);

export default router;
