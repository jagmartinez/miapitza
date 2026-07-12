import { Request, Response, NextFunction } from 'express';
import { ProductionRecipeService } from '../services/production-recipe.service';
import { getErrorMessage } from '../utils/error';

export class ProductionRecipeController {
    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: { productId?: number; status?: string; search?: string } = {};
            if (req.query.productId) filters.productId = parseInt(req.query.productId as string);
            if (req.query.status) filters.status = req.query.status as string;
            if (req.query.search) filters.search = req.query.search as string;
            const data = await ProductionRecipeService.list(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ProductionRecipeService.getById(parseInt(req.params.id), req.user!.companyId);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getByProduct(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ProductionRecipeService.list(req.user!.companyId, {
                productId: parseInt(req.params.productId)
            });
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async previewCost(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ProductionRecipeService.previewCost(req.user!.companyId, req.body);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ProductionRecipeService.create(req.user!.companyId, req.body, req.user!.userId);
            res.status(201).json({ success: true, message: 'Receta de producción creada', data });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ProductionRecipeService.update(
                parseInt(req.params.id), req.user!.companyId, req.body, req.user!.userId
            );
            res.json({ success: true, message: 'Receta actualizada', data });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async setStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const status = req.body.status as 'DRAFT' | 'ACTIVE' | 'INACTIVE';
            const data = await ProductionRecipeService.setStatus(
                parseInt(req.params.id), req.user!.companyId, status, req.user!.userId
            );
            res.json({ success: true, message: 'Estado de receta actualizado', data });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async createVersion(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ProductionRecipeService.createNewVersion(
                parseInt(req.params.id), req.user!.companyId, req.user!.userId
            );
            res.status(201).json({ success: true, message: 'Nueva versión creada', data });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async remove(req: Request, res: Response, next: NextFunction) {
        try {
            await ProductionRecipeService.remove(parseInt(req.params.id), req.user!.companyId, req.user!.userId);
            res.json({ success: true, message: 'Receta eliminada' });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
