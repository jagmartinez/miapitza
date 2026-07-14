import { Request, Response, NextFunction } from 'express';
import { SupplierService } from '../services/supplier.service';
import { getErrorMessage } from '../utils/error';
import { parseOptionalQueryDateFrom, parseOptionalQueryDateTo } from '../utils/date-range';

export class SupplierController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;
            const suppliers = await SupplierService.getAll(companyId, active);
            res.json({
                success: true,
                data: suppliers
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const supplier = await SupplierService.getById(id, companyId);
            res.json({
                success: true,
                data: supplier
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const supplier = await SupplierService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Proveedor creado exitosamente',
                data: supplier
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const supplier = await SupplierService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Proveedor actualizado exitosamente',
                data: supplier
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async getPriceHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const filters: NonNullable<Parameters<typeof SupplierService.getPriceHistory>[2]> = {};
            if (req.query.productId) filters.productId = parseInt(req.query.productId as string);
            filters.dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string | undefined, req.user!.timezone);
            filters.dateTo = parseOptionalQueryDateTo(req.query.dateTo as string | undefined, req.user!.timezone);

            const history = await SupplierService.getPriceHistory(id, companyId, filters);
            res.json({ success: true, data: history });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await SupplierService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Proveedor eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
