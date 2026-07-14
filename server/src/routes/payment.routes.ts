import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { authMiddleware, requirePermission } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

const PAYMENT_READ_FALLBACK_ROLES = [
    'SUPERADMIN',
    'ADMIN',
    'MESERO',
    'HOST',
    'COCINA',
    'CHEF',
    'BODEGA',
    'CAJERO'
];

router.use(authMiddleware);

router.get('/methods', requirePermission('payments.process', ...PAYMENT_READ_FALLBACK_ROLES), PaymentController.getPaymentMethods);
router.get('/order/:orderId', requirePermission('payments.process', ...PAYMENT_READ_FALLBACK_ROLES), PaymentController.getByOrderId);
router.get('/order/:orderId/summary', requirePermission('payments.process', ...PAYMENT_READ_FALLBACK_ROLES), PaymentController.getOrderSummary);
router.post('/', requirePermission('payments.process', 'SUPERADMIN', 'ADMIN', 'CAJERO'), validate(s.createPayment), PaymentController.create);
router.delete('/:id', requirePermission('payments.reverse', 'SUPERADMIN', 'ADMIN'), validate(s.idParam), PaymentController.delete);

export default router;
