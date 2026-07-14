import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ProductionReportService } from '../../services/production-report.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Production physical report reconciliation', () => {
    it('keeps cancelled orders in audit counts but excludes reversed quantities and costs', async () => {
        jest.spyOn(prisma.productionOrder, 'findMany').mockResolvedValue([
            { status: 'FINISHED', plannedQuantity: 10, producedQuantity: 9, estimatedCost: 50, realCost: 55, product: { unit: 'kg', baseUnit: null } },
            { status: 'CANCELLED', plannedQuantity: 20, producedQuantity: 20, estimatedCost: 100, realCost: 110, product: { unit: 'l', baseUnit: null } },
            { status: 'PENDING', plannedQuantity: 5, producedQuantity: 0, estimatedCost: 25, realCost: 0, product: { unit: 'kg', baseUnit: null } }
        ] as never);

        const report = await ProductionReportService.getProductions(1, {});

        expect(report.summary).toEqual({
            count: 3, finished: 1, cancelled: 1,
            totalPlanned: 15, totalProduced: 9,
            totalEstimatedCost: 75, totalRealCost: 55,
            plannedQuantities: [{ unit: 'kg', quantity: 15 }],
            producedQuantities: [{ unit: 'kg', quantity: 9 }],
            mixedOutputUnits: false
        });
    });

    it('does not add planned or produced quantities across output units', async () => {
        jest.spyOn(prisma.productionOrder, 'findMany').mockResolvedValue([
            { status: 'FINISHED', plannedQuantity: 2, producedQuantity: 1.5, estimatedCost: 10, realCost: 11, product: { unit: 'kg', baseUnit: null } },
            { status: 'FINISHED', plannedQuantity: 3, producedQuantity: 2.5, estimatedCost: 20, realCost: 21, product: { unit: 'l', baseUnit: null } }
        ] as never);

        const report = await ProductionReportService.getProductions(1, {});

        expect(report.summary.totalPlanned).toBeNull();
        expect(report.summary.totalProduced).toBeNull();
        expect(report.summary.plannedQuantities).toEqual([
            { unit: 'kg', quantity: 2 },
            { unit: 'l', quantity: 3 }
        ]);
        expect(report.summary.producedQuantities).toEqual([
            { unit: 'kg', quantity: 1.5 },
            { unit: 'l', quantity: 2.5 }
        ]);
        expect(report.summary.mixedOutputUnits).toBe(true);
    });

    it('returns only output movements in the produced-product kardex and applies branch scope', async () => {
        const findMany = jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            { id: 1, productId: 10, reference: 'PROD-7' },
            { id: 2, productId: 20, reference: 'PROD-7' }
        ] as never);
        jest.spyOn(prisma.productionOrder, 'findMany').mockResolvedValue([{ id: 7, productId: 10 }] as never);

        const report = await ProductionReportService.getProducedKardex(1, { branchId: 2 });

        expect(report.items.map((item) => item.id)).toEqual([1]);
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ warehouse: { OR: [{ branchId: 2 }, { branchId: null }] } })
        }));
    });

    it('uses consumed FIFO source refs for traceability instead of unrelated recent productions', async () => {
        jest.spyOn(prisma.productionOrder, 'findFirst').mockResolvedValue({
            id: 9, companyId: 1, productId: 30,
            product: { id: 30, name: 'Pizza', sku: 'PIZ', type: 'PRODUCT_FOR_SALE' },
            warehouse: { id: 1, name: 'Cocina' }, user: { id: 1, name: 'Chef' },
            items: [{
                componentProductId: 20,
                componentProduct: { id: 20, name: 'Masa', sku: 'MAS', type: 'INTERMEDIATE' },
                consumedQuantity: 2, unit: 'kg', unitCost: 3, totalCost: 6,
                consumedLayers: [{ sourceRef: 'PROD-3', quantity: 2, unitCost: 3 }]
            }]
        } as never);
        const sources = jest.spyOn(prisma.productionOrder, 'findMany').mockResolvedValue([
            { id: 3, code: 'PRD-3', productId: 20, producedQuantity: 5, realUnitCost: 3, finishedAt: new Date() }
        ] as never);

        const result = await ProductionReportService.getTraceability(1, 9);

        expect(result.inputs[0].sourceProductions.map((source) => source.id)).toEqual([3]);
        expect(sources).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 1, id: { in: [3] } } }));
    });
});
