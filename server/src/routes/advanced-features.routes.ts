import { Router, Request, Response, NextFunction } from 'express';
import { WasteReportService } from '../services/waste-report.service';
import { AutoPurchaseOrderService } from '../services/auto-purchase-order.service';
import { DynamicPricingService } from '../services/dynamic-pricing.service';
import { RecipeScalingService } from '../services/recipe-scaling.service';
import { TicketPrintingService } from '../services/ticket-printing.service';
import { BankReconciliationService } from '../services/bank-reconciliation.service';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { ADMINS, CASHIERS, INVENTORY, KITCHEN, OPERATIONS } from '../constants/roles';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';
import { getErrorMessage } from '../utils/error';
import { parseOptionalQueryDateFrom, parseOptionalQueryDateTo } from '../utils/date-range';
import { resolveBranchScope, assertBranchAccess, BranchScopeError } from '../utils/branch-scope';
import { MenuItemService } from '../services/menu-item.service';
import { WarehouseService } from '../services/warehouse.service';

const router = Router();

router.use(authMiddleware);

// ==================== WASTE REPORTS ====================

router.post('/waste', requireRole(...INVENTORY), validate(s.recordWaste), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const userId = req.user!.userId;
        const warehouse = await WarehouseService.getById(Number(req.body.warehouseId), companyId);
        assertBranchAccess(req.user!, warehouse.branchId, { allowGlobal: true });

        const result = await WasteReportService.recordWaste(companyId, {
            ...req.body,
            userId
        });

        res.json({ success: true, data: result });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/waste/report', requireRole(...INVENTORY), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const { startDate, endDate, warehouseId, productId } = req.query;
        const branchId = resolveBranchScope(req.user!);
        if (warehouseId) {
            const warehouse = await WarehouseService.getById(parseInt(warehouseId as string), companyId);
            assertBranchAccess(req.user!, warehouse.branchId, { allowGlobal: true });
        }

        const report = await WasteReportService.getWasteReport(companyId, {
            startDate: parseOptionalQueryDateFrom(startDate as string | undefined, req.user!.timezone),
            endDate: parseOptionalQueryDateTo(endDate as string | undefined, req.user!.timezone),
            warehouseId: warehouseId ? parseInt(warehouseId as string) : undefined,
            productId: productId ? parseInt(productId as string) : undefined,
            branchId
        });

        res.json({ success: true, data: report });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
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
        const branchId = resolveBranchScope(req.user!);
        if (warehouseId) {
            const warehouse = await WarehouseService.getById(warehouseId, companyId);
            assertBranchAccess(req.user!, warehouse.branchId, { allowGlobal: true });
        }

        const suggestions = await AutoPurchaseOrderService.generateSuggestions(companyId, warehouseId, branchId);
        res.json({ success: true, data: suggestions });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/auto-po/create', requireRole('ADMIN', 'SUPERADMIN', 'BODEGA'), validate(s.createAutoPO), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const { branchId, supplierId, items } = req.body;
        const scopedBranchId = resolveBranchScope(req.user!, Number(branchId));
        if (!scopedBranchId) return next({ statusCode: 400, message: 'ID de sucursal requerido' });

        const po = await AutoPurchaseOrderService.createFromSuggestions(companyId, scopedBranchId, supplierId, items);
        res.json({ success: true, data: po });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

// ==================== DYNAMIC PRICING ====================

router.get('/pricing/:menuItemId', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const menuItemId = parseInt(req.params.menuItemId);
        const branchId = resolveBranchScope(req.user!);

        const prices = await DynamicPricingService.getBranchPrices(menuItemId, companyId, branchId);
        res.json({ success: true, data: prices });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/pricing/:menuItemId/branch/:branchId', requireRole('ADMIN', 'SUPERADMIN'), validate(s.setBranchPrice), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const menuItemId = parseInt(req.params.menuItemId);
        const branchId = resolveBranchScope(req.user!, parseInt(req.params.branchId));
        if (!branchId) return next({ statusCode: 400, message: 'ID de sucursal requerido' });
        const { price } = req.body;

        const result = await DynamicPricingService.setBranchPrice(menuItemId, branchId, price, companyId);
        res.json({ success: true, data: result });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

// ==================== RECIPE SCALING ====================

router.post('/recipes/:recipeId/scale', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.scaleRecipe), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const recipeId = parseInt(req.params.recipeId);
        const { targetPortions } = req.body;
        const branchId = await MenuItemService.getRecipeOwnerBranch(recipeId, companyId);
        assertBranchAccess(req.user!, branchId);

        const scaled = await RecipeScalingService.scaleRecipe(recipeId, companyId, targetPortions);
        res.json({ success: true, data: scaled });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/recipes/:menuItemId/yield', requireRole('ADMIN', 'SUPERADMIN', 'CHEF'), validate(s.calculateYield), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const menuItemId = parseInt(req.params.menuItemId);
        const branchId = await MenuItemService.getOwnerBranch(menuItemId, companyId);
        assertBranchAccess(req.user!, branchId);

        const yieldCalc = await RecipeScalingService.calculateYield(menuItemId, companyId, req.body);
        res.json({ success: true, data: yieldCalc });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/recipes/portions/:category', (req: Request, res: Response) => {
    const suggestions = RecipeScalingService.getPortionSuggestions(req.params.category);
    res.json({ success: true, data: suggestions });
});

