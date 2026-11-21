import { Request, Response, NextFunction } from 'express';
import { OrderService } from '../services/order.service';
import { WebSocketService } from '../services/websocket.service';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';
import { parseQueryDateFrom, parseQueryDateTo } from '../utils/date-range';
import { SettingService } from '../services/setting.service';
import { KitchenNotificationService } from '../services/kitchen-notification.service';
import { KitchenError } from '../services/kitchen-errors';
import {
    DISCOUNT_AUTH_ERROR,
    DiscountAuthRejectedError,
    DiscountAuthRequiredError,
    DiscountAuthorizationService,
    MAX_DISCOUNT_REASON,
    MIN_DISCOUNT_REASON,
    canApplyManualDiscount
} from '../services/discount-authorization.service';

function deviceTokenOf(req: Request): string {
    const header = req.headers['x-device-token'];
    return typeof header === 'string' ? header : '';
}

/** undefined when absent; throws a 400-style Error when present but invalid. */
function parseDiscountReason(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const reason = typeof value === 'string' ? value.trim() : '';
    if (reason.length < MIN_DISCOUNT_REASON || reason.length > MAX_DISCOUNT_REASON) {
        throw new Error(`El motivo del descuento debe tener entre ${MIN_DISCOUNT_REASON} y ${MAX_DISCOUNT_REASON} caracteres`);
    }
    return reason;
}

export class OrderController {
    /** Load an order and assert the caller's branch may access it. */
    private static async assertOrderBranch(req: Request, orderId: number) {
        const order = await OrderService.getById(orderId, req.user!.companyId);
        assertBranchAccess(req.user!, order.branchId);
        return order;
    }

    /**
     * Branch-scoped ORDER_UPDATE with the fresh full order. Best effort: the
     * mutation is already committed, so a failed read/emit must not turn a
     * successful request into an error the client would retry.
     */
    private static async emitOrderUpdate(orderId: number, status: string, companyId: number) {
        try {
            const order = await OrderService.getById(orderId, companyId);
            WebSocketService.broadcastOrderUpdate(orderId, status, order, {
                companyId,
                branchId: order.branchId
            });
        } catch (error) {
            console.error(`[OrderController] ORDER_UPDATE ${status} for order ${orderId} not emitted:`, error);
        }
    }

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: {
                branchId?: number;
                tableId?: number;
                status?: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'CANCELLED';
                financialStatus?: 'UNPAID' | 'PARTIAL' | 'PAID';
                startDate?: Date;
                endDate?: Date;
                settledStartDate?: Date;
                settledEndDate?: Date;
                invoicedStartDate?: Date;
                invoicedEndDate?: Date;
                invoicedOnly?: boolean;
                search?: string;
                page?: number;
                limit?: number;
            } = {};

            const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            filters.branchId = resolveBranchScope(req.user!, requested);

            if (req.query.tableId) {
                filters.tableId = parseInt(req.query.tableId as string);
            }

            if (req.query.status) {
                const requestedStatus = req.query.status as string;
                // Backwards-compatible read alias for legacy clients. PAID is no
                // longer an operational state and maps to financial settlement.
                if (requestedStatus === 'PAID') filters.financialStatus = 'PAID';
                else filters.status = requestedStatus as typeof filters.status;
            }

            if (req.query.financialStatus) {
                const financialStatus = req.query.financialStatus as string;
                if (financialStatus === 'UNPAID' || financialStatus === 'PARTIAL' || financialStatus === 'PAID') {
                    filters.financialStatus = financialStatus;
                }
            }

            if (req.query.startDate) {
                filters.startDate = parseQueryDateFrom(req.query.startDate as string);
            }

            if (req.query.endDate) {
                filters.endDate = parseQueryDateTo(req.query.endDate as string);
            }

            if (req.query.settledStartDate) {
                filters.settledStartDate = parseQueryDateFrom(req.query.settledStartDate as string);
            }

            if (req.query.settledEndDate) {
                filters.settledEndDate = parseQueryDateTo(req.query.settledEndDate as string);
            }

            if (req.query.invoicedStartDate) {
                filters.invoicedStartDate = parseQueryDateFrom(req.query.invoicedStartDate as string);
            }

            if (req.query.invoicedEndDate) {
                filters.invoicedEndDate = parseQueryDateTo(req.query.invoicedEndDate as string);
            }

