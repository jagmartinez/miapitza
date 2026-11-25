import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import {
    assertNoShiftOverlaps,
    ShiftSwapService,
    ShiftTemplateService,
    WeeklyScheduleService,
} from '../../services/hr-schedule.service';
import { zonedDateTimeToUtc } from '../../utils/timezone';

const publishedShift = {
    id: 20,
    companyId: 4,
    scheduleId: 9,
    userId: 8,
    branchId: 10,
    jobPositionId: null,
    shiftTemplateId: null,
    startAt: new Date('2026-07-14T14:00:00Z'),
    endAt: new Date('2026-07-14T22:00:00Z'),
    timezoneSnapshot: 'America/Managua',
    breakMinutes: 30,
    paidBreak: false,
    notes: null,
    status: 'SCHEDULED',
};

const activeBranchAssignment = {
    branchId: 10,
    effectiveFrom: new Date('2025-01-01T00:00:00Z'),
    effectiveTo: null,
};

describe('HR weekly schedule invariants', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('rejects overlapping intervals for the same user', () => {
        expect(() => assertNoShiftOverlaps([
            { userId: 8, startAt: new Date('2026-07-14T14:00:00Z'), endAt: new Date('2026-07-14T20:00:00Z') },
            { userId: 8, startAt: new Date('2026-07-14T19:59:00Z'), endAt: new Date('2026-07-14T22:00:00Z') },
        ])).toThrow('turnos solapados');
    });

    it('supports cross-midnight shifts and permits an adjacent next shift', () => {
        expect(() => assertNoShiftOverlaps([
            { userId: 8, startAt: new Date('2026-07-15T04:00:00Z'), endAt: new Date('2026-07-15T12:00:00Z') },
            { userId: 8, startAt: new Date('2026-07-15T12:00:00Z'), endAt: new Date('2026-07-15T16:00:00Z') },
        ])).not.toThrow();
    });

    it('converts local cross-midnight input with the branch timezone before persisting UTC', async () => {
        jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([{ id: 10, timezone: 'America/Managua' }] as never);
        jest.spyOn(prisma.user, 'findMany').mockResolvedValue([{
            id: 8, branchId: 10, allowedBranches: [],
            employee: { branchAssignments: [activeBranchAssignment] },
        }] as never);
        jest.spyOn(prisma.jobPosition, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.shiftTemplate, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.weeklySchedule, 'findFirst').mockResolvedValue(null as never);
        jest.spyOn(WeeklyScheduleService, 'getById').mockResolvedValue({ id: 9 } as never);
        const tx = {
            weeklySchedule: { create: jest.fn().mockResolvedValue({ id: 9, version: 1 } as never) },
            scheduledShift: { createMany: jest.fn().mockResolvedValue({ count: 1 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await WeeklyScheduleService.createDraft(4, {
            weekStart: '2026-07-13',
            shifts: [{
                userId: 8, branchId: 10, date: '2026-07-14',
                startTime: '22:00', endTime: '02:00', breakMinutes: 15,
            }],
        }, 3);

        const call = tx.scheduledShift.createMany.mock.calls[0][0] as { data: Array<{
            startAt: Date; endAt: Date; timezoneSnapshot: string;
        }> };
        const data = call.data[0];
        expect(data.startAt.toISOString()).toBe('2026-07-15T04:00:00.000Z');
        expect(data.endAt.toISOString()).toBe('2026-07-15T08:00:00.000Z');
        expect(data.timezoneSnapshot).toBe('America/Managua');
    });

    it('rejects a local time that does not exist during a DST transition', async () => {
        jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([{ id: 10, timezone: 'America/New_York' }] as never);
        jest.spyOn(prisma.user, 'findMany').mockResolvedValue([{
            id: 8, branchId: 10, allowedBranches: [],
            employee: { branchAssignments: [activeBranchAssignment] },
        }] as never);
        jest.spyOn(prisma.jobPosition, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.shiftTemplate, 'findMany').mockResolvedValue([] as never);

        await expect(WeeklyScheduleService.createDraft(4, {
            weekStart: '2026-03-02',
            shifts: [{
                userId: 8, branchId: 10, date: '2026-03-08',
                startTime: '02:30', endTime: '04:00',
            }],
        }, 3)).rejects.toThrow('hora local no existe');
    });

    it('uses an explicit earlier/later policy for repeated fall-back wall-clock times', () => {
        const parts = { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 };
        const earlier = zonedDateTimeToUtc(parts, 'America/New_York', 'earlier');
        const later = zonedDateTimeToUtc(parts, 'America/New_York', 'later');

        expect(earlier.toISOString()).toBe('2026-11-01T05:30:00.000Z');
        expect(later.toISOString()).toBe('2026-11-01T06:30:00.000Z');
    });

    it('rejects string booleans inside nested shift DTOs', async () => {
        await expect(WeeklyScheduleService.createDraft(4, {
            weekStart: '2026-07-13',
            shifts: [{
                userId: 8, branchId: 10, date: '2026-07-14',
                startTime: '08:00', endTime: '16:00', paidBreak: 'false',
            } as never],
        }, 3)).rejects.toThrow('paidBreak debe ser booleano');
    });

    it('rejects a shift without an effective RH branch assignment', async () => {
        jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([{ id: 10, timezone: 'America/Managua' }] as never);
        jest.spyOn(prisma.user, 'findMany').mockResolvedValue([{
            id: 8, branchId: 10, allowedBranches: [], employee: { branchAssignments: [] },
        }] as never);
        jest.spyOn(prisma.jobPosition, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.shiftTemplate, 'findMany').mockResolvedValue([] as never);

        await expect(WeeklyScheduleService.createDraft(4, {
            weekStart: '2026-07-13',
            shifts: [{
                userId: 8, branchId: 10, date: '2026-07-14',
                startTime: '08:00', endTime: '16:00',
            }],
        }, 3)).rejects.toMatchObject({ statusCode: 409 });
    });

    it('keeps published schedules immutable', async () => {
        jest.spyOn(WeeklyScheduleService, 'getById').mockResolvedValue({
            id: 9, companyId: 4, status: 'PUBLISHED', revision: 2,
            weekStart: new Date('2026-07-13T00:00:00Z'), shifts: [],
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(WeeklyScheduleService.replaceDraftShifts(9, 4, {
            expectedRevision: 2, shifts: [],
        }, 3)).rejects.toMatchObject({ statusCode: 409 });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('detects a concurrent supersession while publishing', async () => {
        jest.spyOn(WeeklyScheduleService, 'getById').mockResolvedValue({
            id: 9, companyId: 4, status: 'DRAFT', revision: 2, version: 2,
            weekStart: new Date('2026-07-13T00:00:00Z'), supersedesScheduleId: 5,
            shifts: [publishedShift],
        } as never);
        jest.spyOn(prisma.scheduledShift, 'findMany').mockResolvedValue([] as never);
        const tx = {
            user: { findMany: jest.fn().mockResolvedValue([{
                id: 8, branchId: 10, allowedBranches: [],
                employee: { branchAssignments: [activeBranchAssignment] },
            }] as never) },
            scheduledShift: { findMany: jest.fn().mockResolvedValue([] as never) },
            weeklySchedule: {
                updateMany: jest.fn().mockResolvedValue({ count: 0 } as never),
                findFirst: jest.fn(),
            },
            auditLog: { create: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(WeeklyScheduleService.publish(9, 4, 2, 3))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(tx.weeklySchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 5, companyId: 4, status: 'PUBLISHED' }),
        }));
    });

    it('revalidates employee eligibility inside publication transaction', async () => {
        jest.spyOn(WeeklyScheduleService, 'getById').mockResolvedValue({
            id: 9, companyId: 4, status: 'DRAFT', revision: 2, version: 2,
            weekStart: new Date('2026-07-13T00:00:00Z'), supersedesScheduleId: null,
            shifts: [publishedShift],
        } as never);
        const tx = {
            user: { findMany: jest.fn().mockResolvedValue([] as never) },
            scheduledShift: { findMany: jest.fn() },
            weeklySchedule: { updateMany: jest.fn(), findFirst: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(WeeklyScheduleService.publish(9, 4, 2, 3))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(tx.scheduledShift.findMany).not.toHaveBeenCalled();
        expect(tx.weeklySchedule.updateMany).not.toHaveBeenCalled();
    });

    it('applies tenant and branch scope to template reads', async () => {
        const findFirst = jest.spyOn(prisma.shiftTemplate, 'findFirst').mockResolvedValue(null as never);
        await expect(ShiftTemplateService.getById(7, 4, 10)).rejects.toMatchObject({ statusCode: 404 });
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7, companyId: 4, branchId: 10 },
        }));
    });

    it('filters both schedule existence and included shifts by branch scope', async () => {
        const findMany = jest.spyOn(prisma.weeklySchedule, 'findMany').mockResolvedValue([] as never);
        await WeeklyScheduleService.list(4, {}, 10);
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ companyId: 4, shifts: { some: { branchId: 10 } } }),
            include: expect.objectContaining({ shifts: expect.objectContaining({ where: { branchId: 10 } }) }),
        }));
    });

    it('fails closed when a branch-scoped actor tries to replace a company-wide weekly schedule', async () => {
        const getById = jest.spyOn(WeeklyScheduleService, 'getById');

        await expect(WeeklyScheduleService.replaceDraftShifts(9, 4, {
            expectedRevision: 0,
            shifts: [],
        }, 3, 10)).rejects.toMatchObject({ statusCode: 403 });

        expect(getById).not.toHaveBeenCalled();
    });

    it('returns only the authenticated user shifts from the self endpoint service', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 8 } as never);
        jest.spyOn(prisma.weeklySchedule, 'findFirst').mockResolvedValue({
            id: 9, companyId: 4, weekStart: new Date('2026-07-13T00:00:00Z'),
            version: 1, revision: 3, status: 'PUBLISHED', publishedAt: new Date(),
            shifts: [publishedShift, { ...publishedShift, id: 21, userId: 99 }],
            acknowledgements: [],
        } as never);
        jest.spyOn(prisma.shiftSwapRequest, 'findMany').mockResolvedValue([] as never);

        const result = await WeeklyScheduleService.getMySchedule(4, 8, '2026-07-13');
        expect(result?.shifts).toHaveLength(1);
        expect(result?.shifts[0]).toEqual(expect.objectContaining({
            userId: 8, date: '2026-07-14', startTime: '08:00', endTime: '16:00',
        }));
        expect(result).toEqual(expect.objectContaining({ status: 'PUBLISHED', revision: 3 }));
    });

    it('uses the immutable assignment override as the effective self-service owner', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 8 } as never);
        jest.spyOn(prisma.weeklySchedule, 'findFirst').mockResolvedValue({
            id: 9, companyId: 4, weekStart: new Date('2026-07-13T00:00:00Z'),
            version: 1, revision: 3, status: 'PUBLISHED', publishedAt: new Date(),
            shifts: [{
                ...publishedShift,
                assignmentOverride: {
                    id: 1, assignedUserId: 99, swapRequestId: 44, effectiveAt: new Date(),
                    assignedUser: { id: 99, name: 'Cobertura', username: 'coverage', accountType: 'INTERNAL', status: 'ACTIVE' },
                },
            }],
            acknowledgements: [],
        } as never);

        const original = await WeeklyScheduleService.getMySchedule(4, 8, '2026-07-13');
        const replacement = await WeeklyScheduleService.getMySchedule(4, 99, '2026-07-13');

        expect(original?.shifts).toHaveLength(0);
        expect(replacement?.shifts).toEqual([expect.objectContaining({ userId: 99, originalUserId: 8 })]);
    });

    it('materializes approved swap assignments and releases reservations atomically', async () => {
        const futureShift = {
            ...publishedShift,
            startAt: new Date('2030-07-14T14:00:00Z'),
            endAt: new Date('2030-07-14T22:00:00Z'),
        };
        const acceptedRequest = {
            id: 44, companyId: 4, status: 'ACCEPTED', requesterShiftId: 20, offeredShiftId: 21,
            scheduleId: 9, requestedById: 8, targetUserId: 99,
            requesterShift: { ...futureShift, branchId: 10, assignmentOverride: null },
            offeredShift: { ...futureShift, id: 21, userId: 99, branchId: 10, assignmentOverride: null },
        };
        const tx = {
            scheduledShift: { findFirst: jest.fn().mockResolvedValue(null as never) },
            shiftSwapRequest: {
                findFirst: jest.fn().mockResolvedValue(acceptedRequest as never),
                updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
                findUnique: jest.fn().mockResolvedValue({ id: 44, status: 'APPROVED' } as never),
            },
            shiftAssignmentOverride: { createMany: jest.fn().mockResolvedValue({ count: 2 } as never) },
            shiftSwapReservation: {
                count: jest.fn().mockResolvedValue(2 as never),
                deleteMany: jest.fn().mockResolvedValue({ count: 2 } as never),
            },
            user: { count: jest.fn().mockResolvedValue(2 as never) },
            employee: { findFirst: jest.fn().mockResolvedValue({ id: 1 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await ShiftSwapService.approve(44, 4, 3);

        expect(tx.shiftAssignmentOverride.createMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.arrayContaining([
                expect.objectContaining({ scheduledShiftId: 20, assignedUserId: 99 }),
                expect.objectContaining({ scheduledShiftId: 21, assignedUserId: 8 }),
            ]),
        }));
        expect(tx.shiftSwapReservation.deleteMany).toHaveBeenCalledWith({ where: { swapRequestId: 44, companyId: 4 } });
    });

    it('revalidates effective RH branch assignments before approving a swap', async () => {
        const futureShift = {
            ...publishedShift,
            startAt: new Date('2030-07-14T14:00:00Z'),
            endAt: new Date('2030-07-14T22:00:00Z'),
        };
        const tx = {
            shiftSwapRequest: { findFirst: jest.fn().mockResolvedValue({
                id: 44, companyId: 4, status: 'ACCEPTED', requesterShiftId: 20, offeredShiftId: null,
                scheduleId: 9, requestedById: 8, targetUserId: 99,
                requesterShift: { ...futureShift, assignmentOverride: null }, offeredShift: null,
            } as never) },
            shiftSwapReservation: { count: jest.fn().mockResolvedValue(1 as never) },
            user: { count: jest.fn().mockResolvedValue(2 as never) },
            employee: { findFirst: jest.fn().mockResolvedValue(null as never) },
            shiftAssignmentOverride: { createMany: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(ShiftSwapService.approve(44, 4, 3)).rejects.toMatchObject({ statusCode: 409 });

        expect(tx.shiftAssignmentOverride.createMany).not.toHaveBeenCalled();
    });

    it('refuses to approve a swap when its published schedule is no longer current', async () => {
        const tx = {
            shiftSwapRequest: { findFirst: jest.fn().mockResolvedValue(null as never) },
            shiftAssignmentOverride: { createMany: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(ShiftSwapService.approve(44, 4, 3)).rejects.toMatchObject({ statusCode: 404 });
        expect(tx.shiftAssignmentOverride.createMany).not.toHaveBeenCalled();
    });

    it('cancels open swaps and releases reservations when a published schedule is cancelled', async () => {
        jest.spyOn(WeeklyScheduleService, 'getById').mockResolvedValue({
            id: 9, companyId: 4, status: 'PUBLISHED', revision: 3,
        } as never);
        const tx = {
            weeklySchedule: { updateMany: jest.fn().mockResolvedValue({ count: 1 } as never) },
            shiftSwapRequest: {
                findMany: jest.fn().mockResolvedValue([{ id: 44 }] as never),
                updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
            },
            shiftSwapReservation: { deleteMany: jest.fn().mockResolvedValue({ count: 2 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await WeeklyScheduleService.cancel(9, 4, 3, 7);

        expect(tx.shiftSwapRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ companyId: 4, id: { in: [44] } }),
            data: expect.objectContaining({ status: 'CANCELLED', openRequesterKey: null, openOfferedKey: null }),
        }));
        expect(tx.shiftSwapReservation.deleteMany).toHaveBeenCalledWith({
            where: { companyId: 4, swapRequestId: { in: [44] } },
        });
    });

    it('cannot cancel a swap that became approved concurrently', async () => {
        jest.spyOn(prisma.shiftSwapRequest, 'findFirst').mockResolvedValue({
            id: 44, requestedById: 8, status: 'ACCEPTED',
        } as never);
        const tx = {
            shiftSwapRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 } as never) },
            shiftSwapReservation: { deleteMany: jest.fn() },
            auditLog: { create: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(ShiftSwapService.cancel(44, 4, 8, false)).rejects.toMatchObject({ statusCode: 409 });
        expect(tx.shiftSwapReservation.deleteMany).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('responds to a swap and writes its audit in the same transaction', async () => {
        const tx = {
            user: { findFirst: jest.fn().mockResolvedValue({ id: 8 } as never) },
            shiftSwapRequest: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
                findUnique: jest.fn().mockResolvedValue({ id: 44, status: 'ACCEPTED' } as never),
            },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await ShiftSwapService.respond(44, 4, 8, 'ACCEPT');

        expect(tx.shiftSwapRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 44, companyId: 4, targetUserId: 8, status: 'PENDING' },
        }));
        expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a swap response when the target employee became inactive', async () => {
        const tx = {
            user: { findFirst: jest.fn().mockResolvedValue(null as never) },
            shiftSwapRequest: { updateMany: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(ShiftSwapService.respond(44, 4, 8, 'ACCEPT'))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(tx.shiftSwapRequest.updateMany).not.toHaveBeenCalled();
    });
});
