import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { isValidTimeZone, zonedDateKey } from '../utils/timezone';
import { AuditLogService } from './audit-log.service';
import { BranchService } from './branch.service';

export class HrDomainError extends Error {
    constructor(message: string, public readonly statusCode = 400) {
        super(message);
        this.name = 'HrDomainError';
    }
}

const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'] as const;
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACTOR', 'INTERN'] as const;
const ACCOUNT_TYPES = ['INTERNAL', 'EXTERNAL'] as const;
const PAY_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'FORTNIGHTLY', 'MONTHLY'] as const;

type EmployeeStatusValue = typeof EMPLOYEE_STATUSES[number];
type EmploymentTypeValue = typeof EMPLOYMENT_TYPES[number];
type AccountTypeValue = typeof ACCOUNT_TYPES[number];
type PayFrequencyValue = typeof PAY_FREQUENCIES[number];

export interface EmployeeInitialCompensationInput {
    compensationType?: 'SALARY' | 'HOURLY';
    payFrequency?: PayFrequencyValue;
    amount?: string;
    currency?: string;
    reason?: string;
}

export interface EmployeeWriteInput {
    userId?: number;
    employeeCode?: string;
    legalName?: string;
    preferredName?: string | null;
    documentType?: string | null;
    documentNumber?: string | null;
    socialSecurityNumber?: string | null;
    taxId?: string | null;
    workEmail?: string | null;
    workPhone?: string | null;
    address?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelationship?: string | null;
    hireDate?: string;
    terminationDate?: string | null;
    employmentType?: EmploymentTypeValue;
    departmentId?: number | null;
    jobPositionId?: number | null;
    costCenterId?: number | null;
    supervisorEmployeeId?: number | null;
    notes?: string | null;
    branchIds?: number[];
    primaryBranchId?: number | null;
    initialCompensation?: EmployeeInitialCompensationInput;
}

const employeeRelationsSelect = {
    user: {
        select: {
            id: true, name: true, username: true,
            accountType: true, status: true,
        },
    },
    department: { select: { id: true, name: true, code: true, active: true } },
    jobPosition: { select: { id: true, name: true, code: true, active: true, departmentId: true } },
    costCenter: { select: { id: true, name: true, code: true, active: true } },
    supervisor: { select: { id: true, employeeCode: true, legalName: true, status: true } },
    branchAssignments: {
        where: { effectiveTo: null },
        include: { branch: { select: { id: true, name: true, code: true, status: true } } },
        orderBy: [{ isPrimary: 'desc' as const }, { id: 'asc' as const }],
    },
} satisfies Pick<Prisma.EmployeeSelect, 'user' | 'department' | 'jobPosition' | 'costCenter' | 'supervisor' | 'branchAssignments'>;

// The base list deliberately omits sensitive PII. A separate projection adds
// only identification and current compensation after the controller confirms
// hr.employee.sensitive.view; the remaining sensitive fields stay detail-only.
const employeeListSelect = {
    id: true,
    companyId: true,
    userId: true,
    employeeCode: true,
    legalName: true,
    preferredName: true,
    hireDate: true,
    terminationDate: true,
    employmentType: true,
    status: true,
    departmentId: true,
    jobPositionId: true,
    costCenterId: true,
    supervisorEmployeeId: true,
    createdAt: true,
    updatedAt: true,
    ...employeeRelationsSelect,
} satisfies Prisma.EmployeeSelect;

const employeeSensitiveSelect = {
    ...employeeListSelect,
    documentType: true,
    documentNumber: true,
    socialSecurityNumber: true,
    taxId: true,
    workEmail: true,
    workPhone: true,
    address: true,
    emergencyContactName: true,
    emergencyContactPhone: true,
    emergencyContactRelationship: true,
    notes: true,
    user: {
        select: {
            id: true, name: true, email: true, username: true,
            accountType: true, status: true,
        },
    },
    branchAssignments: {
        include: { branch: { select: { id: true, name: true, code: true, status: true } } },
        orderBy: [{ effectiveFrom: 'desc' as const }, { id: 'desc' as const }],
    },
} satisfies Prisma.EmployeeSelect;

const currentCompensationSelect = {
    id: true,
    employeeId: true,
    contractId: true,
    compensationType: true,
    payFrequency: true,
    amount: true,
    currency: true,
    effectiveFrom: true,
    effectiveTo: true,
    reason: true,
    createdAt: true,
} satisfies Prisma.CompensationHistorySelect;

function employeeAuthorizedListSelect(at: Date) {
    return {
        ...employeeListSelect,
        documentType: true,
        documentNumber: true,
        compensation: {
            where: {
                effectiveFrom: { lte: at },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
            },
            select: currentCompensationSelect,
            orderBy: [{ effectiveFrom: 'desc' as const }, { id: 'desc' as const }],
            take: 1,
        },
    } satisfies Prisma.EmployeeSelect;
}

function todayDate(timeZone = 'America/Managua'): Date {
    return parseDateOnly(zonedDateKey(new Date(), timeZone), 'fecha actual');
}

function parseDateOnly(value: string, field: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new HrDomainError(`${field} debe tener formato YYYY-MM-DD`);
    const result = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (
        result.getUTCFullYear() !== Number(match[1]) ||
        result.getUTCMonth() !== Number(match[2]) - 1 ||
        result.getUTCDate() !== Number(match[3])
    ) {
        throw new HrDomainError(`${field} no es una fecha válida`);
    }
    return result;
}

function nullableText(value: unknown, field: string, max = 191): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') throw new HrDomainError(`${field} debe ser texto`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrDomainError(`${field} excede ${max} caracteres`);
    return normalized || null;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw new HrDomainError(`${field} debe ser booleano`);
    return value;
}

function requiredText(value: unknown, field: string, max = 191): string {
    const normalized = nullableText(value, field, max);
    if (!normalized) throw new HrDomainError(`${field} es requerido`);
    return normalized;
}

