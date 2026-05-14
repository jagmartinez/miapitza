import { Router } from 'express';
import multer from 'multer';
import { ProductController } from '../controllers/product.controller';
import { ProductImportController } from '../controllers/product-import.controller';
import { CostingController } from '../controllers/costing.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const upload = multer();
const router = Router();

router.use(authMiddleware);

router.get('/', ProductController.getAll);
router.get('/low-stock', ProductController.getLowStock);

// Excel import/export — must be before /:id to avoid param capture
router.get('/import/template', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), ProductImportController.getTemplate);
router.post('/import/validate', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), upload.single('file'), ProductImportController.validate);
router.post('/import/confirm', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), ProductImportController.confirm);

router.get('/:id', validate(s.idParam), ProductController.getById);
router.get('/:id/cost-history', validate(s.idParam), CostingController.getCostHistory);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.createProduct), ProductController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'BODEGA'), validate(s.updateProduct), ProductController.update);
router.delete('/:id', requireRole('SUPERADMIN'), validate(s.idParam), ProductController.delete);
router.post('/:id/recalculate-cost', requireRole('SUPERADMIN'), validate(s.idParam), CostingController.recalculateCost);

export default router;
