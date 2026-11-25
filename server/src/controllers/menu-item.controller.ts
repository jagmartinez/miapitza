import { Request, Response, NextFunction } from 'express';
import { MenuItemService } from '../services/menu-item.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';

export class MenuItemController {
    private static async assertMenuItemBranch(req: Request, menuItemId: number, allowGlobal: boolean) {
        const branchId = await MenuItemService.getOwnerBranch(menuItemId, req.user!.companyId);
        assertBranchAccess(req.user!, branchId, { allowGlobal });
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            type MenuItemFilters = NonNullable<Parameters<typeof MenuItemService.getAll>[1]>;
            const filters: MenuItemFilters = {};

            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            filters.branchId = resolveBranchScope(req.user!, requested);

            if (req.query.categoryId) {
                filters.categoryId = parseInt(req.query.categoryId as string);
            }

            if (req.query.brandId) {
                filters.brandId = parseInt(req.query.brandId as string);
            }

            if (req.query.active !== undefined) {
                filters.active = req.query.active === 'true';
            }

            if (req.query.type) {
                const t = req.query.type as string;
                if (t === 'PREPARED' || t === 'DIRECT') {
                    filters.type = t;
                }
            }

            filters.resolveBranchPrice = req.query.effectivePricing === 'true';

            const menuItems = await MenuItemService.getAll(companyId, filters);
            res.json({
                success: true,
                data: menuItems
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const menuItem = await MenuItemService.getById(id, companyId);
            // Global items (branchId null) are shared across branches.
            assertBranchAccess(req.user!, (menuItem as { branchId: number | null }).branchId, { allowGlobal: true });
            res.json({
                success: true,
                data: menuItem
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const branchId = resolveBranchScope(
                req.user!,
                req.body.branchId ? Number(req.body.branchId) : undefined
            );
            const menuItem = await MenuItemService.create(companyId, {
                ...req.body,
                branchId: branchId ?? undefined
            });
            res.status(201).json({
                success: true,
                message: 'Platillo creado exitosamente',
                data: menuItem
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuItemController.assertMenuItemBranch(req, id, false);
            const updateData = { ...req.body };
            if (req.body.branchId !== undefined) {
                updateData.branchId = resolveBranchScope(req.user!, Number(req.body.branchId));
            }

            const menuItem = await MenuItemService.update(id, companyId, updateData);
            res.json({
                success: true,
                message: 'Platillo actualizado exitosamente',
                data: menuItem
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuItemController.assertMenuItemBranch(req, id, false);
            await MenuItemService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Platillo eliminado exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    // Recipe management
    static async getRecipes(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuItemController.assertMenuItemBranch(req, menuItemId, true);
            const recipes = await MenuItemService.getRecipes(menuItemId, companyId);
            res.json({
                success: true,
                data: recipes
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async addRecipe(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuItemController.assertMenuItemBranch(req, menuItemId, false);
            const recipe = await MenuItemService.addRecipe(menuItemId, companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Receta agregada exitosamente',
                data: recipe
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateRecipe(req: Request, res: Response, next: NextFunction) {
        try {
            const recipeId = parseInt(req.params.recipeId);
            const companyId = req.user!.companyId;
            const branchId = await MenuItemService.getRecipeOwnerBranch(recipeId, companyId);
            assertBranchAccess(req.user!, branchId);
            const recipe = await MenuItemService.updateRecipe(recipeId, companyId, req.body);
            res.json({
                success: true,
                message: 'Receta actualizada exitosamente',
                data: recipe
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async replaceRecipes(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuItemController.assertMenuItemBranch(req, menuItemId, false);
            const menuItemData = req.body.menuItem ? { ...req.body.menuItem } : undefined;
            if (menuItemData && req.body.menuItem.branchId !== undefined) {
                menuItemData.branchId = resolveBranchScope(
                    req.user!,
                    Number(req.body.menuItem.branchId)
                );
            }
            const result = await MenuItemService.replaceRecipes(
                menuItemId,
                companyId,
                req.body.recipes,
                menuItemData
            );
            res.json({
                success: true,
                message: 'Receta reemplazada exitosamente',
                data: result
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteRecipe(req: Request, res: Response, next: NextFunction) {
        try {
            const recipeId = parseInt(req.params.recipeId);
            const companyId = req.user!.companyId;
            const branchId = await MenuItemService.getRecipeOwnerBranch(recipeId, companyId);
            assertBranchAccess(req.user!, branchId);
            await MenuItemService.deleteRecipe(recipeId, companyId);
            res.json({
                success: true,
                message: 'Receta eliminada exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    // Image management
    static async getImages(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuItemController.assertMenuItemBranch(req, menuItemId, true);
            const images = await MenuItemService.getImages(menuItemId, companyId);
            res.json({
                success: true,
                data: images
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async addImage(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuItemController.assertMenuItemBranch(req, menuItemId, false);
            const { imageUrl } = req.body;
            const image = await MenuItemService.addImage(menuItemId, companyId, imageUrl);
            res.status(201).json({
                success: true,
                message: 'Imagen agregada exitosamente',
                data: image
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteImage(req: Request, res: Response, next: NextFunction) {
        try {
            const imageId = parseInt(req.params.imageId);
            const companyId = req.user!.companyId;
            const branchId = await MenuItemService.getImageOwnerBranch(imageId, companyId);
            assertBranchAccess(req.user!, branchId);
            await MenuItemService.deleteImage(imageId, companyId);
            res.json({
                success: true,
                message: 'Imagen eliminada exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