function initialCompensation(value: unknown): Required<EmployeeInitialCompensationInput> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new HrDomainError('La compensación inicial es requerida para crear el expediente');
    }
    const input = value as Record<string, unknown>;
    const compensationType = requiredText(input.compensationType, 'initialCompensation.compensationType', 20);
    const payFrequency = requiredText(input.payFrequency, 'initialCompensation.payFrequency', 20);
    if (!['SALARY', 'HOURLY'].includes(compensationType)) {
        throw new HrDomainError('initialCompensation.compensationType inválido');
    }
    if (!PAY_FREQUENCIES.includes(payFrequency as PayFrequencyValue)) {
        throw new HrDomainError('initialCompensation.payFrequency inválido');
    }
    const amount = requiredText(input.amount, 'initialCompensation.amount', 40);
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !new Prisma.Decimal(amount).greaterThan(0)) {
        throw new HrDomainError('initialCompensation.amount debe ser positivo con máximo dos decimales');
    }
    const currency = requiredText(input.currency ?? 'NIO', 'initialCompensation.currency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new HrDomainError('initialCompensation.currency debe ser ISO 4217 de tres letras');
    }
    return {
        compensationType: compensationType as Required<EmployeeInitialCompensationInput>['compensationType'],
        payFrequency: payFrequency as PayFrequencyValue,
        amount,
        currency,
        reason: requiredText(input.reason, 'initialCompensation.reason', 500),
    };
}

function positiveInt(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new HrDomainError(`${field} debe ser un entero positivo`);
    return parsed;
}

function optionalId(value: unknown, field: string): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return positiveInt(value, field);
}

function normalizeIdList(value: unknown): number[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new HrDomainError('branchIds debe ser un arreglo');
    return Array.from(new Set(value.map((entry) => positiveInt(entry, 'branchIds'))));
}

async function assertTenantReference(
    companyId: number,
    model: 'department' | 'jobPosition' | 'costCenter' | 'employee',
    id: number | null | undefined,
    currentEmployeeId?: number,
) {
    if (id == null) return;
    if (model === 'department') {
        if (!await prisma.department.findFirst({ where: { id, companyId }, select: { id: true } })) {
            throw new HrDomainError('Departamento no encontrado en la empresa', 404);
        }
    } else if (model === 'jobPosition') {
        if (!await prisma.jobPosition.findFirst({ where: { id, companyId }, select: { id: true } })) {
            throw new HrDomainError('Puesto no encontrado en la empresa', 404);
        }
    } else if (model === 'costCenter') {
        if (!await prisma.costCenter.findFirst({ where: { id, companyId }, select: { id: true } })) {
            throw new HrDomainError('Centro de costo no encontrado en la empresa', 404);
        }
    } else {
        if (id === currentEmployeeId) throw new HrDomainError('Un empleado no puede supervisarse a sí mismo');
        if (!await prisma.employee.findFirst({ where: { id, companyId }, select: { id: true } })) {
            throw new HrDomainError('Supervisor no encontrado en la empresa', 404);
        }
    }
}

async function assertAcyclicSupervisorHierarchy(
    companyId: number,
    employeeId: number | undefined,
    supervisorEmployeeId: number | null | undefined,
    db: Prisma.TransactionClient | typeof prisma = prisma,
) {
    if (!employeeId || supervisorEmployeeId == null) return;
    const visited = new Set<number>();
    let currentId: number | null = supervisorEmployeeId;
    while (currentId !== null) {
        if (currentId === employeeId) {
            throw new HrDomainError('La relación de supervisión no puede formar un ciclo', 409);
        }
        if (visited.has(currentId)) {
            throw new HrDomainError('La jerarquía de supervisión existente contiene un ciclo', 409);
        }
        visited.add(currentId);
        const current: { supervisorEmployeeId: number | null } | null = await db.employee.findFirst({
            where: { id: currentId, companyId },
            select: { supervisorEmployeeId: true },
        });
        if (!current) throw new HrDomainError('Supervisor no encontrado en la empresa', 404);
        currentId = current.supervisorEmployeeId;
    }
}

async function assertBranches(companyId: number, branchIds: number[] | undefined, primaryBranchId?: number | null) {
    if (branchIds === undefined) return;
    if (branchIds.length > 0 && primaryBranchId == null) {
        throw new HrDomainError('Debe seleccionar una sucursal principal cuando existen adscripciones');
    }
    if (primaryBranchId != null && !branchIds.includes(primaryBranchId)) {
        throw new HrDomainError('La sucursal principal debe estar incluida en branchIds');
    }
    if (branchIds.length === 0) return;
    const count = await prisma.branch.count({ where: { id: { in: branchIds }, companyId, status: 'ACTIVE' } });
    if (count !== branchIds.length) {
        throw new HrDomainError('Una o más sucursales no pertenecen a la empresa o están inactivas', 404);
    }
}

