import type { Request, Response } from 'express';
import { ReportProductionService } from '../services/report-production.service';
import { ExcelExporter, sendExcelResponse } from '../utils/excel-export';

function parseFilters(req: Request) {
    const { categoryId, warehouseId, branchId, dateFrom, dateTo, days } = req.query;
    const user = req.user!;
    const resolvedBranch = user.role === 'SUPERADMIN'
        ? (branchId ? Number(branchId) : undefined)
        : user.branchId || undefined;

    return {
        categoryId: categoryId ? Number(categoryId) : undefined,
        warehouseId: warehouseId ? Number(warehouseId) : undefined,
        branchId: resolvedBranch,
        dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
        dateTo: dateTo ? new Date(dateTo as string) : undefined,
        days: days ? Number(days) : undefined,
    };
}

export class ReportProductionController {
    static async getRecipeCostAnalysis(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const filters = parseFilters(req);
            const data = await ReportProductionService.getRecipeCostAnalysis(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async exportRecipeCostAnalysis(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const filters = parseFilters(req);
            const data = await ReportProductionService.getRecipeCostAnalysis(companyId, filters);

            const buffer = await ExcelExporter.generateReport({
                title: 'Análisis de Costos de Recetas',
                sheetName: 'Costos Recetas',
                columns: [
                    { header: 'Plato', key: 'menuItemName', width: 30 },
                    { header: 'Categoría', key: 'category', width: 18 },
                    { header: 'Precio', key: 'price', width: 12 },
                    { header: 'Costo', key: 'totalCost', width: 12 },
                    { header: 'Margen', key: 'margin', width: 12 },
                    { header: 'Margen %', key: 'marginPct', width: 10 },
                    { header: 'Food Cost %', key: 'foodCostPct', width: 12 },
                    { header: '# Ingredientes', key: 'ingredientCount', width: 14 },
                ],
                data: data.items,
                summary: data.summary,
                userName: req.user?.roleObj?.name || 'Admin',
            });

            sendExcelResponse(res, buffer, 'costos-recetas');
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async getProductionYield(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const filters = parseFilters(req);
            const data = await ReportProductionService.getProductionYield(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async exportProductionYield(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const filters = parseFilters(req);
            const data = await ReportProductionService.getProductionYield(companyId, filters);

            const buffer = await ExcelExporter.generateReport({
                title: 'Rendimiento de Producción',
                sheetName: 'Rendimiento',
                columns: [
                    { header: 'Plato', key: 'menuItemName', width: 30 },
                    { header: 'Categoría', key: 'category', width: 18 },
                    { header: 'Porciones Posibles', key: 'maxPortions', width: 18 },
                    { header: 'Ingrediente Limitante', key: 'limitingIngredient', width: 25 },
                    { header: '# Ingredientes', key: 'ingredientCount', width: 14 },
                ],
                data: data.items,
                summary: data.summary,
                userName: req.user?.roleObj?.name || 'Admin',
            });

            sendExcelResponse(res, buffer, 'rendimiento-produccion');
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async getMenuEngineering(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const filters = parseFilters(req);
            const data = await ReportProductionService.getMenuEngineering(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async exportMenuEngineering(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const filters = parseFilters(req);
            const data = await ReportProductionService.getMenuEngineering(companyId, filters);

            const buffer = await ExcelExporter.generateReport({
                title: 'Ingeniería de Menú (Productos Estrella)',
                sheetName: 'Menu Engineering',
                columns: [
                    { header: 'Plato', key: 'menuItemName', width: 30 },
                    { header: 'Categoría', key: 'category', width: 18 },
                    { header: 'Clasificación', key: 'classification', width: 14 },
                    { header: 'Precio', key: 'price', width: 12 },
                    { header: 'Costo', key: 'cost', width: 12 },
                    { header: 'Margen', key: 'margin', width: 12 },
                    { header: 'Qty Vendida', key: 'qtySold', width: 12 },
                    { header: 'Ingresos', key: 'revenue', width: 14 },
                    { header: 'Ganancia Total', key: 'totalProfit', width: 14 },
                ],
                data: data.items,
                summary: data.summary,
                userName: req.user?.roleObj?.name || 'Admin',
            });

            sendExcelResponse(res, buffer, 'ingenieria-menu');
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async getPurchaseProjection(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const filters = parseFilters(req);
            const data = await ReportProductionService.getPurchaseProjection(companyId, filters);
            res.json({ success: true, data });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async exportPurchaseProjection(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const filters = parseFilters(req);
            const data = await ReportProductionService.getPurchaseProjection(companyId, filters);

            const buffer = await ExcelExporter.generateReport({
                title: 'Proyección de Compras',
                sheetName: 'Proyección',
                columns: [
                    { header: 'Producto', key: 'productName', width: 28 },
                    { header: 'Categoría', key: 'category', width: 18 },
                    { header: 'Unidad', key: 'unit', width: 10 },
                    { header: 'Stock Actual', key: 'currentStock', width: 13 },
                    { header: 'Uso Diario', key: 'dailyUsage', width: 12 },
                    { header: 'Necesidad Proyectada', key: 'projectedNeed', width: 18 },
                    { header: 'Compra Sugerida', key: 'suggestedPurchase', width: 16 },
                    { header: 'Días p/ Agotarse', key: 'daysUntilStockout', width: 16 },
                    { header: 'Costo Estimado', key: 'estimatedCost', width: 14 },
                ],
                data: data.items,
                summary: data.summary,
                userName: req.user?.roleObj?.name || 'Admin',
            });

            sendExcelResponse(res, buffer, 'proyeccion-compras');
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }
}
