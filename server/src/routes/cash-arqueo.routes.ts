import { Router, Request, Response, NextFunction } from 'express';
import { CashArqueoService } from '../services/cash-arqueo.service';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { getErrorMessage } from '../utils/error';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('SUPERADMIN', 'ADMIN', 'CAJERO'));

/**
 * @swagger
 * /api/cash-arqueo/{shiftId}:
 *   get:
 *     summary: Get detailed cash breakdown for a shift
 *     tags: [Cash Register]
 */
router.get('/:shiftId', validate(s.shiftIdParam), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const shiftId = parseInt(req.params.shiftId);

        const details = await CashArqueoService.getShiftDetails(shiftId, companyId);

        res.json({
            success: true,
            data: details
        });
    } catch (error: unknown) {
        console.error('[CASH-ARQUEO] Error getting shift details:', getErrorMessage(error));
        if (error instanceof Error && error.stack) {
            console.error('[CASH-ARQUEO] Stack trace:', error.stack);
        }
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/cash-arqueo/{shiftId}/count:
 *   post:
 *     summary: Perform cash count (arqueo)
 *     tags: [Cash Register]
 */
router.post('/:shiftId/count', validate(s.cashCount), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const shiftId = parseInt(req.params.shiftId);
        const { bills, coins, usdBills, exchangeRate, notes } = req.body;

        const result = await CashArqueoService.performArqueo(shiftId, companyId, { bills, coins, usdBills, exchangeRate, notes });

        res.json({
            success: true,
            data: result
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/:shiftId/preview-close', validate(s.closeShift), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const shiftId = parseInt(req.params.shiftId);
        const { endAmount, notes, bills, coins, usdBills, exchangeRate } = req.body;

        const result = await CashArqueoService.previewClose(shiftId, companyId, {
            endAmount,
            notes,
            bills,
            coins,
            usdBills,
            exchangeRate
        });

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
 * /api/cash-arqueo/{shiftId}/close:
 *   post:
 *     summary: Close shift with final count
 *     tags: [Cash Register]
 */
router.post('/:shiftId/close', validate(s.closeShift), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const shiftId = parseInt(req.params.shiftId);
        const { endAmount, notes, bills, coins, usdBills, exchangeRate, forceClose } = req.body;

        const result = await CashArqueoService.closeShiftWithArqueo(
            shiftId,
            companyId,
            endAmount,
            req.user!.roles || [req.user!.role],
            notes,
            { bills, coins, usdBills, exchangeRate },
            { forceClose }
        );

        res.json({
            success: true,
            message: 'Turno cerrado exitosamente',
            data: result
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/cash-arqueo/{shiftId}/report:
 *   get:
 *     summary: Generate shift report
 *     tags: [Cash Register]
 */
router.get('/:shiftId/report', validate(s.shiftIdParam), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const shiftId = parseInt(req.params.shiftId);

        const report = await CashArqueoService.generateShiftReport(shiftId, companyId);

        res.json({
            success: true,
            data: report
        });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

export default router;
