import { NextFunction, Request, Response } from 'express';
import { KitchenNotificationService } from '../services/kitchen-notification.service';

export class KitchenNotificationController {
    static async list(req: Request, res: Response, next: NextFunction) {
        try {
            const includeAttended = req.query.includeAttended === 'true';
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const data = await KitchenNotificationService.list(
                req.user!.companyId,
                req.user!.userId,
                { includeAttended, limit }
            );
            res.json({ success: true, data });
        } catch (error) {
            next({ statusCode: 400, message: error instanceof Error ? error.message : 'Error al consultar notificaciones' });
        }
    }

    static async seen(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await KitchenNotificationService.markSeen(
                req.user!.companyId,
                req.user!.userId,
                Number(req.params.id)
            );
            res.json({ success: true, data });
        } catch (error) {
            next({ statusCode: 404, message: error instanceof Error ? error.message : 'Notificación no encontrada' });
        }
    }

    static async attended(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await KitchenNotificationService.markAttended(
                req.user!.companyId,
                req.user!.userId,
                Number(req.params.id)
            );
            res.json({ success: true, data });
        } catch (error) {
            next({ statusCode: 404, message: error instanceof Error ? error.message : 'Notificación no encontrada' });
        }
    }
}
