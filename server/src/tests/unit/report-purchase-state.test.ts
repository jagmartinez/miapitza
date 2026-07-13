import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportExtendedService } from '../../services/report-extended.service';

describe('purchase trend report state', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([
        ['daily', ReportExtendedService.getPurchasesByDay.bind(ReportExtendedService)],
        ['monthly', ReportExtendedService.getPurchasesByMonth.bind(ReportExtendedService)]
    ])('counts only received purchase orders in the %s trend', async (_label, report) => {
        const findMany = jest.spyOn(prisma.purchaseOrder, 'findMany').mockResolvedValue([] as never);

        await report(2, { branchId: 5 });

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 2,
                branchId: 5,
                status: 'RECEIVED'
            })
        }));
    });
});
