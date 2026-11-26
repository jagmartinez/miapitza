import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import {
    AttendanceCorrectionService,
    AttendanceDerivedService,
    AttendanceIncidentService,
    LeaveRequestService,
    OvertimeService,
    VacationService,
    WorkforcePortalService,
} from '../../services/hr-workforce.service';

const empty = { items: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } } as never;

function stubSources() {
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 7, name: 'Ana', username: 'ana', branchId: 1 } as never);
    jest.spyOn(AttendanceIncidentService, 'list').mockResolvedValue(empty);
    jest.spyOn(AttendanceCorrectionService, 'list').mockResolvedValue(empty);
    jest.spyOn(OvertimeService, 'list').mockResolvedValue(empty);
    jest.spyOn(LeaveRequestService, 'list').mockResolvedValue(empty);
    jest.spyOn(VacationService, 'listBalances').mockResolvedValue(empty);
    jest.spyOn(VacationService, 'listLedger').mockResolvedValue(empty);
}

describe('WorkforcePortalService.getMyWorkforce summaries option', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('skips the per-day attendance recalculation when summaries are not wanted', async () => {
        stubSources();
        const derived = jest.spyOn(AttendanceDerivedService, 'list').mockResolvedValue(empty);
        const data = await WorkforcePortalService.getMyWorkforce(1, 7, 'America/Managua', { dateFrom: '2026-10-23', dateTo: '2027-03-22' }, { includeSummaries: false });
        expect(derived).not.toHaveBeenCalled();
        expect(data.attendanceSummaries).toEqual([]);
        expect(LeaveRequestService.list).toHaveBeenCalledWith(1, expect.objectContaining({ userId: 7, dateFrom: '2026-10-23' }));
    });

    it('still returns the summaries by default (web portal)', async () => {
        stubSources();
        const derived = jest.spyOn(AttendanceDerivedService, 'list').mockResolvedValue({ items: [{ id: 1 }], pagination: {} } as never);
        const data = await WorkforcePortalService.getMyWorkforce(1, 7, 'America/Managua', { dateFrom: '2026-11-01', dateTo: '2026-11-07' });
        expect(derived).toHaveBeenCalledTimes(1);
        expect(data.attendanceSummaries).toEqual([{ id: 1 }]);
    });
});
