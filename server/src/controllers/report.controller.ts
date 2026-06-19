import { Request, Response, NextFunction } from 'express';
import { ReportService } from '../services/report.service';
import { ExcelExporter, sendExcelResponse } from '../utils/excel-export';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope } from '../utils/branch-scope';
import { parseOptionalQueryDateFrom, parseOptionalQueryDateTo } from '../utils/date-range';

export class ReportController {
    private static resolveBranchScope(req: Request, requestedBranchId?: number): number | undefined {
        // Centralised rule: SUPERADMIN is company-wide; everyone else is pinned to
        // their active branch.
        return resolveBranchScope(req.user!, requestedBranchId);
    }

    static async getDashboardStats(req: Request, res: Response, next: NextFunction) {
        try {
            const requestedBranchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            const branchId = ReportController.resolveBranchScope(req, requestedBranchId);
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
            if (req.query.dateFrom) filters.dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string);
            if (req.query.dateTo) filters.dateTo = parseOptionalQueryDateTo(req.query.dateTo as string);
            if (req.query.branchId) {
                const requestedBranchId = parseInt(req.query.branchId as string);
                filters.branchId = ReportController.resolveBranchScope(req, requestedBranchId);
            } else {
                filters.branchId = ReportController.resolveBranchScope(req, undefined);
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

    // ── Inventory Report ──
    static async getInventoryReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.warehouseId) filters.warehouseId = parseInt(req.query.warehouseId as string);
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);
            if (req.query.productId) filters.productId = parseInt(req.query.productId as string);
            if (req.query.lowStockOnly === 'true') filters.lowStockOnly = true;

