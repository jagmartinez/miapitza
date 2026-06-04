import { Request, Response, NextFunction } from 'express';
import { TableService } from '../services/table.service';
import { WebSocketService } from '../services/websocket.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';

export class TableController {
    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);
            const tables = await TableService.getAll(companyId, branchId);
            res.json({
                success: true,
                data: tables
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
            const table = await TableService.getById(id, companyId);
            assertBranchAccess(req.user!, table.branchId);
            res.json({
                success: true,
                data: table
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getByBranch(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = parseInt(req.params.branchId);
            const companyId = req.user!.companyId;
            const branchId = resolveBranchScope(req.user!, requestedBranchId);
            if (!branchId) {
                return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            }
            const tables = await TableService.getByBranch(branchId, companyId);
            res.json({
                success: true,
                data: tables
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            // Resolve target branch: non-superadmin users are pinned to their active branch.
            const requested = req.body.branchId ? Number(req.body.branchId) : req.user?.branchId;
            const branchId = resolveBranchScope(req.user!, requested);
            if (!branchId) {
                return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            }
            req.body.branchId = branchId;

            const table = await TableService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Mesa creada exitosamente',
                data: table
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
            const existing = await TableService.getById(id, companyId);
            assertBranchAccess(req.user!, existing.branchId);
            const table = await TableService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Mesa actualizada exitosamente',
                data: table
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
            const existing = await TableService.getById(id, companyId);
            assertBranchAccess(req.user!, existing.branchId);
            await TableService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Mesa eliminada exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async updateStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { status } = req.body;

            if (!status) {
                return next({ statusCode: 400, message: 'Estado es requerido' });
            }

            const existing = await TableService.getById(id, companyId);
            assertBranchAccess(req.user!, existing.branchId);
            const table = await TableService.updateStatus(id, companyId, status);

            // Broadcast table status change
            WebSocketService.broadcastTableUpdate(id, status, table, {
                companyId,
                branchId: table.branchId
            });

            res.json({
                success: true,
                message: 'Estado de mesa actualizado exitosamente',
                data: table
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
