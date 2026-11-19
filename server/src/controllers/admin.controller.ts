import { Request, Response, NextFunction } from 'express';
import { runDemoCycle } from '../scripts/demo-pizza-cycle';

export class AdminController {
    static async seedDemoCycle(req: Request, res: Response, next: NextFunction) {
        try {
            const once = req.body?.once === false ? false : true;
            const dryRun = req.body?.dryRun === true;
            const result = await runDemoCycle({ once, dryRun });
            res.json({ success: true, data: result });
        } catch (err) {
            next(err);
        }
    }
}
