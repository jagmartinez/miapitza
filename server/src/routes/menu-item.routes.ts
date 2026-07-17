import { Router } from 'express';
import { MenuItemController } from '../controllers/menu-item.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', MenuItemController.getAll);
router.get('/:id', validate(s.idParam), MenuItemController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), validate(s.createMenuItem), MenuItemController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), validate(s.idParam), MenuItemController.update);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), validate(s.idParam), MenuItemController.delete);

router.get('/:id/recipes', validate(s.idParam), MenuItemController.getRecipes);
router.post('/:id/recipes', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), validate(s.addRecipe), MenuItemController.addRecipe);
router.put('/:id/recipes', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), validate(s.replaceRecipes), MenuItemController.replaceRecipes);
router.put('/recipes/:recipeId', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), validate(s.updateRecipe), MenuItemController.updateRecipe);
router.delete('/recipes/:recipeId', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.deleteRecipe);

router.get('/:id/images', validate(s.idParam), MenuItemController.getImages);
router.post('/:id/images', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), validate(s.idParam), MenuItemController.addImage);
router.delete('/images/:imageId', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.deleteImage);

export default router;