export class HrEmployeeService {
    static async list(companyId: number, filters: {
        search?: string;
        status?: string;
        departmentId?: number;
        jobPositionId?: number;
        costCenterId?: number;
        branchId?: number;
        page?: number;
        limit?: number;
    }, options: { sensitive?: boolean; timeZone?: string } = {}) {
        const page = Math.max(1, filters.page || 1);
        const limit = Math.min(100, Math.max(1, filters.limit || 25));
        const where: Prisma.EmployeeWhereInput = { companyId };
        if (filters.status) {
            if (!EMPLOYEE_STATUSES.includes(filters.status as EmployeeStatusValue)) {
                throw new HrDomainError('Estado de empleado inválido');
            }
            where.status = filters.status as EmployeeStatusValue;
        }
        if (filters.departmentId) where.departmentId = filters.departmentId;
        if (filters.jobPositionId) where.jobPositionId = filters.jobPositionId;
        if (filters.costCenterId) where.costCenterId = filters.costCenterId;
        if (filters.branchId) {
            const today = todayDate();
            where.branchAssignments = { some: {
                branchId: filters.branchId,
                effectiveFrom: { lte: today },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
            } };
        }
        const search = filters.search?.trim();
        if (search) {
            where.OR = [
                { employeeCode: { contains: search } },
                { legalName: { contains: search } },
                { preferredName: { contains: search } },
                { user: { name: { contains: search } } },
                { user: { username: { contains: search } } },
                ...(options.sensitive ? [{ documentNumber: { contains: search } }] : []),
            ];
        }
        const select = options.sensitive
            ? employeeAuthorizedListSelect(todayDate(options.timeZone))
            : employeeListSelect;
        const [data, total] = await prisma.$transaction([
            prisma.employee.findMany({
                where, select,
                orderBy: [{ status: 'asc' }, { legalName: 'asc' }],
                skip: (page - 1) * limit, take: limit,
            }),
            prisma.employee.count({ where }),
        ]);
        return { data, pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) } };
    }

    static async getById(id: number, companyId: number, options: { branchId?: number; sensitive?: boolean } = {}) {
        const employee = await prisma.employee.findFirst({
            where: {
                id,
                companyId,
                ...(options.branchId
                    ? { branchAssignments: { some: {
                        branchId: options.branchId,
                        effectiveFrom: { lte: todayDate() },
                        OR: [{ effectiveTo: null }, { effectiveTo: { gte: todayDate() } }],
                    } } }
                    : {}),
            },
            select: options.sensitive ? employeeSensitiveSelect : employeeListSelect,
        });
        if (!employee) throw new HrDomainError('Empleado no encontrado', 404);
        return employee;
    }

    private static async validateReferences(
        companyId: number,
        input: EmployeeWriteInput,
        employeeId?: number,
        current?: { departmentId: number | null; jobPositionId: number | null },
    ) {
        const departmentId = optionalId(input.departmentId, 'departmentId');
        const jobPositionId = optionalId(input.jobPositionId, 'jobPositionId');
        await Promise.all([
            assertTenantReference(companyId, 'department', departmentId),
            assertTenantReference(companyId, 'jobPosition', jobPositionId),
            assertTenantReference(companyId, 'costCenter', optionalId(input.costCenterId, 'costCenterId')),
            assertTenantReference(companyId, 'employee', optionalId(input.supervisorEmployeeId, 'supervisorEmployeeId'), employeeId),
        ]);
        await assertAcyclicSupervisorHierarchy(
            companyId,
            employeeId,
            optionalId(input.supervisorEmployeeId, 'supervisorEmployeeId'),
        );
        const effectiveDepartmentId = input.departmentId !== undefined ? departmentId ?? null : current?.departmentId ?? null;
        const effectiveJobPositionId = input.jobPositionId !== undefined ? jobPositionId ?? null : current?.jobPositionId ?? null;
        if (effectiveJobPositionId !== null) {
            const position = await prisma.jobPosition.findFirst({
                where: { id: effectiveJobPositionId, companyId },
                select: { departmentId: true },
            });
            if (!position) throw new HrDomainError('Puesto no encontrado en la empresa', 404);
            if (position.departmentId !== null && effectiveDepartmentId !== position.departmentId) {
                throw new HrDomainError('El puesto seleccionado no pertenece al departamento indicado');
            }
        }
        const branchIds = normalizeIdList(input.branchIds);
        const primaryBranchId = optionalId(input.primaryBranchId, 'primaryBranchId');
        await assertBranches(companyId, branchIds, primaryBranchId);
        return { branchIds, primaryBranchId };
    }

    static async create(
        companyId: number,
        input: EmployeeWriteInput,
        actorUserId: number,
        scopeBranchId?: number,
    ) {
        const userId = positiveInt(input.userId, 'userId');
        const employeeCode = requiredText(input.employeeCode, 'employeeCode', 50).toUpperCase();
        const hireDate = parseDateOnly(requiredText(input.hireDate, 'hireDate', 10), 'hireDate');
        const user = await prisma.user.findFirst({
            where: {
                id: userId,
                companyId,
                ...(scopeBranchId ? {
                    OR: [
                        { branchId: scopeBranchId },
                        { allowedBranches: { some: { branchId: scopeBranchId } } },
                    ],
                } : {}),
            },
            select: { id: true, name: true, employee: { select: { id: true } } },
        });
        if (!user) throw new HrDomainError('Usuario no encontrado en la empresa', 404);
        if (user.employee) throw new HrDomainError('El usuario ya está ligado a un empleado', 409);
        const { branchIds, primaryBranchId } = await this.validateReferences(companyId, input);
        const employmentType = input.employmentType || 'FULL_TIME';
        if (!EMPLOYMENT_TYPES.includes(employmentType)) throw new HrDomainError('Tipo de empleo inválido');
        const compensation = initialCompensation(input.initialCompensation);

        const created = await prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id: userId }, data: { accountType: 'INTERNAL' } });
            const employee = await tx.employee.create({
                data: {
                    companyId, userId, employeeCode,
                    legalName: input.legalName ? requiredText(input.legalName, 'legalName') : user.name,
                    preferredName: nullableText(input.preferredName, 'preferredName'),
                    documentType: nullableText(input.documentType, 'documentType'),
                    documentNumber: nullableText(input.documentNumber, 'documentNumber'),
                    socialSecurityNumber: nullableText(input.socialSecurityNumber, 'socialSecurityNumber'),
                    taxId: nullableText(input.taxId, 'taxId'),
                    workEmail: nullableText(input.workEmail, 'workEmail'),
                    workPhone: nullableText(input.workPhone, 'workPhone'),
                    address: nullableText(input.address, 'address'),
                    emergencyContactName: nullableText(input.emergencyContactName, 'emergencyContactName'),
                    emergencyContactPhone: nullableText(input.emergencyContactPhone, 'emergencyContactPhone'),
                    emergencyContactRelationship: nullableText(input.emergencyContactRelationship, 'emergencyContactRelationship'),
                    hireDate, employmentType,
                    departmentId: optionalId(input.departmentId, 'departmentId'),
                    jobPositionId: optionalId(input.jobPositionId, 'jobPositionId'),
                    costCenterId: optionalId(input.costCenterId, 'costCenterId'),
                    supervisorEmployeeId: optionalId(input.supervisorEmployeeId, 'supervisorEmployeeId'),
                    notes: nullableText(input.notes, 'notes', 5000),
                },
            });
            if (branchIds?.length) {
                await tx.employeeBranchAssignment.createMany({
                    data: branchIds.map((branchId) => ({
                        companyId, employeeId: employee.id, branchId,
                        isPrimary: branchId === primaryBranchId, effectiveFrom: hireDate,
                    })),
                });
            }
            const compensationRecord = await tx.compensationHistory.create({
                data: {
                    companyId,
                    employeeId: employee.id,
                    changedById: actorUserId,
                    compensationType: compensation.compensationType,
                    payFrequency: compensation.payFrequency,
                    amount: new Prisma.Decimal(compensation.amount),
                    currency: compensation.currency,
                    effectiveFrom: hireDate,
                    reason: compensation.reason,
                },
            });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'Employee', entityId: employee.id,
                action: 'CREATE', details: { employeeCode, linkedUserId: userId, branchIds: branchIds || [] },
            }, tx);
            await AuditLogService.log({
                companyId,
                userId: actorUserId,
                entityType: 'CompensationHistory',
                entityId: compensationRecord.id,
                action: 'CREATE',
                details: {
                    employeeId: employee.id,
                    effectiveFrom: hireDate.toISOString().slice(0, 10),
                    compensationType: compensation.compensationType,
                    payFrequency: compensation.payFrequency,
                    currency: compensation.currency,
                    priorEntryId: null,
                    operation: 'EMPLOYEE_ONBOARDING',
                },
            }, tx);
            return employee;
        });
        // Mutation responses use the non-sensitive projection. PII is only
        // returned by the dedicated detail endpoint guarded with
        // hr.employee.sensitive.view.
        return this.getById(created.id, companyId);
    }

    static async update(
        id: number,
        companyId: number,
        input: EmployeeWriteInput,
        actorUserId: number,
        timeZone = 'America/Managua',
        scopeBranchId?: number,
    ) {
        const existing = await this.getById(id, companyId, { branchId: scopeBranchId });
        const { branchIds, primaryBranchId } = await this.validateReferences(companyId, input, id, existing);
        if (input.employmentType && !EMPLOYMENT_TYPES.includes(input.employmentType)) {
            throw new HrDomainError('Tipo de empleo inválido');
        }
        const data: Prisma.EmployeeUpdateInput = {};
        if (input.employeeCode !== undefined) data.employeeCode = requiredText(input.employeeCode, 'employeeCode', 50).toUpperCase();
        if (input.legalName !== undefined) data.legalName = requiredText(input.legalName, 'legalName');
        const textFields = [
            'preferredName', 'documentType', 'documentNumber', 'socialSecurityNumber', 'taxId',
            'workEmail', 'workPhone', 'address', 'emergencyContactName', 'emergencyContactPhone',
            'emergencyContactRelationship',
        ] as const;
        for (const field of textFields) {
            if (input[field] !== undefined) data[field] = nullableText(input[field], field) as never;
        }
        if (input.notes !== undefined) data.notes = nullableText(input.notes, 'notes', 5000);
        if (input.hireDate !== undefined) {
            const hireDate = parseDateOnly(input.hireDate, 'hireDate');
            if (existing.terminationDate && hireDate > existing.terminationDate) {
                throw new HrDomainError('La fecha de ingreso no puede ser posterior a la terminación');
            }
            data.hireDate = hireDate;
        }
        if (input.terminationDate !== undefined) {
            throw new HrDomainError('La fecha de terminación sólo puede cambiarse mediante el flujo de estado');
        }
        if (input.employmentType !== undefined) data.employmentType = input.employmentType;
        if (input.departmentId !== undefined) data.department = input.departmentId == null ? { disconnect: true } : { connect: { id: input.departmentId } };
        if (input.jobPositionId !== undefined) data.jobPosition = input.jobPositionId == null ? { disconnect: true } : { connect: { id: input.jobPositionId } };
        if (input.costCenterId !== undefined) data.costCenter = input.costCenterId == null ? { disconnect: true } : { connect: { id: input.costCenterId } };
        if (input.supervisorEmployeeId !== undefined) data.supervisor = input.supervisorEmployeeId == null ? { disconnect: true } : { connect: { id: input.supervisorEmployeeId } };

        await prisma.$transaction(async (tx) => {
            if (input.supervisorEmployeeId !== undefined) {
                await tx.$queryRaw(Prisma.sql`
                    SELECT id FROM Employee
                    WHERE companyId = ${companyId}
                    FOR UPDATE
                `);
                await assertAcyclicSupervisorHierarchy(
                    companyId,
                    id,
                    optionalId(input.supervisorEmployeeId, 'supervisorEmployeeId'),
                    tx,
                );
            }
            await tx.employee.update({ where: { id }, data });
            if (branchIds !== undefined) {
                const current = await tx.employeeBranchAssignment.findMany({
                    where: { employeeId: id, effectiveTo: null },
                    select: { id: true, branchId: true },
                });
                const effectiveDate = todayDate(timeZone);
                const removed = current.filter((assignment) => !branchIds.includes(assignment.branchId));
                if (removed.length) {
                    await tx.employeeBranchAssignment.updateMany({
                        where: { id: { in: removed.map((assignment) => assignment.id) } },
                        data: { effectiveTo: effectiveDate, isPrimary: false },
                    });
                }
                for (const assignment of current.filter((entry) => branchIds.includes(entry.branchId))) {
                    await tx.employeeBranchAssignment.update({
                        where: { id: assignment.id }, data: { isPrimary: assignment.branchId === primaryBranchId },
                    });
                }
                const currentIds = new Set(current.map((entry) => entry.branchId));
                const additions = branchIds.filter((branchId) => !currentIds.has(branchId));
                for (const branchId of additions) {
                    // Reopening an assignment removed earlier on the same date must
                    // not collide with the historical unique key.
                    await tx.employeeBranchAssignment.upsert({
                        where: {
                            employeeId_branchId_effectiveFrom: {
                                employeeId: id,
                                branchId,
                                effectiveFrom: effectiveDate,
                            },
                        },
                        create: {
                            companyId, employeeId: id, branchId,
                            isPrimary: branchId === primaryBranchId, effectiveFrom: effectiveDate,
                        },
                        update: {
                            effectiveTo: null,
                            isPrimary: branchId === primaryBranchId,
                        },
                    });
                }
            }
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'Employee', entityId: id,
                action: 'UPDATE',
                details: { before: { employeeCode: existing.employeeCode, status: existing.status }, fields: Object.keys(input) },
            }, tx);
        });
        return this.getById(id, companyId, { branchId: scopeBranchId });
    }

    static async setStatus(
        id: number,
        companyId: number,
        status: EmployeeStatusValue,
        terminationDate: string | undefined,
        reason: string | undefined,
        actorUserId: number,
        timeZone = 'America/Managua',
        scopeBranchId?: number,
    ) {
        if (!EMPLOYEE_STATUSES.includes(status)) throw new HrDomainError('Estado de empleado inválido');
        const existing = await this.getById(id, companyId, { branchId: scopeBranchId });
        if (existing.status === status) return existing;
        if (existing.status === 'TERMINATED') {
            throw new HrDomainError('Un expediente terminado no puede reactivarse; se requiere un flujo de recontratación', 409);
        }
        const statusDate = terminationDate ? parseDateOnly(terminationDate, 'terminationDate') : todayDate(timeZone);
        if (status === 'TERMINATED') {
            if (statusDate < existing.hireDate) {
                throw new HrDomainError('La fecha de terminación no puede ser anterior a la fecha de ingreso');
            }
            if (statusDate > todayDate(timeZone)) {
                throw new HrDomainError('No se puede marcar como terminado con una fecha futura');
            }
        } else if (terminationDate) {
            throw new HrDomainError('terminationDate sólo aplica al estado TERMINATED');
        }
        await prisma.$transaction(async (tx) => {
            let biometricPurgeRequestId: number | null = null;
            const changed = await tx.employee.updateMany({
                where: { id, companyId, status: existing.status },
                data: {
                    status,
                    terminationDate: status === 'TERMINATED' ? statusDate : null,
                },
            });
            if (changed.count !== 1) {
                throw new HrDomainError('El estado del empleado cambió concurrentemente; recargue el expediente', 409);
            }
            if (status === 'TERMINATED') {
                const [futureAssignment, futureContract] = await Promise.all([
                    tx.employeeBranchAssignment.findFirst({
                        where: { employeeId: id, effectiveTo: null, effectiveFrom: { gt: statusDate } },
                        select: { id: true },
                    }),
                    tx.employmentContract.findFirst({
                        where: { employeeId: id, status: 'ACTIVE', startDate: { gt: statusDate } },
                        select: { id: true },
                    }),
                ]);
                if (futureAssignment || futureContract) {
                    throw new HrDomainError('La fecha de terminación no puede ser anterior al inicio de una adscripción o contrato vigente');
                }
                await tx.employeeBranchAssignment.updateMany({
                    where: { employeeId: id, effectiveTo: null },
                    data: { effectiveTo: statusDate, isPrimary: false },
                });
                await tx.employmentContract.updateMany({
                    where: { employeeId: id, status: 'ACTIVE' },
                    data: { status: 'TERMINATED', endDate: statusDate },
                });
                await tx.user.updateMany({
                    where: { id: existing.userId, companyId },
                    data: { status: 'INACTIVE' },
                });
                await tx.userSession.updateMany({
                    where: { userId: existing.userId, revoked: false },
                    data: { revoked: true },
                });
                const biometric = await tx.biometricProfile.findFirst({
                    where: { companyId, userId: existing.userId, status: 'ACTIVE' },
                    select: { id: true, provider: true, templateRef: true },
                });
                if (biometric) {
                    const now = new Date();
                    const revoked = await tx.biometricProfile.updateMany({
                        where: { id: biometric.id, companyId, userId: existing.userId, status: 'ACTIVE' },
                        data: {
                            status: 'REVOKED',
                            templateRef: `REVOKED:${randomUUID()}`,
                            revokedAt: now,
                            purgeRequestedAt: now,
                            revocationReason: 'EMPLOYMENT_TERMINATED',
                        },
                    });
                    if (revoked.count === 1) {
                        const purge = await tx.biometricPurgeRequest.create({
                            data: {
                                companyId,
                                biometricProfileId: biometric.id,
                                provider: biometric.provider,
                                encryptedTemplateRef: biometric.templateRef,
                                reason: 'EMPLOYMENT_TERMINATED',
                                status: 'PENDING',
                                attempts: 0,
                                nextAttemptAt: now,
                            },
                            select: { id: true },
                        });
                        biometricPurgeRequestId = purge.id;
                    }
                }
            }
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'Employee', entityId: id,
                action: 'UPDATE',
                details: {
                    field: 'status', from: existing.status, to: status,
                    reason: reason?.trim() || null,
                    biometricPurgeRequestId,
                },
            }, tx);
        });
        return this.getById(id, companyId);
    }

    static async setUserAccountType(
        userId: number,
        companyId: number,
        accountType: AccountTypeValue,
        _actorUserId: number,
    ) {
        if (!ACCOUNT_TYPES.includes(accountType)) throw new HrDomainError('Tipo de cuenta inválido');
        const user = await prisma.user.findFirst({
            where: { id: userId, companyId },
            select: { id: true, name: true, accountType: true, employee: { select: { id: true } } },
        });
        if (!user) throw new HrDomainError('Usuario no encontrado en la empresa', 404);
        if (accountType === 'EXTERNAL' && user.employee) {
            throw new HrDomainError('No se puede convertir a EXTERNAL porque el expediente histórico requiere conservar el vínculo; esta transición no está implementada', 409);
        }
        if (accountType === 'INTERNAL' && !user.employee) {
            throw new HrDomainError('El tipo INTERNAL solo se asigna durante el alta real en /api/v1/hr/employees', 409);
        }
        const updated = await prisma.user.update({
            where: { id: userId }, data: { accountType },
            select: { id: true, accountType: true, employee: { select: { id: true, employeeCode: true, status: true } } },
        });
        return updated;
    }
}

