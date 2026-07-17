import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import {
    deriveWorkedMinutes,
    deriveWorkedIntervals,
    employeeBranchScope,
    hasAttendanceLeaveConflict,
    hasSummarySourceChanged,
    leaveAmount,
    leaveIntervalsForShift,
    LeaveRequestService,
} from '../../services/hr-workforce.service';

describe('HR workforce invariants', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('derives ordinary and break minutes from an immutable punch sequence', () => {
        const events = [
            { id: 1, action: 'CHECK_IN', occurredAt: new Date('2026-07-14T14:00:00Z'), branchId: 2 },
            { id: 2, action: 'BREAK_START', occurredAt: new Date('2026-07-14T18:00:00Z'), branchId: 2 },
            { id: 3, action: 'BREAK_END', occurredAt: new Date('2026-07-14T18:30:00Z'), branchId: 2 },
            { id: 4, action: 'CHECK_OUT', occurredAt: new Date('2026-07-14T22:00:00Z'), branchId: 2 },
        ] as const;
        const result = deriveWorkedMinutes([...events]);

        expect(result).toEqual({ ordinaryMinutes: 450, breakMinutes: 30, anomalies: [] });
        expect(deriveWorkedIntervals([...events])).toEqual([
            { start: new Date('2026-07-14T14:00:00Z'), end: new Date('2026-07-14T18:00:00Z') },
            { start: new Date('2026-07-14T18:30:00Z'), end: new Date('2026-07-14T22:00:00Z') },
        ]);
    });

    it('reconciles an overnight checkout at or after shift end without inventing a missing exit', () => {
        const result = deriveWorkedMinutes([
            { id: 11, action: 'CHECK_IN', occurredAt: new Date('2026-07-15T04:00:00Z'), branchId: 2 },
            { id: 12, action: 'CHECK_OUT', occurredAt: new Date('2026-07-15T12:15:00Z'), branchId: 2 },
        ]);

        expect(result).toEqual({ ordinaryMinutes: 495, breakMinutes: 0, anomalies: [] });
    });

    it('detects invalid punch ordering without inventing worked time', () => {
        const result = deriveWorkedMinutes([
            { id: 1, action: 'CHECK_OUT', occurredAt: new Date('2026-07-14T14:00:00Z'), branchId: 2 },
        ]);
        expect(result.ordinaryMinutes).toBe(0);
        expect(result.anomalies).toContain('CHECK_OUT_WITHOUT_CHECK_IN');
    });

    it('does not stale overtime when an identical summary is read again', () => {
        const state = {
            timezone: 'America/Managua', periodId: 4, scheduledMinutes: 480,
            ordinaryMinutes: 510, breakMinutes: 30, lateMinutes: 0,
            earlyDepartureMinutes: 0, candidateOvertimeMinutes: 30,
            approvedOvertimeMinutes: 0,
        };
        expect(hasSummarySourceChanged(state, { ...state })).toBe(false);
        expect(hasSummarySourceChanged(state, { ...state, candidateOvertimeMinutes: 31 })).toBe(true);
    });

    it('keeps an uncovered shift critical when a leave covers only one hour', () => {
        const shift = {
            startAt: new Date('2026-07-14T14:00:00Z'),
            endAt: new Date('2026-07-14T22:00:00Z'),
        };
        const partial = leaveIntervalsForShift([
            { id: 1, fraction: 'HOURS', startTime: '09:00', endTime: '10:00' },
        ], '2026-07-14', 'America/Managua', shift);
        const full = leaveIntervalsForShift([
            { id: 2, fraction: 'FULL_DAY', startTime: null, endTime: null },
        ], '2026-07-14', 'America/Managua', shift);
        const half = leaveIntervalsForShift([
            { id: 3, fraction: 'HALF_DAY', startTime: '08:00', endTime: '12:00' },
        ], '2026-07-14', 'America/Managua', shift);

        expect(partial.fullyCovered).toBe(false);
        expect(full.fullyCovered).toBe(true);
        expect(half.fullyCovered).toBe(false);
        expect(half.expectedStart.toISOString()).toBe('2026-07-14T18:00:00.000Z');
    });

    it('maps an hourly leave after midnight into its overnight shift', () => {
        const coverage = leaveIntervalsForShift([{
            id: 4,
            fraction: 'HOURS',
            startTime: '00:00',
            endTime: '02:00',
            startDate: new Date('2026-07-15T00:00:00Z'),
            endDate: new Date('2026-07-15T00:00:00Z'),
        }], '2026-07-14', 'America/Managua', {
            startAt: new Date('2026-07-15T04:00:00Z'),
            endAt: new Date('2026-07-15T12:00:00Z'),
        });

        expect(coverage.fullyCovered).toBe(false);
        expect(coverage.intervals).toEqual([{
            start: new Date('2026-07-15T06:00:00Z'),
            end: new Date('2026-07-15T08:00:00Z'),
        }]);
    });

    it('keeps an incomplete punch sequence critical inside a fully covered leave', () => {
        const leave = [{
            start: new Date('2026-07-14T14:00:00Z'),
            end: new Date('2026-07-14T22:00:00Z'),
        }];
        expect(hasAttendanceLeaveConflict({
            firstIn: new Date('2026-07-14T14:05:00Z'),
            fullyCovered: true,
            leaveIntervals: leave,
            workedIntervals: [],
        })).toBe(true);
        expect(hasAttendanceLeaveConflict({
            fullyCovered: true,
            leaveIntervals: leave,
            workedIntervals: [],
        })).toBe(false);
    });

    it('requires a half-day interval to match its configured ledger charge', () => {
        const date = new Date('2026-07-15T00:00:00Z');
        expect(leaveAmount(date, date, 'HALF_DAY', '08:00', '12:00', 'HOURS')).toBe(4);
        expect(() => leaveAmount(date, date, 'HALF_DAY', '00:00', '23:59', 'DAYS'))
            .toThrow('intervalo exacto de 240 minutos');
        expect(leaveAmount(date, date, 'HALF_DAY', '08:00', '11:45', 'HOURS', { dayMinutes: 450, hourMinutes: 60 })).toBe(3.75);
    });

    it('evaluates employee branch scope against the process window in both directions', () => {
        const from = new Date('2026-07-01T00:00:00.000Z');
        const to = new Date('2026-07-31T00:00:00.000Z');

        expect(employeeBranchScope(4, { from, to })).toEqual({
            employee: {
                branchAssignments: {
                    some: {
                        branchId: 4,
                        effectiveFrom: { lte: to },
                        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
                    },
                },
            },
        });
    });

    it('forbids a user from deciding their own leave request', async () => {
        const tx = {
            leaveRequest: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 7,
                    companyId: 4,
                    userId: 11,
                    requestedById: 11,
                    status: 'PENDING',
                    leaveType: { balanceTracked: false },
                } as never),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(LeaveRequestService.decide(7, 4, 11, 'APPROVED', 'Aprobación'))
            .rejects.toMatchObject({ code: 'HR_SELF_APPROVAL_FORBIDDEN', statusCode: 409 });
    });

    it('rejects overlapping leave requests when a draft is submitted', async () => {
        const current = {
            id: 7,
            companyId: 4,
            userId: 11,
            status: 'DRAFT',
            revision: 0,
            startDate: new Date('2026-07-20T00:00:00Z'),
            endDate: new Date('2026-07-22T00:00:00Z'),
            fraction: 'FULL_DAY',
            startTime: null,
            endTime: null,
            leaveType: { requiresAttachment: false },
        };
        const tx = {
            user: { findFirst: jest.fn().mockResolvedValue({ id: 11, branchId: 2 } as never) },
            attendancePeriod: { findFirst: jest.fn().mockResolvedValue(null as never) },
            leaveRequest: {
                findFirst: jest.fn()
                    .mockResolvedValueOnce(current as never)
                    .mockResolvedValueOnce({ id: 8 } as never),
                findMany: jest.fn().mockResolvedValue([{ ...current, id: 8 }] as never),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(LeaveRequestService.submit(7, 4, 11, true))
            .rejects.toMatchObject({ code: 'HR_LEAVE_OVERLAP', statusCode: 409 });
    });

    it('rejects self submission when the linked employee is no longer active', async () => {
        const tx = {
            user: { findFirst: jest.fn().mockResolvedValue(null as never) },
            leaveRequest: { findFirst: jest.fn().mockResolvedValue({
                id: 7, companyId: 4, userId: 11, status: 'DRAFT', revision: 0,
                startDate: new Date('2026-07-20T00:00:00Z'), endDate: new Date('2026-07-20T00:00:00Z'),
                leaveType: { requiresAttachment: false },
            } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(LeaveRequestService.submit(7, 4, 11, true))
            .rejects.toMatchObject({ code: 'HR_USER_NOT_FOUND', statusCode: 404 });
    });

    it('fails closed on submit when the leave type now requires secure evidence', async () => {
        const tx = {
            user: { findFirst: jest.fn().mockResolvedValue({ id: 11, branchId: 2 } as never) },
            leaveRequest: { findFirst: jest.fn().mockResolvedValue({
                id: 7, companyId: 4, userId: 11, status: 'DRAFT', revision: 0,
                startDate: new Date('2026-07-20T00:00:00Z'), endDate: new Date('2026-07-20T00:00:00Z'),
                leaveType: { requiresAttachment: true },
            } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(LeaveRequestService.submit(7, 4, 11, true))
            .rejects.toMatchObject({ code: 'HR_LEAVE_EVIDENCE_FLOW_REQUIRED', statusCode: 409 });
    });

    it('fails closed again on approval when secure evidence is unavailable', async () => {
        const tx = {
            attendancePeriod: { findFirst: jest.fn().mockResolvedValue(null as never) },
            leaveRequest: { findFirst: jest.fn().mockResolvedValue({
                id: 7, companyId: 4, userId: 12, status: 'PENDING', revision: 1,
                startDate: new Date('2026-07-20T00:00:00Z'), endDate: new Date('2026-07-20T00:00:00Z'),
                leaveType: { requiresAttachment: true, balanceTracked: false },
            } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await expect(LeaveRequestService.decide(7, 4, 11, 'APPROVED', 'Revisado'))
            .rejects.toMatchObject({ code: 'HR_LEAVE_EVIDENCE_FLOW_REQUIRED', statusCode: 409 });
    });
});

describe('HR workforce route and migration contract', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../../routes/hr-workforce.routes.ts'), 'utf8');
    const service = fs.readFileSync(path.resolve(__dirname, '../../services/hr-workforce.service.ts'), 'utf8');
    const migration = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20260713_hr_04_workforce_management/migration.sql'), 'utf8');

    it('matches the client endpoint contract, including PUT for leave types', () => {
        for (const endpoint of [
            '/attendance/daily-summaries',
            '/attendance/incidents',
            '/attendance/corrections',
            '/attendance/periods/:id/close',
            '/attendance/periods/:id/reopen',
            '/overtime/requests',
            '/leave/requests/:id/submit',
            '/leave/calendar',
            '/vacation/balances',
            '/vacation/ledger',
            '/vacation/adjustments',
            '/me/attendance/summary',
            '/me/workforce',
        ]) expect(routes).toContain(endpoint);
        expect(routes).toContain("router.put('/leave/types/:id'");
        expect(routes).toContain("/attendance/corrections/:id/cancel");
    });

    it('loads overnight events by scheduled shift instead of truncating checkout at shift end', () => {
        expect(service).toContain('{ scheduledShiftId: { in: scheduledShiftIds } }');
        expect(service).toContain('{ scheduledShiftId: null, serverAt: { gte: bounds.start, lt: bounds.end } }');
    });

    it('separates self, management and approval permissions', () => {
        expect(routes).toContain("requirePermission('hr.workforce.self'");
        expect(routes).toContain("requirePermission('hr.workforce.read', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.workforce.manage', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.workforce.approve', ROLES.SUPERADMIN)");
    });

    it('makes the vacation ledger append-only at the database layer', () => {
        expect(migration).toContain('CREATE TRIGGER `VacationLedgerEntry_prevent_update`');
        expect(migration).toContain('CREATE TRIGGER `VacationLedgerEntry_prevent_delete`');
        expect(migration).toContain('UNIQUE INDEX `VacationLedgerEntry_leaveRequestId_type_key`');
    });
});
