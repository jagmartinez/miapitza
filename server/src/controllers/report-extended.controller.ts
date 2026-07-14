import { Request, Response, NextFunction } from 'express';
import { ReportExtendedService } from '../services/report-extended.service';
import { ExcelExporter, sendExcelResponse } from '../utils/excel-export';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope } from '../utils/branch-scope';
import { parseOptionalQueryDateFrom, parseOptionalQueryDateTo } from '../utils/date-range';

const parseCategoryIds = (value: unknown): number[] | undefined => {
    if (typeof value !== 'string') return undefined;
    const ids = [...new Set(value.split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    return ids.length > 0 ? ids : undefined;
};

export class ReportExtendedController {
    private static parseFilters(req: Request) {
        const branchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
        return {
            dateFrom: parseOptionalQueryDateFrom(req.query.dateFrom as string | undefined, req.user!.timezone),
            dateTo: parseOptionalQueryDateTo(req.query.dateTo as string | undefined, req.user!.timezone),
            branchId: resolveBranchScope(req.user!, branchId),
            supplierId: req.query.supplierId ? parseInt(req.query.supplierId as string) : undefined,
            categoryId: req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined,
            categoryIds: parseCategoryIds(req.query.categoryIds),
            productId: req.query.productId ? parseInt(req.query.productId as string) : undefined,
            userId: req.query.userId ? parseInt(req.query.userId as string) : undefined,
            salesChannel: req.query.salesChannel as string | undefined,
            limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        };
    }

    private static buildAppliedFilters(req: Request): Record<string, string> {
        const f: Record<string, string> = {};
        if (req.query.dateFrom) f['Desde'] = req.query.dateFrom as string;
        if (req.query.dateTo) f['Hasta'] = req.query.dateTo as string;
        if (req.query.branchId) f['Sucursal ID'] = req.query.branchId as string;
        if (req.query.supplierId) f['Proveedor ID'] = req.query.supplierId as string;
        if (req.query.categoryId) f['Categoría ID'] = req.query.categoryId as string;
        if (req.query.categoryIds) f['Categorías ID'] = req.query.categoryIds as string;
        return f;
    }

    private static userName(req: Request): string {
        return req.user?.roleObj?.name || req.user?.role || 'Admin';
    }

    private static dateStamp(): string {
        return new Date().toISOString().split('T')[0];
    }

    // ═══════════════════════════════════════════════════════════
    // PURCHASES
    // ═══════════════════════════════════════════════════════════

    static async getPurchasesByDay(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getPurchasesByDay(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportPurchasesByDay(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getPurchasesByDay(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Compras por Día',
                sheetName: 'Compras Diarias',
                columns: [
                    { header: 'Fecha', key: 'date', width: 14, style: 'date' },
                    { header: 'Monto Total', key: 'totalAmount', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: '# Items', key: 'itemCount', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Días': data.summary.totalDays,
                    'Monto Total': data.summary.totalAmount,
                    'Total OC': data.summary.totalOrders,
                    'Promedio Diario': data.summary.avgPerDay,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `compras_por_dia_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getPurchasesByMonth(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getPurchasesByMonth(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportPurchasesByMonth(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getPurchasesByMonth(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Compras por Mes',
                sheetName: 'Compras Mensuales',
                columns: [
                    { header: 'Mes', key: 'month', width: 14 },
                    { header: 'Monto Total', key: 'totalAmount', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Meses': data.summary.totalMonths,
                    'Monto Total': data.summary.totalAmount,
                    'Total OC': data.summary.totalOrders,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `compras_por_mes_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getPriceComparison(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getPriceComparison(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportPriceComparison(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getPriceComparison(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Comparación de Precios por Proveedor',
                sheetName: 'Comparación Precios',
                columns: [
                    { header: 'Producto', key: 'productName', width: 25 },
                    { header: 'SKU', key: 'sku', width: 14 },
                    { header: 'Categoría', key: 'categoryName', width: 18 },
                    { header: 'Proveedor', key: 'supplierName', width: 22 },
                    { header: 'Costo Prom.', key: 'avgCost', width: 14, style: 'currency' },
                    { header: 'Costo Mín.', key: 'minCost', width: 14, style: 'currency' },
                    { header: 'Costo Máx.', key: 'maxCost', width: 14, style: 'currency' },
                    { header: 'Variación %', key: 'priceVariation', width: 14, style: 'number' },
                    { header: 'Qty Total', key: 'totalQuantity', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Productos': data.summary.totalProducts,
                    'Total Comparaciones': data.summary.totalComparisons,
                    'Variación Promedio': `${data.summary.avgVariation}%`,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `comparacion_precios_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getMostPurchasedProducts(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getMostPurchasedProducts(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportMostPurchasedProducts(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getMostPurchasedProducts(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Productos Más Comprados',
                sheetName: 'Más Comprados',
                columns: [
                    { header: 'Producto', key: 'productName', width: 28 },
                    { header: 'SKU', key: 'sku', width: 14 },
                    { header: 'Unidad', key: 'unit', width: 10 },
                    { header: 'Categoría', key: 'categoryName', width: 18 },
                    { header: 'Qty Total', key: 'totalQuantity', width: 14, style: 'number' },
                    { header: 'Costo Total', key: 'totalCost', width: 16, style: 'currency' },
                    { header: 'Costo Unit. Prom.', key: 'avgUnitCost', width: 16, style: 'currency' },
                    { header: '# OC', key: 'orderCount', width: 10, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Productos': data.summary.totalProducts,
                    'Total Gastado': data.summary.totalSpent,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `productos_mas_comprados_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getPurchasesBySupplier(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getPurchasesBySupplier(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportPurchasesBySupplier(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getPurchasesBySupplier(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Compras por Proveedor',
                sheetName: 'Por Proveedor',
                columns: [
                    { header: 'Proveedor', key: 'supplierName', width: 28 },
                    { header: 'Monto Total', key: 'totalAmount', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: 'Prom. por OC', key: 'avgPerOrder', width: 16, style: 'currency' },
                    { header: '% del Total', key: 'percentOfTotal', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Proveedores': data.summary.totalSuppliers,
                    'Monto Total': data.summary.totalAmount,
                    'Top Proveedor': data.summary.topSupplier,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `compras_por_proveedor_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SALES
    // ═══════════════════════════════════════════════════════════

    static async getSalesByCategory(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByCategory(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesByCategory(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByCategory(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas por Categoría',
                sheetName: 'Por Categoría',
                columns: [
                    { header: 'Categoría', key: 'categoryName', width: 22 },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                    { header: '% del Total', key: 'percentOfTotal', width: 12, style: 'number' },
                    { header: '# Items', key: 'itemCount', width: 12, style: 'number' },
                    { header: 'Unidades', key: 'unitsSold', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Categorías': data.summary.totalCategories,
                    'Ventas Totales': data.summary.totalSales,
                    'Top Categoría': data.summary.topCategory,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_por_categoria_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesByProduct(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ReportExtendedService.getSalesByProduct(req.user!.companyId, ReportExtendedController.parseFilters(req));
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesByProduct(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await ReportExtendedService.getSalesByProduct(req.user!.companyId, ReportExtendedController.parseFilters(req));
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas por Producto',
                sheetName: 'Ventas por Producto',
                columns: [
                    { header: 'Producto', key: 'productName', width: 28 },
                    { header: 'Categoría', key: 'categoryName', width: 20 },
                    { header: 'Unidades', key: 'unitsSold', width: 12, style: 'number' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: '# Líneas', key: 'lineCount', width: 12, style: 'number' },
                    { header: 'Precio Prom.', key: 'averageUnitPrice', width: 16, style: 'currency' },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Productos': data.summary.totalProducts,
                    'Unidades Vendidas': data.summary.totalUnits,
                    'Total Órdenes': data.summary.totalOrders,
                    'Ventas Totales': data.summary.totalSales,
                    'Producto Líder': data.summary.topProduct,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_por_producto_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesByBrand(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByBrand(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesByBrand(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByBrand(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas por Empresa (Marca)',
                sheetName: 'Por Empresa',
                columns: [
                    { header: 'Empresa / Marca', key: 'brandName', width: 24 },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                    { header: '% del Total', key: 'percentOfTotal', width: 12, style: 'number' },
                    { header: '# Items', key: 'itemCount', width: 12, style: 'number' },
                    { header: 'Unidades', key: 'unitsSold', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Empresas': data.summary.totalBrands,
                    'Ventas Totales': data.summary.totalSales,
                    'Top Empresa': data.summary.topBrand,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_por_empresa_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesDaily(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesDaily(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesDaily(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesDaily(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas Diarias',
                sheetName: 'Ventas Diarias',
                columns: [
                    { header: 'Fecha', key: 'date', width: 14, style: 'date' },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: 'Ticket Prom.', key: 'avgTicket', width: 14, style: 'currency' },
                    { header: 'Descuentos', key: 'totalDiscount', width: 14, style: 'currency' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Días': data.summary.totalDays,
                    'Ventas Totales': data.summary.totalSales,
                    'Total Órdenes': data.summary.totalOrders,
                    'Promedio Diario': data.summary.avgDailySales,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_diarias_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesMonthly(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesMonthly(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesMonthly(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesMonthly(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas Mensuales',
                sheetName: 'Ventas Mensuales',
                columns: [
                    { header: 'Mes', key: 'month', width: 14 },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: 'Ticket Prom.', key: 'avgTicket', width: 14, style: 'currency' },
                    { header: 'Variación %', key: 'variationPct', width: 14, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Meses': data.summary.totalMonths,
                    'Ventas Totales': data.summary.totalSales,
                    'Total Órdenes': data.summary.totalOrders,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_mensuales_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesByPaymentMethod(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByPaymentMethod(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesByPaymentMethod(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByPaymentMethod(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas por Método de Pago',
                sheetName: 'Método Pago',
                columns: [
                    { header: 'Método de Pago', key: 'methodName', width: 22 },
                    { header: 'Monto Total', key: 'totalAmount', width: 16, style: 'currency' },
                    { header: '# Transacciones', key: 'transactionCount', width: 16, style: 'number' },
                    { header: '% del Total', key: 'percentOfTotal', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Métodos': data.summary.totalMethods,
                    'Monto Total': data.summary.totalAmount,
                    'Método Dominante': data.summary.dominantMethod,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_metodo_pago_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesByWaiter(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByWaiter(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesByWaiter(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByWaiter(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas por Mesero/Usuario',
                sheetName: 'Por Mesero',
                columns: [
                    { header: 'Usuario', key: 'userName', width: 22 },
                    { header: 'Rol', key: 'roleName', width: 16 },
                    { header: 'Sucursal', key: 'branchName', width: 18 },
                    { header: 'Empresa', key: 'companyName', width: 18 },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: 'Ticket Prom.', key: 'avgTicket', width: 14, style: 'currency' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Usuarios': data.summary.totalUsers,
                    'Ventas Totales': data.summary.totalSales,
                    'Top Mesero': data.summary.topWaiter,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_por_mesero_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesByChannel(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByChannel(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesByChannel(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByChannel(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas por Canal (Restaurante / Delivery / PedidosYa)',
                sheetName: 'Por Canal',
                columns: [
                    { header: 'Canal', key: 'channelName', width: 20 },
                    { header: 'Ventas Brutas', key: 'grossSales', width: 16, style: 'currency' },
                    { header: 'Comisión', key: 'commission', width: 14, style: 'currency' },
                    { header: 'Ingreso Neto', key: 'netIncome', width: 16, style: 'currency' },
                    { header: 'COGS Est.', key: 'estimatedCOGS', width: 14, style: 'currency' },
                    { header: 'Margen', key: 'margin', width: 14, style: 'currency' },
                    { header: 'Margen %', key: 'marginPct', width: 12, style: 'number' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: '% del Total', key: 'percentOfTotal', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Canales': data.summary.totalChannels,
                    'Ventas Brutas': data.summary.totalGrossSales,
                    'Total Comisiones': data.summary.totalCommissions,
                    'Ingreso Neto': data.summary.totalNetIncome,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_por_canal_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getSalesByHour(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByHour(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportSalesByHour(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getSalesByHour(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Ventas por Hora (Análisis de Horas Pico)',
                sheetName: 'Por Hora',
                columns: [
                    { header: 'Hora', key: 'hourLabel', width: 10 },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: 'Ticket Prom.', key: 'avgTicket', width: 14, style: 'currency' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Hora Pico': data.summary.peakHour,
                    'Ventas Hora Pico': data.summary.peakSales,
                    'Total Órdenes': data.summary.totalOrders,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `ventas_por_hora_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // COSTS
    // ═══════════════════════════════════════════════════════════

    static async getFoodCostByCategory(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getFoodCostByCategory(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportFoodCostByCategory(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getFoodCostByCategory(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Food Cost por Categoría',
                sheetName: 'Food Cost',
                columns: [
                    { header: 'Categoría', key: 'categoryName', width: 22 },
                    { header: 'Ingresos', key: 'revenue', width: 16, style: 'currency' },
                    { header: 'COGS', key: 'cogs', width: 14, style: 'currency' },
                    { header: 'Margen Bruto', key: 'grossMargin', width: 16, style: 'currency' },
                    { header: 'Food Cost %', key: 'foodCostPct', width: 14, style: 'number' },
                    { header: 'Margen %', key: 'marginPct', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Ingresos Totales': data.summary.totalRevenue,
                    'COGS Total': data.summary.totalCOGS,
                    'Food Cost General': `${data.summary.overallFoodCost}%`,
                    'Margen General': `${data.summary.overallMargin}%`,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `food_cost_categoria_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getMarginByProduct(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getMarginByProduct(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportMarginByProduct(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getMarginByProduct(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Margen por Producto (Más Rentables)',
                sheetName: 'Margen Producto',
                columns: [
                    { header: 'Producto', key: 'menuItemName', width: 28 },
                    { header: 'Categoría', key: 'categoryName', width: 18 },
                    { header: 'Ingresos', key: 'revenue', width: 16, style: 'currency' },
                    { header: 'COGS', key: 'cogs', width: 14, style: 'currency' },
                    { header: 'Margen', key: 'margin', width: 14, style: 'currency' },
                    { header: 'Margen %', key: 'marginPct', width: 12, style: 'number' },
                    { header: 'Food Cost %', key: 'foodCostPct', width: 14, style: 'number' },
                    { header: 'Uds. Vendidas', key: 'unitsSold', width: 14, style: 'number' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Productos': data.summary.totalProducts,
                    'Ingresos Totales': data.summary.totalRevenue,
                    'Margen Total': data.summary.totalMargin,
                    'Más Rentable': data.summary.mostProfitable,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `margen_por_producto_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // AUDIT
    // ═══════════════════════════════════════════════════════════

    static async getAuditReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Parameters<typeof ReportExtendedService.getAuditReport>[1] = {};
            if (req.query.dateFrom) filters.dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string, req.user!.timezone);
            if (req.query.dateTo) filters.dateTo = parseOptionalQueryDateTo(req.query.dateTo as string, req.user!.timezone);
            if (req.query.userId) filters.userId = parseInt(req.query.userId as string);
            if (req.query.entityType) filters.entityType = req.query.entityType as string;
            if (req.query.action) filters.action = req.query.action as string;
            if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
            const data = await ReportExtendedService.getAuditReport(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportAuditReport(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters: Parameters<typeof ReportExtendedService.getAuditReport>[1] = {};
            if (req.query.dateFrom) filters.dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string, req.user!.timezone);
            if (req.query.dateTo) filters.dateTo = parseOptionalQueryDateTo(req.query.dateTo as string, req.user!.timezone);
            if (req.query.userId) filters.userId = parseInt(req.query.userId as string);
            if (req.query.entityType) filters.entityType = req.query.entityType as string;
            if (req.query.action) filters.action = req.query.action as string;
            const data = await ReportExtendedService.getAuditReport(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Registro de Auditoría',
                sheetName: 'Auditoría',
                columns: [
                    { header: 'Fecha', key: 'date', width: 18, style: 'date' },
                    { header: 'Usuario', key: 'userName', width: 20 },
                    { header: 'Rol', key: 'roleName', width: 14 },
                    { header: 'Entidad', key: 'entityType', width: 16 },
                    { header: 'ID Entidad', key: 'entityId', width: 12, style: 'number' },
                    { header: 'Acción', key: 'action', width: 16 },
                    { header: 'Detalles', key: 'details', width: 40 },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Total Eventos': data.summary.totalEvents,
                    'Usuarios Únicos': data.summary.uniqueUsers,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `auditoria_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DECISION
    // ═══════════════════════════════════════════════════════════

    static async getDayAnalysis(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getDayAnalysis(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportDayAnalysis(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const filters = ReportExtendedController.parseFilters(req);
            const data = await ReportExtendedService.getDayAnalysis(companyId, filters);
            const buffer = await ExcelExporter.generateReport({
                title: 'Análisis por Día de la Semana',
                sheetName: 'Análisis Días',
                columns: [
                    { header: 'Ranking', key: 'rank', width: 10, style: 'number' },
                    { header: 'Día', key: 'dayName', width: 14 },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                    { header: 'Prom. Diario', key: 'avgDailySales', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                    { header: 'Ticket Prom.', key: 'avgTicket', width: 14, style: 'currency' },
                ],
                data: data.items,
                filters: ReportExtendedController.buildAppliedFilters(req),
                summary: {
                    'Día Más Fuerte': data.summary.strongestDay,
                    'Día Más Débil': data.summary.weakestDay,
                    'Total Órdenes': data.summary.totalOrders,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `analisis_dias_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async getMonthComparison(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const branchRaw = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, branchRaw);
            const monthA = req.query.monthA as string | undefined;
            const monthB = req.query.monthB as string | undefined;
            const data = await ReportExtendedService.getMonthComparison(companyId, { branchId, monthA, monthB });
            res.json({ success: true, data });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async exportMonthComparison(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const branchRaw = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, branchRaw);
            const monthA = req.query.monthA as string | undefined;
            const monthB = req.query.monthB as string | undefined;
            const data = await ReportExtendedService.getMonthComparison(companyId, { branchId, monthA, monthB });
            const buffer = await ExcelExporter.generateReport({
                title: 'Comparación Mes vs Mes',
                sheetName: 'Comparación Meses',
                columns: [
                    { header: 'Mes', key: 'month', width: 14 },
                    { header: 'Etiqueta', key: 'label', width: 16 },
                    { header: 'Ventas Totales', key: 'totalSales', width: 16, style: 'currency' },
                    { header: '# Órdenes', key: 'orderCount', width: 12, style: 'number' },
                ],
                data: data.items,
                filters: {
                    ...(monthA ? { 'Mes A': monthA } : {}),
                    ...(monthB ? { 'Mes B': monthB } : {}),
                },
                summary: {
                    'Ventas Mes A': data.summary.salesMonthA,
                    'Ventas Mes B': data.summary.salesMonthB,
                    'Variación Absoluta': data.summary.absoluteVariation,
                    'Variación %': `${data.summary.percentVariation}%`,
                },
                userName: ReportExtendedController.userName(req),
            });
            sendExcelResponse(res, buffer, `comparacion_meses_${ReportExtendedController.dateStamp()}.xlsx`);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
