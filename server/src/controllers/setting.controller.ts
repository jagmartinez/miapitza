import { Request, Response, NextFunction } from 'express';
import { SettingService } from '../services/setting.service';
import { getErrorMessage } from '../utils/error';

export class SettingController {

    static async getAll(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const settings = await SettingService.getAll(companyId);
            res.json({
                success: true,
                data: settings
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async update(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const settings = await SettingService.update(companyId, req.body);
            res.json({
                success: true,
                data: settings
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
