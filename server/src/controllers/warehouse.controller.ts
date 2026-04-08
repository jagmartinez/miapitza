import { Request, Response, NextFunction } from 'express';
import { WarehouseService } from '../services/warehouse.service';
import { getErrorMessage } from '../utils/error';

export class WarehouseController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const branchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const type = req.query.type ? String(req.query.type).toUpperCase() as 'CENTRAL' | 'BRANCH' : undefined;
            const warehouses = await WarehouseService.getAll(companyId, branchId, type);
            res.json({
                success: true,
                data: warehouses
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const warehouse = await WarehouseService.getById(id, companyId);
            res.json({
                success: true,
                data: warehouse
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async getStock(req: Request, res: Response, next: NextFunction) {
        try {
            const warehouseId = parseInt(req.params.id);
            const productId = req.query.productId ? parseInt(req.query.productId as string) : undefined;
            const companyId = req.user!.companyId;

            const stock = await WarehouseService.getStock(warehouseId, companyId, productId);
            res.json({
                success: true,
                data: stock
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const warehouse = await WarehouseService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Almacén creado exitosamente',
                data: warehouse
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const warehouse = await WarehouseService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Almacén actualizado exitosamente',
                data: warehouse
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await WarehouseService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Almacén eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
