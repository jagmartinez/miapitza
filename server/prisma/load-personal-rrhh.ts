/**
 * Initial HR load of the active staff of "La Mia Pitza" (backups/personal-rrhh-20261119.json, git-ignored: contains PII).
 *
 * Creates, per collaborator: User (role EMPLEADO, INTERNAL, ACTIVE, random temporary password,
 * mustChangePassword) + UserRole + UserBranch (1,2,3), Employee (ACTIVE, FULL_TIME), branch
 * assignments (Bamboo primary, effectiveFrom = hireDate), CompensationHistory (SALARY MONTHLY NIO),
 * EmploymentContract ACTIVE (payroll raises MISSING_CONTRACT without one), and the vacation ledger
 * of leave type VAC: opening ADJUSTMENT 2026-10-31, approved November LeaveRequests with their
 * USAGE entry (as LeaveRequestService.decide does) and the November ACCRUAL on 2026-11-30.
 * Also creates the real departments / job positions and the leave type VAC.
 *
 * Also grants the self-service HR permissions (hr.*.self) to role EMPLEADO (resolved by name) and
 * deactivates the demo leave type(s) listed in the plan (active=false, data kept), both audited.
 * Ledger createdAt is strictly increasing in chronological order (the settlement reads the newest).
 *
 * Dry-run by default (read only, no passwords generated; warns about prior POS users of the person):
 *   npx ts-node --transpile-only prisma/load-personal-rrhh.ts [plan.json]
 * Apply (target DB name is mandatory and must match SELECT DATABASE()):
 *   ALLOW_HR_STAFF_LOAD=1 npx ts-node --transpile-only prisma/load-personal-rrhh.ts [plan.json] --apply --expect-db=<db>
 *   (RECON_TX_TIMEOUT_MS overrides the transaction timeout, default 120000)
 *
 * Idempotent: people are matched by employeeCode / documentNumber / username / email; every child
 * row by its natural key (contractNumber, ledger reference, leave dates...). A second run is a
 * no-op. Any conflict (cédula, code, username or email used by somebody else, a closed attendance
 * period, overlapping leave, insufficient balance) blocks the whole load. Everything runs in one
 * transaction; balances per person (tolerance 0.05) and absence of duplicated employees are
 * verified before commit. Temporary passwords exist only at apply time and are written solely to
 * backups/credenciales-personal-20261119-<db>.csv (git-ignored). Output never prints cédulas, salaries
 * or passwords.
 */
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../src/utils/prisma';
import { BCRYPT_ROUNDS, assertStrongPassword, generateStrongRandomPassword } from '../src/utils/password-policy';

type Db = Prisma.TransactionClient | PrismaClient;
type PlanEmployee = {
    item: number; legalName: string; documentType: string; documentNumber: string; employeeCode: string;
    hireDate: string; employmentType: 'FULL_TIME'; status: 'ACTIVE'; jobPositionCode: string;
    monthlySalaryNIO: number; contractNumber: string;
    user: { username: string; email: string; name: string; roleName: string; status: 'ACTIVE'; accountType: 'INTERNAL'; mustChangePassword: boolean; branchId: number };
    branches: { branchId: number; isPrimary: boolean }[];
    vacation: {
        openingAdjustment: { effectiveDate: string; amount: number; reference: string } | null;
        novemberAccrual: { effectiveDate: string; amount: number; rule: string; reference: string };
        leaveRequests: { startDate: string; endDate: string; days: number }[];
        expectedBalance20261130: number; calendarBalance: number | null; toConfirm: boolean;
    };
};
type Plan = {
    companyId: number; actorUserId: number;
    conventions: { balanceTolerance: number };
    departments: { code: string; name: string }[];
    jobPositions: { code: string; name: string; departmentCode: string }[];
    leaveType: { code: string; name: string; description: string; paid: boolean; balanceTracked: boolean; unit: 'DAYS'; requiresAttachment: boolean; active: boolean };
    employeeRole: { name: string; selfPermissions: string[] };
    deactivateLeaveTypeCodes: string[];
    branchNames: Record<string, string>;
    employees: PlanEmployee[];
};

const SOURCE = 'load-personal-rrhh-20261119';
const LEAVE_REASON = 'Vacaciones programadas noviembre 2026 (calendario del negocio)';
const DECISION_REASON = 'Carga inicial: vacaciones aprobadas según calendario del negocio';
const CSV_DIR = path.resolve(__dirname, '../backups');

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const daysInclusive = (a: string, b: string) => Math.round((day(b).getTime() - day(a).getTime()) / 86_400_000) + 1;

class Conflict extends Error {}

/** Ledger createdAt clock: strictly increasing (1 s steps) in insertion order, which is chronological
 * per person (opening < usages < accrual). The settlement (hr-benefits-governance) reads the
 * newest entry by createdAt, so equal timestamps inside one transaction would return the opening. */
