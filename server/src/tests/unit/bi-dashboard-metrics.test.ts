import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportService } from '../../services/report.service';

afterEach(() => { jest.restoreAllMocks(); });

describe('Business Intelligence metric contracts', () => {
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
                status: { in: ['PAID', 'DELIVERED'] },
                closedAt: { gte: expect.any(Date) }
            })
        }));
    });

    it('filters each service trend by its own requested period', async () => {
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: 'America/Managua' } as never);
        const now = Date.now();
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            { createdAt: new Date(now - 60 * 60 * 1000), closedAt: new Date(now), tipAmount: 5, total: 25 },
            { createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000), closedAt: new Date(now - 10 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000), tipAmount: 3, total: 20 }
        ] as never);

        const result = await ReportService.getServiceTrends(1, undefined, 'week', 'month');

        expect(result.tips).toHaveLength(1);
        expect(result.spend).toHaveLength(2);
    });
});
