import { Request, Response, NextFunction } from 'express';
import { InventoryMovementService } from '../services/inventory-movement.service';
import { WarehouseService } from '../services/warehouse.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';

export class InventoryMovementController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            type MovementFilters = NonNullable<Parameters<typeof InventoryMovementService.getAll>[1]>;
            const filters: MovementFilters = {};

            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            filters.branchId = resolveBranchScope(req.user!, requested);

            if (req.query.warehouseId) {
                filters.warehouseId = parseInt(req.query.warehouseId as string);
            }

            if (req.query.productId) {
                filters.productId = parseInt(req.query.productId as string);
            }

            if (req.query.type) {
                const t = req.query.type as string;
                if (t === 'IN' || t === 'OUT' || t === 'ADJUSTMENT' || t === 'TRANSFER') {
                    filters.type = t;
                }
            }

            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate as string);
            }

            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate as string);
            }

            if (req.query.page) {
                filters.page = parseInt(req.query.page as string);
            }

            if (req.query.limit) {
                filters.limit = parseInt(req.query.limit as string);
            }

            const movements = await InventoryMovementService.getAll(companyId, filters);
            res.json({
                success: true,
                data: movements
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
            const movement = await InventoryMovementService.getById(id, companyId);
            res.json({
                success: true,
                data: movement
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getKardex(req: Request, res: Response, next: NextFunction) {
        try {
            const productId = parseInt(req.params.productId);
            const companyId = req.user!.companyId;
            const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined;

            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);

            const kardex = await InventoryMovementService.getKardex(productId, companyId, warehouseId, branchId);
            res.json({
                success: true,
                data: kardex
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            // The target warehouse must be accessible to the caller's branch
            // (own branch, or a shared CENTRAL warehouse).
            const warehouse = await WarehouseService.getById(parseInt(String(req.body.warehouseId)), companyId);
            assertBranchAccess(req.user!, (warehouse as { branchId: number | null }).branchId, { allowGlobal: true });

            const data = {
                ...req.body,
                userId: req.user?.userId!
            };

            const movement = await InventoryMovementService.create(companyId, data);
            res.status(201).json({
                success: true,
                message: 'Movimiento de inventario creado exitosamente',
                data: movement
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async transfer(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            // Both source and destination warehouses must be accessible to the caller.
            const from = await WarehouseService.getById(parseInt(String(req.body.fromWarehouseId)), companyId);
            const to = await WarehouseService.getById(parseInt(String(req.body.toWarehouseId)), companyId);
            assertBranchAccess(req.user!, (from as { branchId: number | null }).branchId, { allowGlobal: true });
            assertBranchAccess(req.user!, (to as { branchId: number | null }).branchId, { allowGlobal: true });

            const data = {
                ...req.body,
                userId: req.user?.userId!
            };

            const result = await InventoryMovementService.transfer(companyId, data);
            res.status(201).json({
                success: true,
                message: 'Transferencia completada exitosamente',
                data: result
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
