import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import {
    HrScheduleError,
    ShiftTemplateService,
    WeeklyScheduleService,
} from '../../services/hr-schedule.service';

const template = {
    id: 71,
    companyId: 4,
    branchId: 10,
    jobPositionId: 21,
    name: 'Jornada mañana',
    code: 'MANANA',
    color: '#3B82F6',
    startMinute: 8 * 60,
    endMinute: 16 * 60,
    breakMinutes: 30,
    paidBreak: false,
    timezone: 'America/Managua',
    notes: null,
    active: true,
    revision: 2,
    createdAt: new Date('2026-07-25T10:00:00Z'),
    updatedAt: new Date('2026-07-25T10:00:00Z'),
};

const activeAssignment = {
    branchId: 10,
    effectiveFrom: new Date('2025-01-01T00:00:00Z'),
    effectiveTo: null,
};

function mockSerializableTransaction(tx: Record<string, unknown>) {
    return jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
    );
}

function mockShiftNormalizationDependencies() {
    jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([{
        id: 10,
        timezone: 'America/Managua',
    }] as never);
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue([{
        id: 8,
        branchId: 10,
        allowedBranches: [],
        employee: {
            jobPositionId: 21,
            branchAssignments: [activeAssignment],
        },
    }] as never);
    jest.spyOn(prisma.jobPosition, 'findMany').mockResolvedValue([{ id: 21 }] as never);
}

