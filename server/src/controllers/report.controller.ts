import { Request, Response, NextFunction } from 'express';
import { ReportService } from '../services/report.service';
import { getErrorMessage } from '../utils/error';

export class ReportController {
    private static resolveBranchScope(req: Request, requestedBranchId?: number): number | undefined {
        const isSuperAdmin = req.user?.role === 'SUPERADMIN';
        if (isSuperAdmin) {
            return requestedBranchId;
        }

        const userBranchId = req.user?.branchId;
        if (!userBranchId) {
            throw new Error('Usuario sin sucursal asignada');
        }

        if (requestedBranchId && requestedBranchId !== userBranchId) {
            throw new Error('No autorizado para consultar otra sucursal');
        }

        return userBranchId;
    }

    static async getDashboardStats(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const companyId = req.user!.companyId;
            const stats = await ReportService.getDashboardStats(companyId, branchId);
            res.json({
                success: true,
                data: stats
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesChart(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const period = req.query.period as 'week' | 'month' || 'week';
            const companyId = req.user!.companyId;
            const chartData = await ReportService.getSalesChart(companyId, period, branchId);
            res.json({
                success: true,
                data: chartData
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getTopSellingProducts(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
            const companyId = req.user!.companyId;
            const topProducts = await ReportService.getTopSellingProducts(companyId, branchId, limit);
            res.json({
                success: true,
                data: topProducts
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesByUser(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
            const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
            const companyId = req.user!.companyId;
            const salesByUser = await ReportService.getSalesByUser(companyId, branchId, startDate, endDate);
            res.json({
                success: true,
                data: salesByUser
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getRecentOrders(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
            const companyId = req.user!.companyId;
            const orders = await ReportService.getRecentOrders(companyId, branchId, limit);
            res.json({
                success: true,
                data: orders
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getRecentInvoices(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;
            const todayOnly = req.query.todayOnly === 'true';
            const companyId = req.user!.companyId;
            const invoices = await ReportService.getRecentInvoices(companyId, branchId, limit, todayOnly);
            res.json({
                success: true,
                data: invoices
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getTodaysReservations(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const days = req.query.days ? parseInt(req.query.days as string) : 1;
            const companyId = req.user!.companyId;
            const reservations = await ReportService.getTodaysReservations(companyId, branchId, days);
            res.json({
                success: true,
                data: reservations
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getIncomeBreakdown(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const periodRaw = req.query.period;
            const period: 'today' | 'week' | 'month' | 'year' =
                periodRaw === 'today' ||
                periodRaw === 'week' ||
                periodRaw === 'month' ||
                periodRaw === 'year'
                    ? periodRaw
                    : 'month';
            const companyId = req.user!.companyId;
            const data = await ReportService.getIncomeBreakdown(companyId, branchId, period);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getOccupancyHeatmap(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const companyId = req.user!.companyId;
            const data = await ReportService.getOccupancyHeatmap(companyId, branchId);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getShiftEvaluation(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const companyId = req.user!.companyId;
            const data = await ReportService.getShiftEvaluation(companyId, branchId);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getConversionFunnel(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const companyId = req.user!.companyId;
            const data = await ReportService.getConversionFunnel(companyId, branchId);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getServiceTrends(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = this.resolveBranchScope(req, requestedBranchId);
            const data = await ReportService.getServiceTrends(companyId, branchId);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getMyStats(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const companyId = req.user!.companyId;
            const role = req.user!.role;
            const data = await ReportService.getMyStats(userId, companyId, role);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getMyActivity(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const companyId = req.user!.companyId;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
            const data = await ReportService.getUserActivity(userId, companyId, limit);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getMyPerformance(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const companyId = req.user!.companyId;
            const data = await ReportService.getMyPerformance(userId, companyId);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getPasswordInfo(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.userId;
            const companyId = req.user!.companyId;
            const data = await ReportService.getPasswordInfo(userId, companyId);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getCostReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: NonNullable<Parameters<typeof ReportService.getCostReport>[1]> = {};
            if (req.query.dateFrom) filters.dateFrom = new Date(req.query.dateFrom as string);
            if (req.query.dateTo) filters.dateTo = new Date(req.query.dateTo as string);
            if (req.query.branchId) {
                const requestedBranchId = parseInt(req.query.branchId as string);
                filters.branchId = this.resolveBranchScope(req, requestedBranchId);
            } else {
                filters.branchId = this.resolveBranchScope(req, undefined);
            }
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);
            if (req.query.productId) filters.productId = parseInt(req.query.productId as string);
            if (req.query.supplierId) filters.supplierId = parseInt(req.query.supplierId as string);

            const data = await ReportService.getCostReport(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
