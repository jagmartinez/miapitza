import { Request, Response, NextFunction } from 'express';
import { BranchService } from '../services/branch.service';
import { getErrorMessage } from '../utils/error';

export class BranchController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            let companyId = req.user!.companyId;
            if (req.user?.role === 'SUPERADMIN' && req.query.companyId) {
                companyId = parseInt(req.query.companyId as string);
            }
            const branches = await BranchService.getAll(companyId);
            res.json({
                success: true,
                data: branches
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const branch = await BranchService.getById(id, companyId);
            res.json({
                success: true,
                data: branch
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            let companyId = req.user!.companyId;
            if (req.user?.role === 'SUPERADMIN' && req.body.companyId) {
                companyId = parseInt(req.body.companyId);
            }
            const branch = await BranchService.create({ ...req.body, companyId });
            res.status(201).json({
                success: true,
                message: 'Sucursal creada exitosamente',
                data: branch
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const branch = await BranchService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Sucursal actualizada exitosamente',
                data: branch
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await BranchService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Sucursal eliminada exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
