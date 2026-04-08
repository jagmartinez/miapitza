import { Router } from 'express';
import { SettingController } from '../controllers/setting.controller';
import { CostingController } from '../controllers/costing.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', SettingController.getAll);
router.put('/', requireRole('ADMIN', 'SUPERADMIN'), SettingController.update);
router.get('/costing-method', CostingController.getCostingMethod);
router.put('/costing-method', requireRole('SUPERADMIN', 'ADMIN'), CostingController.updateCostingMethod);

export default router;
