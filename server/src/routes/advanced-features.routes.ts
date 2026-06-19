import { Router, Request, Response, NextFunction } from 'express';
import { WasteReportService } from '../services/waste-report.service';
import { AutoPurchaseOrderService } from '../services/auto-purchase-order.service';
import { DynamicPricingService } from '../services/dynamic-pricing.service';
import { RecipeScalingService } from '../services/recipe-scaling.service';
import { TicketPrintingService } from '../services/ticket-printing.service';
import { BankReconciliationService, NotImplementedError } from '../services/bank-reconciliation.service';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { ADMINS, CASHIERS, INVENTORY } from '../constants/roles';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { getErrorMessage } from '../utils/error';
import { parseOptionalQueryDateFrom, parseOptionalQueryDateTo } from '../utils/date-range';

const router = Router();

router.use(authMiddleware);

// ==================== WASTE REPORTS ====================

router.post('/waste', requireRole(...INVENTORY), validate(s.recordWaste), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const userId = req.user!.userId;

        const result = await WasteReportService.recordWaste(companyId, {
            ...req.body,
            userId
        });

        res.json({ success: true, data: result });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/waste/report', requireRole(...INVENTORY), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const { startDate, endDate, warehouseId, productId } = req.query;

        const report = await WasteReportService.getWasteReport(companyId, {
            startDate: parseOptionalQueryDateFrom(startDate as string | undefined),
            endDate: parseOptionalQueryDateTo(endDate as string | undefined),
            warehouseId: warehouseId ? parseInt(warehouseId as string) : undefined,
            productId: productId ? parseInt(productId as string) : undefined
        });

        res.json({ success: true, data: report });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/waste/reasons', (req: Request, res: Response) => {
    res.json({ success: true, data: WasteReportService.getWasteReasons() });
});

// ==================== AUTO PURCHASE ORDERS ====================

router.get('/auto-po/suggestions', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined;

        const suggestions = await AutoPurchaseOrderService.generateSuggestions(companyId, warehouseId);
        res.json({ success: true, data: suggestions });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/auto-po/create', requireRole('ADMIN', 'SUPERADMIN', 'BODEGA'), validate(s.createAutoPO), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const { branchId, supplierId, items } = req.body;

        const po = await AutoPurchaseOrderService.createFromSuggestions(companyId, branchId, supplierId, items);
        res.json({ success: true, data: po });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

// ==================== DYNAMIC PRICING ====================

router.get('/pricing/:menuItemId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const menuItemId = parseInt(req.params.menuItemId);

        const prices = await DynamicPricingService.getBranchPrices(menuItemId, companyId);
        res.json({ success: true, data: prices });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/pricing/:menuItemId/branch/:branchId', requireRole('ADMIN', 'SUPERADMIN'), validate(s.setBranchPrice), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const menuItemId = parseInt(req.params.menuItemId);
        const branchId = parseInt(req.params.branchId);
        const { price } = req.body;

        const result = await DynamicPricingService.setBranchPrice(menuItemId, branchId, price, companyId);
        res.json({ success: true, data: result });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

// ==================== RECIPE SCALING ====================

router.post('/recipes/:recipeId/scale', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.scaleRecipe), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const recipeId = parseInt(req.params.recipeId);
        const { targetPortions } = req.body;

        const scaled = await RecipeScalingService.scaleRecipe(recipeId, companyId, targetPortions);
        res.json({ success: true, data: scaled });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/recipes/:menuItemId/yield', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.calculateYield), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const menuItemId = parseInt(req.params.menuItemId);

        const yieldCalc = await RecipeScalingService.calculateYield(menuItemId, companyId, req.body);
        res.json({ success: true, data: yieldCalc });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/recipes/portions/:category', (req: Request, res: Response) => {
    const suggestions = RecipeScalingService.getPortionSuggestions(req.params.category);
    res.json({ success: true, data: suggestions });
});

// ==================== TICKET PRINTING ====================

router.get('/tickets/:orderId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);

        const ticket = await TicketPrintingService.generateOrderTicket(orderId, companyId);
        res.json({ success: true, data: ticket });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/tickets/:orderId/kitchen', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);

        const ticket = await TicketPrintingService.generateKitchenTicket(orderId, companyId);
        res.json({ success: true, data: ticket });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/tickets/:orderId/formatted', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);
        const width = req.query.width === '58' ? 58 : 80;

        const ticketData = await TicketPrintingService.generateOrderTicket(orderId, companyId);
        const formatted = TicketPrintingService.formatForPrinter(ticketData, width);

        res.type('text/plain').send(formatted);
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

// ==================== BANK RECONCILIATION ====================

router.get('/reconciliation', requireRole(...CASHIERS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const { startDate, endDate } = req.query;

        const status = await BankReconciliationService.getReconciliationStatus(
            companyId,
            new Date(startDate as string),
            new Date(endDate as string)
        );
        res.json({ success: true, data: status });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/reconciliation/pending', requireRole(...CASHIERS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const pending = await BankReconciliationService.getPendingReconciliations(companyId);
        res.json({ success: true, data: pending });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/reconciliation/deposit', requireRole(...ADMINS), validate(s.recordDeposit), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const deposit = await BankReconciliationService.recordDeposit(companyId, req.body);
        res.json({ success: true, data: deposit });
    } catch (error: unknown) {
        // No BankDeposit persistence exists yet — report this honestly as 501.
        const statusCode = error instanceof NotImplementedError ? 501 : 500;
        next({ statusCode, message: getErrorMessage(error) });
    }
});

router.post('/reconciliation/mark-reconciled', requireRole(...ADMINS), validate(s.markReconciled), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const { shiftIds, depositReference } = req.body;
        const result = await BankReconciliationService.markAsReconciled(companyId, shiftIds, depositReference);
        res.json({ success: true, data: result });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/reconciliation/report/:month/:year', requireRole(...CASHIERS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const month = parseInt(req.params.month);
        const year = parseInt(req.params.year);

        const report = await BankReconciliationService.generateReport(companyId, month, year);
        res.json({ success: true, data: report });
    } catch (error: unknown) {
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

export default router;
