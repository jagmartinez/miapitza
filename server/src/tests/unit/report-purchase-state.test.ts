import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportExtendedService } from '../../services/report-extended.service';
import { SettingService } from '../../services/setting.service';

describe('purchase trend report state', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([
        ['daily', ReportExtendedService.getPurchasesByDay.bind(ReportExtendedService)],
        ['monthly', ReportExtendedService.getPurchasesByMonth.bind(ReportExtendedService)]
    ])('counts only received purchase orders in the %s trend', async (_label, report) => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        const findMany = jest.spyOn(prisma.purchaseOrder, 'findMany').mockResolvedValue([] as never);

        await report(2, { branchId: 5 });

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 2,
                branchId: 5,
                // Received basis: partial receipts count for what arrived.
                status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] }
            })
        }));
    });

    it('values partial and closed-short orders at what was received', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        const date = new Date('2026-07-15T18:00:00.000Z');
        jest.spyOn(prisma.purchaseOrder, 'findMany').mockResolvedValue([
            // Partial: ordered 100, received 40.
            { date, status: 'PARTIALLY_RECEIVED', total: 100, receivedTotal: 40, supplierId: 1, items: [] },
            // Closed short: total already adjusted to the received value.
            { date, status: 'RECEIVED', total: 25, receivedTotal: 25, supplierId: 1, items: [] }
        ] as never);

        const monthly = await ReportExtendedService.getPurchasesByMonth(2, {});

        expect(monthly.summary.totalAmount).toBe(65);
    });
});
