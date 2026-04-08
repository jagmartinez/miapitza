import { Request, Response, NextFunction } from 'express';
import { CompanyService } from '../services/company.service';
import { getErrorMessage } from '../utils/error';

export class CompanyController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companies = await CompanyService.getAll();
            res.json({
                success: true,
                data: companies
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const company = await CompanyService.getById(id);
            res.json({
                success: true,
                data: company
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const company = await CompanyService.create(req.body);
            res.status(201).json({
                success: true,
                message: 'Empresa creada exitosamente',
                data: company
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const company = await CompanyService.update(id, req.body);
            res.json({
                success: true,
                message: 'Empresa actualizada exitosamente',
                data: company
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
