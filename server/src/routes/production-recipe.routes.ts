import { Router } from 'express';
import { ProductionRecipeController } from '../controllers/production-recipe.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { MENU_MANAGEMENT, INVENTORY } from '../constants/roles';

const router = Router();

router.use(authMiddleware);

// Roles allowed to manage production recipes (kitchen/recipe + inventory management).
const MANAGE = Array.from(new Set([...MENU_MANAGEMENT, ...INVENTORY]));

router.get('/', ProductionRecipeController.getAll);
router.get('/product/:productId', ProductionRecipeController.getByProduct);
router.get('/:id', validate(s.idParam), ProductionRecipeController.getById);

router.post('/', requireRole(...MANAGE), validate(s.createProductionRecipe), ProductionRecipeController.create);
router.put('/:id', requireRole(...MANAGE), validate(s.updateProductionRecipe), ProductionRecipeController.update);
router.patch('/:id/status', requireRole(...MANAGE), validate(s.setProductionRecipeStatus), ProductionRecipeController.setStatus);
router.post('/:id/version', requireRole(...MANAGE), validate(s.idParam), ProductionRecipeController.createVersion);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), ProductionRecipeController.remove);

export default router;