type CatalogKind = 'department' | 'jobPosition' | 'costCenter';

export class HrCatalogService {
    static async list(kind: CatalogKind, companyId: number) {
        if (kind === 'department') return prisma.department.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
        if (kind === 'jobPosition') return prisma.jobPosition.findMany({
            where: { companyId }, include: { department: { select: { id: true, name: true, code: true } } }, orderBy: { name: 'asc' },
        });
        return prisma.costCenter.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
    }

    static async create(
        kind: CatalogKind,
        companyId: number,
        input: { name?: string; code?: string; description?: string | null; departmentId?: number | null },
        actorUserId: number,
    ) {
        const name = requiredText(input.name, 'name', 100);
        const code = requiredText(input.code, 'code', 30).toUpperCase();
        const description = nullableText(input.description, 'description', 191);
        const departmentId = optionalId(input.departmentId, 'departmentId');
        if (kind === 'jobPosition') await assertTenantReference(companyId, 'department', departmentId);
        return prisma.$transaction(async (tx) => {
            const record = kind === 'department'
                ? await tx.department.create({ data: { companyId, name, code, description } })
                : kind === 'jobPosition'
                    ? await tx.jobPosition.create({ data: { companyId, name, code, description, departmentId } })
                    : await tx.costCenter.create({ data: { companyId, name, code, description } });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: kind, entityId: record.id,
                action: 'CREATE', details: { name, code },
            }, tx);
            return record;
        });
    }

    static async update(
        kind: CatalogKind,
        id: number,
        companyId: number,
        input: { name?: string; code?: string; description?: string | null; departmentId?: number | null; active?: boolean },
        actorUserId: number,
    ) {
        const model = kind === 'department' ? prisma.department : kind === 'jobPosition' ? prisma.jobPosition : prisma.costCenter;
        const existing = await (model as typeof prisma.department).findFirst({ where: { id, companyId } });
        if (!existing) throw new HrDomainError('Registro de catálogo no encontrado', 404);
        const data = {
            ...(input.name !== undefined ? { name: requiredText(input.name, 'name', 100) } : {}),
            ...(input.code !== undefined ? { code: requiredText(input.code, 'code', 30).toUpperCase() } : {}),
            ...(input.description !== undefined ? { description: nullableText(input.description, 'description', 191) } : {}),
            ...(input.active !== undefined ? { active: optionalBoolean(input.active, 'active') } : {}),
        };
        if (kind === 'jobPosition' && input.departmentId !== undefined) {
            const departmentId = optionalId(input.departmentId, 'departmentId');
            await assertTenantReference(companyId, 'department', departmentId);
            Object.assign(data, { departmentId });
        }
        return prisma.$transaction(async (tx) => {
            const txModel = kind === 'department' ? tx.department : kind === 'jobPosition' ? tx.jobPosition : tx.costCenter;
            const record = await (txModel as typeof tx.department).update({ where: { id }, data });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: kind, entityId: id,
                action: 'UPDATE', details: { fields: Object.keys(input) },
            }, tx);
            return record;
        });
    }
}

