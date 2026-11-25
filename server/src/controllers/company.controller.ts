import { Request, Response, NextFunction } from 'express';
import { CompanyService } from '../services/company.service';
import { getErrorMessage } from '../utils/error';
import { assertPlatformOperator, isPlatformOperator, resolveActingCompanyId, TenantScopeError } from '../utils/tenant-scope';

export class CompanyController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companies = await CompanyService.getAll(
                isPlatformOperator(req.user!) ? undefined : req.user!.companyId,
            );
            res.json({
                success: true,
                data: companies
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            const companyId = await resolveActingCompanyId(req.user!, id);
            const company = await CompanyService.getById(companyId);
            res.json({
                success: true,
                data: company
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            assertPlatformOperator(req.user!);
            const company = await CompanyService.create(req.body, req.user!.userId);
            res.status(201).json({
                success: true,
                message: 'Empresa creada exitosamente',
                data: company
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            const companyId = await resolveActingCompanyId(req.user!, id);
            const company = await CompanyService.update(companyId, req.body, req.user!.userId);
            res.json({
                success: true,
                message: 'Empresa actualizada exitosamente',
                data: company
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
