import { Request, Response, NextFunction } from 'express';
import { PurchaseOrderService } from '../services/purchase-order.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';

export class PurchaseOrderController {

    /** Load a purchase order and assert the caller's branch may access it. */
    private static async assertOrderBranch(req: Request, orderId: number) {
        const order = await PurchaseOrderService.getById(orderId, req.user!.companyId);
        assertBranchAccess(req.user!, (order as { branchId: number | null }).branchId);
        return order;
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: {
                branchId?: number;
                supplierId?: number;
                status?: 'DRAFT' | 'ISSUED' | 'RECEIVED' | 'CANCELLED';
                search?: string;
            } = {};

            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            filters.branchId = resolveBranchScope(req.user!, requested);

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
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const order = await PurchaseOrderService.getById(id, companyId);
            assertBranchAccess(req.user!, (order as { branchId: number | null }).branchId);
            res.json({
                success: true,
                data: order
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
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
                    cost: item.cost != null ? Number(item.cost) : 0,
                    purchaseUnit: item.purchaseUnit || undefined
                }));
            }

            // Non-superadmin users are pinned to their active branch.
            const requestedBranch = req.body.branchId ? Number(req.body.branchId) : req.user?.branchId;
            const branchId = resolveBranchScope(req.user!, requestedBranch);
            if (!branchId) {
                return next({ statusCode: 400, message: 'ID de sucursal requerido' });
            }
            req.body.branchId = branchId;

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
            if (error instanceof BranchScopeError) return next(error);
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
                    cost: item.cost != null ? Number(item.cost) : 0,
                    purchaseUnit: item.purchaseUnit || undefined
                }));
            }

            if (req.file) {
                req.body.invoicePdf = `/uploads/invoices/${req.file.filename}`;
            }

            await PurchaseOrderController.assertOrderBranch(req, id);
            // A branch-scoped user cannot move a PO to another branch.
            if (req.body.branchId !== undefined) {
                assertBranchAccess(req.user!, Number(req.body.branchId));
            }
            const order = await PurchaseOrderService.update(id, companyId, req.body);
            res.json({
                success: true,
                message: 'Orden de compra actualizada exitosamente',
                data: order
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
            await PurchaseOrderController.assertOrderBranch(req, id);
            await PurchaseOrderService.delete(id, companyId);
            res.json({
                success: true,
                message: 'Orden de compra eliminada exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
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

            await PurchaseOrderController.assertOrderBranch(req, id);
            const order = await PurchaseOrderService.receive(id, companyId, req.user?.userId!, warehouseId);
            res.json({
                success: true,
                message: 'Orden de compra recibida exitosamente. Inventario actualizado.',
                data: order
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async addItem(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await PurchaseOrderController.assertOrderBranch(req, orderId);
            const item = await PurchaseOrderService.addItem(orderId, companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Artículo agregado exitosamente',
                data: item
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async removeItem(req: Request, res: Response, next: NextFunction) {
        try {
            const itemId = parseInt(req.params.itemId);
            const companyId = req.user!.companyId;
            // A14: this route only carries itemId, so resolve the owning PO's branch
            // to enforce the same branch-scope guard used on other mutating routes.
            const branchId = await PurchaseOrderService.getItemOrderBranch(itemId, companyId);
            assertBranchAccess(req.user!, branchId);
            await PurchaseOrderService.removeItem(itemId, companyId);
            res.json({
                success: true,
                message: 'Artículo eliminado exitosamente'
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async addPayment(req: Request, res: Response, next: NextFunction) {
        try {
            const purchaseOrderId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { amount, date, bank, referenceNumber, observations } = req.body;

            if (!amount || amount <= 0) {
                return next({ statusCode: 400, message: 'El monto debe ser mayor a 0' });
            }

            // A14: enforce branch-scope before registering a payment.
            await PurchaseOrderController.assertOrderBranch(req, purchaseOrderId);

            const payment = await PurchaseOrderService.addPayment(purchaseOrderId, companyId, {
                amount: Number(amount),
                date,
                bank,
                referenceNumber,
                observations
            });

            res.status(201).json({
                success: true,
                message: 'Pago registrado exitosamente',
                data: payment
            });
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: getErrorMessage(error) });
        }
    }

    static async getPayments(req: Request, res: Response, next: NextFunction) {
        try {
            const purchaseOrderId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const payments = await PurchaseOrderService.getPayments(purchaseOrderId, companyId);
            res.json({
                success: true,
                data: payments
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