function decimalToNumber(value: Prisma.Decimal | null): number | null {
    return value === null ? null : Number(value);
}

function validateGeofenceValues(values: {
    latitude: number | null;
    longitude: number | null;
    geofenceRadiusM: number | null;
    maxLocationAccuracyM: number | null;
    timezone: string;
    attendanceEnabled: boolean;
}, requirePosition = false) {
    const { latitude, longitude, geofenceRadiusM, maxLocationAccuracyM, timezone, attendanceEnabled } = values;
    if ((latitude === null) !== (longitude === null)) throw new HrDomainError('Latitud y longitud deben configurarse juntas');
    if (latitude === null && (geofenceRadiusM !== null || maxLocationAccuracyM !== null)) {
        throw new HrDomainError('El radio y la precisión GPS requieren coordenadas configuradas');
    }
    if (attendanceEnabled && (latitude === null || longitude === null || geofenceRadiusM === null || maxLocationAccuracyM === null)) {
        throw new HrDomainError('No se puede habilitar asistencia sin coordenadas, radio y precisión máxima');
    }
    if (requirePosition && (latitude === null || longitude === null)) throw new HrDomainError('Toda sucursal nueva requiere latitud y longitud');
    if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw new HrDomainError('Latitud fuera de rango');
    if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new HrDomainError('Longitud fuera de rango');
    if (geofenceRadiusM !== null && (!Number.isInteger(geofenceRadiusM) || geofenceRadiusM < 10 || geofenceRadiusM > 10000)) {
        throw new HrDomainError('geofenceRadiusM debe estar entre 10 y 10000 metros');
    }
    if (maxLocationAccuracyM !== null && (!Number.isInteger(maxLocationAccuracyM) || maxLocationAccuracyM < 1 || maxLocationAccuracyM > 5000)) {
        throw new HrDomainError('maxLocationAccuracyM debe estar entre 1 y 5000 metros');
    }
    if (!isValidTimeZone(timezone)) throw new HrDomainError('Zona horaria inválida');
}