            const data = await ReportService.getInventoryReport(companyId, filters as any);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportInventoryReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.warehouseId) filters.warehouseId = parseInt(req.query.warehouseId as string);
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);
            if (req.query.lowStockOnly === 'true') filters.lowStockOnly = true;

            const data = await ReportService.getInventoryReport(companyId, filters as any);
            const appliedFilters: Record<string, string> = {};
            if (req.query.warehouseId) appliedFilters['Almacén ID'] = req.query.warehouseId as string;
            if (req.query.categoryId) appliedFilters['Categoría ID'] = req.query.categoryId as string;
            if (req.query.lowStockOnly === 'true') appliedFilters['Solo stock bajo'] = 'Sí';

            const buffer = await ExcelExporter.generateReport({
                title: 'Reporte de Inventario Actual',
                sheetName: 'Inventario',
                columns: [
                    { header: 'Producto', key: 'productName', width: 30 },
                    { header: 'SKU', key: 'sku', width: 15 },
                    { header: 'Categoría', key: 'categoryName', width: 20 },
                    { header: 'Almacén', key: 'warehouseName', width: 20 },
                    { header: 'Unidad', key: 'unit', width: 10 },
                    { header: 'Stock Actual', key: 'quantity', width: 14, style: 'number' },
                    { header: 'Stock Mínimo', key: 'minStock', width: 14, style: 'number' },
                    { header: 'Costo Promedio', key: 'currentAverageCost', width: 16, style: 'currency' },
                    { header: 'Valor Total', key: 'totalValue', width: 16, style: 'currency' },
                    { header: 'Estado', key: 'status', width: 12 },
                ],
                data: data.items,
                filters: appliedFilters,
                summary: {
                    'Total Productos': data.summary.totalProducts,
                    'Valor Total Inventario': data.summary.totalValue,
                    'Stock Bajo': data.summary.lowStockCount,
                    'Crítico': data.summary.criticalCount,
                },
                userName: req.user?.roleObj?.name || req.user?.role || 'Admin',
            });

            const date = new Date().toISOString().split('T')[0];
            sendExcelResponse(res, buffer, `reporte_inventario_actual_${date}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    // ── Purchases Report ──
    static async getPurchasesReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.dateFrom) filters.dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string);
            if (req.query.dateTo) filters.dateTo = parseOptionalQueryDateTo(req.query.dateTo as string);
            if (req.query.supplierId) filters.supplierId = parseInt(req.query.supplierId as string);
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);
            if (req.query.branchId) {
                filters.branchId = ReportController.resolveBranchScope(req, parseInt(req.query.branchId as string));
            } else {
                filters.branchId = ReportController.resolveBranchScope(req, undefined);
            }
            if (req.query.status) filters.status = req.query.status as string;

            const data = await ReportService.getPurchasesReport(companyId, filters as any);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportPurchasesReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.dateFrom) filters.dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string);
            if (req.query.dateTo) filters.dateTo = parseOptionalQueryDateTo(req.query.dateTo as string);
            if (req.query.supplierId) filters.supplierId = parseInt(req.query.supplierId as string);
            if (req.query.branchId) {
                filters.branchId = ReportController.resolveBranchScope(req, parseInt(req.query.branchId as string));
            } else {
                filters.branchId = ReportController.resolveBranchScope(req, undefined);
            }

            const data = await ReportService.getPurchasesReport(companyId, filters as any);
            const appliedFilters: Record<string, string> = {};
            if (req.query.dateFrom) appliedFilters['Desde'] = req.query.dateFrom as string;
            if (req.query.dateTo) appliedFilters['Hasta'] = req.query.dateTo as string;

            const buffer = await ExcelExporter.generateReport({
                title: 'Reporte de Compras',
                sheetName: 'Compras',
                columns: [
                    { header: 'Fecha', key: 'date', width: 14, style: 'date' },
                    { header: 'OC #', key: 'poNumber', width: 15 },
                    { header: 'Proveedor', key: 'supplierName', width: 25 },
                    { header: 'Producto', key: 'productName', width: 25 },
                    { header: 'Categoría', key: 'categoryName', width: 18 },
                    { header: 'Cantidad', key: 'quantity', width: 12, style: 'number' },
                    { header: 'Costo Unit.', key: 'unitCost', width: 14, style: 'currency' },
                    { header: 'Costo Total', key: 'totalCost', width: 14, style: 'currency' },
                    { header: 'Estado', key: 'status', width: 12 },
                ],
                data: data.items,
                filters: appliedFilters,
                summary: {
                    'Total OC': data.summary.totalOrders,
                    'Monto Total': data.summary.totalAmount,
                    'Proveedores': data.summary.uniqueSuppliers,
                    'Productos': data.summary.uniqueProducts,
                },
                userName: req.user?.roleObj?.name || req.user?.role || 'Admin',
            });

            const date = new Date().toISOString().split('T')[0];
            sendExcelResponse(res, buffer, `reporte_compras_${date}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    // ── Sales Report ──
    static async getSalesReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.dateFrom) filters.dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string);
            if (req.query.dateTo) filters.dateTo = parseOptionalQueryDateTo(req.query.dateTo as string);
            if (req.query.branchId) {
                filters.branchId = ReportController.resolveBranchScope(req, parseInt(req.query.branchId as string));
            } else {
                filters.branchId = ReportController.resolveBranchScope(req, undefined);
            }
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);
            if (req.query.brandId) filters.brandId = parseInt(req.query.brandId as string);
            if (req.query.userId) filters.userId = parseInt(req.query.userId as string);

            const data = await ReportService.getSalesReport(companyId, filters as any);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.dateFrom) filters.dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string);
            if (req.query.dateTo) filters.dateTo = parseOptionalQueryDateTo(req.query.dateTo as string);
            if (req.query.branchId) {
                filters.branchId = ReportController.resolveBranchScope(req, parseInt(req.query.branchId as string));
            } else {
                filters.branchId = ReportController.resolveBranchScope(req, undefined);
            }
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);
            if (req.query.brandId) filters.brandId = parseInt(req.query.brandId as string);

            const data = await ReportService.getSalesReport(companyId, filters as any);
            const appliedFilters: Record<string, string> = {};
            if (req.query.dateFrom) appliedFilters['Desde'] = req.query.dateFrom as string;
            if (req.query.dateTo) appliedFilters['Hasta'] = req.query.dateTo as string;

            const buffer = await ExcelExporter.generateReport({
                title: 'Reporte de Ventas',
                sheetName: 'Ventas',
                columns: [
                    { header: 'Fecha', key: 'date', width: 14, style: 'date' },
                    { header: 'Orden #', key: 'orderNumber', width: 15 },
                    { header: 'Producto', key: 'productName', width: 25 },
                    { header: 'Categoría', key: 'categoryName', width: 18 },
                    { header: 'Empresa/Marca', key: 'brandName', width: 18 },
                    { header: 'Cantidad', key: 'quantity', width: 10, style: 'number' },
                    { header: 'Precio Unit.', key: 'unitPrice', width: 14, style: 'currency' },
                    { header: 'Descuento', key: 'discount', width: 12, style: 'currency' },
                    { header: 'Total', key: 'totalSale', width: 14, style: 'currency' },
                    { header: 'Método Pago', key: 'paymentMethod', width: 16 },
                    { header: 'Usuario', key: 'userName', width: 18 },
                    { header: 'Sucursal', key: 'branchName', width: 18 },
                    { header: 'Empresa', key: 'companyName', width: 18 },
                ],
                data: data.items,
                filters: appliedFilters,
                summary: {
                    'Total Órdenes': data.summary.totalOrders,
                    'Ventas Totales': data.summary.totalSales,
                    'Descuento Total': data.summary.totalDiscount,
                    'Ticket Promedio': data.summary.averageTicket,
                },
                userName: req.user?.roleObj?.name || req.user?.role || 'Admin',
            });

            const date = new Date().toISOString().split('T')[0];
            sendExcelResponse(res, buffer, `reporte_ventas_${date}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    // ── Profitability Report ──
    static async getProfitabilityReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);

            const data = await ReportService.getProfitabilityReport(companyId, filters as any);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportProfitabilityReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);

            const data = await ReportService.getProfitabilityReport(companyId, filters as any);

            const buffer = await ExcelExporter.generateReport({
                title: 'Reporte de Rentabilidad por Producto',
                sheetName: 'Rentabilidad',
                columns: [
                    { header: 'Producto / Menú', key: 'menuItemName', width: 30 },
                    { header: 'Categoría', key: 'categoryName', width: 20 },
                    { header: 'Precio Venta', key: 'price', width: 14, style: 'currency' },
                    { header: 'Costo Estimado', key: 'estimatedCost', width: 16, style: 'currency' },
                    { header: 'Margen Bruto', key: 'grossMargin', width: 14, style: 'currency' },
                    { header: '% Margen', key: 'marginPercent', width: 12, style: 'percent' },
                    { header: 'Estado', key: 'status', width: 12 },
                ],
                data: data.items.map(i => ({ ...i, marginPercent: i.marginPercent / 100 })),
                summary: {
                    'Total Items': data.summary.totalItems,
                    'Margen Promedio': `${data.summary.avgMargin}%`,
                    'Bajo Margen': data.summary.lowMarginCount,
                },
                userName: req.user?.roleObj?.name || req.user?.role || 'Admin',
            });

            const date = new Date().toISOString().split('T')[0];
            sendExcelResponse(res, buffer, `reporte_rentabilidad_${date}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    // ── Low Stock Report ──
    static async getLowStockReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.warehouseId) filters.warehouseId = parseInt(req.query.warehouseId as string);
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);

            const data = await ReportService.getLowStockReport(companyId, filters as any);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportLowStockReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Record<string, unknown> = {};
            if (req.query.warehouseId) filters.warehouseId = parseInt(req.query.warehouseId as string);
            if (req.query.categoryId) filters.categoryId = parseInt(req.query.categoryId as string);

            const data = await ReportService.getLowStockReport(companyId, filters as any);

            const buffer = await ExcelExporter.generateReport({
                title: 'Reporte de Stock Bajo',
                sheetName: 'Stock Bajo',
                columns: [
                    { header: 'Producto', key: 'productName', width: 30 },
                    { header: 'Categoría', key: 'categoryName', width: 20 },
                    { header: 'Almacén', key: 'warehouseName', width: 20 },
                    { header: 'Stock Actual', key: 'currentStock', width: 14, style: 'number' },
                    { header: 'Stock Mínimo', key: 'minStock', width: 14, style: 'number' },
                    { header: 'Déficit', key: 'deficit', width: 12, style: 'number' },
                    { header: 'Unidad', key: 'unit', width: 10 },
                    { header: 'Criticidad', key: 'criticality', width: 12 },
                ],
                data: data.items,
                summary: {
                    'Total Bajo Stock': data.summary.totalLowStock,
                    'Crítico': data.summary.criticalCount,
                    'Advertencia': data.summary.warningCount,
                },
                userName: req.user?.roleObj?.name || req.user?.role || 'Admin',
            });

            const date = new Date().toISOString().split('T')[0];
            sendExcelResponse(res, buffer, `reporte_stock_bajo_${date}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
