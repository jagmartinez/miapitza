import { Router } from 'express';
import { KardexController } from '../controllers/kardex.controller';
import { authMiddleware } from '../middlewares/auth';

const router = Router();

// All kardex routes require authentication
router.use(authMiddleware);

router.get('/', KardexController.getKardex);
router.get('/summary', KardexController.getKardexSummary);
router.get('/export', KardexController.exportKardex);

export default router;
