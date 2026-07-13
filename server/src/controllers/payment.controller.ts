import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/payment.service';
import { OrderService } from '../services/order.service';
import { assertBranchAccess, BranchScopeError } from '../utils/branch-scope';
import prisma from '../utils/prisma';

export class PaymentController {
    static async getPaymentMethods(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const paymentMethods = await prisma.paymentMethod.findMany({
                where: {
                    OR: [
                        { companyId: companyId },
                        { companyId: null } // System-wide methods
                    ],
                    active: true
                },
                orderBy: { name: 'asc' }
            });
            res.json({
                success: true,
                data: paymentMethods
            });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async getByOrderId(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.orderId);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(orderId, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const payments = await PaymentService.getByOrderId(orderId, companyId);
            res.json({
                success: true,
                data: payments
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async getOrderSummary(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.orderId);
            const companyId = req.user!.companyId;
            const order = await OrderService.getById(orderId, companyId);
            assertBranchAccess(req.user!, order.branchId);
            const summary = await PaymentService.getOrderPaymentSummary(orderId, companyId);
            res.json({
                success: true,
                data: summary
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 404, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            if (req.body.orderId) {
                const order = await OrderService.getById(parseInt(String(req.body.orderId)), companyId);
                assertBranchAccess(req.user!, order.branchId);
            }
            const payment = await PaymentService.create(companyId, req.body, req.user?.userId!);
            res.status(201).json({
                success: true,
                message: 'Pago procesado exitosamente',
                data: payment
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;
            const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
            if (!reason) return next({ statusCode: 400, message: 'El motivo de reversión es obligatorio' });

            const payment = await prisma.payment.findFirst({
                where: { id, order: { companyId } },
                select: { order: { select: { branchId: true } } }
            });
            if (!payment) return next({ statusCode: 404, message: 'Pago no encontrado' });
            assertBranchAccess(req.user!, payment.order.branchId);

            await PaymentService.delete(id, companyId, userId, reason);
            res.json({
                success: true,
                message: 'Pago eliminado exitosamente'
            });
        } catch (error) {
            if (error instanceof BranchScopeError) return next(error);
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }
}