// ==================== TICKET PRINTING ====================

router.get('/tickets/:orderId', requireRole(...OPERATIONS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);
        assertBranchAccess(req.user!, await TicketPrintingService.getOrderBranch(orderId, companyId));

        const ticket = await TicketPrintingService.generateOrderTicket(orderId, companyId);
        res.json({ success: true, data: ticket });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/tickets/:orderId/kitchen', requireRole(...OPERATIONS, ...KITCHEN), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);
        assertBranchAccess(req.user!, await TicketPrintingService.getOrderBranch(orderId, companyId));

        const ticket = await TicketPrintingService.generateKitchenTicket(orderId, companyId);
        res.json({ success: true, data: ticket });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/tickets/:orderId/formatted', requireRole(...OPERATIONS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const orderId = parseInt(req.params.orderId);
        assertBranchAccess(req.user!, await TicketPrintingService.getOrderBranch(orderId, companyId));
        const width = req.query.width === '58' ? 58 : 80;

        const ticketData = await TicketPrintingService.generateOrderTicket(orderId, companyId);
        const formatted = TicketPrintingService.formatForPrinter(ticketData, width);

        res.type('text/plain').send(formatted);
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

// ==================== BANK RECONCILIATION ====================

router.get('/reconciliation', requireRole(...CASHIERS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const { startDate, endDate } = req.query;
        const branchId = resolveBranchScope(req.user!, req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined);

        const status = await BankReconciliationService.getReconciliationStatus(
            companyId,
            new Date(startDate as string),
            new Date(endDate as string),
            branchId
        );
        res.json({ success: true, data: status });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/reconciliation/pending', requireRole(...CASHIERS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const branchId = resolveBranchScope(req.user!, req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined);
        const pending = await BankReconciliationService.getPendingReconciliations(companyId, branchId);
        res.json({ success: true, data: pending });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/reconciliation/deposit', requireRole(...ADMINS), validate(s.recordDeposit), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const branchId = resolveBranchScope(req.user!, req.body.branchId ? Number(req.body.branchId) : undefined);
        const deposit = await BankReconciliationService.recordDeposit(companyId, req.user!.userId, req.body, branchId);
        res.json({ success: true, data: deposit });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 400, message: getErrorMessage(error) });
    }
});

router.get('/reconciliation/deposits', requireRole(...CASHIERS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const branchId = resolveBranchScope(req.user!, req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined);
        const deposits = await BankReconciliationService.getDeposits(req.user!.companyId, branchId);
        res.json({ success: true, data: deposits });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.post('/reconciliation/deposit/:id/reverse', requireRole(...ADMINS), validate(s.reverseDeposit), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const branchId = resolveBranchScope(req.user!, req.body.branchId ? Number(req.body.branchId) : undefined);
        const result = await BankReconciliationService.reverseDeposit(req.user!.companyId, parseInt(req.params.id), req.user!.userId, req.body.reason, branchId);
        res.json({ success: true, data: result });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 400, message: getErrorMessage(error) });
    }
});

router.post('/reconciliation/mark-reconciled', requireRole(...ADMINS), validate(s.markReconciled), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const { shiftIds, depositReference } = req.body;
        const branchId = resolveBranchScope(req.user!, req.body.branchId ? Number(req.body.branchId) : undefined);
        const result = await BankReconciliationService.markAsReconciled(companyId, shiftIds, depositReference, branchId);
        res.json({ success: true, data: result });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

router.get('/reconciliation/report/:month/:year', requireRole(...CASHIERS), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const companyId = req.user!.companyId;
        const month = parseInt(req.params.month);
        const year = parseInt(req.params.year);
        const branchId = resolveBranchScope(req.user!, req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined);

        const report = await BankReconciliationService.generateReport(companyId, month, year, branchId);
        res.json({ success: true, data: report });
    } catch (error: unknown) {
        if (error instanceof BranchScopeError) return next(error);
        next({ statusCode: 500, message: getErrorMessage(error) });
    }
});

export default router;
