import { Request, Response, NextFunction } from 'express';
import { InventoryMovementService } from '../services/inventory-movement.service';
import { getErrorMessage } from '../utils/error';

export class InventoryMovementController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            type MovementFilters = NonNullable<Parameters<typeof InventoryMovementService.getAll>[1]>;
            const filters: MovementFilters = {};

            if (req.user?.role === 'SUPERADMIN') {
                if (req.query.branchId) {
                    filters.branchId = parseInt(req.query.branchId as string);
                }
            } else {
                filters.branchId = req.user?.branchId;
            }

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

            const movements = await InventoryMovementService.getAll(companyId, filters);
            res.json({
                success: true,
                data: movements
            });
        } catch (error: unknown) {
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

            let branchId: number | undefined;
            if (req.user?.role === 'SUPERADMIN') {
                branchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            } else {
                branchId = req.user?.branchId;
            }

            const kardex = await InventoryMovementService.getKardex(productId, companyId, warehouseId, branchId);
            res.json({
                success: true,
                data: kardex
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            // Add userId from authenticated user
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
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async transfer(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
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
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
