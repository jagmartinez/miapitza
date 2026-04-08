import { Router } from 'express';
import { MenuItemController } from '../controllers/menu-item.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All menu routes require authentication
router.use(authMiddleware);

router.get('/', MenuItemController.getAll);
router.get('/:id', MenuItemController.getById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.create);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.update);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.delete);

// Recipe management endpoints
router.get('/:id/recipes', MenuItemController.getRecipes);
router.post('/:id/recipes', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.addRecipe);
router.put('/recipes/:recipeId', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.updateRecipe);
router.delete('/recipes/:recipeId', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.deleteRecipe);

// Image management endpoints
router.get('/:id/images', MenuItemController.getImages);
router.post('/:id/images', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.addImage);
router.delete('/images/:imageId', requireRole('SUPERADMIN', 'ADMIN', 'CHEF'), MenuItemController.deleteImage);

export default router;
