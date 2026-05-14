import { Router } from 'express';
import { SettingController } from '../controllers/setting.controller';
import { CostingController } from '../controllers/costing.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', SettingController.getAll);
router.put('/', requireRole('ADMIN', 'SUPERADMIN'), validate(s.updateSettings), SettingController.update);
router.get('/costing-method', CostingController.getCostingMethod);
router.put('/costing-method', requireRole('SUPERADMIN', 'ADMIN'), validate(s.updateCostingMethod), CostingController.updateCostingMethod);

export default router;
