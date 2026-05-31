import { Router } from 'express';
import { KardexController } from '../controllers/kardex.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { INVENTORY } from '../constants/roles';

const router = Router();

// All kardex routes require authentication and inventory-level access
// (kardex exposes cost/valuation data).
router.use(authMiddleware);
router.use(requireRole(...INVENTORY));

router.get('/', KardexController.getKardex);
router.get('/summary', KardexController.getKardexSummary);
router.get('/export', KardexController.exportKardex);

export default router;
