import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportService } from '../../services/report.service';

afterEach(() => { jest.restoreAllMocks(); });
beforeEach(() => {
    jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
});

describe('Business Intelligence metric contracts', () => {
    it('limits the reservation funnel stage to the current tenant-local day', async () => {
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: 'America/Managua' } as never);
        const reservationCount = jest.spyOn(prisma.reservation, 'count').mockResolvedValue(2);
        jest.spyOn(prisma.order, 'count').mockResolvedValue(1);
        jest.spyOn(prisma.order, 'groupBy').mockResolvedValue([] as never);

        jest.useFakeTimers({ now: new Date('2026-07-16T02:00:00.000Z') });
        try {
            await ReportService.getConversionFunnel(1, 3);
        } finally {
            jest.useRealTimers();
        }

        expect(reservationCount).toHaveBeenCalledWith({
            where: {
                companyId: 1,
                branchId: 3,
                date: {
                    gte: new Date('2026-07-15T06:00:00.000Z'),
                    lt: new Date('2026-07-16T06:00:00.000Z')
                }
            }
        });
    });

    it('groups relative demand in the company timezone and applies the selected period', async () => {
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: 'America/Managua' } as never);
        const orderLookup = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            { createdAt: new Date('2026-07-10T02:00:00.000Z') }
        ] as never);

        const result = await ReportService.getOccupancyHeatmap(1, 2, 'year');

        // 02:00 UTC is 20:00 Thursday in America/Managua.
        expect(result.find((point) => point.day === 'Jue' && point.hour === 20)?.value).toBe(100);
        expect(orderLookup).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 1,
                branchId: 2,
                financialStatus: 'PAID',
                status: { not: 'CANCELLED' },
                closedAt: expect.objectContaining({ not: null, gte: expect.any(Date) })
            })
        }));
    });

    it('filters each service trend by its own requested period', async () => {
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: 'America/Managua' } as never);
        const now = Date.now();
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            { createdAt: new Date(now - 60 * 60 * 1000), closedAt: new Date(now), deliveredAt: new Date(now), tipAmount: 5, total: 25 },
            { createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000), closedAt: new Date(now - 10 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000), deliveredAt: new Date(now - 10 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000), tipAmount: 3, total: 20 }
        ] as never);

        const result = await ReportService.getServiceTrends(1, undefined, 'week', 'month');

        expect(result.tips).toHaveLength(1);
        expect(result.spend).toHaveLength(2);
    });

    it('bounds BI chart periods with the company timezone instead of the host clock', async () => {
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: 'America/Managua' } as never);
        const orderLookup = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);

        // 2026-07-16 02:00 UTC is still 2026-07-15 evening in America/Managua.
        jest.useFakeTimers({ now: new Date('2026-07-16T02:00:00.000Z') });
        try {
            await ReportService.getSalesChart(1, 'week');
        } finally {
            jest.useRealTimers();
        }

        expect(orderLookup).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                closedAt: expect.objectContaining({
                    // Local midnight 2026-07-08 in America/Managua (UTC-6) = 06:00Z
                    gte: new Date('2026-07-08T06:00:00.000Z')
                })
            })
        }));
    });

    it('plots credit notes on issuedAt instead of rewriting the original sales day', async () => {
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: 'America/Managua' } as never);
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            closedAt: new Date('2026-07-14T16:00:00Z'),
            total: 115
        }] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{
            issuedAt: new Date('2026-07-15T16:00:00Z'),
            total: 115
        }] as never);
        jest.useFakeTimers({ now: new Date('2026-07-16T18:00:00Z') });
        try {
            const result = await ReportService.getSalesChart(1, 'week');
            expect(result).toEqual(expect.arrayContaining([
                { date: '2026-07-14', amount: 115 },
                { date: '2026-07-15', amount: -115 }
            ]));
        } finally {
            jest.useRealTimers();
        }
    });

    it('nets credited quantities before ranking top products', async () => {
        jest.spyOn(prisma.orderItem, 'groupBy').mockResolvedValue([
            { menuItemId: 10, _sum: { quantity: 5, subtotal: 50 } },
            { menuItemId: 20, _sum: { quantity: 4, subtotal: 80 } }
        ] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{
            issuedAt: new Date(),
            total: 30,
            order: { userId: 7 },
            refunds: [],
            lines: [{
                quantity: 3,
                subtotal: 30,
                orderItem: { menuItemId: 10 }
            }]
        }] as never);
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([
            { id: 10, name: 'A', price: 10, category: { name: 'Uno' } },
            { id: 20, name: 'B', price: 20, category: { name: 'Dos' } }
        ] as never);

        const result = await ReportService.getTopSellingProducts(1, undefined, 2);

        expect(result.map((item) => [item.menuItemId, item.totalQuantity, item.totalRevenue])).toEqual([
            [20, 4, 80],
            [10, 2, 20]
        ]);
    });

    it('attributes a credit to the original seller on the note issue date', async () => {
        jest.spyOn(prisma.order, 'groupBy').mockResolvedValue([{
            userId: 7,
            _sum: { total: 100 },
            _count: { id: 1 }
        }] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{
            issuedAt: new Date('2026-07-16T12:00:00Z'),
            total: 40,
            order: { userId: 7 },
            refunds: [],
            lines: []
        }] as never);
        jest.spyOn(prisma.user, 'findMany').mockResolvedValue([{
            id: 7,
            name: 'Ana',
            role: { name: 'MESERO' }
        }] as never);

        const result = await ReportService.getSalesByUser(
            1,
            undefined,
            new Date('2026-07-16T00:00:00Z'),
            new Date('2026-07-16T23:59:59Z')
        );

        expect(result).toEqual([expect.objectContaining({
            userId: 7,
            totalSales: 60,
            orderCount: 1,
            averageOrderValue: 60
        })]);
    });
});
