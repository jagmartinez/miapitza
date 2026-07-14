import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { KitchenNotificationController } from '../controllers/kitchen-notification.controller';

const router = Router();
router.use(authMiddleware);

const idParam = { params: { id: { type: 'number' as const, required: true, min: 1, integer: true } } };
router.get('/', KitchenNotificationController.list);
router.patch('/:id/seen', validate(idParam), KitchenNotificationController.seen);
router.patch('/:id/attended', validate(idParam), KitchenNotificationController.attended);

export default router;
