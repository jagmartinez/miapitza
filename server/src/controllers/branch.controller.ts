import { Request, Response, NextFunction } from 'express';
import { BranchService } from '../services/branch.service';
import { getErrorMessage } from '../utils/error';
import { assertBranchAccess, BranchScopeError, isCompanyWide, resolveBranchScope } from '../utils/branch-scope';

export class BranchController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            let companyId = req.user!.companyId;
            if (isCompanyWide(req.user!) && req.query.companyId) {
                companyId = parseInt(req.query.companyId as string);
            }
            const branches = isCompanyWide(req.user!)
                ? await BranchService.getAll(companyId)
                : [await BranchService.getById(resolveBranchScope(req.user!)!, companyId)];
            res.json({
                success: true,
                data: branches
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
            const branch = await BranchService.getById(id, companyId);
            assertBranchAccess(req.user!, branch.id);
            res.json({
                success: true,
                data: branch
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            let companyId = req.user!.companyId;
            if (isCompanyWide(req.user!) && req.body.companyId) {
                companyId = parseInt(req.body.companyId);
            }
            const branch = await BranchService.create({
                companyId,
                name: req.body.name,
                code: req.body.code,
                address: req.body.address,
                phone: req.body.phone
            });
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
            const existing = await BranchService.getById(id, companyId);
            assertBranchAccess(req.user!, existing.id);
            const branch = await BranchService.update(id, companyId, {
                name: req.body.name,
                code: req.body.code,
                address: req.body.address,
                phone: req.body.phone,
                status: req.body.status
            });
            res.json({
                success: true,
                message: 'Sucursal actualizada exitosamente',
                data: branch
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
