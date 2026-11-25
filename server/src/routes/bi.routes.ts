import { Router } from 'express';
import { BiController } from '../controllers/bi.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// Same audience as the existing reports: SUPERADMIN and ADMIN only.
router.use(authMiddleware);
router.use(requireRole('SUPERADMIN', 'ADMIN'));

router.get('/summary', BiController.summary);
router.get('/trend', BiController.trend);
router.get('/bridge', BiController.bridge);
router.get('/channels', BiController.channels);
router.get('/heatmap', BiController.heatmap);
router.get('/pareto', BiController.pareto);
router.get('/branches', BiController.branches);
router.get('/insights', BiController.insights);

export default router;
