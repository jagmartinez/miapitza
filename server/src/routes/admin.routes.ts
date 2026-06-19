import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { PLATFORM_ADMINS } from '../constants/roles';

const router = Router();

router.use(authMiddleware);
router.use(requireRole(...PLATFORM_ADMINS));

router.post('/seed-demo-cycle', AdminController.seedDemoCycle);

export default router;
