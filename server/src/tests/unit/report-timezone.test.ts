import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportExtendedService } from '../../services/report-extended.service';
import { SettingService } from '../../services/setting.service';

describe('financial report timezone recognition', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('groups a UTC instant under the tenant local sales day', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            {
                id: 1,
                closedAt: new Date('2026-07-13T02:00:00.000Z'),
                total: 100,
                discount: 0,
                salesChannel: 'RESTAURANT'
            }
        ] as never);

        const result = await ReportExtendedService.getSalesDaily(1);

        expect(result.items).toEqual([
            expect.objectContaining({ date: '2026-07-12', totalSales: 100, orderCount: 1 })
        ]);
    });

    it('uses the month before the requested comparison month and tenant-local boundaries', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        const findMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);

        const result = await ReportExtendedService.getMonthComparison(1, { monthB: '2026-05' });

        expect(result.items.map((item) => item.month)).toEqual(['2026-04', '2026-05']);
        expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({
                closedAt: {
                    gte: new Date('2026-04-01T06:00:00.000Z'),
                    lte: new Date('2026-05-01T05:59:59.999Z')
                }
            })
        }));
    });

    it('counts distinct local service dates when averaging weekday performance', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            { id: 1, closedAt: new Date('2026-07-06T18:00:00.000Z'), total: 100 },
            { id: 2, closedAt: new Date('2026-08-03T18:00:00.000Z'), total: 300 }
        ] as never);

        const result = await ReportExtendedService.getDayAnalysis(1);
        const monday = result.items.find((item) => item.dayName === 'Lunes');

        expect(monday).toEqual(expect.objectContaining({
            totalSales: 400,
            orderCount: 2,
            avgDailySales: 200
        }));
    });
});