function ledgerClock(entries: number) {
    let next = Date.now() - (entries + 5) * 1000;
    return () => new Date(next += 1000);
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

type Counter = Record<string, number>;
const bump = (c: Counter, k: string) => { c[k] = (c[k] || 0) + 1; };

function validatePlan(plan: Plan) {
    const uniq = (xs: string[], what: string) => {
        const seen = new Set<string>();
        for (const x of xs) { if (seen.has(x.toLowerCase())) throw new Error(`Plan: ${what} duplicado`); seen.add(x.toLowerCase()); }
    };
    uniq(plan.employees.map(e => e.employeeCode), 'employeeCode');
    uniq(plan.employees.map(e => e.documentNumber), 'documentNumber');
    uniq(plan.employees.map(e => e.user.username), 'username');
    uniq(plan.employees.map(e => e.user.email), 'email');
    uniq(plan.employees.map(e => e.contractNumber), 'contractNumber');
    const posCodes = new Set(plan.jobPositions.map(p => p.code));
    const deptCodes = new Set(plan.departments.map(d => d.code));
    for (const p of plan.jobPositions) if (!deptCodes.has(p.departmentCode)) throw new Error(`Plan: departamento ${p.departmentCode} inexistente`);
    for (const e of plan.employees) {
        if (!posCodes.has(e.jobPositionCode)) throw new Error(`Plan: puesto ${e.jobPositionCode} inexistente (${e.legalName})`);
        if (e.employeeCode !== e.documentNumber.replace(/-/g, '').toUpperCase()) throw new Error(`Plan: employeeCode no deriva de la cédula (${e.legalName})`);
        if (!(e.monthlySalaryNIO > 0) || Math.round(e.monthlySalaryNIO * 100) !== e.monthlySalaryNIO * 100) throw new Error(`Plan: salario inválido (${e.legalName})`);
        if (e.branches.filter(b => b.isPrimary).length !== 1) throw new Error(`Plan: una sola sucursal principal (${e.legalName})`);
        const v = e.vacation;
        let used = 0;
        for (const lr of v.leaveRequests) {
            if (daysInclusive(lr.startDate, lr.endDate) !== lr.days) throw new Error(`Plan: días de permiso no cuadran (${e.legalName})`);
            if (day(lr.startDate) < day(e.hireDate)) throw new Error(`Plan: permiso antes del ingreso (${e.legalName})`);
            used += lr.days;
        }
        if (v.openingAdjustment && v.openingAdjustment.amount === 0) throw new Error(`Plan: apertura en cero no admitida (${e.legalName})`);
        const expected = r4((v.openingAdjustment?.amount ?? 0) + v.novemberAccrual.amount - used);
        if (Math.abs(expected - v.expectedBalance20261130) > 1e-9) throw new Error(`Plan: saldo esperado inconsistente (${e.legalName})`);
        if (v.calendarBalance !== null && Math.abs(v.calendarBalance - expected) > plan.conventions.balanceTolerance) throw new Error(`Plan: saldo no cuadra con calendario (${e.legalName})`);
    }
}

async function ensureBalance(db: Db, companyId: number, userId: number, leaveTypeId: number, asOf: Date) {
    // Same semantics as hr-workforce.service ensureBalance (scopeKey LEAVE_TYPE:{id}).
    const scopeKey = `LEAVE_TYPE:${leaveTypeId}`;
    const balance = await db.vacationBalance.upsert({
        where: { companyId_userId_scopeKey: { companyId, userId, scopeKey } },
        create: { companyId, userId, leaveTypeId, scopeKey, unit: 'DAYS', asOf },
        update: { sourceRevision: { increment: 1 } },
    });
    if (balance.asOf < asOf) return db.vacationBalance.update({ where: { id: balance.id }, data: { asOf } });
    return balance;
}

async function ledgerSum(db: Db, balanceId: number) {
    const t = await db.vacationLedgerEntry.aggregate({ where: { balanceId }, _sum: { amount: true } });
    return Number(t._sum.amount || 0);
}

type RunResult = { counts: Counter; createdUsers: string[]; conflicts: string[]; changes: number };

/**
 * Walks the plan. mode 'plan' only reads (children of rows that do not exist yet are counted as
 * creations); mode 'apply' writes. Conflicts are collected (plan) or thrown (apply).
 */
async function run(db: Db, plan: Plan, mode: 'plan' | 'apply', hashes: Map<string, string>): Promise<RunResult> {
    const apply = mode === 'apply';
    const { companyId, actorUserId: actor } = plan;
    const stamp = ledgerClock(plan.employees.length * 6);
    const counts: Counter = {};
    const conflicts: string[] = [];
    const createdUsers: string[] = [];
    const conflict = (msg: string) => { if (apply) throw new Conflict(msg); conflicts.push(msg); };
    const audit = (entityType: string, entityId: number, action: string, details: Record<string, unknown>) =>
        db.auditLog.create({ data: { companyId, userId: actor, entityType, entityId, action, details: { ...details, source: SOURCE } as Prisma.InputJsonValue } });

    // ---------- Preconditions ----------
    const branchIds = Object.keys(plan.branchNames).map(Number);
    const [company, actorUser, role, branches, perms] = await Promise.all([
        db.company.findUnique({ where: { id: companyId }, select: { id: true } }),
        db.user.findFirst({ where: { id: plan.actorUserId, companyId }, select: { id: true } }),
        db.role.findUnique({ where: { companyId_name: { companyId, name: plan.employeeRole.name } }, include: { permissions: { select: { id: true, name: true } } } }),
        db.branch.findMany({ where: { companyId, id: { in: branchIds } }, select: { id: true, name: true } }),
        db.permission.findMany({ where: { name: { in: plan.employeeRole.selfPermissions } }, select: { id: true, name: true } }),
    ]);
    if (!company || !actorUser) throw new Error('Empresa o usuario actor no encontrado');
    if (!role) throw new Error(`Rol ${plan.employeeRole.name} no encontrado en la empresa`);
    for (const id of branchIds) {
        const b = branches.find(x => x.id === id);
        if (!b || b.name !== plan.branchNames[String(id)]) throw new Error(`Sucursal ${id} no es "${plan.branchNames[String(id)]}" en la empresa`);
    }
    for (const e of plan.employees) for (const b of e.branches) if (!plan.branchNames[String(b.branchId)]) throw new Error(`Sucursal ${b.branchId} fuera del plan`);
    const missingDefs = plan.employeeRole.selfPermissions.filter(n => !perms.some(p => p.name === n));
    if (missingDefs.length) conflict(`Permisos no definidos en la BD: ${missingDefs.join(', ')}`);

    // ---------- Role EMPLEADO: self-service HR permissions (without duplicating) ----------
    const toGrant = perms.filter(p => !role.permissions.some(rp => rp.id === p.id));
    for (const _ of perms.filter(p => role.permissions.some(rp => rp.id === p.id))) bump(counts, 'rolePermission.exists');
    if (toGrant.length) {
        for (const _ of toGrant) bump(counts, 'rolePermission.create');
        if (apply) {
            await db.role.update({ where: { id: role.id }, data: { permissions: { connect: toGrant.map(p => ({ id: p.id })) } } });
            await audit('Role', role.id, 'UPDATE', { role: role.name, addedPermissions: toGrant.map(p => p.name), operation: 'HR_STAFF_LOAD' });
        }
    }
    const closed = await db.attendancePeriod.findFirst({
        where: { companyId, status: 'CLOSED', dateFrom: { lte: day('2026-11-30') }, dateTo: { gte: day('2026-10-31') } },
        select: { dateFrom: true, dateTo: true },
    });
    if (closed) conflict(`Período de asistencia cerrado ${key(closed.dateFrom)}..${key(closed.dateTo)} (HR_PERIOD_CLOSED)`);

    // ---------- Departments / positions ----------
    const deptIds = new Map<string, number | null>();
    for (const d of plan.departments) {
        const found = await db.department.findMany({ where: { companyId, OR: [{ code: d.code }, { name: d.name }] } });
        if (found.length > 1 || (found[0] && (found[0].code !== d.code || found[0].name !== d.name))) { conflict(`Departamento ${d.name}: código/nombre usado por otro registro`); deptIds.set(d.code, null); continue; }
        if (found[0]) { deptIds.set(d.code, found[0].id); bump(counts, 'department.exists'); continue; }
        bump(counts, 'department.create');
        if (!apply) { deptIds.set(d.code, null); continue; }
        const row = await db.department.create({ data: { companyId, code: d.code, name: d.name, active: true } });
        await audit('Department', row.id, 'CREATE', { code: d.code, name: d.name });
        deptIds.set(d.code, row.id);
    }
    const posIds = new Map<string, number | null>();
    for (const p of plan.jobPositions) {
        const deptId = deptIds.get(p.departmentCode) ?? null;
        const found = await db.jobPosition.findMany({ where: { companyId, OR: [{ code: p.code }, { name: p.name }] } });
        if (found.length > 1 || (found[0] && (found[0].code !== p.code || found[0].name !== p.name || (deptId !== null && found[0].departmentId !== deptId)))) { conflict(`Puesto ${p.name}: código/nombre/departamento en conflicto`); posIds.set(p.code, null); continue; }
        if (found[0]) { posIds.set(p.code, found[0].id); bump(counts, 'jobPosition.exists'); continue; }
        bump(counts, 'jobPosition.create');
        if (!apply) { posIds.set(p.code, null); continue; }
        const row = await db.jobPosition.create({ data: { companyId, code: p.code, name: p.name, departmentId: deptId, active: true } });
        await audit('JobPosition', row.id, 'CREATE', { code: p.code, name: p.name, departmentId: deptId });
        posIds.set(p.code, row.id);
    }
    const deptOfPos = new Map(plan.jobPositions.map(p => [p.code, p.departmentCode]));

    // ---------- Leave type VAC ----------
    const lt = plan.leaveType;
    let leaveTypeId: number | null = null;
    const ltFound = await db.leaveType.findUnique({ where: { companyId_code: { companyId, code: lt.code } } });
    if (ltFound) {
        if (ltFound.paid !== lt.paid || ltFound.balanceTracked !== lt.balanceTracked || ltFound.unit !== lt.unit || !ltFound.active || ltFound.requiresAttachment) conflict(`Tipo de permiso ${lt.code} existe con otra semántica`);
        leaveTypeId = ltFound.id; bump(counts, 'leaveType.exists');
    } else {
        bump(counts, 'leaveType.create');
        if (apply) {
            const row = await db.leaveType.create({ data: { companyId, code: lt.code, name: lt.name, description: lt.description, paid: lt.paid, active: lt.active, balanceTracked: lt.balanceTracked, unit: lt.unit, requiresAttachment: lt.requiresAttachment } });
            await audit('LeaveType', row.id, 'CREATE', { code: lt.code, name: lt.name });
            leaveTypeId = row.id;
        }
    }
    // Demo leave types are deactivated (never deleted: they keep history and demo balances) so the
    // only active tracked DAYS type is VAC (VacationService.adjust without balanceId stays unambiguous).
    for (const code of plan.deactivateLeaveTypeCodes) {
        const demo = await db.leaveType.findUnique({ where: { companyId_code: { companyId, code } } });
        if (!demo) { bump(counts, 'demoLeaveType.absent'); continue; }
        if (!demo.active) { bump(counts, 'demoLeaveType.inactive'); continue; }
        bump(counts, 'demoLeaveType.deactivate');
        if (apply) {
            await db.leaveType.update({ where: { id: demo.id }, data: { active: false } });
            await audit('LeaveType', demo.id, 'UPDATE', { fields: ['active'], code, active: { from: true, to: false }, operation: 'HR_STAFF_LOAD' });
        }
    }

    // ---------- People ----------
    for (const e of plan.employees) {
        const label = e.legalName;
        const hireDate = day(e.hireDate);
        const [byCode, byDoc, byDocLoose, byUsername, byEmail] = await Promise.all([
            db.employee.findUnique({ where: { companyId_employeeCode: { companyId, employeeCode: e.employeeCode } }, include: { user: true } }),
            db.employee.findMany({ where: { documentNumber: e.documentNumber }, include: { user: true } }),
            // Same cédula written without dashes / other case (e.g. stored as the code).
            db.employee.findMany({ where: { companyId, OR: [{ documentNumber: e.employeeCode }, { documentType: e.employeeCode }] }, select: { id: true } }),
            db.user.findUnique({ where: { username: e.user.username } }),
            db.user.findUnique({ where: { email: e.user.email } }),
        ]);
        const candidates = new Map<number, NonNullable<typeof byCode>>();
        if (byCode) candidates.set(byCode.id, byCode);
        for (const x of byDoc) candidates.set(x.id, x);
        const looseOther = byDocLoose.filter(x => !candidates.has(x.id));
        if (candidates.size > 1 || looseOther.length) { conflict(`${label}: cédula/código ya usados por otro empleado`); continue; }
        let emp = [...candidates.values()][0] ?? null;
        if (emp) {
            if (emp.companyId !== companyId || emp.employeeCode !== e.employeeCode || emp.documentNumber !== e.documentNumber
                || emp.user.username !== e.user.username || emp.user.email !== e.user.email) {
                conflict(`${label}: existe un empleado con esa cédula/código pero con otros datos o usuario`); continue;
            }
            bump(counts, 'employee.exists'); bump(counts, 'user.exists');
        } else {
            if (byUsername || byEmail) { conflict(`${label}: username o email ya usados por otra persona`); continue; }
        }

        const posId = posIds.get(e.jobPositionCode) ?? null;
        const deptId = deptIds.get(deptOfPos.get(e.jobPositionCode)!) ?? null;
        let userId: number | null = emp?.userId ?? null;
        let employeeId: number | null = emp?.id ?? null;

        if (!emp) {
            bump(counts, 'user.create'); bump(counts, 'employee.create');
            if (apply) {
                const hash = hashes.get(e.user.username);
                if (!hash) throw new Error(`Falta contraseña generada para ${e.user.username}`);
                const user = await db.user.create({ data: {
                    companyId, name: e.user.name, email: e.user.email, username: e.user.username, password: hash,
                    mustChangePassword: true, roleId: role.id, branchId: e.user.branchId,
                    status: 'ACTIVE', accountType: 'INTERNAL',
                } });
                await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
                await db.userBranch.createMany({ data: e.branches.map(b => ({ userId: user.id, branchId: b.branchId })) });
                await audit('User', user.id, 'CREATE', { username: user.username, roleId: role.id, accountType: 'INTERNAL', branchIds: e.branches.map(b => b.branchId), mustChangePassword: true, operation: 'HR_STAFF_LOAD' });
                const created = await db.employee.create({ data: {
                    companyId, userId: user.id, employeeCode: e.employeeCode, legalName: e.legalName,
                    documentType: e.documentType, documentNumber: e.documentNumber, hireDate,
                    employmentType: e.employmentType, status: e.status, departmentId: deptId, jobPositionId: posId,
                    notes: 'Alta por carga inicial de personal (personal.xlsx, 2026-11-19)',
                } });
                await audit('Employee', created.id, 'CREATE', { employeeCode: e.employeeCode, linkedUserId: user.id, branchIds: e.branches.map(b => b.branchId) });
                createdUsers.push(e.user.username);
                userId = user.id; employeeId = created.id;
            }
        } else {
            if (emp.status !== 'ACTIVE' || key(emp.hireDate) !== e.hireDate) conflict(`${label}: empleado existente con estado/fecha de ingreso distinto`);
            if (posId !== null && emp.jobPositionId !== posId) conflict(`${label}: empleado existente con otro puesto`);
        }
        const isNew = employeeId === null; // only in plan mode for not-yet-created people

        // Branch assignments
        for (const b of e.branches) {
            const exists = !isNew && await db.employeeBranchAssignment.findUnique({ where: { employeeId_branchId_effectiveFrom: { employeeId: employeeId!, branchId: b.branchId, effectiveFrom: hireDate } } });
            if (exists) { if (exists.isPrimary !== b.isPrimary) conflict(`${label}: asignación de sucursal con otra marca principal`); continue; }
            bump(counts, 'branchAssignment.create');
            if (apply) await db.employeeBranchAssignment.create({ data: { companyId, employeeId: employeeId!, branchId: b.branchId, isPrimary: b.isPrimary, effectiveFrom: hireDate } });
        }

        // Contract
        let contractId: number | null = null;
        const contract = await db.employmentContract.findUnique({ where: { companyId_contractNumber: { companyId, contractNumber: e.contractNumber } } });
        if (contract) {
            if (isNew || contract.employeeId !== employeeId) { conflict(`${label}: número de contrato usado por otro empleado`); continue; }
            contractId = contract.id; bump(counts, 'contract.exists');
        } else {
            const other = isNew ? null : await db.employmentContract.findFirst({ where: { companyId, employeeId: employeeId!, status: 'ACTIVE' }, select: { id: true } });
            if (other) conflict(`${label}: ya tiene otro contrato ACTIVE`);
            bump(counts, 'contract.create');
            if (apply) {
                const row = await db.employmentContract.create({ data: {
                    companyId, employeeId: employeeId!, jobPositionId: posId, contractNumber: e.contractNumber,
                    employmentType: e.employmentType, startDate: hireDate, status: 'ACTIVE', signedAt: hireDate,
                    notes: 'Contrato por tiempo indeterminado registrado en la carga inicial; signedAt = fecha de ingreso (supuesto)',
                } });
                await audit('EmploymentContract', row.id, 'CREATE', { employeeId, contractNumber: e.contractNumber, status: 'ACTIVE', operation: 'HR_STAFF_LOAD' });
                contractId = row.id;
            }
        }

        // Compensation
        const comp = isNew ? [] : await db.compensationHistory.findMany({ where: { companyId, employeeId: employeeId! } });
        if (comp.length) {
            const ok = comp.length === 1 && comp[0].compensationType === 'SALARY' && comp[0].payFrequency === 'MONTHLY'
                && comp[0].currency === 'NIO' && Number(comp[0].amount) === e.monthlySalaryNIO && key(comp[0].effectiveFrom) === e.hireDate && comp[0].effectiveTo === null;
            if (!ok) conflict(`${label}: historial de compensación existente distinto al plan`);
            bump(counts, 'compensation.exists');
        } else {
            bump(counts, 'compensation.create');
            if (apply) {
                const row = await db.compensationHistory.create({ data: {
                    companyId, employeeId: employeeId!, contractId, changedById: plan.actorUserId,
                    compensationType: 'SALARY', payFrequency: 'MONTHLY', amount: new Prisma.Decimal(e.monthlySalaryNIO.toFixed(2)),
                    currency: 'NIO', effectiveFrom: hireDate, reason: 'Salario básico mensual inicial (carga de personal 2026-11-19)',
                } });
                await audit('CompensationHistory', row.id, 'CREATE', {
                    employeeId, effectiveFrom: e.hireDate, compensationType: 'SALARY', payFrequency: 'MONTHLY', currency: 'NIO',
                    priorEntryId: null, operation: 'EMPLOYEE_ONBOARDING',
                });
            }
        }

        // ---------- Vacation ledger (chronological: opening, usages, accrual) ----------
        if (leaveTypeId === null && apply) throw new Error('Tipo VAC no resuelto');
        const v = e.vacation;
        const ledgerOps: Array<{ date: string; kind: 'OPEN' | 'USAGE' | 'ACCR'; amount: number; ref?: string; lr?: { startDate: string; endDate: string; days: number } }> = [];
        if (v.openingAdjustment) ledgerOps.push({ date: v.openingAdjustment.effectiveDate, kind: 'OPEN', amount: v.openingAdjustment.amount, ref: v.openingAdjustment.reference });
        for (const lr of [...v.leaveRequests].sort((a, b) => a.startDate.localeCompare(b.startDate))) ledgerOps.push({ date: lr.startDate, kind: 'USAGE', amount: -lr.days, lr });
        ledgerOps.push({ date: v.novemberAccrual.effectiveDate, kind: 'ACCR', amount: v.novemberAccrual.amount, ref: v.novemberAccrual.reference });

        let simulated = 0; // running balance for plan mode / service-like sufficiency check
        if (!isNew && leaveTypeId !== null) {
            const bal = await db.vacationBalance.findUnique({ where: { companyId_userId_scopeKey: { companyId, userId: userId!, scopeKey: `LEAVE_TYPE:${leaveTypeId}` } } });
            if (bal) {
                const foreign = await db.vacationLedgerEntry.count({ where: { balanceId: bal.id, OR: [{ reference: null }, { reference: { not: { startsWith: 'LMP-VAC-' } }, leaveRequestId: null }] } });
                if (foreign) conflict(`${label}: el saldo VAC tiene movimientos ajenos a esta carga`);
            }
        }
        for (const op of ledgerOps) {
            if (op.kind !== 'USAGE') {
                const existing = await db.vacationLedgerEntry.findUnique({ where: { companyId_reference: { companyId, reference: op.ref! } } });
                if (existing) {
                    if (existing.userId !== userId || Number(existing.amount) !== op.amount || key(existing.effectiveDate) !== op.date) conflict(`${label}: asiento ${op.kind} existente difiere`);
                    bump(counts, `ledger.${op.kind}.exists`); simulated += op.amount; continue;
                }
                bump(counts, `ledger.${op.kind}.create`); simulated += op.amount;
                if (!apply) continue;
                const balance = await ensureBalance(db, companyId, userId!, leaveTypeId!, day(op.date));
                const before = await ledgerSum(db, balance.id);
                const type = op.kind === 'OPEN' ? 'ADJUSTMENT' : 'ACCRUAL';
                const reason = op.kind === 'OPEN'
                    ? 'Saldo de apertura: vacaciones acumuladas al 31/10/2026 (personal.xlsx)'
                    : `Acumulación noviembre 2026: ${v.novemberAccrual.rule} (30 días/año)`;
                const entry = await db.vacationLedgerEntry.create({ data: {
                    companyId, balanceId: balance.id, userId: userId!, effectiveDate: day(op.date), amount: op.amount, unit: 'DAYS',
                    type, reason, reference: op.ref!, actorId: plan.actorUserId, resultingBalance: r4(before + op.amount), createdAt: stamp(),
                } });
                await audit('VacationLedgerEntry', entry.id, 'CREATE', { userId, balanceId: balance.id, effectiveDate: op.date, amount: op.amount, unit: 'DAYS', type, reason, reference: op.ref });
                continue;
            }
            // USAGE through an APPROVED LeaveRequest (LeaveRequestService create -> submit -> decide)
            const lr = op.lr!;
            const start = day(lr.startDate), end = day(lr.endDate);
            const overlapping = isNew ? [] : await db.leaveRequest.findMany({ where: { companyId, userId: userId!, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start } } });
            const same = overlapping.find(r => r.leaveTypeId === leaveTypeId && key(r.startDate) === lr.startDate && key(r.endDate) === lr.endDate && r.status === 'APPROVED');
            if (same) {
                const usage = await db.vacationLedgerEntry.findUnique({ where: { leaveRequestId_type: { leaveRequestId: same.id, type: 'USAGE' } } });
                if (!usage || Number(usage.amount) !== -lr.days || Number(same.requestedAmount) !== lr.days) conflict(`${label}: permiso ${lr.startDate} existente sin USAGE correcto`);
                if (overlapping.length > 1) conflict(`${label}: permiso ${lr.startDate} se solapa con otra ausencia`);
                bump(counts, 'leaveRequest.exists'); simulated -= lr.days; continue;
            }
            const sameDatesOther = isNew ? 0 : await db.leaveRequest.count({ where: { companyId, userId: userId!, leaveTypeId: leaveTypeId ?? undefined, startDate: start, endDate: end, status: { notIn: ['APPROVED'] } } });
            if (sameDatesOther) { conflict(`${label}: permiso ${lr.startDate}..${lr.endDate} existe cancelado/rechazado/pendiente; revisar a mano`); continue; }
            if (overlapping.length) { conflict(`${label}: permiso ${lr.startDate}..${lr.endDate} se solapa con otra ausencia (HR_LEAVE_OVERLAP)`); continue; }
            if (simulated + 1e-9 < lr.days) conflict(`${label}: saldo insuficiente para ${lr.startDate} (disponible ${r4(simulated)}, solicitado ${lr.days})`);
            bump(counts, 'leaveRequest.create'); simulated -= lr.days;
            if (!apply) continue;
            const now = new Date();
            const balance = await ensureBalance(db, companyId, userId!, leaveTypeId!, start); // provisioned on create
            const req = await db.leaveRequest.create({ data: {
                companyId, userId: userId!, branchId: e.user.branchId, leaveTypeId: leaveTypeId!, startDate: start, endDate: end,
                fraction: 'FULL_DAY', requestedAmount: lr.days, balanceUnit: 'DAYS', reason: LEAVE_REASON,
                status: 'DRAFT', requestedById: plan.actorUserId,
            } });
            await audit('LeaveRequest', req.id, 'CREATE', { userId, leaveTypeId, startDate: lr.startDate, endDate: lr.endDate, requestedAmount: lr.days, status: 'DRAFT' });
            await db.leaveRequest.update({ where: { id: req.id }, data: { status: 'PENDING', submittedAt: now, revision: { increment: 1 } } });
            await audit('LeaveRequest', req.id, 'UPDATE', { transition: 'DRAFT->PENDING' });
            const decided = await ensureBalance(db, companyId, userId!, leaveTypeId!, end);
            if (decided.id !== balance.id) throw new Error('Saldo VAC inconsistente');
            const available = await ledgerSum(db, balance.id);
            if (available + 1e-9 < lr.days) throw new Conflict(`${label}: saldo insuficiente (HR_VACATION_INSUFFICIENT_BALANCE)`);
            await db.vacationLedgerEntry.create({ data: {
                companyId, balanceId: balance.id, userId: userId!, leaveRequestId: req.id, effectiveDate: start, amount: -lr.days, unit: 'DAYS',
                type: 'USAGE', reason: `Permiso aprobado: ${LEAVE_REASON}`, reference: `LEAVE-${req.id}`, actorId: plan.actorUserId,
                resultingBalance: r4(available - lr.days), createdAt: stamp(),
            } });
            await db.leaveRequest.update({ where: { id: req.id }, data: { status: 'APPROVED', decidedById: plan.actorUserId, decisionReason: DECISION_REASON, decidedAt: now, revision: { increment: 1 } } });
            await audit('LeaveRequest', req.id, 'UPDATE', { transition: 'PENDING->APPROVED', reason: DECISION_REASON });
        }
        if (Math.abs(r4(simulated) - v.expectedBalance20261130) > plan.conventions.balanceTolerance) conflict(`${label}: saldo simulado ${r4(simulated)} != esperado ${v.expectedBalance20261130}`);
    }

    const changes = Object.entries(counts).filter(([k]) => k.endsWith('.create') || k.endsWith('.deactivate')).reduce((s, [, n]) => s + n, 0);
    return { counts, createdUsers, conflicts, changes };
}

