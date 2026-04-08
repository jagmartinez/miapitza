import { Request, Response, NextFunction } from 'express';
import { MenuItemService } from '../services/menu-item.service';
import { getErrorMessage } from '../utils/error';

export class MenuItemController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            type MenuItemFilters = NonNullable<Parameters<typeof MenuItemService.getAll>[1]>;
            const filters: MenuItemFilters = {};
            const isSuperAdmin = (req.user?.roles || [req.user?.role]).includes('SUPERADMIN');

            if (isSuperAdmin) {
                if (req.query.branchId) {
                    filters.branchId = parseInt(req.query.branchId as string);
                }
            } else {
                filters.branchId = req.user?.branchId;
            }

            if (req.query.categoryId) {
                filters.categoryId = parseInt(req.query.categoryId as string);
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

            const menuItems = await MenuItemService.getAll(companyId, filters);
            res.json({
                success: true,
                data: menuItems
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const menuItem = await MenuItemService.getById(id, companyId);
            res.json({
                success: true,
                data: menuItem
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const menuItem = await MenuItemService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Platillo creado exitosamente',
                data: menuItem
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const menuItem = await MenuItemService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Platillo actualizado exitosamente',
                data: menuItem
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuItemService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Platillo eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    // Recipe management
    static async getRecipes(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const recipes = await MenuItemService.getRecipes(menuItemId, companyId);
            res.json({
                success: true,
                data: recipes
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async addRecipe(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const recipe = await MenuItemService.addRecipe(menuItemId, companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Receta agregada exitosamente',
                data: recipe
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateRecipe(req: Request, res: Response, next: NextFunction) {
        try {
            const recipeId = parseInt(req.params.recipeId);
            const companyId = req.user!.companyId;
            const recipe = await MenuItemService.updateRecipe(recipeId, companyId, req.body);
            res.json({
                success: true,
                message: 'Receta actualizada exitosamente',
                data: recipe
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteRecipe(req: Request, res: Response, next: NextFunction) {
        try {
            const recipeId = parseInt(req.params.recipeId);
            const companyId = req.user!.companyId;
            await MenuItemService.deleteRecipe(recipeId, companyId);
            res.json({
                success: true,
                message: 'Receta eliminada exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    // Image management
    static async getImages(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const images = await MenuItemService.getImages(menuItemId, companyId);
            res.json({
                success: true,
                data: images
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async addImage(req: Request, res: Response, next: NextFunction) {
        try {
            const menuItemId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { imageUrl } = req.body;
            const image = await MenuItemService.addImage(menuItemId, companyId, imageUrl);
            res.status(201).json({
                success: true,
                message: 'Imagen agregada exitosamente',
                data: image
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async deleteImage(req: Request, res: Response, next: NextFunction) {
        try {
            const imageId = parseInt(req.params.imageId);
            const companyId = req.user!.companyId;
            await MenuItemService.deleteImage(imageId, companyId);
            res.json({
                success: true,
                message: 'Imagen eliminada exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