export class HrGeofenceService {
    static async createBranch(companyId: number, input: {
        name?: string;
        code?: string;
        address?: string | null;
        phone?: string | null;
        latitude?: number;
        longitude?: number;
        geofenceRadiusM?: number;
        maxLocationAccuracyM?: number;
        timezone?: string;
        attendanceEnabled?: boolean;
        status?: 'ACTIVE' | 'INACTIVE';
    }, actorUserId: number) {
        const name = requiredText(input.name, 'name', 200);
        const code = requiredText(input.code, 'code', 20).toUpperCase();
        const latitude = input.latitude === undefined ? null : Number(input.latitude);
        const longitude = input.longitude === undefined ? null : Number(input.longitude);
        const geofenceRadiusM = input.geofenceRadiusM === undefined ? null : Number(input.geofenceRadiusM);
        const maxLocationAccuracyM = input.maxLocationAccuracyM === undefined ? null : Number(input.maxLocationAccuracyM);
        const timezone = input.timezone?.trim() || 'America/Managua';
        const attendanceEnabled = input.attendanceEnabled ?? false;
        const status = input.status || 'ACTIVE';
        if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new HrDomainError('Estado de sucursal inválido');
        if (attendanceEnabled && status !== 'ACTIVE') throw new HrDomainError('No se puede habilitar asistencia en una sucursal inactiva');
        validateGeofenceValues({
            latitude, longitude, geofenceRadiusM, maxLocationAccuracyM, timezone, attendanceEnabled,
        }, true);
        if (latitude === null || longitude === null || geofenceRadiusM === null || maxLocationAccuracyM === null) {
            throw new HrDomainError('Toda sucursal nueva requiere coordenadas, radio de geocerca y precisión máxima');
        }
        return BranchService.create({
            companyId, name, code,
            address: nullableText(input.address, 'address') || undefined,
            phone: nullableText(input.phone, 'phone') || undefined,
            latitude, longitude, geofenceRadiusM, maxLocationAccuracyM,
            timezone, attendanceEnabled, status,
        }, actorUserId);
    }

