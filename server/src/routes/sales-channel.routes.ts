import { Router } from 'express';
import { SalesChannelController } from '../controllers/sales-channel.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', requireRole('SUPERADMIN', 'ADMIN'), SalesChannelController.getAll);
router.put('/', requireRole('SUPERADMIN', 'ADMIN'), SalesChannelController.upsert);
router.post('/ensure-defaults', requireRole('SUPERADMIN', 'ADMIN'), SalesChannelController.ensureDefaults);
router.get('/calculate-pricing', requireRole('SUPERADMIN', 'ADMIN'), SalesChannelController.calculatePricing);

export default router;
