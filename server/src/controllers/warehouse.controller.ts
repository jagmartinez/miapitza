import { Request, Response, NextFunction } from 'express';
import { WarehouseService } from '../services/warehouse.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, assertBranchAccess, isCompanyWide, BranchScopeError } from '../utils/branch-scope';

export class WarehouseController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);
            const type = req.query.type ? String(req.query.type).toUpperCase() as 'CENTRAL' | 'BRANCH' : undefined;
            const warehouses = await WarehouseService.getAll(companyId, branchId, type);
            res.json({
                success: true,
                data: warehouses
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
            const warehouse = await WarehouseService.getById(id, companyId);
            // CENTRAL warehouses (branchId null) are shared across the company.
            assertBranchAccess(req.user!, (warehouse as { branchId: number | null }).branchId, { allowGlobal: true });
            res.json({
                success: true,
                data: warehouse
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getStock(req: Request, res: Response, next: NextFunction) {
        try {
            const warehouseId = parseInt(req.params.id);
            const productId = req.query.productId ? parseInt(req.query.productId as string) : undefined;
            const companyId = req.user!.companyId;

            const warehouse = await WarehouseService.getById(warehouseId, companyId);
            assertBranchAccess(req.user!, (warehouse as { branchId: number | null }).branchId, { allowGlobal: true });
            const stock = await WarehouseService.getStock(warehouseId, companyId, productId);
            res.json({
                success: true,
                data: stock
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            // Non-superadmin users may only create warehouses in their active branch.
            if (!isCompanyWide(req.user!)) {
                if (!req.user!.branchId) {
                    return next({ statusCode: 400, message: 'Su usuario no tiene una sucursal activa asignada.' });
                }
                req.body.branchId = req.user!.branchId;
            }
            const warehouse = await WarehouseService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Almacén creado exitosamente',
                data: warehouse
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
            const existing = await WarehouseService.getById(id, companyId);
            assertBranchAccess(req.user!, (existing as { branchId: number | null }).branchId);
            const warehouse = await WarehouseService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Almacén actualizado exitosamente',
                data: warehouse
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
            const existing = await WarehouseService.getById(id, companyId);
            assertBranchAccess(req.user!, (existing as { branchId: number | null }).branchId);
            await WarehouseService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Almacén eliminado exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
