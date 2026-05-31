import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/payment.service';
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
            const payments = await PaymentService.getByOrderId(orderId, companyId);
            res.json({
                success: true,
                data: payments
            });
        } catch (error) {
            next({ statusCode: 500, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async getOrderSummary(req: Request, res: Response, next: NextFunction) {
        try {
            const orderId = parseInt(req.params.orderId);
            const companyId = req.user!.companyId;
            const summary = await PaymentService.getOrderPaymentSummary(orderId, companyId);
            res.json({
                success: true,
                data: summary
            });
        } catch (error) {
            next({ statusCode: 404, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async create(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const payment = await PaymentService.create(companyId, req.body, req.user?.userId!);
            res.status(201).json({
                success: true,
                message: 'Pago procesado exitosamente',
                data: payment
            });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }

    static async delete(req: Request, res: Response, next: NextFunction) {
        try {
            const id = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;
            await PaymentService.delete(id, companyId, userId);
            res.json({
                success: true,
                message: 'Pago eliminado exitosamente'
            });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error desconocido' });
        }
    }
}