            if (req.query.invoicedOnly === 'true') {
                filters.invoicedOnly = true;
            }

            if (typeof req.query.search === 'string' && req.query.search.trim()) {
                // Bounded free text; matched server-side against order number,
                // customer name and table number within the caller's scope.
                filters.search = req.query.search.trim().slice(0, 100);
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
            await OrderController.emitOrderUpdate(orderId, 'ITEMS_CHANGED', companyId);
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
            const removed = await OrderService.removeItem(
                itemId,
                companyId,
                req.user!.role === 'SUPERADMIN' ? undefined : req.user!.branchId,
                req.user!.userId
            );
            await OrderController.emitOrderUpdate(removed.orderId, 'ITEMS_CHANGED', companyId);
            res.json({
                success: true,
                message: 'Artículo eliminado exitosamente'
            });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    /** PATCH /orders/items/:itemId - quantity/notes of a line not yet sent to the kitchen. */
    static async updateItem(req: Request, res: Response, next: NextFunction) {
        try {
            const itemId = Number(req.params.itemId);
            const companyId = req.user!.companyId;
            // Pins non-company-wide users to their branch (throws without one);
            // company-wide admins get no branch filter.
            const branchId = resolveBranchScope(req.user!);
            const { quantity, notes } = req.body ?? {};
            const item = await OrderService.updateItem(itemId, companyId, branchId, { quantity, notes }, req.user!.userId);
            await OrderController.emitOrderUpdate(item.orderId, 'ITEMS_CHANGED', companyId);
            res.json({
                success: true,
                message: 'Artículo actualizado exitosamente',
                data: item
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    /** PATCH /orders/:id/guests */
    static async updateGuests(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = Number(req.params.id);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, orderId);
            const order = await OrderService.setGuests(orderId, companyId, req.body?.guests);
            await OrderController.emitOrderUpdate(orderId, 'GUESTS_CHANGED', companyId);
            res.json({
                success: true,
                message: 'Personas actualizadas',
                data: order
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    /** POST /orders/:id/items/deliver - hand finished lines to the guests (idempotent). */
    static async deliverItems(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = Number(req.params.id);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, orderId);
            const result = await OrderService.deliverItems(orderId, companyId, req.user!.userId, req.body?.itemIds);
            if (result.delivered.length > 0) {
                await OrderController.emitOrderUpdate(orderId, 'ITEMS_DELIVERED', companyId);
            }
            res.json({
                success: true,
                message: result.delivered.length > 0 ? 'Líneas entregadas' : 'No había líneas por entregar',
                data: result
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    /**
     * POST /orders/:id/items/:itemId/void — supervisor void of a line already
     * sent to kitchen. Requires X-Idempotency-Key so a retried tap/offline
     * replay never wastes the same food twice.
     */
    static async voidItem(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = Number(req.params.id);
            const itemId = Number(req.params.itemId);
            const companyId = req.user!.companyId;
            const headerKey = req.headers['x-idempotency-key'];
            const idempotencyKey = typeof headerKey === 'string' && headerKey.trim()
                ? headerKey.trim()
                : typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
            if (idempotencyKey.length < 8 || idempotencyKey.length > 191) {
                return next({ statusCode: 428, message: 'X-Idempotency-Key es requerido (8 a 191 caracteres) para anular una línea' });
            }
            await OrderController.assertOrderBranch(req, orderId);
            const result = await OrderService.voidKitchenItem(orderId, itemId, companyId, req.user!.userId, {
                quantity: req.body?.quantity === undefined ? undefined : Number(req.body.quantity),
                reason: req.body?.reason,
                wasteWarehouseId: req.body?.warehouseId === undefined ? undefined : Number(req.body.warehouseId),
                idempotencyKey,
            });
            if (!result.replayed) {
                // POS, tables, orders and KDS all refetch on ORDER_UPDATE.
                WebSocketService.broadcastOrderUpdate(orderId, 'ITEM_VOIDED', result.order, {
                    companyId,
                    branchId: result.branchId
                });
            }
            res.json({
                success: true,
                message: result.promotionRemoved
                    ? `Línea anulada. La promoción ${result.promotionRemoved.code} ya no aplica y fue retirada`
                    : 'Línea anulada y merma registrada',
                data: {
                    order: result.order,
                    voidItemId: result.voidItemId,
                    voidedQuantity: result.voidedQuantity,
                    kitchenBatchId: result.kitchenBatchId,
                    promotionRemoved: result.promotionRemoved,
                    manualDiscountClamped: result.manualDiscountClamped ?? null,
                    replayed: result.replayed,
                }
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            // Explicit domain statuses (409 idempotency conflict) and Prisma
            // errors (P2034 -> 409) keep their own classification.
            const bag = error as { statusCode?: unknown; code?: unknown; name?: unknown };
            if (typeof bag.statusCode === 'number' || (typeof bag.name === 'string' && bag.name.startsWith('PrismaClient'))) {
                return next(error);
            }
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
                await KitchenNotificationService.notifyReady({ companyId, orderId: id, complete: true });
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
            const discountReason = parseDiscountReason(req.body?.discountReason);

            await OrderController.assertOrderBranch(req, id);
            // Mobile flow only (discountReason present): without orders.discount.apply
            // the user's own limit is 0, so any manual discount answers
            // DISCOUNT_AUTH_REQUIRED and can be obtained from a supervisor.
            // The web call has no reason and is unchanged.
            const canApply = discountReason === undefined || !(Number(discount) > 0)
                || await canApplyManualDiscount(req.user!);
            const order = await OrderService.updatePricing(id, companyId, {
                discount: discount !== undefined ? Number(discount) : undefined,
                discountCode: discountCode !== undefined ? String(discountCode || '') : undefined,
                tax: tax !== undefined ? Number(tax) : undefined,
                tipAmount: tipAmount !== undefined ? Number(tipAmount) : undefined,
                discountReason
            }, req.user!.userId, { role: req.user!.role, roles: req.user!.roles }, canApply ? undefined : { noApplyPermission: true });

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
            if (error instanceof DiscountAuthRequiredError) {
                return res.status(403).json({
                    success: false,
                    code: error.code,
                    message: error.message,
                    limitPercent: error.limitPercent,
                    requestedPercent: error.requestedPercent
                });
            }
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    /**
     * GET /orders/discount/supervisors -- supervisors that can authorize a
     * discount on this tablet's branch (X-Device-Token).
     */
    static async listDiscountSupervisors(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await DiscountAuthorizationService.listSupervisors(deviceTokenOf(req), req.user!);
            res.json({ success: true, data });
        } catch (error) {
            if (error instanceof DiscountAuthRejectedError) {
                return res.status(401).json({ success: false, message: DISCOUNT_AUTH_ERROR });
            }
            next({ statusCode: 500, message: 'Error al consultar supervisores' });
        }
    }

    /**
     * POST /orders/:id/discount/authorize -- a supervisor's PIN authorizes a
     * manual discount above the requester's limit. Applies discount, reason and
     * authorizer in one transaction. Creates no session. Never logs the PIN.
     */
    static async authorizeDiscount(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const { supervisorUserId, pin, discount } = req.body ?? {};
            const discountReason = parseDiscountReason(req.body?.discountReason);
            if (discountReason === undefined || typeof discount !== 'number' || !Number.isFinite(discount) || discount <= 0) {
                return next({ statusCode: 400, message: 'Descuento y motivo son requeridos' });
            }
            // Malformed credentials are indistinguishable from wrong ones.
            if (!Number.isInteger(supervisorUserId) || typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
                return res.status(401).json({ success: false, message: DISCOUNT_AUTH_ERROR });
            }
            // A requester without orders.discount.apply may still obtain a
            // supervisor authorization (spec 7.3.0); orders.edit is enforced by the route.
            const existing = await OrderController.assertOrderBranch(req, id);
            const authorization = await DiscountAuthorizationService.verifySupervisor({
                requester: req.user!,
                deviceToken: deviceTokenOf(req),
                supervisorUserId,
                pin,
                orderBranchId: existing.branchId,
                orderId: id,
                requestedDiscount: discount,
                reason: discountReason
            });
            const order = await OrderService.updatePricing(id, companyId, {
                discount,
                discountReason
            }, req.user!.userId, { role: req.user!.role, roles: req.user!.roles }, { authorization });

            WebSocketService.broadcastOrderUpdate(id, 'PRICING_UPDATED', order, {
                companyId,
                branchId: order.branchId
            });

            res.json({ success: true, message: 'Descuento autorizado', data: order });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            if (error instanceof DiscountAuthRejectedError) {
                return res.status(401).json({ success: false, message: DISCOUNT_AUTH_ERROR });
            }
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async sendToKitchen(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, id);
            const order = await OrderService.sendToKitchen(id, companyId);
            const kitchenBatchSent = order.kitchenBatchSent !== false;

            // An idempotent offline retry must not manufacture a second KDS
            // arrival event after the original send already committed.
            if (kitchenBatchSent) {
                WebSocketService.broadcastOrderToKitchen(order, {
                    companyId,
                    branchId: order?.branchId || req.user?.branchId,
                    roles: ['COCINA', 'CHEF', 'ADMIN', 'SUPERADMIN']
                });
                // Waiters do not receive the kitchen-only event above.
                await OrderController.emitOrderUpdate(id, 'SENT_TO_KITCHEN', companyId);
            }

            res.json({
                success: true,
                message: kitchenBatchSent ? 'Orden enviada a cocina' : 'La tanda ya estaba enviada a cocina',
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
            const order = await OrderService.complete(id, companyId, Number(warehouseId), req.user!.userId);

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
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async startItem(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.id);
            const itemId = parseInt(req.params.itemId);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, orderId);
            const result = await OrderService.startItem(
                orderId,
                itemId,
                companyId,
                req.user!.userId,
            );

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
            const result = await OrderService.finishItem(
                orderId,
                itemId,
                companyId,
                req.user!.userId,
            );

            WebSocketService.broadcastOrderUpdate(orderId, 'ITEM_FINISHED', { orderId, item: result.item, order: result.order }, {
                companyId,
                branchId: result.order.branchId
            });

            if (result.allDone) {
                await KitchenNotificationService.notifyReady({
                    companyId,
                    orderId,
                    kitchenBatchId: result.kitchenBatchId,
                    complete: true,
                });
                WebSocketService.broadcastOrderReady(orderId, result.order.table?.number, {
                    companyId,
                    branchId: result.order.branchId
                });
            } else {
                await KitchenNotificationService.notifyReady({
                    companyId,
                    orderId,
                    kitchenBatchId: result.kitchenBatchId,
                    itemId,
                    complete: false,
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

    static async updateFiscalCustomer(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            await OrderController.assertOrderBranch(req, id);
            const order = await OrderService.updateFiscalCustomer(
                id,
                companyId,
                req.user!.userId,
                req.body
            );
            res.json({ success: true, message: 'Datos fiscales del cliente actualizados', data: order });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async getKitchenConfig(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await SettingService.getKdsTimingConfig(req.user!.companyId);
            res.json({ success: true, data: { ...data, clockStartsAt: 'KITCHEN_RECEIVED_AT' } });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error al obtener configuración KDS' });
        }
    }

    static async getKitchenQueue(req: Request, res: Response, next: NextFunction) {
        try {
            const requested = req.query.branchId ? Number(req.query.branchId) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);
            const data = await OrderService.getKitchenQueue(req.user!.companyId, branchId);
            res.json({ success: true, data });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error al consultar la cola KDS' });
        }
    }

    static async getKitchenHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const requested = req.query.branchId ? Number(req.query.branchId) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);
            const limit = req.query.limit ? Number(req.query.limit) : 100;
            const data = await OrderService.getKitchenHistory(req.user!.companyId, branchId, limit);
            res.json({ success: true, data });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error al consultar historial KDS' });
        }
    }

    static async getRecentKitchenBatches(req: Request, res: Response, next: NextFunction) {
        try {
            const requested = req.query.branchId ? Number(req.query.branchId) : undefined;
            const branchId = resolveBranchScope(req.user!, requested);
            const limit = req.query.limit ? Number(req.query.limit) : 10;
            const data = await OrderService.getRecentKitchenBatches(req.user!.companyId, branchId, limit);
            res.json({ success: true, data });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error al consultar recientes KDS' });
        }
    }

    static async startKitchenPreparation(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const kitchenBatchId = req.body?.kitchenBatchId === undefined
                ? undefined
                : Number(req.body.kitchenBatchId);
            await OrderController.assertOrderBranch(req, id);
            const result = await OrderService.startKitchenPreparation(
                id,
                req.user!.companyId,
                req.user!.userId,
                kitchenBatchId,
            );
            WebSocketService.broadcastOrderInPreparation(id, result.order.table?.number, {
                companyId: req.user!.companyId,
                branchId: result.branchId
            });
            WebSocketService.broadcastOrderUpdate(id, 'KITCHEN_PREPARATION_STARTED', result.order, {
                companyId: req.user!.companyId,
                branchId: result.branchId
            });
            res.json({ success: true, message: result.changed ? 'Preparación iniciada' : 'La preparación ya estaba iniciada', data: result.order });
        } catch (error) {
            if (error instanceof BranchScopeError || error instanceof KitchenError) return next(error);
            next({ statusCode: 409, message: error instanceof Error ? error.message : 'No se pudo iniciar la preparación' });
        }
    }

    static async markKitchenReady(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const kitchenBatchId = req.body?.kitchenBatchId === undefined
                ? undefined
                : Number(req.body.kitchenBatchId);
            await OrderController.assertOrderBranch(req, id);
            const result = await OrderService.markKitchenBatchReady(
                id,
                companyId,
                req.user!.userId,
                kitchenBatchId,
            );
            if (result.changed) {
                await KitchenNotificationService.notifyReady({
                    companyId,
                    orderId: id,
                    kitchenBatchId: result.kitchenBatchId,
                    complete: true,
                });
                WebSocketService.broadcastOrderReady(id, result.order.table?.number, {
                    companyId,
                    branchId: result.order.branchId,
                });
            }
            WebSocketService.broadcastOrderUpdate(id, 'KITCHEN_READY', result.order, {
                companyId,
                branchId: result.order.branchId,
            });
            res.json({ success: true, message: 'Tanda marcada como lista', data: result.order });
        } catch (error) {
            if (error instanceof BranchScopeError || error instanceof KitchenError) return next(error);
            next({ statusCode: 409, message: error instanceof Error ? error.message : 'No se pudo marcar la orden lista' });
        }
    }

    static async releaseKitchenOrder(req: Request, res: Response, next: NextFunction) {
        try {
            const id = Number(req.params.id);
            const companyId = req.user!.companyId;
            const kitchenBatchId = req.body?.kitchenBatchId === undefined
                ? undefined
                : Number(req.body.kitchenBatchId);
            await OrderController.assertOrderBranch(req, id);
            const result = await OrderService.releaseFromKitchen(
                id,
                companyId,
                req.user!.userId,
                kitchenBatchId,
            );
            if (result.changed) {
                await KitchenNotificationService.notifyReleased(
                    companyId,
                    id,
                    result.kitchenBatchId,
                );
            }
            WebSocketService.broadcastOrderUpdate(id, 'KITCHEN_RELEASED', result.order, {
                companyId,
                branchId: result.branchId
            });
            if (result.autoDelivered) {
                // Paid order handed over on release: let POS/Tables drop the
                // READY card instead of offering a now-invalid "Entregar".
                // The release already committed: a failed reload must not turn
                // the response into an error, clients refetch on any update.
                const delivered = await OrderService.getById(id, companyId).catch(() => undefined);
                WebSocketService.broadcastOrderUpdate(id, 'COMPLETED', delivered, {
                    companyId,
                    branchId: result.branchId
                });
            }
            res.json({ success: true, message: result.changed ? 'Orden liberada del KDS' : 'La orden ya estaba liberada', data: result.order });
        } catch (error) {
            if (error instanceof BranchScopeError || error instanceof KitchenError) return next(error);
            next({ statusCode: 409, message: error instanceof Error ? error.message : 'No se pudo liberar la orden' });
        }
    }

    static async cancel(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const cancelledById = req.user!.userId;
            const cancelReason = req.body.cancelReason || null;
            const wasteWarehouseId = req.body.warehouseId === undefined
                ? undefined
                : Number(req.body.warehouseId);

            const scopedOrder = await OrderController.assertOrderBranch(req, id);
            const actorRoles = req.user!.roles ?? [req.user!.role];
            const isWaiterWithoutAdministrativeRole = actorRoles.includes('MESERO')
                && !actorRoles.some((role) => role === 'ADMIN' || role === 'SUPERADMIN');
            if (
                isWaiterWithoutAdministrativeRole
                && scopedOrder.items.some((item) => item.sentAt != null)
            ) {
                return next({
                    statusCode: 403,
                    message: 'El mesero no puede cancelar una orden después de enviarla a cocina',
                });
            }
            const order = await OrderService.cancel(id, companyId, cancelledById, cancelReason, {
                wasteWarehouseId
            });

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
