import { Request, Response, NextFunction } from 'express';
import { MenuBrandService } from '../services/menu-brand.service';
import { getErrorMessage } from '../utils/error';

export class MenuBrandController {
    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const brands = await MenuBrandService.getAll(companyId);
            res.json({ success: true, data: brands });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const brand = await MenuBrandService.getById(id, companyId);
            res.json({ success: true, data: brand });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const brand = await MenuBrandService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Marca creada exitosamente',
                data: brand
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const brand = await MenuBrandService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Marca actualizada exitosamente',
                data: brand
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await MenuBrandService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Marca eliminada exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
