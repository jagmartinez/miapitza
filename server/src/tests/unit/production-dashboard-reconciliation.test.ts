import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ProductionReportService } from '../../services/production-report.service';

afterEach(() => { jest.restoreAllMocks(); });

describe('ProductionReportService.getDashboard reconciliation', () => {
    it('separates planned orders from finished-period realized metrics and preserves units', async () => {
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: 'America/Managua' } as never);
        const finishedAt = new Date('2026-07-10T18:00:00.000Z');
        const common = {
            companyId: 1,
            branchId: 2,
            productId: 10,
            product: { id: 10, name: 'Salsa', sku: 'SAL', type: 'INTERMEDIATE', unit: 'kg', baseUnit: { abbreviation: 'kg' } },
            warehouse: { id: 1, name: 'Central' },
            branch: { id: 2, name: 'Bamboo' },
            userId: 3,
            user: { id: 3, name: 'Operario' },
            items: [],
            plannedQuantity: 10,
            producedQuantity: 9,
            estimatedCost: 35,
            realCost: 40,
            date: new Date('2026-07-09T18:00:00.000Z'),
            finishedAt
        };
        const plannedOrders = [
            { ...common, id: 1, code: 'PRD-1', status: 'FINISHED' },
            { ...common, id: 2, code: 'PRD-2', status: 'CANCELLED', producedQuantity: 50, realCost: 999, finishedAt: null }
        ];
        const realizedOrders = [{ ...common, id: 1, code: 'PRD-1', status: 'FINISHED' }];

        const findMany = jest.spyOn(prisma.productionOrder, 'findMany')
            .mockResolvedValueOnce(plannedOrders as never)
            .mockResolvedValueOnce(realizedOrders as never);
        jest.spyOn(prisma.productionRecipe, 'count').mockResolvedValue(1);
        jest.spyOn(prisma.product, 'count').mockResolvedValue(1);

        const result = await ProductionReportService.getDashboard(1, {});

        expect(result.kpis.total).toBe(2);
        expect(result.kpis.cancelled).toBe(1);
        expect(result.kpis.realizedOrders).toBe(1);
        expect(result.kpis.totalRealCost).toBe(40);
        expect(result.kpis.avgRealOrderCost).toBe(40);
        expect(result.topProduced[0]).toEqual(expect.objectContaining({ produced: 9, unit: 'kg' }));
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'FINISHED' }),
            orderBy: { finishedAt: 'desc' }
        }));
    });
});
