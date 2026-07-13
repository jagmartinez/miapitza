import { Request, Response, NextFunction } from 'express';
import { OrderService } from '../services/order.service';
import { WebSocketService } from '../services/websocket.service';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';
import { parseQueryDateFrom, parseQueryDateTo } from '../utils/date-range';

export class OrderController {
    /** Load an order and assert the caller's branch may access it. */
    private static async assertOrderBranch(req: Request, orderId: number) {
        const order = await OrderService.getById(orderId, req.user!.companyId);
        assertBranchAccess(req.user!, order.branchId);
        return order;
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: {
                branchId?: number;
                tableId?: number;
                status?: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'PAID' | 'CANCELLED';
                startDate?: Date;
                endDate?: Date;
                page?: number;
                limit?: number;
            } = {};

            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            filters.branchId = resolveBranchScope(req.user!, requested);

            if (req.query.tableId) {
                filters.tableId = parseInt(req.query.tableId as string);
            }

            if (req.query.status) {
                filters.status = req.query.status as typeof filters.status;
            }

            if (req.query.startDate) {
                filters.startDate = parseQueryDateFrom(req.query.startDate as string);
            }

            if (req.query.endDate) {
                filters.endDate = parseQueryDateTo(req.query.endDate as string);
            }

            if (req.query.page) {
                filters.page = parseInt(req.query.page as string);
            }

            if (req.query.limit) {
                filters.limit = parseInt(req.query.limit as string);
            }

            const result = await OrderService.getAll(companyId, filters);
            res.json({
                success: true,
                data: result.data,
                pagination: result.pagination
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async getActive(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);
            const orders = await OrderService.getActiveOrders(companyId, branchId);
            res.json({
                success: true,
                data: orders
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(id, companyId);
            assertBranchAccess(req.user!, order.branchId);
            res.json({
                success: true,
                data: order
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            // Non-superadmin users can only create orders in their active branch.
            // SUPERADMIN must specify the target branch.
            const requested = req.body.branchId ? Number(req.body.branchId) : req.user?.branchId;
            const branchId = resolveBranchScope(req.user!, requested);

            if (!branchId) {
                return next({ statusCode: 400, message: 'branchId es requerido' });
            }

            const data = {
                ...req.body,
                branchId,
                userId: req.user?.userId!
            };

            const order = await OrderService.create(companyId, data);

            if (!order) {
                return next({ statusCode: 500, message: 'Error al crear la orden' });
            }

            // Broadcast order creation
            WebSocketService.broadcastOrderUpdate(order.id, 'CREATED', order, {
                companyId,
                branchId: order.branchId
            });

            res.status(201).json({
                success: true,
                message: 'Orden creada exitosamente',
                data: order
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async addItem(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, orderId);
            const item = await OrderService.addItem(orderId, companyId, req.body);
            res.status(201).json({
                success: true,
                message: 'Artículo agregado exitosamente',
                data: item
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async removeItem(req: Request, res: Response, next: NextFunction) {
        try {
            const itemId = parseInt(req.params.itemId);
            const companyId = req.user!.companyId;
            await OrderService.removeItem(
                itemId,
                companyId,
                req.user!.role === 'SUPERADMIN' ? undefined : req.user!.branchId
            );
            res.json({
                success: true,
                message: 'Artículo eliminado exitosamente'
            });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
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

            await OrderController.assertOrderBranch(req, id);
            const order = await OrderService.updateStatus(id, companyId, status);

            // Broadcast status update
            WebSocketService.broadcastOrderUpdate(id, status, order, {
                companyId,
                branchId: order.branchId
            });

            // Special notification if order is ready
            if (status === 'READY') {
                WebSocketService.broadcastOrderReady(id, order.table?.number, {
                    companyId,
                    branchId: order.branchId
                });
            }

            res.json({
                success: true,
                message: 'Estado de orden actualizado exitosamente',
                data: order
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async updatePricing(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { discount, discountCode, tax, tipAmount } = req.body;

            await OrderController.assertOrderBranch(req, id);
            const order = await OrderService.updatePricing(id, companyId, {
                discount: discount !== undefined ? Number(discount) : undefined,
                discountCode: discountCode !== undefined ? String(discountCode || '') : undefined,
                tax: tax !== undefined ? Number(tax) : undefined,
                tipAmount: tipAmount !== undefined ? Number(tipAmount) : undefined
            });

            WebSocketService.broadcastOrderUpdate(id, 'PRICING_UPDATED', order, {
                companyId,
                branchId: order.branchId
            });

            res.json({
                success: true,
                message: 'Totales de orden actualizados',
                data: order
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async sendToKitchen(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, id);
            const order = await OrderService.sendToKitchen(id, companyId);

            // Broadcast to kitchen
            WebSocketService.broadcastOrderToKitchen(order, {
                companyId,
                branchId: order?.branchId || req.user?.branchId,
                roles: ['COCINA', 'CHEF', 'ADMIN', 'SUPERADMIN']
            });

            res.json({
                success: true,
                message: 'Orden enviada a cocina',
                data: order
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async complete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { warehouseId } = req.body;

            if (!warehouseId) {
                return next({ statusCode: 400, message: 'warehouseId es requerido' });
            }

            await OrderController.assertOrderBranch(req, id);
            const order = await OrderService.complete(id, companyId, warehouseId);

            // Broadcast completion
            WebSocketService.broadcastOrderUpdate(id, 'COMPLETED', order, {
                companyId,
                branchId: order.branchId
            });

            res.json({
                success: true,
                message: 'Orden completada. Inventario actualizado.',
                data: order
            });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async startItem(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.id);
            const itemId = parseInt(req.params.itemId);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, orderId);
            const result = await OrderService.startItem(orderId, itemId, companyId);

            WebSocketService.broadcastOrderUpdate(orderId, 'ITEM_STARTED', { orderId, item: result.item, order: result.order }, {
                companyId,
                branchId: result.order.branchId
            });

            WebSocketService.broadcastOrderInPreparation(orderId, result.order.table?.number, {
                companyId,
                branchId: result.order.branchId
            });

            res.json({ success: true, message: 'Artículo iniciado', data: result });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async finishItem(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.id);
            const itemId = parseInt(req.params.itemId);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, orderId);
            const result = await OrderService.finishItem(orderId, itemId, companyId);

            WebSocketService.broadcastOrderUpdate(orderId, 'ITEM_FINISHED', { orderId, item: result.item, order: result.order }, {
                companyId,
                branchId: result.order.branchId
            });

            if (result.allDone) {
                WebSocketService.broadcastOrderReady(orderId, result.order.table?.number, {
                    companyId,
                    branchId: result.order.branchId
                });
            }

            res.json({ success: true, message: result.allDone ? 'Todos los artículos listos - orden lista' : 'Artículo terminado', data: result });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async reportProblem(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;
            const { description } = req.body;

            if (!description || !description.trim()) {
                return next({ statusCode: 400, message: 'Descripción del problema es requerida' });
            }

            await OrderController.assertOrderBranch(req, orderId);
            const result = await OrderService.reportProblem(orderId, companyId, userId, description.trim());

            WebSocketService.broadcastOrderUpdate(orderId, 'PROBLEM_REPORTED', {
                orderId,
                description: description.trim(),
                reportedBy: req.user!.userId
            }, {
                companyId,
                branchId: result.branchId
            });

            res.json({
                success: true,
                message: 'Problema reportado exitosamente',
                data: result
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async cancel(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const cancelledById = req.user!.userId;
            const cancelReason = req.body.cancelReason || null;

            await OrderController.assertOrderBranch(req, id);
            const order = await OrderService.cancel(id, companyId, cancelledById, cancelReason);

            WebSocketService.broadcastOrderUpdate(id, 'CANCELLED', order, {
                companyId,
                branchId: order.branchId
            });

            res.json({
                success: true,
                message: 'Orden cancelada',
                data: order
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }
}
