import { Router } from 'express';
import { UnitConversionController } from '../controllers/unit-conversion.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', UnitConversionController.getAllUnits);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), UnitConversionController.createUnit);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), UnitConversionController.updateUnit);
router.post('/seed', requireRole('SUPERADMIN', 'ADMIN'), UnitConversionController.seedUnits);
router.post('/auto-configure-all', requireRole('SUPERADMIN', 'ADMIN'), UnitConversionController.autoConfigureAll);
router.get('/product/:productId', UnitConversionController.getProductUnits);
router.put('/product/:productId', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), UnitConversionController.setProductUnits);
router.post('/product/:productId/auto-configure', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), UnitConversionController.autoConfigureProduct);

export default router;
