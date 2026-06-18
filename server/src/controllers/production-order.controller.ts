import { Request, Response, NextFunction } from 'express';
import { ProductionOrderService } from '../services/production-order.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';

export class ProductionOrderController {
    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: { branchId?: number; status?: string; productId?: number; warehouseId?: number; search?: string } = {};
            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            filters.branchId = resolveBranchScope(req.user!, requested);
            if (req.query.status) filters.status = req.query.status as string;
            if (req.query.productId) filters.productId = parseInt(req.query.productId as string);
            if (req.query.warehouseId) filters.warehouseId = parseInt(req.query.warehouseId as string);
            if (req.query.search) filters.search = req.query.search as string;
            const data = await ProductionOrderService.list(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const order = await ProductionOrderService.getById(parseInt(req.params.id), req.user!.companyId);
            assertBranchAccess(req.user!, (order as { branchId: number | null }).branchId);
            res.json({ success: true, data: order });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    /** Preview required inputs + availability for a tentative production (no persistence). */
    static async preview(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const data = await ProductionOrderService.preview(companyId, {
                productId: Number(req.body.productId),
                recipeId: req.body.recipeId ? Number(req.body.recipeId) : undefined,
                plannedQuantity: Number(req.body.plannedQuantity),
                warehouseId: Number(req.body.warehouseId)
            });
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requested = req.body.branchId ? Number(req.body.branchId) : req.user?.branchId;
            const branchId = resolveBranchScope(req.user!, requested);
            if (!branchId) return next({ statusCode: 400, message: 'ID de sucursal requerido' });

            const data = await ProductionOrderService.create(
                companyId,
                {
                    productId: Number(req.body.productId),
                    recipeId: req.body.recipeId ? Number(req.body.recipeId) : undefined,
                    plannedQuantity: Number(req.body.plannedQuantity),
                    warehouseId: Number(req.body.warehouseId),
                    branchId,
                    notes: req.body.notes,
                    date: req.body.date,
                    status: req.body.status
                },
                req.user!.userId
            );
            res.status(201).json({ success: true, message: 'Orden de producción creada', data });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            await ProductionOrderController.assertBranch(req, id);
            const data = await ProductionOrderService.update(
                id, req.user!.companyId,
                {
                    plannedQuantity: req.body.plannedQuantity !== undefined ? Number(req.body.plannedQuantity) : undefined,
                    warehouseId: req.body.warehouseId !== undefined ? Number(req.body.warehouseId) : undefined,
                    recipeId: req.body.recipeId !== undefined ? Number(req.body.recipeId) : undefined,
                    notes: req.body.notes
                },
                req.user!.userId
            );
            res.json({ success: true, message: 'Orden actualizada', data });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async setStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            await ProductionOrderController.assertBranch(req, id);
            const data = await ProductionOrderService.setStatus(
                id, req.user!.companyId, req.body.status, req.user!.userId
            );
            res.json({ success: true, message: 'Estado actualizado', data });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async finish(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            await ProductionOrderController.assertBranch(req, id);
            const data = await ProductionOrderService.finish(
                id, req.user!.companyId, req.user!.userId,
                {
                    producedQuantity: req.body.producedQuantity !== undefined ? Number(req.body.producedQuantity) : undefined,
                    consumptions: Array.isArray(req.body.consumptions) ? req.body.consumptions : undefined,
                    notes: req.body.notes,
                    allowNegative: !!req.body.allowNegative
                }
            );
            res.json({ success: true, message: 'Producción finalizada', data });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async cancel(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            await ProductionOrderController.assertBranch(req, id);
            const data = await ProductionOrderService.cancel(id, req.user!.companyId, req.user!.userId, req.body.reason);
            res.json({ success: true, message: 'Orden anulada', data });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    private static async assertBranch(req: Request, id: number) {
        const order = await ProductionOrderService.getById(id, req.user!.companyId);
        assertBranchAccess(req.user!, (order as { branchId: number | null }).branchId);
        return order;
    }
}
