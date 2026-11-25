import { Request, Response, NextFunction } from 'express';
import { BranchService } from '../services/branch.service';
import { getErrorMessage } from '../utils/error';
import { assertBranchAccess, BranchScopeError, isCompanyWide, resolveBranchScope } from '../utils/branch-scope';
import {
    isPlatformOperator,
    parseCompanyIdInput,
    resolveActingCompanyId,
    TenantScopeError,
} from '../utils/tenant-scope';

export class BranchController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const requested = parseCompanyIdInput(req.query?.companyId);
            const companyId = await resolveActingCompanyId(req.user!, requested);
            const branches = isCompanyWide(req.user!)
                ? await BranchService.getAll(companyId)
                : [await BranchService.getById(resolveBranchScope(req.user!)!, companyId)];
            res.json({
                success: true,
                data: branches
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError || error instanceof TenantScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            const companyId = await BranchController.resolveBranchCompany(req, id);
            const branch = await BranchService.getById(id, companyId);
            assertBranchAccess(req.user!, branch.id);
            res.json({
                success: true,
                data: branch
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError || error instanceof TenantScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const requested = parseCompanyIdInput(req.body.companyId);
            const companyId = await resolveActingCompanyId(req.user!, requested, {
                requireActiveTarget: true,
            });
            const branch = await BranchService.create({
                companyId,
                name: req.body.name,
                code: req.body.code,
                address: req.body.address,
                phone: req.body.phone,
                latitude: req.body.latitude,
                longitude: req.body.longitude,
                geofenceRadiusM: req.body.geofenceRadiusM,
                maxLocationAccuracyM: req.body.maxLocationAccuracyM,
                timezone: req.body.timezone,
                attendanceEnabled: req.body.attendanceEnabled,
                status: req.body.status,
            }, req.user!.userId);
            res.status(201).json({
                success: true,
                message: 'Sucursal creada exitosamente',
                data: branch
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            const companyId = await BranchController.resolveBranchCompany(req, id);
            const existing = await BranchService.getById(id, companyId);
            assertBranchAccess(req.user!, existing.id);
            const branch = await BranchService.update(id, companyId, {
                name: req.body.name,
                code: req.body.code,
                address: req.body.address,
                phone: req.body.phone,
                status: req.body.status
            }, req.user!.userId);
            res.json({
                success: true,
                message: 'Sucursal actualizada exitosamente',
                data: branch
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError || error instanceof TenantScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id, 10);
            const companyId = await BranchController.resolveBranchCompany(req, id);
            await BranchService.delete(id, companyId, req.user!.userId);
            res.json({
                success: true,
                message: 'Sucursal eliminada exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof TenantScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    /**
     * Home-company actors are pinned to `req.user.companyId`.
     * Platform operators may manage a branch owned by another company by id.
     */
    private static async resolveBranchCompany(req: Request, branchId: number): Promise<number> {
        if (!isPlatformOperator(req.user!)) {
            return req.user!.companyId;
        }
        const requested = parseCompanyIdInput(req.query?.companyId ?? req.body?.companyId);
        if (requested !== undefined) {
            return resolveActingCompanyId(req.user!, requested);
        }
        const ownerCompanyId = await BranchService.getCompanyIdById(branchId);
        if (ownerCompanyId == null) {
            throw new TenantScopeError('Sucursal no encontrada');
        }
        return resolveActingCompanyId(req.user!, ownerCompanyId);
    }
}
