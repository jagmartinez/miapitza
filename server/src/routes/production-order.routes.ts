import { Router } from 'express';
import { ProductionOrderController } from '../controllers/production-order.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { INVENTORY } from '../constants/roles';

const router = Router();

router.use(authMiddleware);

router.get('/', ProductionOrderController.getAll);
router.post('/preview', requireRole(...INVENTORY), validate(s.previewProduction), ProductionOrderController.preview);
router.get('/:id', validate(s.idParam), ProductionOrderController.getById);

router.post('/', requireRole(...INVENTORY), validate(s.createProductionOrder), ProductionOrderController.create);
router.put('/:id', requireRole(...INVENTORY), validate(s.idParam), ProductionOrderController.update);
router.patch('/:id/status', requireRole(...INVENTORY), validate(s.setProductionOrderStatus), ProductionOrderController.setStatus);
router.post('/:id/finish', requireRole(...INVENTORY), validate(s.finishProductionOrder), ProductionOrderController.finish);
router.post('/:id/cancel', requireRole(...INVENTORY), validate(s.idParam), ProductionOrderController.cancel);

export default router;
