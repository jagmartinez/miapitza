import { Router } from 'express';
import { SettingController } from '../controllers/setting.controller';
import { CostingController } from '../controllers/costing.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { ADMINS } from '../constants/roles';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

// Reads stay available to any authenticated user; writes are restricted to admins.
router.get('/', SettingController.getAll);
router.put('/', requireRole(...ADMINS), validate(s.updateSettings), SettingController.update);
router.get('/costing-method', CostingController.getCostingMethod);
router.put('/costing-method', requireRole(...ADMINS), validate(s.updateCostingMethod), CostingController.updateCostingMethod);

export default router;
