import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { ReportService } from '../../services/report.service';

describe('ReportService.getSalesReport reconciliation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reconciles order metrics and counts only orders matching item filters', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            {
                id: 1, createdAt: new Date('2026-01-01'), invoiceNumber: 'F-1',
                discount: 10, tax: 13.5, tipAmount: 5, total: 98.5,
                payments: [{ amount: 98.5, paymentMethod: { name: 'Efectivo' } }],
                user: { name: 'Ana' }, branch: { name: 'Centro' }, company: { name: 'Demo' },
                items: [
                    { quantity: 1, price: 60, subtotal: 60, menuItem: { name: 'A', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } } },
                    { quantity: 1, price: 30, subtotal: 30, menuItem: { name: 'B', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } } },
                ],
            },
            {
                id: 2, createdAt: new Date('2026-01-01'), invoiceNumber: 'F-2',
                discount: 0, tax: 15, tipAmount: 0, total: 115,
                payments: [{ amount: 115, paymentMethod: { name: 'Tarjeta' } }],
                user: { name: 'Luis' }, branch: { name: 'Centro' }, company: { name: 'Demo' },
                items: [{ quantity: 1, price: 100, subtotal: 100, menuItem: { name: 'C', categoryId: 8, brandId: 1, category: { name: 'Otra' }, brand: { name: 'Marca' } } }],
            },
        ] as never);

        const result = await ReportService.getSalesReport(3, { categoryId: 7 });

        expect(result.summary).toMatchObject({
            totalOrders: 1,
            totalSales: 90,
            netItemSales: 90,
            orderDiscount: 10,
            tax: 13.5,
            tip: 5,
            grossOrderTotal: 98.5,
            collected: 98.5,
            averageTicket: 98.5,
        });
        expect(result.summary.netItemSales - result.summary.orderDiscount + result.summary.tax + result.summary.tip)
            .toBe(result.summary.grossOrderTotal);
        expect(result.items.map((item) => item.discount)).toEqual([10, 0]);
    });
});
