import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportExtendedService } from '../../services/report-extended.service';
import { ReportService } from '../../services/report.service';

const purchase = {
    id: 1,
    companyId: 1,
    branchId: 2,
    supplierId: 3,
    date: new Date('2026-07-15T12:00:00.000Z'),
    invoiceNumber: 'PO-1',
    status: 'RECEIVED',
    supplier: { id: 3, name: 'Proveedor' },
    branch: { id: 2, name: 'Centro' },
    items: [
        {
            productId: 10,
            quantity: 2,
            cost: 10,
            baseQuantity: 10,
            baseCost: 2,
            subtotal: 20,
            product: {
                id: 10, name: 'Harina', sku: 'HAR', unit: 'kg', categoryId: 8,
                currentAverageCost: 2, baseUnit: { abbreviation: 'kg' }, category: { id: 8, name: 'Insumos' }
            }
        },
        {
            productId: 11,
            quantity: 3,
            cost: 10,
            baseQuantity: null,
            baseCost: null,
            subtotal: 30,
            product: {
                id: 11, name: 'Aceite legado', sku: 'ACE', unit: 'l', categoryId: 8,
                currentAverageCost: 9, baseUnit: { abbreviation: 'ml' }, category: { id: 8, name: 'Insumos' }
            }
        }
    ]
};

afterEach(() => {
    jest.restoreAllMocks();
});

describe('purchase reporting UOM integrity', () => {
    it('keeps legacy money in the cost total but excludes its incomparable physical quantity', async () => {
        jest.spyOn(prisma.purchaseOrder, 'findMany').mockResolvedValue([purchase] as never);
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);

        const report = await ReportService.getCostReport(1);

        expect(report.summary).toEqual(expect.objectContaining({
            totalPurchaseCost: 50,
            excludedLegacyPurchaseLines: 1,
            excludedLegacyPurchaseAmount: 30,
        }));
        expect(report.byProduct).toHaveLength(1);
        expect(report.byProduct[0]).toEqual(expect.objectContaining({
            productId: 10,
            totalQuantity: 10,
            totalCost: 20,
            avgUnitCost: 2,
        }));
    });

    it('labels a legacy purchase row instead of presenting purchase-UOM values as base UOM', async () => {
        jest.spyOn(prisma.purchaseOrder, 'findMany').mockResolvedValue([purchase] as never);

        const report = await ReportService.getPurchasesReport(1);
        const legacy = report.items.find((item) => item.productName === 'Aceite legado');

        expect(legacy).toEqual(expect.objectContaining({
            quantity: null,
            unitCost: null,
            unit: 'UOM no normalizada',
            totalCost: 30,
            dataQuality: 'LEGACY_UOM_MISSING',
        }));
        expect(report.summary).toEqual(expect.objectContaining({ legacyUomLines: 1, legacyUomAmount: 30 }));
    });

    it('exposes excluded legacy money in supplier comparison and most-purchased summaries', async () => {
        jest.spyOn(prisma.purchaseOrder, 'findMany').mockResolvedValue([purchase] as never);

        const comparison = await ReportExtendedService.getPriceComparison(1);
        const mostPurchased = await ReportExtendedService.getMostPurchasedProducts(1);

        expect(comparison.items).toHaveLength(1);
        expect(comparison.summary).toEqual(expect.objectContaining({ excludedLegacyLines: 1, excludedLegacyAmount: 30 }));
        expect(mostPurchased.items).toHaveLength(1);
        expect(mostPurchased.summary).toEqual(expect.objectContaining({
            totalSpent: 50,
            normalizedSpent: 20,
            excludedLegacyLines: 1,
            excludedLegacyAmount: 30,
        }));
    });
});
