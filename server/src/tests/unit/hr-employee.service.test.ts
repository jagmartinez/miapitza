import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { HrEmployeeService } from '../../services/hr.service';

describe('HrEmployeeService tenant and account invariants', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('creates the Employee, initial compensation and INTERNAL user in one audited transaction', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 21, name: 'Ana Pérez', employee: null,
        } as never);
        const tx = {
            user: { update: jest.fn().mockResolvedValue({ id: 21 } as never) },
            employee: { create: jest.fn().mockResolvedValue({ id: 8, employeeCode: 'EMP-21' } as never) },
            employeeBranchAssignment: { createMany: jest.fn() },
            compensationHistory: { create: jest.fn().mockResolvedValue({ id: 51 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );
        const employeeFind = jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue({
            id: 8, companyId: 4, userId: 21, employeeCode: 'EMP-21', legalName: 'Ana Pérez',
        } as never);

        const result = await HrEmployeeService.create(4, {
            userId: 21,
            employeeCode: 'emp-21',
            legalName: 'Ana Pérez',
            hireDate: '2026-07-13',
            initialCompensation: {
                compensationType: 'SALARY', payFrequency: 'BIWEEKLY', amount: '12500.00',
                currency: 'NIO', reason: 'Oferta laboral aprobada',
            },
        }, 3);

        expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 21 }, data: { accountType: 'INTERNAL' } });
        expect(tx.employee.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ companyId: 4, userId: 21, employeeCode: 'EMP-21' }),
        }));
        expect(tx.compensationHistory.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                companyId: 4, employeeId: 8, changedById: 3, payFrequency: 'BIWEEKLY',
                amount: expect.objectContaining({}), effectiveFrom: new Date('2026-07-13T00:00:00.000Z'),
            }),
        }));
        expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
        expect(result).toEqual(expect.objectContaining({ id: 8, companyId: 4 }));
        const returnedSelect = employeeFind.mock.calls[0][0]?.select as Record<string, unknown>;
        expect(returnedSelect).not.toHaveProperty('documentNumber');
        expect(returnedSelect).not.toHaveProperty('socialSecurityNumber');
    });

    it('rejects onboarding without an initial compensation before opening the transaction', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 21, name: 'Ana Pérez', employee: null,
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(HrEmployeeService.create(4, {
            userId: 21, employeeCode: 'EMP-21', legalName: 'Ana Pérez', hireDate: '2026-07-13',
        }, 3)).rejects.toThrow('compensación inicial');

        expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects a user outside the authoritative tenant', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(HrEmployeeService.create(4, {
            userId: 99, employeeCode: 'EMP-99', hireDate: '2026-07-13',
        }, 3)).rejects.toMatchObject({ statusCode: 404 });
        expect(transaction).not.toHaveBeenCalled();
        expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 99, companyId: 4 } }));
    });

    it('also scopes the linked user to the manager branch', async () => {
        const findFirst = jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);

        await expect(HrEmployeeService.create(4, {
            userId: 99, employeeCode: 'EMP-99', hireDate: '2026-07-13',
            branchIds: [10], primaryBranchId: 10,
        }, 3, 10)).rejects.toMatchObject({ statusCode: 404 });

        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: 99,
                companyId: 4,
                OR: [
                    { branchId: 10 },
                    { allowedBranches: { some: { branchId: 10 } } },
                ],
            }),
        }));
    });

    it('never invents an Employee when accountType is changed directly', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 21, name: 'Ana Pérez', accountType: 'EXTERNAL', employee: null,
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(HrEmployeeService.setUserAccountType(21, 4, 'INTERNAL', 3))
            .rejects.toMatchObject({ statusCode: 409 });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('keeps employee lists tenant/branch scoped and excludes sensitive PII', async () => {
        const findMany = jest.spyOn(prisma.employee, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.employee, 'count').mockResolvedValue(0);
        jest.spyOn(prisma, '$transaction').mockResolvedValue([[], 0] as never);

        await HrEmployeeService.list(4, { branchId: 10, page: 1, limit: 25 });

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 4,
                branchAssignments: { some: expect.objectContaining({
                    branchId: 10,
                    effectiveFrom: expect.objectContaining({ lte: expect.any(Date) }),
                    OR: [{ effectiveTo: null }, { effectiveTo: { gte: expect.any(Date) } }],
                }) },
            }),
            select: expect.objectContaining({
                id: true,
                employeeCode: true,
                legalName: true,
            }),
        }));
        const select = findMany.mock.calls[0][0]?.select as Record<string, unknown>;
        expect(select).not.toHaveProperty('documentNumber');
        expect(select).not.toHaveProperty('socialSecurityNumber');
        expect(select).not.toHaveProperty('taxId');
        expect(select).not.toHaveProperty('address');
        expect(select).not.toHaveProperty('notes');
        expect((select.user as { select: Record<string, unknown> }).select).not.toHaveProperty('email');
    });

    it('returns identification and only the compensation effective today to authorized readers', async () => {
        const findMany = jest.spyOn(prisma.employee, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.employee, 'count').mockResolvedValue(0);
        jest.spyOn(prisma, '$transaction').mockResolvedValue([[], 0] as never);

        await HrEmployeeService.list(4, { page: 1, limit: 25 }, { sensitive: true });

        const select = findMany.mock.calls[0][0]?.select as Record<string, unknown> & {
            compensation?: {
                take?: number;
                where?: { effectiveFrom?: { lte?: Date }; OR?: Array<{ effectiveTo: unknown }> };
            };
        };
        expect(select.documentType).toBe(true);
        expect(select.documentNumber).toBe(true);
        expect(select).not.toHaveProperty('socialSecurityNumber');
        expect(select.compensation).toEqual(expect.objectContaining({
            take: 1,
            where: expect.objectContaining({
                effectiveFrom: { lte: expect.any(Date) },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: expect.any(Date) } }],
            }),
        }));
    });

    it('does not resolve an employee from another company or branch', async () => {
        const findFirst = jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue(null);

        await expect(HrEmployeeService.getById(8, 4, { branchId: 10, sensitive: true }))
            .rejects.toMatchObject({ statusCode: 404 });

        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: 8,
                companyId: 4,
                branchAssignments: { some: expect.objectContaining({
                    branchId: 10,
                    effectiveFrom: expect.objectContaining({ lte: expect.any(Date) }),
                    OR: [{ effectiveTo: null }, { effectiveTo: { gte: expect.any(Date) } }],
                }) },
            },
        }));
    });

    it('returns the non-sensitive projection after an employee mutation', async () => {
        const getById = jest.spyOn(HrEmployeeService, 'getById')
            .mockResolvedValueOnce({
                id: 8, companyId: 4, employeeCode: 'EMP-8', status: 'ACTIVE',
                departmentId: null, jobPositionId: null, terminationDate: null,
            } as never)
            .mockResolvedValueOnce({ id: 8, companyId: 4, employeeCode: 'EMP-8' } as never);
        const tx = {
            employee: { update: jest.fn().mockResolvedValue({ id: 8 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await HrEmployeeService.update(8, 4, {}, 3, 'America/Managua', 10);

        expect(getById).toHaveBeenLastCalledWith(8, 4, { branchId: 10 });
        expect(getById).not.toHaveBeenLastCalledWith(8, 4, expect.objectContaining({ sensitive: true }));
    });

    it('rejects branch assignments without one explicit primary branch', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 21, name: 'Ana Pérez', employee: null,
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(HrEmployeeService.create(4, {
            userId: 21,
            employeeCode: 'EMP-21',
            legalName: 'Ana Pérez',
            hireDate: '2026-07-13',
            branchIds: [10],
            primaryBranchId: null,
        }, 3)).rejects.toThrow('sucursal principal');

        expect(transaction).not.toHaveBeenCalled();
    });

    it('rejects indirect cycles in the supervisor hierarchy', async () => {
        jest.spyOn(prisma.employee, 'findFirst')
            .mockResolvedValueOnce({
                id: 8, companyId: 4, employeeCode: 'EMP-8', status: 'ACTIVE',
                departmentId: null, jobPositionId: null, terminationDate: null,
            } as never)
            .mockResolvedValueOnce({ id: 9 } as never)
            .mockResolvedValueOnce({ supervisorEmployeeId: 8 } as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(HrEmployeeService.update(8, 4, { supervisorEmployeeId: 9 }, 3))
            .rejects.toMatchObject({ statusCode: 409 });

        expect(transaction).not.toHaveBeenCalled();
    });

    it('terminates access and revokes sessions in the same transaction', async () => {
        jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue({
            id: 8,
            companyId: 4,
            userId: 21,
            employeeCode: 'EMP-21',
            legalName: 'Ana Pérez',
            status: 'ACTIVE',
            hireDate: new Date('2025-01-01T00:00:00Z'),
            terminationDate: null,
        } as never);
        const tx = {
            employee: { updateMany: jest.fn().mockResolvedValue({ count: 1 } as never) },
            employeeBranchAssignment: {
                findFirst: jest.fn().mockResolvedValue(null as never),
                updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
            },
            employmentContract: {
                findFirst: jest.fn().mockResolvedValue(null as never),
                updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
            },
            user: { updateMany: jest.fn().mockResolvedValue({ count: 1 } as never) },
            userSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 } as never) },
            biometricProfile: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 31, provider: 'face-provider', templateRef: 'encrypted-template',
                } as never),
                updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
            },
            biometricPurgeRequest: {
                create: jest.fn().mockResolvedValue({ id: 91 } as never),
            },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await HrEmployeeService.setStatus(8, 4, 'TERMINATED', '2026-07-13', 'Baja', 3);

        expect(tx.user.updateMany).toHaveBeenCalledWith({
            where: { id: 21, companyId: 4 },
            data: { status: 'INACTIVE' },
        });
        expect(tx.userSession.updateMany).toHaveBeenCalledWith({
            where: { userId: 21, revoked: false },
            data: { revoked: true },
        });
        expect(tx.biometricProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 31, companyId: 4, userId: 21, status: 'ACTIVE' },
            data: expect.objectContaining({ status: 'REVOKED', revocationReason: 'EMPLOYMENT_TERMINATED' }),
        }));
        expect(tx.biometricPurgeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                companyId: 4,
                biometricProfileId: 31,
                encryptedTemplateRef: 'encrypted-template',
                reason: 'EMPLOYMENT_TERMINATED',
            }),
        }));
    });
});
