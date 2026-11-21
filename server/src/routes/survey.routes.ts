import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, extractAuthToken, requirePermission } from '../middlewares/auth';
import { validateQueryDates } from '../middlewares/validate-query-dates';
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
            // Real length/pattern limits are enforced after trimming, in the service.
            comment: { type: 'string', max: 2000 },
            contactPhone: { type: 'string', max: 200 },
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

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown) => (str(v) === undefined ? undefined : Number(v));
const viewerOf = (req: Request) => req.user as NonNullable<Request['user']>;
const q = (req: Request) => req.query as Record<string, unknown>;

const json = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: await fn(req) });
    } catch (error) {
        next(error);
    }
};

const dates = validateQueryDates('dateFrom', 'dateTo');

router.get('/summary', requirePermission('surveys.view', 'SUPERADMIN', 'ADMIN'), dates, json((req) =>
    SurveyService.summary(viewerOf(req), { dateFrom: str(q(req).dateFrom), dateTo: str(q(req).dateTo), branchId: num(q(req).branchId) })));

router.get('/responses', requirePermission('surveys.view', 'SUPERADMIN', 'ADMIN'), dates, json((req) =>
    SurveyService.responses(viewerOf(req), {
        dateFrom: str(q(req).dateFrom),
        dateTo: str(q(req).dateTo),
        branchId: num(q(req).branchId),
        waiterUserId: num(q(req).waiterUserId),
        detractorsOnly: q(req).detractorsOnly === 'true',
        page: num(q(req).page),
        pageSize: num(q(req).pageSize),
    })));

router.get('/ranking', requirePermission('surveys.view', 'SUPERADMIN', 'ADMIN'), json((req) =>
    SurveyService.ranking(viewerOf(req), str(q(req).month), num(q(req).branchId))));

/** Waiter self view (authMiddleware only): aggregates of the caller, never comments or phones. */
router.get('/me', json((req) => SurveyService.mine(viewerOf(req), str(q(req).month))));

export default router;