    static async get(branchId: number, companyId: number) {
        const branch = await prisma.branch.findFirst({
            where: { id: branchId, companyId },
            select: {
                id: true, name: true, latitude: true, longitude: true, geofenceRadiusM: true,
                maxLocationAccuracyM: true, timezone: true, attendanceEnabled: true,
                geofenceVersion: true, updatedAt: true,
            },
        });
        if (!branch) throw new HrDomainError('Sucursal no encontrada', 404);
        return {
            branchId: branch.id,
            branchName: branch.name,
            latitude: decimalToNumber(branch.latitude),
            longitude: decimalToNumber(branch.longitude),
            geofenceRadiusM: branch.geofenceRadiusM,
            maxLocationAccuracyM: branch.maxLocationAccuracyM,
            timezone: branch.timezone,
            attendanceEnabled: branch.attendanceEnabled,
            version: branch.geofenceVersion,
            updatedAt: branch.updatedAt,
        };
    }

    static async update(branchId: number, companyId: number, input: {
        name?: string;
        code?: string;
        address?: string | null;
        phone?: string | null;
        status?: 'ACTIVE' | 'INACTIVE';
        latitude?: number | null;
        longitude?: number | null;
        geofenceRadiusM?: number | null;
        maxLocationAccuracyM?: number | null;
        timezone?: string | null;
        attendanceEnabled?: boolean;
        expectedVersion?: number;
    }, actorUserId: number) {
        const existing = await prisma.branch.findFirst({ where: { id: branchId, companyId } });
        if (!existing) throw new HrDomainError('Sucursal no encontrada', 404);
        const latitude = input.latitude !== undefined ? input.latitude : decimalToNumber(existing.latitude);
        const longitude = input.longitude !== undefined ? input.longitude : decimalToNumber(existing.longitude);
        const geofenceRadiusM = input.geofenceRadiusM !== undefined ? input.geofenceRadiusM : existing.geofenceRadiusM;
        const maxLocationAccuracyM = input.maxLocationAccuracyM !== undefined ? input.maxLocationAccuracyM : existing.maxLocationAccuracyM;
        const timezone = input.timezone !== undefined ? input.timezone?.trim() || 'America/Managua' : existing.timezone;
        const status = input.status ?? existing.status;
        if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new HrDomainError('Estado de sucursal inválido');
        const requestedAttendance = input.attendanceEnabled !== undefined ? input.attendanceEnabled : existing.attendanceEnabled;
        const attendanceEnabled = status === 'INACTIVE' ? false : requestedAttendance;

        validateGeofenceValues(
            { latitude, longitude, geofenceRadiusM, maxLocationAccuracyM, timezone, attendanceEnabled },
            true,
        );
        if (geofenceRadiusM === null || maxLocationAccuracyM === null) {
            throw new HrDomainError('La sucursal debe conservar radio de geocerca y precisión máxima');
        }
        if (input.expectedVersion !== undefined && input.expectedVersion !== existing.geofenceVersion) {
            throw new HrDomainError('La geocerca fue modificada por otro usuario', 409);
        }
        const nextVersion = existing.geofenceVersion + 1;
        await prisma.$transaction(async (tx) => {
            const updated = await tx.branch.updateMany({
                where: { id: branchId, companyId, geofenceVersion: existing.geofenceVersion },
                data: {
                    ...(input.name !== undefined ? { name: requiredText(input.name, 'name', 200) } : {}),
                    ...(input.code !== undefined ? { code: requiredText(input.code, 'code', 20).toUpperCase() } : {}),
                    ...(input.address !== undefined ? { address: nullableText(input.address, 'address') } : {}),
                    ...(input.phone !== undefined ? { phone: nullableText(input.phone, 'phone') } : {}),
                    ...(input.status !== undefined ? { status } : {}),
                    latitude, longitude, geofenceRadiusM, maxLocationAccuracyM,
                    timezone, attendanceEnabled, geofenceVersion: nextVersion,
                },
            });
            if (updated.count !== 1) throw new HrDomainError('La geocerca fue modificada por otro usuario', 409);
            await tx.branchGeofenceVersion.create({
                data: {
                    companyId, branchId, version: nextVersion, latitude, longitude,
                    geofenceRadiusM, maxLocationAccuracyM, timezone, attendanceEnabled, changedById: actorUserId,
                },
            });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'BranchGeofence', entityId: branchId,
                action: 'UPDATE', details: { version: nextVersion, attendanceEnabled, fields: Object.keys(input) },
            }, tx);
        });
        return this.get(branchId, companyId);
    }
}

