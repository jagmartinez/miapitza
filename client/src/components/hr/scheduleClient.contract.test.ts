import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
}));

vi.mock('../../services/api', () => ({ default: apiMock }));

import { scheduleClient } from './scheduleClient';

const shift = {
    id: 9,
    userId: 3,
    branchId: 4,
    jobPositionId: 5,
    startAt: '2026-07-13T14:00:00.000Z',
    endAt: '2026-07-13T23:00:00.000Z',
    timezoneSnapshot: 'America/Managua',
    breakMinutes: 30,
};

const schedule = {
    id: 7,
    weekStart: '2026-07-13',
    status: 'DRAFT',
    version: 1,
    revision: 2,
    shifts: [shift],
};

const response = (data: unknown, fromCache = false) => ({
    data: { success: true, data },
    ...(fromCache ? { _fromCache: true } : {}),
});

describe('Phase 2 schedule API contract', () => {
    beforeEach(() => {
        apiMock.get.mockReset();
        apiMock.post.mockReset();
        apiMock.put.mockReset();
        apiMock.patch.mockReset();
    });

    it('sends every supported schedule filter and preserves offline-cache provenance', async () => {
        apiMock.get.mockResolvedValueOnce(response({ schedules: [schedule], conflicts: [], holidays: [] }, true));
        const result = await scheduleClient.getSchedules({
            weekStart: '2026-07-13',
            branchId: 4,
            userId: 3,
            jobPositionId: 5,
        });

        expect(apiMock.get).toHaveBeenCalledWith('/v1/hr/schedules', {
            params: { weekStart: '2026-07-13', branchId: 4, userId: 3, jobPositionId: 5 },
        });
        expect(result.fromCache).toBe(true);
        expect(result.schedules[0]).toEqual(expect.objectContaining({
            id: 7,
            revision: 2,
            shifts: [expect.objectContaining({ date: '2026-07-13', startTime: '08:00', endTime: '17:00' })],
        }));
    });

    it('sends whole-shift optimistic updates and the versioned mutation routes', async () => {
        apiMock.put.mockResolvedValue(response(schedule));
        apiMock.post.mockResolvedValue(response(schedule));
        const update = { expectedRevision: 2, shifts: [{
            userId: 3,
            branchId: 4,
            jobPositionId: 5,
            date: '2026-07-13',
            startTime: '08:00',
            endTime: '17:00',
            breakMinutes: 30,
        }] };

        const create = {
            weekStart: '2026-07-13',
            shifts: [{
                userId: 3,
                branchId: 4,
                jobPositionId: 5,
                date: '2026-07-13',
                startTime: '08:00',
                endTime: '17:00',
                breakMinutes: 30,
            }],
        };
        await scheduleClient.createSchedule(create);
        await scheduleClient.updateSchedule(7, update);
        await scheduleClient.copySchedule(7, { targetWeekStart: '2026-07-20' });
        await scheduleClient.publishSchedule(7, { expectedRevision: 2 });
        await scheduleClient.cancelSchedule(7, { expectedRevision: 2 });
        await scheduleClient.acknowledgeSchedule(7);

        expect(apiMock.post).toHaveBeenCalledWith('/v1/hr/schedules', create);
        expect(apiMock.put).toHaveBeenCalledWith('/v1/hr/schedules/7', update);
        expect(apiMock.post).toHaveBeenCalledWith('/v1/hr/schedules/7/copy', { targetWeekStart: '2026-07-20' });
        expect(apiMock.post).toHaveBeenCalledWith('/v1/hr/schedules/7/publish', { expectedRevision: 2 });
        expect(apiMock.post).toHaveBeenCalledWith('/v1/hr/schedules/7/cancel', { expectedRevision: 2 });
        expect(apiMock.post).toHaveBeenCalledWith('/v1/hr/schedules/7/acknowledge');
    });

    it('uses the self-service and auxiliary read routes with their filters', async () => {
        apiMock.get
            .mockResolvedValueOnce(response({ schedules: [schedule], conflicts: [], holidays: [] }))
            .mockResolvedValueOnce(response({ schedules: [{ ...schedule, status: 'PUBLISHED' }], conflicts: [], holidays: [] }))
            .mockResolvedValueOnce(response({ users: [], branches: [], positions: [] }))
            .mockResolvedValueOnce(response({ shiftTemplates: [] }))
            .mockResolvedValueOnce(response({ holidays: [] }));

        await scheduleClient.getMySchedule('2026-07-13');
        await scheduleClient.getTeamSchedule('2026-07-13');
        await scheduleClient.getScheduleLookups('2026-07-13');
        await scheduleClient.getShiftTemplates(4);
        await scheduleClient.getHolidays('2026-07-13', 4);

        expect(apiMock.get).toHaveBeenNthCalledWith(1, '/v1/hr/me/schedule', { params: { weekStart: '2026-07-13' } });
        expect(apiMock.get).toHaveBeenNthCalledWith(2, '/v1/hr/team/schedule', { params: { weekStart: '2026-07-13' } });
        expect(apiMock.get).toHaveBeenNthCalledWith(3, '/v1/hr/schedules/lookups', { params: { weekStart: '2026-07-13' } });
        expect(apiMock.get).toHaveBeenNthCalledWith(4, '/v1/hr/shift-templates', { params: { branchId: 4 } });
        expect(apiMock.get).toHaveBeenNthCalledWith(5, '/v1/hr/holidays', { params: { weekStart: '2026-07-13', branchId: 4 } });
    });

    it('uses revision-aware template mutations and never deletes a configured shift', async () => {
        const template = {
            id: 12,
            revision: 4,
            branchId: 4,
            name: 'Apertura',
            code: 'APERTURA',
            startTime: '08:00',
            endTime: '16:00',
            breakMinutes: 30,
            paidBreak: false,
            color: '#2563EB',
            active: true,
        };
        apiMock.post.mockResolvedValueOnce(response(template));
        apiMock.put.mockResolvedValueOnce(response({ ...template, revision: 5 }));
        apiMock.patch.mockResolvedValueOnce(response({ ...template, revision: 6, active: false }));

        const payload = {
            branchId: 4,
            jobPositionId: null,
            name: 'Apertura',
            code: 'APERTURA',
            startTime: '08:00',
            endTime: '16:00',
            breakMinutes: 30,
            paidBreak: false,
            notes: null,
            color: '#2563EB',
        };
        await scheduleClient.createShiftTemplate(payload);
        await scheduleClient.updateShiftTemplate(12, { ...payload, expectedRevision: 4 });
        await scheduleClient.setShiftTemplateActive(12, false, 5);

        expect(apiMock.post).toHaveBeenCalledWith('/v1/hr/shift-templates', payload);
        expect(apiMock.put).toHaveBeenCalledWith('/v1/hr/shift-templates/12', { ...payload, expectedRevision: 4 });
        expect(apiMock.patch).toHaveBeenCalledWith('/v1/hr/shift-templates/12/status', {
            active: false,
            expectedRevision: 5,
        });
        expect(apiMock).not.toHaveProperty('delete');
    });

    it('treats a published week without a schedule as a valid empty team result', async () => {
        apiMock.get.mockResolvedValueOnce(response(null));
        await expect(scheduleClient.getTeamSchedule('2026-07-13')).resolves.toEqual({
            schedules: [],
            conflicts: [],
            holidays: [],
            fromCache: false,
        });
    });

    it('fails loudly instead of treating malformed schedule payloads as an empty week', async () => {
        apiMock.get.mockResolvedValueOnce(response({ unexpected: [] }));
        await expect(scheduleClient.getSchedules({ weekStart: '2026-07-13' }))
            .rejects.toThrow('formato esperado');
    });
});
