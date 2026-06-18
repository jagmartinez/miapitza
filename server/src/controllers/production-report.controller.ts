import { Request, Response, NextFunction } from 'express';
import { ProductionReportService } from '../services/production-report.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, BranchScopeError } from '../utils/branch-scope';

export class ProductionReportController {
    private static parseFilters(req: Request) {
        const requested = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
        return {
            branchId: resolveBranchScope(req.user!, requested),
            dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
            dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
            productId: req.query.productId ? parseInt(req.query.productId as string) : undefined,
            warehouseId: req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined,
            status: req.query.status as string | undefined
        };
    }

    private static handle(res: Response, next: NextFunction, fn: () => Promise<unknown>) {
        fn()
            .then((data) => res.json({ success: true, data }))
            .catch((error: unknown) => {
                if (error instanceof BranchScopeError) return next(error);
                next({ statusCode: 400, message: getErrorMessage(error) });
            });
    }

    static getProductions(req: Request, res: Response, next: NextFunction) {
        const f = ProductionReportController.parseFilters(req);
        ProductionReportController.handle(res, next, () => ProductionReportService.getProductions(req.user!.companyId, f));
    }

    static getInputConsumption(req: Request, res: Response, next: NextFunction) {
        const f = ProductionReportController.parseFilters(req);
        ProductionReportController.handle(res, next, () => ProductionReportService.getInputConsumption(req.user!.companyId, f));
    }

    static getPlanVsReal(req: Request, res: Response, next: NextFunction) {
        const f = ProductionReportController.parseFilters(req);
        ProductionReportController.handle(res, next, () => ProductionReportService.getPlanVsReal(req.user!.companyId, f));
    }

    static getProducedKardex(req: Request, res: Response, next: NextFunction) {
        const f = ProductionReportController.parseFilters(req);
        ProductionReportController.handle(res, next, () => ProductionReportService.getProducedKardex(req.user!.companyId, f));
    }

    static getProfitability(req: Request, res: Response, next: NextFunction) {
        const f = ProductionReportController.parseFilters(req);
        ProductionReportController.handle(res, next, () => ProductionReportService.getProfitability(req.user!.companyId, f));
    }

    static getTraceability(req: Request, res: Response, next: NextFunction) {
        const orderId = parseInt(req.params.orderId);
        ProductionReportController.handle(res, next, () => ProductionReportService.getTraceability(req.user!.companyId, orderId));
    }

    static getDashboard(req: Request, res: Response, next: NextFunction) {
        const f = ProductionReportController.parseFilters(req);
        ProductionReportController.handle(res, next, () => ProductionReportService.getDashboard(req.user!.companyId, f));
    }
}