export class HrOverviewService {
    static async dashboard(companyId: number, branchId?: number) {
        const employeeWhere: Prisma.EmployeeWhereInput = {
            companyId,
            ...(branchId ? { branchAssignments: { some: { branchId, effectiveTo: null } } } : {}),
        };
        const branchWhere: Prisma.BranchWhereInput = { companyId, ...(branchId ? { id: branchId } : {}) };
        const scopedUserRelation = branchId
            ? { user: { employee: { branchAssignments: { some: { branchId, effectiveTo: null } } } } }
            : {};
        const scopedEmployeeRelation = branchId
            ? { employee: { branchAssignments: { some: { branchId, effectiveTo: null } } } }
            : {};
        const [total, active, onLeave, inactive, suspended, terminated, internalAccounts,
            departments, jobPositions, costCenters, totalBranches, geofenceConfigured, attendanceEnabled,
            leaveRequests, overtimeRequests, attendanceCorrections, attendanceIncidents, loanRequests,
            activeRule, draftRuns, reviewRuns, approvedRuns] = await Promise.all([
            prisma.employee.count({ where: employeeWhere }),
            prisma.employee.count({ where: { ...employeeWhere, status: 'ACTIVE' } }),
            prisma.employee.count({ where: { ...employeeWhere, status: 'ON_LEAVE' } }),
            prisma.employee.count({ where: { ...employeeWhere, status: 'INACTIVE' } }),
            prisma.employee.count({ where: { ...employeeWhere, status: 'SUSPENDED' } }),
            prisma.employee.count({ where: { ...employeeWhere, status: 'TERMINATED' } }),
            prisma.user.count({
                where: {
                    companyId,
                    accountType: 'INTERNAL',
                    ...(branchId ? { employee: { branchAssignments: { some: { branchId, effectiveTo: null } } } } : {}),
                },
            }),
            prisma.department.count({ where: { companyId, active: true } }),
            prisma.jobPosition.count({ where: { companyId, active: true } }),
            prisma.costCenter.count({ where: { companyId, active: true } }),
            prisma.branch.count({ where: branchWhere }),
            prisma.branch.count({
                where: {
                    ...branchWhere, latitude: { not: null }, longitude: { not: null },
                    geofenceRadiusM: { not: null }, maxLocationAccuracyM: { not: null },
                },
            }),
            prisma.branch.count({ where: { ...branchWhere, attendanceEnabled: true } }),
            prisma.leaveRequest.count({
                where: { companyId, status: 'PENDING', ...scopedUserRelation },
            }),
            prisma.overtimeRequest.count({
                where: { companyId, status: 'PENDING', ...scopedUserRelation },
            }),
            prisma.attendanceCorrection.count({
                where: { companyId, status: 'PENDING', ...scopedUserRelation },
            }),
            prisma.attendanceIncident.count({
                where: { companyId, status: 'OPEN', ...scopedUserRelation },
            }),
            prisma.hrLoan.count({
                where: { companyId, status: 'REQUESTED', ...scopedEmployeeRelation },
            }),
            prisma.payrollRuleVersion.count({ where: { companyId, status: 'ACTIVE' } }),
            prisma.payrollRun.count({ where: { companyId, status: 'DRAFT' } }),
            prisma.payrollRun.count({ where: { companyId, status: 'REVIEW' } }),
            prisma.payrollRun.count({ where: { companyId, status: 'APPROVED' } }),
        ]);
        return {
            employees: { total, active, onLeave, inactive, suspended, terminated, internalAccounts },
            catalogs: { departments, jobPositions, costCenters },
            branches: { total: totalBranches, geofenceConfigured, attendanceEnabled },
            attention: { leaveRequests, overtimeRequests, attendanceCorrections, attendanceIncidents, loanRequests },
            payroll: { activeRule: activeRule > 0, draftRuns, reviewRuns, approvedRuns },
        };
    }

    static async lookups(companyId: number, branchId?: number) {
        const [users, branches, departments, jobPositions, costCenters] = await Promise.all([
            prisma.user.findMany({
                where: { companyId, ...(branchId ? { branchId } : {}) },
                select: {
                    id: true, name: true, username: true, accountType: true, status: true,
                    employee: { select: { id: true, employeeCode: true, status: true } },
                },
                orderBy: { name: 'asc' },
            }),
            prisma.branch.findMany({
                where: { companyId, ...(branchId ? { id: branchId } : {}) },
                select: { id: true, name: true, code: true, status: true },
                orderBy: { name: 'asc' },
            }),
            prisma.department.findMany({ where: { companyId }, select: { id: true, name: true, code: true, active: true }, orderBy: { name: 'asc' } }),
            prisma.jobPosition.findMany({ where: { companyId }, select: { id: true, name: true, code: true, active: true, departmentId: true }, orderBy: { name: 'asc' } }),
            prisma.costCenter.findMany({ where: { companyId }, select: { id: true, name: true, code: true, active: true }, orderBy: { name: 'asc' } }),
        ]);
        return {
            users, branches, departments, jobPositions, costCenters,
            enums: { employeeStatuses: EMPLOYEE_STATUSES, employmentTypes: EMPLOYMENT_TYPES, accountTypes: ACCOUNT_TYPES },
        };
    }
}
