import { Request, Response, NextFunction } from 'express';
import { CategoryService } from '../services/category.service';
import { getErrorMessage } from '../utils/error';

export class CategoryController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const categories = await CategoryService.getAll(companyId);
            res.json({
                success: true,
                data: categories
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const category = await CategoryService.getById(id, companyId);
            res.json({
                success: true,
                data: category
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const category = await CategoryService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Categoría creada exitosamente',
                data: category
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const category = await CategoryService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Categoría actualizada exitosamente',
                data: category
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await CategoryService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Categoría eliminada exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async ensureDefaults(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const result = await CategoryService.ensureDefaultCategories(companyId);
            res.json({
                success: true,
                message: 'Categorías verificadas/creadas exitosamente',
                data: result
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
