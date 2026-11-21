import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, extractAuthToken } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { SurveyService } from '../services/survey.service';

const router = Router();

router.use(authMiddleware);

/**
 * Customer answer from a service tablet. No role permission: the gate is the
 * `op-device:` session (checked in the service), so a waiter/cashier PIN
 * session on a registered tablet may submit without holding report access.
 */
router.post(
    '/',
    validate({
        body: {
            orderId: { type: 'number', required: true, min: 1, integer: true },
            nps: { type: 'number', required: true, min: 0, max: 10, integer: true },
            waiterRating: { type: 'number', min: 1, max: 5, integer: true },
            waitRating: { type: 'number', min: 1, max: 5, integer: true },
            ambienceRating: { type: 'number', min: 1, max: 5, integer: true },
            foodRating: { type: 'number', min: 1, max: 5, integer: true },
            comment: { type: 'string', max: 500 },
            contactPhone: { type: 'string', max: 30, pattern: /^[0-9+()\-\s]{6,30}$/ },
        },
    }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = await SurveyService.submit(req.user!, extractAuthToken(req), req.body ?? {});
            res.status(data.created ? 201 : 200).json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
