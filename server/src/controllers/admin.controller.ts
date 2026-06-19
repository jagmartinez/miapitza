import { Request, Response } from 'express';
import { runDemoCycle } from '../scripts/demo-pizza-cycle';

export class AdminController {
    static async seedDemoCycle(req: Request, res: Response) {
        try {
            const once = req.body?.once === false ? false : true;
            const dryRun = req.body?.dryRun === true;
            const result = await runDemoCycle({ once, dryRun });
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({
                success: false,
                message: err instanceof Error ? err.message : 'Error',
            });
        }
    }
}
