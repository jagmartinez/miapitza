import { Router, Request, Response, NextFunction } from 'express';
import { SplitBillService } from '../services/split-bill.service';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { getErrorMessage } from '../utils/error';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('SUPERADMIN', 'ADMIN', 'CAJERO', 'MESERO'));

/**
 * @swagger
 * /api/split-bill/{orderId}/evenly:
 *   post:
 *     summary: Split order evenly among N people
 *     tags: [POS]
 */
router.post('/:orderId/evenly', validate(s.splitEvenly), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);
        const { numberOfPeople } = req.body;

        if (!numberOfPeople || numberOfPeople < 2) {
            return res.status(400).json({
                success: false,
                message: 'Debe especificar al menos 2 personas'
            });
        }

        const result = await SplitBillService.splitEvenly(orderId, companyId, numberOfPeople);

        res.json({
            success: true,
            data: result
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/split-bill/{orderId}/by-items:
 *   post:
 *     summary: Split order by items (each person selects their items)
 *     tags: [POS]
 */
router.post('/:orderId/by-items', validate(s.splitByItems), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);
        const { itemAssignments } = req.body;

        const result = await SplitBillService.splitByItems(orderId, companyId, itemAssignments);

        res.json({
            success: true,
            data: result
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/split-bill/{orderId}/by-amount:
 *   post:
 *     summary: Split order by custom amounts
 *     tags: [POS]
 */
router.post('/:orderId/by-amount', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);
        const { customSplits } = req.body;

        const result = await SplitBillService.splitByAmount(orderId, companyId, customSplits);

        res.json({
            success: result.valid !== false,
            data: result
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/split-bill/suggested-tips:
 *   get:
 *     summary: Get suggested tip amounts
 *     tags: [POS]
 */
router.get('/suggested-tips', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const subtotal = parseFloat(req.query.subtotal as string) || 0;
        const suggestions = SplitBillService.getSuggestedTips(subtotal);

        res.json({
            success: true,
            data: suggestions
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

export default router;