/** Post-condition: every person present once with the expected VAC balance, both as the ledger sum
 * and as the settlement reads it (hr-benefits-governance: newest entry by createdAt). */
async function verify(db: Db, plan: Plan) {
    const { companyId } = plan;
    const tol = plan.conventions.balanceTolerance;
    const problems: string[] = [];
    const rows: Array<{ name: string; expected: number; actual: number | null; settlement: number | null }> = [];
    const lt = await db.leaveType.findUnique({ where: { companyId_code: { companyId, code: plan.leaveType.code } } });
    if (!lt) return { ok: false, problems: ['Tipo VAC no existe'], rows };
    const role = await db.role.findUnique({ where: { companyId_name: { companyId, name: plan.employeeRole.name } }, include: { permissions: { select: { name: true } } } });
    const missing = plan.employeeRole.selfPermissions.filter(n => !role?.permissions.some(p => p.name === n));
    if (missing.length) problems.push(`Rol ${plan.employeeRole.name} sin permisos: ${missing.join(', ')}`);
    for (const code of plan.deactivateLeaveTypeCodes) {
        const demo = await db.leaveType.findUnique({ where: { companyId_code: { companyId, code } } });
        if (demo?.active) problems.push(`Tipo ${code} sigue activo`);
    }
    for (const e of plan.employees) {
        const expected = e.vacation.expectedBalance20261130;
        const emps = await db.employee.findMany({ where: { companyId, OR: [{ employeeCode: e.employeeCode }, { documentNumber: e.documentNumber }, { legalName: e.legalName }] }, include: { user: { select: { roleId: true } } } });
        if (emps.length !== 1) { problems.push(`${e.legalName}: ${emps.length} empleados (esperado 1)`); rows.push({ name: e.legalName, expected, actual: null, settlement: null }); continue; }
        const emp = emps[0];
        if (role && emp.user.roleId !== role.id) problems.push(`${e.legalName}: usuario sin rol ${plan.employeeRole.name}`);
        const [assign, contracts, comps, bal] = await Promise.all([
            db.employeeBranchAssignment.count({ where: { employeeId: emp.id, effectiveTo: null } }),
            db.employmentContract.count({ where: { employeeId: emp.id, status: 'ACTIVE' } }),
            db.compensationHistory.count({ where: { employeeId: emp.id, effectiveTo: null } }),
            db.vacationBalance.findUnique({ where: { companyId_userId_scopeKey: { companyId, userId: emp.userId, scopeKey: `LEAVE_TYPE:${lt.id}` } } }),
        ]);
        if (assign !== e.branches.length || contracts !== 1 || comps !== 1) problems.push(`${e.legalName}: asignaciones/contrato/compensación incompletos`);
        const actual = bal ? r4(await ledgerSum(db, bal.id)) : 0;
        if (bal) {
            const entries = await db.vacationLedgerEntry.findMany({ where: { balanceId: bal.id }, orderBy: { createdAt: 'desc' } });
            if (new Set(entries.map(x => x.createdAt.getTime())).size !== entries.length) problems.push(`${e.legalName}: asientos con createdAt repetido`);
            const chrono = [...entries].reverse();
            for (let i = 1; i < chrono.length; i++) if (chrono[i].effectiveDate < chrono[i - 1].effectiveDate) problems.push(`${e.legalName}: createdAt no sigue el orden cronológico`);
            if (entries[0] && Math.abs(Number(entries[0].resultingBalance) - actual) > 1e-6) problems.push(`${e.legalName}: resultingBalance del último asiento (createdAt) != suma del libro`);
        }
        // Same query as hr-benefits-governance.service.ts (settlement).
        const settlementBalances = await db.vacationBalance.findMany({
            where: { companyId, userId: emp.userId, unit: 'DAYS', leaveType: { is: { balanceTracked: true, OR: [{ code: { contains: 'VAC' } }, { name: { contains: 'Vacacion' } }] } } },
            include: { ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        const settlement = settlementBalances.length === 1 ? r4(Number(settlementBalances[0].ledgerEntries[0]?.resultingBalance ?? 0)) : null;
        if (settlement === null) problems.push(`${e.legalName}: la liquidación no encuentra un saldo VAC inequívoco (${settlementBalances.length})`);
        else if (Math.abs(settlement - expected) > tol) problems.push(`${e.legalName}: liquidación lee ${settlement} != esperado ${expected}`);
        if (Math.abs(actual - expected) > tol) problems.push(`${e.legalName}: saldo ${actual} != esperado ${expected}`);
        rows.push({ name: e.legalName, expected, actual, settlement });
    }
    const dupDocs = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) n FROM (SELECT documentNumber FROM Employee WHERE companyId = ${companyId} AND documentNumber IS NOT NULL GROUP BY documentNumber HAVING COUNT(*) > 1) t`);
    const dupNames = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) n FROM (SELECT legalName FROM Employee WHERE companyId = ${companyId} GROUP BY legalName HAVING COUNT(*) > 1) t`);
    if (Number(dupDocs[0].n) || Number(dupNames[0].n)) problems.push('Empleados duplicados por cédula o nombre');
    return { ok: problems.length === 0, problems, rows };
}

/** Warn (never block) about pre-existing users (e.g. POS accounts) that look like the same person. */
async function priorUserWarnings(db: Db, plan: Plan) {
    const planUsernames = new Set(plan.employees.map(e => e.user.username));
    const users = await db.user.findMany({ where: { companyId: plan.companyId }, select: { id: true, username: true, name: true, nif: true, employee: { select: { id: true } } } });
    const out: string[] = [];
    for (const e of plan.employees) {
        const tokens = norm(e.legalName).split(' ');
        const first = tokens[0];
        const surnames = new Set(tokens.slice(1));
        for (const u of users) {
            if (planUsernames.has(u.username)) continue;
            const ut = norm(u.name || '').split(' ').filter(Boolean);
            const uu = norm((u.username || '').replace(/[._-]/g, ' ')).split(' ').filter(Boolean);
            const byNif = !!u.nif && u.nif.replace(/[^0-9a-z]/gi, '').toUpperCase() === e.employeeCode;
            const byName = (ut.length >= 2 && ut[0] === first && ut.slice(1).some(t => surnames.has(t)))
                || (ut.length >= 2 && ut.every(t => tokens.includes(t)))
                || (uu.length >= 2 && uu[0] === first && uu.slice(1).some(t => surnames.has(t)));
            if (byNif || byName) out.push(`${e.legalName} ~ usuario existente '${u.username}' (id ${u.id}, ${byNif ? 'cédula/NIF' : 'nombre'}${u.employee ? ', ya ligado a empleado' : ''})`);
        }
    }
    return out;
}

function printCounts(c: Counter) {
    for (const k of Object.keys(c).sort()) console.log(`  ${k.padEnd(28)} ${c[k]}`);
}

function csvCell(s: string) { return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

function printRows(rows: Array<{ name: string; expected: number; actual: number | null; settlement: number | null }>) {
    const f = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2)).padStart(6);
    for (const r of rows) console.log(`  ${r.name.padEnd(36)} esperado ${f(r.expected)}  libro ${f(r.actual)}  liquidación ${f(r.settlement)}`);
}

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const expectDb = args.find(a => a.startsWith('--expect-db='))?.slice('--expect-db='.length);
    const planPath = path.resolve(args.find(a => !a.startsWith('--')) ?? path.join(__dirname, '../backups/personal-rrhh-20261119.json'));
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as Plan;
    validatePlan(plan);
    const info = (await prisma.$queryRaw<Array<{ db: string; host: string }>>`SELECT DATABASE() db, @@hostname host`)[0];
    const dbName = info.db;
    console.log(`BD: ${dbName} @ ${info.host} | plan: ${path.basename(planPath)} | modo: ${apply ? 'APPLY' : 'DRY-RUN'}`);
    if (apply && !expectDb) throw new Error('--apply exige --expect-db=<nombre de BD>');
    if (expectDb && expectDb !== dbName) throw new Error(`BD destino "${dbName}" != --expect-db "${expectDb}"`);

    for (const w of await priorUserWarnings(prisma, plan)) console.warn(`AVISO usuario previo: ${w}`);
    const pre = await run(prisma, plan, 'plan', new Map());
    console.log('Acciones:'); printCounts(pre.counts);
    if (pre.conflicts.length) {
        console.error(`BLOQUEADO: ${pre.conflicts.length} conflicto(s):`); for (const c of pre.conflicts) console.error(`  - ${c}`);
        process.exitCode = 2; return;
    }
    if (pre.changes === 0) {
        const v = await verify(prisma, plan);
        console.log(`Sin cambios (no-op). Verificación: ${v.ok ? 'OK' : 'FALLA'}`);
        printRows(v.rows);
        for (const p of v.problems) console.error(`  - ${p}`);
        if (!v.ok) process.exitCode = 3;
        return;
    }
    if (!apply) { console.log(`Dry-run: ${pre.changes} cambio(s) pendientes. Use --apply --expect-db=${dbName} con ALLOW_HR_STAFF_LOAD=1.`); return; }
    if (process.env.ALLOW_HR_STAFF_LOAD !== '1') throw new Error('Defina ALLOW_HR_STAFF_LOAD=1 para aplicar');

    // Passwords only for users that will be created; hashed before the transaction (bcrypt is slow).
    // No conflicts were found, so every plan username absent from the DB is a user to create.
    const planUsernames = plan.employees.map(e => e.user.username);
    const existingUsernames = new Set((await prisma.user.findMany({ where: { username: { in: planUsernames } }, select: { username: true } })).map(u => u.username));
    const plain = new Map<string, string>();
    const hashes = new Map<string, string>();
    for (const u of planUsernames.filter(u => !existingUsernames.has(u))) {
        const pw = generateStrongRandomPassword(16);
        assertStrongPassword(pw);
        plain.set(u, pw);
        hashes.set(u, await bcrypt.hash(pw, BCRYPT_ROUNDS));
    }

    // One credentials file per target DB; never overwrite a previous one.
    const safeDb = dbName.replace(/[^A-Za-z0-9_-]/g, '_');
    const csvBase = path.join(CSV_DIR, `credenciales-personal-20261119-${safeDb}.csv`);
    const csvFinal = fs.existsSync(csvBase) ? csvBase.replace(/\.csv$/, `-${Date.now()}.csv`) : csvBase;
    const csvTmp = `${csvFinal}.pending`;
    const timeout = Number(process.env.RECON_TX_TIMEOUT_MS || 120000);
    let result;
    try {
        result = await prisma.$transaction(async tx => {
            const res = await run(tx, plan, 'apply', hashes);
            const v = await verify(tx, plan);
            if (!v.ok) throw new Error(`Verificación fallida, rollback:\n  ${v.problems.join('\n  ')}`);
            const byUser = new Map(plan.employees.map(e => [e.user.username, e]));
            const lines = ['username,email,temporaryPassword,legalName,mustChangePassword'];
            for (const u of res.createdUsers) {
                const e = byUser.get(u)!;
                lines.push([u, e.user.email, plain.get(u)!, e.legalName, 'true'].map(csvCell).join(','));
            }
            if (res.createdUsers.length) {
                fs.mkdirSync(path.dirname(csvTmp), { recursive: true });
                fs.writeFileSync(csvTmp, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
            }
            return { res, v };
        }, { timeout, maxWait: timeout });
    } catch (err) {
        if (fs.existsSync(csvTmp)) fs.unlinkSync(csvTmp); // rolled back: those passwords never existed
        throw err;
    }
    if (result.res.createdUsers.length) fs.renameSync(csvTmp, csvFinal);
    console.log(`APLICADO: ${result.res.changes} cambio(s); ${result.res.createdUsers.length} usuario(s) nuevos.`);
    if (result.res.createdUsers.length) console.log(`Credenciales temporales escritas en ${path.relative(process.cwd(), csvFinal)} (no versionado).`);
    printRows(result.v.rows);
}

main()
    .catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
