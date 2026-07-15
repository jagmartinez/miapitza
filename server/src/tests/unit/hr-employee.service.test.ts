import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { HrEmployeeService } from '../../services/hr.service';

describe('HrEmployeeService tenant and account invariants', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('creates the Employee, marks the User INTERNAL and audits in one transaction', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 21, name: 'Ana Pérez', employee: null,
        } as never);
        const tx = {
            user: { update: jest.fn().mockResolvedValue({ id: 21 } as never) },
            employee: { create: jest.fn().mockResolvedValue({ id: 8, employeeCode: 'EMP-21' } as never) },
            employeeBranchAssignment: { createMany: jest.fn() },
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
        }, 3);

        expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 21 }, data: { accountType: 'INTERNAL' } });
        expect(tx.employee.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ companyId: 4, userId: 21, employeeCode: 'EMP-21' }),
        }));
        expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
        expect(result).toEqual(expect.objectContaining({ id: 8, companyId: 4 }));
        const returnedSelect = employeeFind.mock.calls[0][0]?.select as Record<string, unknown>;
        expect(returnedSelect).not.toHaveProperty('documentNumber');
        expect(returnedSelect).not.toHaveProperty('socialSecurityNumber');
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
                branchAssignments: { some: { branchId: 10, effectiveTo: null } },
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

    it('does not resolve an employee from another company or branch', async () => {
        const findFirst = jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue(null);

        await expect(HrEmployeeService.getById(8, 4, { branchId: 10, sensitive: true }))
            .rejects.toMatchObject({ statusCode: 404 });

        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: 8,
                companyId: 4,
                branchAssignments: { some: { branchId: 10, effectiveTo: null } },
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
            employee: { update: jest.fn().mockResolvedValue({ id: 8 } as never) },
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
    });
});
