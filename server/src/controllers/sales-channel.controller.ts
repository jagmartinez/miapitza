import { Request, Response, NextFunction } from 'express';
import { SalesChannelService } from '../services/sales-channel.service';
import { getErrorMessage } from '../utils/error';

export class SalesChannelController {
    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const channels = await SalesChannelService.getAll(companyId);
            res.json({ success: true, data: channels });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async upsert(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const { channel, name, priceMarkupPct, commissionPct, active } = req.body;

            if (!channel || !name) {
                return next({ statusCode: 400, message: 'channel y name son requeridos' });
            }

            const result = await SalesChannelService.upsert(companyId, {
                channel, name, priceMarkupPct, commissionPct, active
            });

            res.json({ success: true, data: result });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async ensureDefaults(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            await SalesChannelService.ensureDefaults(companyId);
            const channels = await SalesChannelService.getAll(companyId);
            res.json({ success: true, data: channels });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async calculatePricing(req: Request, res: Response, next: NextFunction) {
        try {
            const { regularPrice, markupPct, commissionPct } = req.query;
            const pricing = SalesChannelService.calculatePedidosYaPricing(
                parseFloat(regularPrice as string) || 0,
                parseFloat(markupPct as string) || 18,
                parseFloat(commissionPct as string) || 24
            );
            res.json({ success: true, data: pricing });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
