import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';
import { authMiddleware, requirePermission } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

const ORDER_READ_FALLBACK_ROLES = [
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

router.get('/', requirePermission('orders.view', ...ORDER_READ_FALLBACK_ROLES), OrderController.getAll);
router.get('/active', requirePermission('orders.view', ...ORDER_READ_FALLBACK_ROLES), OrderController.getActive);
router.get('/kitchen/config', requirePermission('kds.view', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), OrderController.getKitchenConfig);
router.get('/kitchen/queue', requirePermission('kds.view', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), OrderController.getKitchenQueue);
router.get('/kitchen/history', requirePermission('kds.view', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), OrderController.getKitchenHistory);
router.get('/:id', requirePermission('orders.view', ...ORDER_READ_FALLBACK_ROLES), validate(s.idParam), OrderController.getById);
router.post('/', requirePermission('orders.create', 'SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.createOrder), OrderController.create);

router.post('/:id/items', requirePermission('orders.edit', 'SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.addOrderItem), OrderController.addItem);
router.delete('/items/:itemId', requirePermission('orders.edit', 'SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), OrderController.removeItem);

router.post('/:id/send-to-kitchen', requirePermission('orders.edit', 'SUPERADMIN', 'ADMIN', 'MESERO'), validate(s.idParam), OrderController.sendToKitchen);
router.patch('/:id/status', requirePermission('orders.edit', 'SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.updateOrderStatus), OrderController.updateStatus);
router.patch('/:id/pricing', requirePermission('orders.edit', 'SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.idParam), OrderController.updatePricing);
router.post('/:id/complete', requirePermission('orders.deliver', 'SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'), validate(s.idParam), OrderController.complete);
router.post('/:id/cancel', requirePermission('orders.cancel', 'SUPERADMIN', 'ADMIN', 'MESERO'), validate(s.idParam), OrderController.cancel);

router.patch('/:id/items/:itemId/start', requirePermission('kds.manage', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.startItem);
router.patch('/:id/items/:itemId/finish', requirePermission('kds.manage', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.finishItem);
router.post('/:id/kitchen/start', requirePermission('kds.manage', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.startKitchenPreparation);
router.post('/:id/kitchen/ready', requirePermission('kds.manage', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.markKitchenReady);
router.post('/:id/kitchen/release', requirePermission('kds.manage', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.releaseKitchenOrder);

router.post('/:id/report-problem', requirePermission('kds.manage', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF'), validate(s.idParam), OrderController.reportProblem);

export default router;
