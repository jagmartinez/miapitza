import { Request, Response, NextFunction } from 'express';
import { PurchaseOrderService } from '../services/purchase-order.service';
import { getErrorMessage } from '../utils/error';

export class PurchaseOrderController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: {
                branchId?: number;
                supplierId?: number;
                status?: 'DRAFT' | 'ISSUED' | 'RECEIVED' | 'CANCELLED';
                search?: string;
            } = {};

            if (req.user?.role === 'SUPERADMIN') {
                if (req.query.branchId) {
                    filters.branchId = parseInt(req.query.branchId as string);
                }
            } else {
                filters.branchId = req.user?.branchId;
            }

            if (req.query.supplierId) {
                filters.supplierId = parseInt(req.query.supplierId as string);
            }

            if (req.query.status) {
                filters.status = req.query.status as NonNullable<typeof filters.status>;
            }

            if (req.query.search) {
                filters.search = req.query.search as string;
            }

            const orders = await PurchaseOrderService.getAll(companyId, filters);
            res.json({
                success: true,
                data: orders
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const order = await PurchaseOrderService.getById(id, companyId);
            res.json({
                success: true,
                data: order
            });
        } catch (error: unknown) {
            next({ statusCode: 404, message: getErrorMessage(error) });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            // Parse fields if they come as strings (common with FormData)
            if (req.body.branchId && typeof req.body.branchId === 'string') req.body.branchId = parseInt(req.body.branchId);
            if (req.body.supplierId && typeof req.body.supplierId === 'string') req.body.supplierId = parseInt(req.body.supplierId);
            if (typeof req.body.items === 'string') {
                try {
                    req.body.items = JSON.parse(req.body.items);
                } catch {
                    return next({ statusCode: 400, message: 'Formato de artículos inválido' });
                }
            }

            // Ensure numeric types for items if they exist
            if (req.body.items && Array.isArray(req.body.items)) {
                req.body.items = req.body.items.map((item: Record<string, unknown>) => ({
                    ...item,
                    productId: item.productId != null ? Number(item.productId) : undefined,
                    quantity: item.quantity != null ? Number(item.quantity) : 0,
                    cost: item.cost != null ? Number(item.cost) : 0
                }));
            }

            // Ensure branchId is set
            if (!req.body.branchId) {
                if (!req.user?.branchId) {
                    return next({ statusCode: 400, message: 'ID de sucursal requerido' });
                }
                req.body.branchId = req.user.branchId;
            }

            if (req.file) {
                req.body.invoicePdf = `/uploads/invoices/${req.file.filename}`;
            }

            const order = await PurchaseOrderService.create(companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Orden de compra creada exitosamente',
                data: order
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;

            // Parse fields if they come as strings
            if (req.body.branchId && typeof req.body.branchId === 'string') req.body.branchId = parseInt(req.body.branchId);
            if (req.body.supplierId && typeof req.body.supplierId === 'string') req.body.supplierId = parseInt(req.body.supplierId);
            if (typeof req.body.items === 'string') {
                try {
                    req.body.items = JSON.parse(req.body.items);
                } catch {
                    return next({ statusCode: 400, message: 'Formato de artículos inválido' });
                }
            }

            // Ensure numeric types for items if they exist
            if (req.body.items && Array.isArray(req.body.items)) {
                req.body.items = req.body.items.map((item: Record<string, unknown>) => ({
                    ...item,
                    productId: item.productId != null ? Number(item.productId) : undefined,
                    quantity: item.quantity != null ? Number(item.quantity) : 0,
                    cost: item.cost != null ? Number(item.cost) : 0
                }));
            }

            if (req.file) {
                req.body.invoicePdf = `/uploads/invoices/${req.file.filename}`;
            }

            const order = await PurchaseOrderService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Orden de compra actualizada exitosamente',
                data: order
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await PurchaseOrderService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Orden de compra eliminada exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async receive(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { warehouseId } = req.body;

            if (!warehouseId) {
                return next({ statusCode: 400, message: 'warehouseId es requerido' });
            }

            const order = await PurchaseOrderService.receive(id, companyId, req.user?.userId!, warehouseId);
            res.json({
                success: true,
                message: 'Orden de compra recibida exitosamente. Inventario actualizado.',
                data: order
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async addItem(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const item = await PurchaseOrderService.addItem(orderId, companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Artículo agregado exitosamente',
                data: item
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async removeItem(req: Request, res: Response, next: NextFunction) {
        try {
            const itemId = parseInt(req.params.itemId);
            const companyId = req.user!.companyId;
            await PurchaseOrderService.removeItem(itemId, companyId);
            res.json({
                success: true,
                message: 'Artículo eliminado exitosamente'
            });
        } catch (error: unknown) {
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }
}
