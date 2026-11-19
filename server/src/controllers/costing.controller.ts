import { Request, Response, NextFunction } from 'express';
import { CostingService } from '../services/costing.service';
import prisma from '../utils/prisma';

export class CostingController {
    /**
     * Get cost history for a specific product
     * GET /api/products/:id/cost-history
     */
    static async getCostHistory(req: Request, res: Response, next: NextFunction) {
        try {
            const productId = parseInt(req.params.id);
            const companyId = req.user!.companyId;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

            const history = await CostingService.getCostHistory(productId, companyId, limit);

            res.json(history);
        } catch (error: unknown) {
            console.error('[CostingController] Error getting cost history:', error);
            next(error);
        }
    }

    /**
     * Get costing method for the company
     * GET /api/settings/costing-method
     */
    static async getCostingMethod(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;

            const company = await prisma.company.findUnique({
                where: { id: companyId },
                select: { costingMethod: true }
            });

            if (!company) {
                return res.status(404).json({ error: 'Empresa no encontrada' });
            }

            res.json({ costingMethod: company.costingMethod });
        } catch (error: unknown) {
            console.error('[CostingController] Error getting costing method:', error);
            next(error);
        }
    }

    /**
     * Update costing method for the company
     * PUT /api/settings/costing-method
     */
    static async updateCostingMethod(req: Request, res: Response, next: NextFunction) {
        try {
            const companyId = req.user!.companyId;
            const { costingMethod } = req.body;

            if (!['WEIGHTED_AVERAGE', 'FIFO'].includes(costingMethod)) {
                return res.status(400).json({
                    error: 'Método de costeo inválido. Debe ser WEIGHTED_AVERAGE o FIFO'
                });
            }

            const company = await CostingService.updateCostingMethod(companyId, costingMethod);

            res.json(company);
        } catch (error: unknown) {
            console.error('[CostingController] Error updating costing method:', error);
            next(error);
        }
    }

}
