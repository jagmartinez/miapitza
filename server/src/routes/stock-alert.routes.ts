import { Router, Request, Response, NextFunction } from 'express';
import { StockAlertService } from '../services/stock-alert.service';
import { authMiddleware } from '../middlewares/auth';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, BranchScopeError } from '../utils/branch-scope';

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /api/stock-alerts:
 *   get:
 *     summary: Get low stock products
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined;
        const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
        const branchId = resolveBranchScope(req.user!, requested);

        const alerts = await StockAlertService.getLowStockProducts(companyId, warehouseId, branchId);

        res.json({
            success: true,
            data: alerts
        });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/stock-alerts/summary:
 *   get:
 *     summary: Get stock alert summary for dashboard
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
        const branchId = resolveBranchScope(req.user!, requested);
        const summary = await StockAlertService.getAlertSummary(companyId, branchId);

        res.json({
            success: true,
            data: summary
        });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/stock-alerts/product/{productId}:
 *   get:
 *     summary: Check stock status for a specific product
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 */
router.get('/product/:productId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const productId = parseInt(req.params.productId);
        const branchId = resolveBranchScope(req.user!);

        const status = await StockAlertService.checkProductStock(productId, companyId, branchId);

        res.json({
            success: true,
            data: status
        });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

export default router;