describe('reusable HR shift templates', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('creates a tenant-scoped template with a canonical validated color and audit row', async () => {
        const branch = jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({
            id: 10,
            timezone: 'America/Managua',
        } as never);
        jest.spyOn(prisma.jobPosition, 'findFirst').mockResolvedValue({ id: 21 } as never);
        const tx = {
            shiftTemplate: {
                create: jest.fn().mockResolvedValue({
                    ...template,
                    color: '#AABBCC',
                    revision: 0,
                } as never),
            },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        mockSerializableTransaction(tx);

        const result = await ShiftTemplateService.create(4, {
            branchId: 10,
            jobPositionId: 21,
            name: 'Jornada mañana',
            code: 'manana',
            color: '#aabbcc',
            startTime: '08:00',
            endTime: '16:00',
            breakMinutes: 30,
        }, 3);

        expect(branch).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 10, companyId: 4, status: 'ACTIVE' },
        }));
        expect(tx.shiftTemplate.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                companyId: 4,
                branchId: 10,
                code: 'MANANA',
                color: '#AABBCC',
            }),
        });
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                companyId: 4,
                userId: 3,
                entityType: 'ShiftTemplate',
                action: 'CREATE',
            }),
        }));
        expect(result).toEqual(expect.objectContaining({
            color: '#AABBCC',
            startTime: '08:00',
            endTime: '16:00',
        }));
    });

    it('rejects invalid colors before persistence', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({
            id: 10,
            timezone: 'America/Managua',
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(ShiftTemplateService.create(4, {
            branchId: 10,
            name: 'Inválida',
            code: 'INVALIDA',
            color: 'red',
            startTime: '08:00',
            endTime: '16:00',
        }, 3)).rejects.toThrow('formato hexadecimal');
        expect(transaction).not.toHaveBeenCalled();
    });

    it('uses explicit optimistic revision and rejects stale updates', async () => {
        jest.spyOn(ShiftTemplateService, 'getById').mockResolvedValue({
            ...template,
            startTime: '08:00',
            endTime: '16:00',
            crossesMidnight: false,
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(ShiftTemplateService.update(71, 4, {
            expectedRevision: 1,
            name: 'Formulario obsoleto',
        }, 3)).rejects.toMatchObject({ statusCode: 409 });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('treats a repeated status mutation as an idempotent success', async () => {
        jest.spyOn(ShiftTemplateService, 'getById').mockResolvedValue({
            ...template,
            active: false,
            revision: 3,
            startTime: '08:00',
            endTime: '16:00',
            crossesMidnight: false,
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        const result = await ShiftTemplateService.update(71, 4, {
            active: false,
            expectedRevision: 2,
        }, 3);

        expect(result).toEqual(expect.objectContaining({ active: false, revision: 3 }));
        expect(transaction).not.toHaveBeenCalled();
    });

    it('blocks editing or deactivating a template referenced by a draft schedule', async () => {
        jest.spyOn(ShiftTemplateService, 'getById').mockResolvedValue({
            ...template,
            startTime: '08:00',
            endTime: '16:00',
            crossesMidnight: false,
        } as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({
            id: 10,
            timezone: 'America/Managua',
        } as never);
        jest.spyOn(prisma.jobPosition, 'findFirst').mockResolvedValue({ id: 21 } as never);
        const tx = {
            scheduledShift: {
                findFirst: jest.fn().mockResolvedValue({ id: 80, scheduleId: 91 } as never),
            },
            shiftTemplate: {
                updateMany: jest.fn(),
            },
        };
        mockSerializableTransaction(tx);

        await expect(ShiftTemplateService.update(71, 4, {
            expectedRevision: 2,
            color: '#FF0000',
        }, 3)).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringContaining('agenda borrador 91'),
        });
        expect(tx.shiftTemplate.updateMany).not.toHaveBeenCalled();
    });

    it('updates through company-scoped CAS and audits the revision transition', async () => {
        jest.spyOn(ShiftTemplateService, 'getById').mockResolvedValue({
            ...template,
            startTime: '08:00',
            endTime: '16:00',
            crossesMidnight: false,
        } as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({
            id: 10,
            timezone: 'America/Managua',
        } as never);
        jest.spyOn(prisma.jobPosition, 'findFirst').mockResolvedValue({ id: 21 } as never);
        const tx = {
            scheduledShift: { findFirst: jest.fn().mockResolvedValue(null as never) },
            shiftTemplate: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
                findFirst: jest.fn().mockResolvedValue({
                    ...template,
                    name: 'Jornada actualizada',
                    revision: 3,
                } as never),
            },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 2 } as never) },
        };
        mockSerializableTransaction(tx);

        const result = await ShiftTemplateService.update(71, 4, {
            expectedRevision: 2,
            name: 'Jornada actualizada',
        }, 3);

        expect(tx.shiftTemplate.updateMany).toHaveBeenCalledWith({
            where: { id: 71, companyId: 4, revision: 2 },
            data: expect.objectContaining({ name: 'Jornada actualizada', revision: 3 }),
        });
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                details: expect.objectContaining({ fromRevision: 2, toRevision: 3 }),
            }),
        }));
        expect(result).toEqual(expect.objectContaining({ revision: 3 }));
    });

    it('soft-deletes idempotently while preserving published references', async () => {
        const getById = jest.spyOn(ShiftTemplateService, 'getById').mockResolvedValue({
            ...template,
            startTime: '08:00',
            endTime: '16:00',
            crossesMidnight: false,
        } as never);
        const tx = {
            scheduledShift: { findFirst: jest.fn().mockResolvedValue(null as never) },
            shiftTemplate: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
                findFirst: jest.fn().mockResolvedValue({
                    ...template,
                    active: false,
                    revision: 3,
                } as never),
            },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 3 } as never) },
        };
        mockSerializableTransaction(tx);

        const removed = await ShiftTemplateService.remove(71, 4, 2, 3);
        expect(tx.shiftTemplate.updateMany).toHaveBeenCalledWith({
            where: { id: 71, companyId: 4, active: true, revision: 2 },
            data: { active: false, revision: 3 },
        });
        expect(removed).toEqual(expect.objectContaining({ active: false, revision: 3 }));

        jest.restoreAllMocks();
        jest.spyOn(ShiftTemplateService, 'getById').mockResolvedValue({
            ...template,
            active: false,
            revision: 3,
            startTime: '08:00',
            endTime: '16:00',
            crossesMidnight: false,
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');
        const replay = await ShiftTemplateService.remove(71, 4, 2, 3);
        expect(replay.active).toBe(false);
        expect(transaction).not.toHaveBeenCalled();
        expect(getById).toHaveBeenCalledTimes(1);
    });

    it('refuses deletion while a draft schedule still references the template', async () => {
        jest.spyOn(ShiftTemplateService, 'getById').mockResolvedValue({
            ...template,
            startTime: '08:00',
            endTime: '16:00',
            crossesMidnight: false,
        } as never);
        const tx = {
            scheduledShift: {
                findFirst: jest.fn().mockResolvedValue({ id: 80, scheduleId: 91 } as never),
            },
            shiftTemplate: { updateMany: jest.fn() },
        };
        mockSerializableTransaction(tx);

        await expect(ShiftTemplateService.remove(71, 4, 2, 3))
            .rejects.toMatchObject({
                statusCode: 409,
                message: expect.stringContaining('agenda borrador 91'),
            });
        expect(tx.shiftTemplate.updateMany).not.toHaveBeenCalled();
    });

    it('derives authoritative shift values and immutable presentation snapshots from a template', async () => {
        mockShiftNormalizationDependencies();
        const templates = jest.spyOn(prisma.shiftTemplate, 'findMany').mockResolvedValue([template] as never);
        jest.spyOn(prisma.weeklySchedule, 'findFirst').mockResolvedValue(null as never);
        jest.spyOn(WeeklyScheduleService, 'getById').mockResolvedValue({ id: 91 } as never);
        const tx = {
            weeklySchedule: {
                create: jest.fn().mockResolvedValue({ id: 91, version: 1 } as never),
            },
            scheduledShift: {
                createMany: jest.fn().mockResolvedValue({ count: 1 } as never),
            },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 4 } as never) },
        };
        mockSerializableTransaction(tx);

        await WeeklyScheduleService.createDraft(4, {
            weekStart: '2026-07-13',
            shifts: [{
                userId: 8,
                branchId: 10,
                shiftTemplateId: 71,
                date: '2026-07-14',
            }],
        }, 3);

        expect(templates).toHaveBeenCalledWith(expect.objectContaining({
            where: { companyId: 4, id: { in: [71] }, active: true },
        }));
        const persisted = (tx.scheduledShift.createMany.mock.calls[0][0] as {
            data: Array<Record<string, unknown>>;
        }).data[0];
        expect(persisted).toEqual(expect.objectContaining({
            companyId: 4,
            branchId: 10,
            jobPositionId: 21,
            shiftTemplateId: 71,
            templateNameSnapshot: 'Jornada mañana',
            templateColorSnapshot: '#3B82F6',
            breakMinutes: 30,
            paidBreak: false,
        }));
        expect((persisted.startAt as Date).toISOString()).toBe('2026-07-14T14:00:00.000Z');
        expect((persisted.endAt as Date).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    });

    it('rejects forged template times and breaks', async () => {
        mockShiftNormalizationDependencies();
        jest.spyOn(prisma.shiftTemplate, 'findMany').mockResolvedValue([template] as never);

        await expect(WeeklyScheduleService.createDraft(4, {
            weekStart: '2026-07-13',
            shifts: [{
                userId: 8,
                branchId: 10,
                jobPositionId: 21,
                shiftTemplateId: 71,
                date: '2026-07-14',
                startTime: '09:00',
                endTime: '16:00',
                breakMinutes: 30,
            }],
        }, 3)).rejects.toThrow('startTime no coincide');

        await expect(WeeklyScheduleService.createDraft(4, {
            weekStart: '2026-07-13',
            shifts: [{
                userId: 8,
                branchId: 10,
                jobPositionId: 21,
                shiftTemplateId: 71,
                date: '2026-07-14',
                startTime: '08:00',
                endTime: '16:00',
                breakMinutes: 0,
            }],
        }, 3)).rejects.toThrow('breakMinutes no coincide');
    });

    it('rejects a position-restricted template for an employee in another position', async () => {
        jest.restoreAllMocks();
        jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([{
            id: 10,
            timezone: 'America/Managua',
        }] as never);
        jest.spyOn(prisma.user, 'findMany').mockResolvedValue([{
            id: 8,
            branchId: 10,
            allowedBranches: [],
            employee: {
                jobPositionId: 22,
                branchAssignments: [activeAssignment],
            },
        }] as never);
        jest.spyOn(prisma.jobPosition, 'findMany').mockResolvedValue([{ id: 21 }] as never);
        jest.spyOn(prisma.shiftTemplate, 'findMany').mockResolvedValue([template] as never);

        await expect(WeeklyScheduleService.createDraft(4, {
            weekStart: '2026-07-13',
            shifts: [{
                userId: 8,
                branchId: 10,
                shiftTemplateId: 71,
                date: '2026-07-14',
            }],
        }, 3)).rejects.toThrow('no corresponde al puesto');
    });

    it('copies historical shifts from snapshots without consulting current or active templates', async () => {
        const getById = jest.spyOn(WeeklyScheduleService, 'getById');
        getById.mockResolvedValueOnce({
            id: 91,
            companyId: 4,
            weekStart: new Date('2026-07-13T00:00:00Z'),
            notes: null,
            shifts: [{
                id: 80,
                originalUserId: 8,
                userId: 8,
                branchId: 10,
                jobPositionId: null,
                shiftTemplateId: 71,
                templateNameSnapshot: 'Nombre histórico',
                templateColorSnapshot: '#112233',
                shiftTemplate: {
                    id: 71,
                    name: 'Nombre actual',
                    code: 'ACTUAL',
                    color: '#FFFFFF',
                },
                date: '2026-07-14',
                startTime: '08:00',
                endTime: '16:00',
                breakMinutes: 30,
                paidBreak: false,
                notes: null,
                status: 'SCHEDULED',
            }],
        } as never).mockResolvedValueOnce({ id: 92 } as never);
        jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([{
            id: 10,
            timezone: 'America/Managua',
        }] as never);
        jest.spyOn(prisma.user, 'findMany').mockResolvedValue([{
            id: 8,
            branchId: 10,
            allowedBranches: [],
            employee: {
                jobPositionId: null,
                branchAssignments: [activeAssignment],
            },
        }] as never);
        jest.spyOn(prisma.jobPosition, 'findMany').mockResolvedValue([] as never);
        const templates = jest.spyOn(prisma.shiftTemplate, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.weeklySchedule, 'findFirst').mockResolvedValue(null as never);
        const tx = {
            weeklySchedule: {
                create: jest.fn().mockResolvedValue({ id: 92, version: 1 } as never),
            },
            scheduledShift: {
                createMany: jest.fn().mockResolvedValue({ count: 1 } as never),
            },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 5 } as never) },
        };
        mockSerializableTransaction(tx);

        await WeeklyScheduleService.copy(91, 4, '2026-07-20', 3);

        expect(templates).toHaveBeenCalledWith(expect.objectContaining({
            where: { companyId: 4, id: { in: [] }, active: true },
        }));
        const persisted = (tx.scheduledShift.createMany.mock.calls[0][0] as {
            data: Array<Record<string, unknown>>;
        }).data[0];
        expect(persisted).toEqual(expect.objectContaining({
            shiftTemplateId: null,
            templateNameSnapshot: 'Nombre histórico',
            templateColorSnapshot: '#112233',
        }));
    });

    it('applies tenant and branch scope to reads', async () => {
        const findFirst = jest.spyOn(prisma.shiftTemplate, 'findFirst').mockResolvedValue(null as never);

        await expect(ShiftTemplateService.getById(71, 4, 10))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 71, companyId: 4, branchId: 10 },
        }));
    });

    it('surfaces schedule domain conflicts as explicit errors', () => {
        expect(new HrScheduleError('conflict', 409)).toMatchObject({
            message: 'conflict',
            statusCode: 409,
        });
    });
});
