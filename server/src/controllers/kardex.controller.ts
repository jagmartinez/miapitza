import { Request, Response } from 'express';
import { KardexService } from '../services/kardex.service';
import { getErrorMessage } from '../utils/error';
import { resolveBranchScope, BranchScopeError } from '../utils/branch-scope';
import { parseOptionalQueryDateFrom, parseOptionalQueryDateTo } from '../utils/date-range';

export class KardexController {
    /**
     * Generate Kardex report for a product
     * GET /api/reports/kardex?productId=1&warehouseId=1&dateFrom=2026-01-01&dateTo=2026-01-31
     */
    static async getKardex(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const productId = parseInt(req.query.productId as string);
            const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined;
            const requestedBranch = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requestedBranch);
            const dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string | undefined, req.user!.timezone);
            const dateTo = parseOptionalQueryDateTo(req.query.dateTo as string | undefined, req.user!.timezone);
            const type = req.query.type as 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER' | undefined;

            if (!productId) {
                return res.status(400).json({ error: 'productId es requerido' });
            }

            const kardex = await KardexService.generateKardex(companyId, {
                productId,
                warehouseId,
                branchId,
                dateFrom,
                dateTo,
                type
            });

            res.json(kardex);
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            console.error('[KardexController] Error getting kardex:', error);
            res.status(500).json({ error: getErrorMessage(error) });
        }
    }

    /**
     * Generate Kardex summary for multiple products
     * GET /api/reports/kardex/summary?warehouseId=1&categoryId=1
     */
    static async getKardexSummary(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined;
            const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
            const requestedBranch = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requestedBranch);
            const dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string | undefined, req.user!.timezone);
            const dateTo = parseOptionalQueryDateTo(req.query.dateTo as string | undefined, req.user!.timezone);

            const summary = await KardexService.generateKardexSummary(companyId, {
                warehouseId,
                categoryId,
                branchId,
                dateFrom,
                dateTo
            });

            res.json(summary);
        } catch (error: unknown) {
            if (error instanceof BranchScopeError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            console.error('[KardexController] Error getting kardex summary:', error);
            res.status(500).json({ error: getErrorMessage(error) });
        }
    }

    /**
     * Export Kardex to Excel
     * GET /api/reports/kardex/export?productId=1&warehouseId=1
     */
    static async exportKardex(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const productId = parseInt(req.query.productId as string);
            const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined;
            const requestedBranch = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
            const branchId = resolveBranchScope(req.user!, requestedBranch);
            const dateFrom = parseOptionalQueryDateFrom(req.query.dateFrom as string | undefined, req.user!.timezone);
            const dateTo = parseOptionalQueryDateTo(req.query.dateTo as string | undefined, req.user!.timezone);

            if (!productId) {
                return res.status(400).json({ error: 'productId es requerido' });
            }

            const buffer = await KardexService.exportToExcel(companyId, {
                productId,
                warehouseId,
                branchId,
                dateFrom,
                dateTo
            });

            // Get product name for filename
            const kardex = await KardexService.generateKardex(companyId, { productId });
            const filename = `Kardex_${kardex.product.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
        } catch (error: unknown) {
            console.error('[KardexController] Error exporting kardex:', error);
            res.status(500).json({ error: getErrorMessage(error) });
        }
    }
}
