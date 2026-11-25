import { createHash, randomUUID } from 'node:crypto';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { HrBenefitsError } from './hr-benefits.error';

type Input = Record<string, unknown>;
type Scope = { companyId: number; actorId: number };

const actorSelect = { id: true, name: true, username: true } as const;
const settlementInclude = Prisma.validator<Prisma.HrEmploymentSettlementInclude>()({
  employee: {
    select: {
      id: true,
      employeeCode: true,
      legalName: true,
      hireDate: true,
      terminationDate: true,
    },
  },
  user: { select: { id: true, name: true, username: true } },
  lines: { orderBy: { id: 'asc' } },
});

function text(value: unknown, field: string, max = 900) {
  if (typeof value !== 'string' || !value.trim())
    throw new HrBenefitsError(`${field} es requerido`);
  const v = value.trim();
  if (v.length > max) throw new HrBenefitsError(`${field} excede ${max} caracteres`);
  return v;
}
function date(value: unknown, field: string) {
  const v = text(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HrBenefitsError(`${field} debe usar YYYY-MM-DD`);
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    throw new HrBenefitsError(`${field} no es válida`);
  return d;
}
function amount(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new HrBenefitsError(`${field} debe ser un monto positivo con dos decimales`);
  const d = new Prisma.Decimal(value);
  if (d.lessThanOrEqualTo(0)) throw new HrBenefitsError(`${field} debe ser mayor que cero`);
  return d.toDecimalPlaces(2);
}
function int(value: unknown, field: string, min: number, max: number) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new HrBenefitsError(`${field} debe estar entre ${min} y ${max}`);
  return n;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Input)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function hash(value: unknown) {
  return createHash('sha256').update(stable(value)).digest('hex');
}
function serialized<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function idempotent<T>(
  scope: Scope,
  key: string,
  operation: string,
  payload: unknown,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const normalized = text(key, 'Idempotency-Key', 128);
  const requestHash = hash(payload);
  const replay = async () => {
    const row = await prisma.hrBenefitIdempotencyRecord.findUnique({
      where: { companyId_key: { companyId: scope.companyId, key: normalized } },
    });
    if (!row) return null;
    if (row.operation !== operation || row.requestHash !== requestHash)
      throw new HrBenefitsError(
        'Idempotency-Key ya fue usada con otra operación',
        409,
        'IDEMPOTENCY_CONFLICT'
      );
    if (!row.response)
      throw new HrBenefitsError(
        'Operación en proceso; reintente con la misma clave',
        409,
        'IDEMPOTENCY_IN_PROGRESS'
      );
    return row.response as T;
  };
  const found = await replay();
  if (found) return found;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const row = await tx.hrBenefitIdempotencyRecord.create({
          data: { companyId: scope.companyId, key: normalized, operation, requestHash },
        });
        const result = await work(tx);
        await tx.hrBenefitIdempotencyRecord.update({
          where: { id: row.id },
          data: { response: serialized(result) as Prisma.InputJsonValue },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const repeated = await replay();
      if (repeated) return repeated;
    }
    throw error;
  }
}

export type TravelPolicyCategory = {
  code: string;
  name: string;
  dailyLimit: string;
  requiresEvidence: boolean;
  allowedAfter?: string | null;
  allowedBefore?: string | null;
};
function clock(value: unknown, field: string, optional = true) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  const v = text(value, field, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HrBenefitsError(`${field} debe usar HH:mm`);
  return v;
}
function categories(value: unknown): TravelPolicyCategory[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new HrBenefitsError('Debe configurar al menos una categoría de viático');
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const item = raw as Input;
    const code = text(item.code, `categoría ${index + 1}`, 64).toUpperCase();
    if (seen.has(code)) throw new HrBenefitsError(`Categoría duplicada: ${code}`);
    seen.add(code);
    return {
      code,
      name: text(item.name, 'nombre de categoría', 120),
      dailyLimit: amount(item.dailyLimit, 'límite diario').toFixed(2),
      requiresEvidence: item.requiresEvidence !== false,
      allowedAfter: clock(item.allowedAfter, 'hora posterior'),
      allowedBefore: clock(item.allowedBefore, 'hora anterior'),
    };
  });
}

function policyData(payload: Input) {
  const percent = amount(payload.loanMaxPaymentPercent, 'loanMaxPaymentPercent');
  if (percent.greaterThan(100))
    throw new HrBenefitsError('loanMaxPaymentPercent no puede superar 100');
  return {
    effectiveFrom: date(payload.effectiveFrom, 'effectiveFrom'),
    currency: text(payload.currency, 'currency', 3).toUpperCase(),
    travelCategories: categories(payload.travelCategories) as unknown as Prisma.InputJsonValue,
    travelMaxDays: int(payload.travelMaxDays, 'travelMaxDays', 1, 365),
    travelEvidenceRequired: payload.travelEvidenceRequired !== false,
    loanMinTenureMonths: int(payload.loanMinTenureMonths, 'loanMinTenureMonths', 0, 600),
    loanMaxAmount: amount(payload.loanMaxAmount, 'loanMaxAmount'),
    loanMaxInstallments: int(payload.loanMaxInstallments, 'loanMaxInstallments', 1, 120),
    loanMaxPaymentPercent: percent,
    sourceReference: text(payload.sourceReference, 'sourceReference', 300),
    reason: text(payload.reason, 'reason'),
  };
}

export async function activeBenefitPolicy(
  companyId: number,
  at = new Date(),
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const effectiveDate = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const row = await db.hrBenefitPolicyVersion.findFirst({
    where: {
      companyId,
      status: 'ACTIVE',
      effectiveFrom: { lte: effectiveDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }],
    },
    orderBy: { version: 'desc' },
  });
  if (!row)
    throw new HrBenefitsError(
      'No existe una política activa de viáticos y préstamos para la fecha',
      409,
      'HR_BENEFITS_POLICY_REQUIRED'
    );
  return row;
}

export async function validateTravelPolicy(
  companyId: number,
  departure: Date,
  returnDate: Date,
  db: Prisma.TransactionClient
) {
  const policy = await activeBenefitPolicy(companyId, departure, db);
  const days = Math.floor((returnDate.getTime() - departure.getTime()) / 86400000) + 1;
  if (days > policy.travelMaxDays)
    throw new HrBenefitsError(
      `La política permite como máximo ${policy.travelMaxDays} días`,
      409,
      'HR_TRAVEL_POLICY_LIMIT'
    );
  return policy;
}
export function validateTravelExpensePolicy(
  policy: { travelCategories: unknown; travelEvidenceRequired: boolean },
  input: Input
) {
  const list = policy.travelCategories as TravelPolicyCategory[];
  const code = text(
    input.policyCategoryCode ?? input.category,
    'policyCategoryCode',
    64
  ).toUpperCase();
  const category = list.find((item) => item.code === code);
  if (!category)
    throw new HrBenefitsError(
      'La categoría no existe en la política congelada',
      409,
      'HR_TRAVEL_CATEGORY_POLICY'
    );
  const claimed = amount(input.claimedAmount, 'claimedAmount');
  if (claimed.greaterThan(category.dailyLimit))
    throw new HrBenefitsError(
      `El gasto excede el límite diario de ${category.dailyLimit}`,
      409,
      'HR_TRAVEL_DAILY_LIMIT'
    );
  const occurredTime = clock(input.occurredTime, 'occurredTime');
  if ((category.allowedAfter || category.allowedBefore) && !occurredTime)
    throw new HrBenefitsError('La categoría requiere hora del gasto');
  const inWindow =
    !category.allowedAfter && !category.allowedBefore
      ? true
      : category.allowedAfter && category.allowedBefore
        ? occurredTime! >= category.allowedAfter || occurredTime! <= category.allowedBefore
        : category.allowedAfter
          ? occurredTime! >= category.allowedAfter
          : occurredTime! <= category.allowedBefore!;
  if (!inWindow)
    throw new HrBenefitsError(
      `Hora fuera de la ventana permitida (${category.allowedAfter ?? 'inicio'} / ${category.allowedBefore ?? 'fin'})`,
      409,
      'HR_TRAVEL_TIME_WINDOW'
    );
  if ((policy.travelEvidenceRequired || category.requiresEvidence) && !input.receiptReference)
    throw new HrBenefitsError(
      'La política exige referencia de soporte/comprobante',
      409,
      'HR_TRAVEL_EVIDENCE_REQUIRED'
    );
  return { category, occurredTime };
}
type LoanPolicyTerms = {
  loanMinTenureMonths: number;
  loanMaxAmount: Prisma.Decimal;
  loanMaxInstallments: number;
  loanMaxPaymentPercent: Prisma.Decimal;
};

export function completedCalendarMonths(hireDate: Date, at: Date): number {
  let months =
    (at.getUTCFullYear() - hireDate.getUTCFullYear()) * 12 +
    (at.getUTCMonth() - hireDate.getUTCMonth());
  const anniversaryDay = Math.min(
    hireDate.getUTCDate(),
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate()
  );
  if (at.getUTCDate() < anniversaryDay) months -= 1;
  return Math.max(0, months);
}

export async function validateLoanTerms(
  companyId: number,
  employeeId: number,
  requested: Prisma.Decimal,
  installments: number,
  at: Date,
  policy: LoanPolicyTerms,
  db: Prisma.TransactionClient
) {
  const employee = await db.employee.findFirst({
    where: { id: employeeId, companyId },
    select: {
      hireDate: true,
      compensation: {
        where: {
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      },
    },
  });
  if (!employee) throw new HrBenefitsError('Empleado no encontrado');
  const tenure = completedCalendarMonths(employee.hireDate, at);
  if (tenure < policy.loanMinTenureMonths)
    throw new HrBenefitsError(
      `La política exige ${policy.loanMinTenureMonths} meses de antigüedad`,
      409,
      'HR_LOAN_TENURE_POLICY'
    );
  if (requested.greaterThan(policy.loanMaxAmount))
    throw new HrBenefitsError(
      `El monto supera el tope ${policy.loanMaxAmount.toFixed(2)}`,
      409,
      'HR_LOAN_AMOUNT_POLICY'
    );
  if (installments > policy.loanMaxInstallments)
    throw new HrBenefitsError(
      `El plazo supera ${policy.loanMaxInstallments} cuotas`,
      409,
      'HR_LOAN_TERM_POLICY'
    );
  const compensation = employee.compensation[0];
  if (!compensation)
    throw new HrBenefitsError(
      'No existe remuneración vigente para evaluar la capacidad de pago',
      409,
      'HR_LOAN_COMPENSATION_REQUIRED'
    );
  const monthly =
    compensation.payFrequency === 'WEEKLY'
      ? compensation.amount.mul(52).div(12)
      : compensation.payFrequency === 'BIWEEKLY'
        ? compensation.amount.mul(24).div(12)
        : compensation.payFrequency === 'FORTNIGHTLY'
          ? compensation.amount.mul(26).div(12)
          : compensation.amount;
  const ratio = requested.div(installments).div(monthly).mul(100);
  if (ratio.greaterThan(policy.loanMaxPaymentPercent))
    throw new HrBenefitsError(
      `La cuota excede ${policy.loanMaxPaymentPercent.toFixed(2)}% de la remuneración mensual`,
      409,
      'HR_LOAN_CAPACITY_POLICY'
    );
}

export async function validateLoanPolicy(
  companyId: number,
  employeeId: number,
  requested: Prisma.Decimal,
  installments: number,
  at: Date,
  db: Prisma.TransactionClient
) {
  const policy = await activeBenefitPolicy(companyId, at, db);
  await validateLoanTerms(companyId, employeeId, requested, installments, at, policy, db);
  return policy;
}

export class HrBenefitPolicyService {
  static async list(scope: Scope, filters: Input) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const where: Prisma.HrBenefitPolicyVersionWhereInput = {
      companyId: scope.companyId,
      status:
        typeof filters.status === 'string' && filters.status
          ? (filters.status as never)
          : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.hrBenefitPolicyVersion.findMany({
        where,
        orderBy: { version: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.hrBenefitPolicyVersion.count({ where }),
    ]);
    return {
      items: serialized(items),
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
  static async create(scope: Scope, payload: Input, key: string) {
    return idempotent(scope, key, 'BENEFIT_POLICY_CREATE', payload, async (tx) => {
      const latest = await tx.hrBenefitPolicyVersion.aggregate({
        where: { companyId: scope.companyId },
        _max: { version: true },
      });
      return serialized(
        await tx.hrBenefitPolicyVersion.create({
          data: {
            companyId: scope.companyId,
            version: (latest._max.version ?? 0) + 1,
            ...policyData(payload),
            createdById: scope.actorId,
          },
        })
      );
    });
  }
  static async update(scope: Scope, id: number, payload: Input, key: string) {
    return idempotent(scope, key, `BENEFIT_POLICY_UPDATE:${id}`, payload, async (tx) => {
      const current = await tx.hrBenefitPolicyVersion.findFirst({
        where: { id, companyId: scope.companyId },
      });
      if (!current) throw new HrBenefitsError('Política no encontrada', 404);
      if (current.status !== 'DRAFT')
        throw new HrBenefitsError(
          'Solo una política borrador puede editarse',
          409,
          'HR_BENEFITS_POLICY_IMMUTABLE'
        );
      if (Number(payload.expectedRevision) !== current.revision)
        throw new HrBenefitsError(
          'La política cambió; recargue',
          409,
          'HR_BENEFITS_POLICY_REVISION_CONFLICT'
        );
      const changed = await tx.hrBenefitPolicyVersion.updateMany({
        where: { id, companyId: scope.companyId, status: 'DRAFT', revision: current.revision },
        data: { ...policyData(payload), revision: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new HrBenefitsError(
          'La política cambió concurrentemente; recargue',
          409,
          'HR_BENEFITS_POLICY_REVISION_CONFLICT'
        );
      await tx.hrBenefitTrace.create({
        data: {
          companyId: scope.companyId,
          resourceType: 'BENEFIT_POLICY',
          resourceId: id,
          event: 'ADJUST_DRAFT',
          actorId: scope.actorId,
          reason: text(payload.adjustmentReason, 'adjustmentReason'),
          revision: current.revision + 1,
        },
      });
      return serialized(
        await tx.hrBenefitPolicyVersion.findFirstOrThrow({
          where: { id, companyId: scope.companyId },
        })
      );
    });
  }
  static async activate(scope: Scope, id: number, payload: Input, key: string) {
    return idempotent(scope, key, `BENEFIT_POLICY_ACTIVATE:${id}`, payload, async (tx) => {
      const row = await tx.hrBenefitPolicyVersion.findFirst({
        where: { id, companyId: scope.companyId },
      });
      if (!row) throw new HrBenefitsError('Política no encontrada', 404);
      if (row.status !== 'DRAFT')
        throw new HrBenefitsError('Solo una política borrador puede activarse', 409);
      if (Number(payload.expectedRevision) !== row.revision)
        throw new HrBenefitsError(
          'La política cambió; recargue',
          409,
          'HR_BENEFITS_POLICY_REVISION_CONFLICT'
        );
      const adjustedByActor = await tx.hrBenefitTrace.findFirst({
        where: {
          companyId: scope.companyId,
          resourceType: 'BENEFIT_POLICY',
          resourceId: id,
          event: 'ADJUST_DRAFT',
          actorId: scope.actorId,
        },
      });
      if (row.createdById === scope.actorId || adjustedByActor)
        throw new HrBenefitsError(
          'Quien creó o ajustó la política no puede activarla',
          409,
          'HR_BENEFITS_DUTY_SEGREGATION'
        );
      if (payload.confirmed !== true) throw new HrBenefitsError('Debe confirmar la activación');
      const current = await tx.hrBenefitPolicyVersion.findFirst({
        where: { companyId: scope.companyId, status: 'ACTIVE', effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (current && row.effectiveFrom <= current.effectiveFrom)
        throw new HrBenefitsError(
          'La nueva vigencia debe iniciar después de la política activa',
          409,
          'HR_BENEFITS_POLICY_OVERLAP'
        );
      const effectiveTo = new Date(row.effectiveFrom.getTime() - 86400000);
      if (current) {
        const closed = await tx.hrBenefitPolicyVersion.updateMany({
          where: {
            id: current.id,
            companyId: scope.companyId,
            status: 'ACTIVE',
            effectiveTo: null,
          },
          data: { effectiveTo },
        });
        if (closed.count !== 1)
          throw new HrBenefitsError(
            'La vigencia activa cambió concurrentemente; recargue',
            409,
            'HR_BENEFITS_POLICY_REVISION_CONFLICT'
          );
      }
      const activated = await tx.hrBenefitPolicyVersion.updateMany({
        where: { id, companyId: scope.companyId, status: 'DRAFT', revision: row.revision },
        data: {
          status: 'ACTIVE',
          activatedById: scope.actorId,
          activatedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (activated.count !== 1)
        throw new HrBenefitsError(
          'La política cambió concurrentemente; recargue',
          409,
          'HR_BENEFITS_POLICY_REVISION_CONFLICT'
        );
      return serialized(
        await tx.hrBenefitPolicyVersion.findFirstOrThrow({
          where: { id, companyId: scope.companyId },
        })
      );
    });
  }
}

const EXIT_TYPES = [
  'RESIGNATION',
  'DISMISSAL',
  'MUTUAL_AGREEMENT',
  'CONTRACT_END',
  'OTHER',
] as const;
const LINE_TYPES = [
  'EARNED_SALARY',
  'VACATION',
  'AGUINALDO',
  'INDEMNITY',
  'OTHER_EARNING',
  'DEDUCTION',
] as const;
function settlementLines(value: unknown) {
  if (!Array.isArray(value) || value.length === 0)
    throw new HrBenefitsError('La liquidación requiere conceptos detallados');
  return value.map((raw, index) => {
    const item = raw as Input;
    const type = text(item.type, `tipo línea ${index + 1}`, 30);
    if (!LINE_TYPES.includes(type as (typeof LINE_TYPES)[number]))
      throw new HrBenefitsError(`Tipo de concepto inválido: ${type}`);
    return {
      type: type as (typeof LINE_TYPES)[number],
      concept: text(item.concept, 'concept', 160),
      formulaBasis: text(item.formulaBasis, 'formulaBasis', 600),
      sourceReference: text(item.sourceReference, 'sourceReference', 300),
      amount: amount(item.amount, 'amount'),
    };
  });
}
function references(value: unknown) {
  if (!Array.isArray(value) || value.length === 0)
    throw new HrBenefitsError('Debe adjuntar al menos una referencia de soporte');
  return value.map((item, i) => text(item, `soporte ${i + 1}`, 300));
}
function totals(lines: ReturnType<typeof settlementLines>) {
  const gross = lines
    .filter((l) => l.type !== 'DEDUCTION')
    .reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
  const deductions = lines
    .filter((l) => l.type === 'DEDUCTION')
    .reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
  const net = gross.minus(deductions);
  if (net.isNegative())
    throw new HrBenefitsError('Las deducciones no pueden superar los ingresos de la liquidación');
  return { gross, deductions, net };
}
function allowed(status: string) {
  if (status === 'DRAFT') return ['SUBMIT', 'VOID'];
  if (status === 'SUBMITTED') return ['REVIEW', 'REJECT', 'VOID'];
  if (status === 'REVIEWED') return ['APPROVE', 'REJECT', 'VOID'];
  if (status === 'APPROVED') return ['PAY', 'VOID'];
  if (status === 'REJECTED') return ['REOPEN'];
  return [];
}
async function presentSettlement(
  row: Prisma.HrEmploymentSettlementGetPayload<{ include: typeof settlementInclude }>,
  detail = false,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const trace = detail
    ? await db.hrBenefitTrace.findMany({
        where: { companyId: row.companyId, resourceType: 'SETTLEMENT', resourceId: row.id },
        include: { actor: { select: actorSelect } },
        orderBy: { occurredAt: 'asc' },
      })
    : undefined;
  return serialized({ ...row, allowedActions: allowed(row.status), ...(trace ? { trace } : {}) });
}

export class HrEmploymentSettlementService {
  static async list(scope: Scope, filters: Input) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const search = typeof filters.search === 'string' ? filters.search.trim() : '';
    const where: Prisma.HrEmploymentSettlementWhereInput = {
      companyId: scope.companyId,
      status:
        typeof filters.status === 'string' && filters.status
          ? (filters.status as never)
          : undefined,
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { employee: { is: { legalName: { contains: search } } } },
              { user: { is: { name: { contains: search } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.hrEmploymentSettlement.findMany({
        where,
        include: settlementInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.hrEmploymentSettlement.count({ where }),
    ]);
    return {
      items: await Promise.all(rows.map((r) => presentSettlement(r))),
      pagination: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
  static async get(scope: Scope, id: number) {
    const row = await prisma.hrEmploymentSettlement.findFirst({
      where: { id, companyId: scope.companyId },
      include: settlementInclude,
    });
    if (!row)
      throw new HrBenefitsError('Liquidación no encontrada', 404, 'HR_SETTLEMENT_NOT_FOUND');
    return presentSettlement(row, true);
  }
  static async preview(scope: Scope, payload: Input) {
    const userId = int(payload.userId, 'userId', 1, 2147483647);
    const terminationDate = date(payload.terminationDate, 'terminationDate');
    const employee = await prisma.employee.findFirst({
      where: { companyId: scope.companyId, userId, status: { in: ['ACTIVE', 'ON_LEAVE'] } },
      include: {
        compensation: {
          where: {
            effectiveFrom: { lte: terminationDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: terminationDate } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });
    if (!employee) throw new HrBenefitsError('Empleado activo no encontrado', 404);
    if (terminationDate < employee.hireDate)
      throw new HrBenefitsError('La terminación no puede ser anterior a la contratación');
    const blockers: string[] = [];
    const warnings: string[] = [];
    const suggestedLines: Array<Record<string, string>> = [];
    const compensation = employee.compensation[0];
    let monthly = new Prisma.Decimal(0);
    const currencyCode = compensation?.currency ?? 'NIO';
    if (!compensation) blockers.push('No existe compensación vigente para calcular prestaciones.');
    else if (compensation.compensationType === 'HOURLY') {
      if (typeof payload.manualOrdinaryMonthlyBase === 'string' && payload.manualBaseReference) {
        monthly = amount(payload.manualOrdinaryMonthlyBase, 'manualOrdinaryMonthlyBase');
        warnings.push(
          `Base manual conciliada: ${text(payload.manualBaseReference, 'manualBaseReference', 300)}`
        );
      } else
        blockers.push(
          'La remuneración es por hora/variable: concilie componentes o recibos pagados y documente una base ordinaria manual.'
        );
    } else
      monthly =
        compensation.payFrequency === 'WEEKLY'
          ? compensation.amount.mul(52).div(12)
          : compensation.payFrequency === 'BIWEEKLY'
            ? compensation.amount.mul(24).div(12)
            : compensation.payFrequency === 'FORTNIGHTLY'
              ? compensation.amount.mul(26).div(12)
              : compensation.amount;
    const unpaidDays = Number(payload.unpaidSalaryDays ?? 0);
    if (monthly.greaterThan(0) && unpaidDays > 0)
      suggestedLines.push({
        type: 'EARNED_SALARY',
        concept: 'Salario pendiente',
        formulaBasis: `${monthly.toFixed(2)} / 30 × ${unpaidDays} días`,
        sourceReference: 'Ley 185, art. 77',
        amount: monthly.div(30).mul(unpaidDays).toFixed(2),
      });
    if (typeof payload.aguinaldoPendingAmount === 'string' && payload.aguinaldoBasisReference)
      suggestedLines.push({
        type: 'AGUINALDO',
        concept: 'Décimo tercer mes proporcional conciliado',
        formulaBasis: text(payload.aguinaldoBasisReference, 'aguinaldoBasisReference', 600),
        sourceReference: 'Ley 185, arts. 42 y 93-95; historia de nóminas/aguinaldos pagados',
        amount: amount(payload.aguinaldoPendingAmount, 'aguinaldoPendingAmount').toFixed(2),
      });
    else
      blockers.push(
        'No se determinó el corte pendiente de aguinaldo sin riesgo de duplicar pagos; concilie nóminas pagadas y documente monto/base.'
      );
    const balances = await prisma.vacationBalance.findMany({
      where: {
        companyId: scope.companyId,
        userId,
        unit: 'DAYS',
        leaveType: {
          is: {
            balanceTracked: true,
            OR: [{ code: { contains: 'VAC' } }, { name: { contains: 'Vacacion' } }],
          },
        },
      },
      include: { leaveType: true, ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (balances.length !== 1)
      blockers.push(
        balances.length
          ? 'Hay más de un saldo de vacaciones aplicable; concilie el catálogo antes de calcular.'
          : 'No existe un saldo inequívoco de vacaciones controladas.'
      );
    else {
      const days = new Prisma.Decimal(balances[0].ledgerEntries[0]?.resultingBalance ?? 0);
      if (monthly.greaterThan(0) && days.greaterThan(0))
        suggestedLines.push({
          type: 'VACATION',
          concept: 'Vacaciones acumuladas',
          formulaBasis: `${days.toFixed(4)} días × salario diario ${monthly.div(30).toFixed(2)}`,
          sourceReference: 'Ley 185, arts. 42, 76-78',
          amount: days.mul(monthly.div(30)).toFixed(2),
        });
    }
    if (payload.indemnityApplicable === true) {
      if (payload.indemnityConfirmed !== true || !payload.indemnityJustification)
        blockers.push(
          'La indemnización requiere decisión legal expresa y justificación de causal.'
        );
      else if (monthly.greaterThan(0)) {
        const serviceYears =
          (terminationDate.getTime() - employee.hireDate.getTime()) / (86400000 * 365);
        const months = Math.min(
          5,
          Math.max(1, Math.min(serviceYears, 3) + (Math.max(0, serviceYears - 3) * 20) / 30)
        );
        suggestedLines.push({
          type: 'INDEMNITY',
          concept: 'Indemnización por antigüedad',
          formulaBasis: `${serviceYears.toFixed(4)} años; ${months.toFixed(4)} meses de salario`,
          sourceReference: `Ley 185, arts. 43 y 45 · ${text(payload.indemnityJustification, 'indemnityJustification', 300)}`,
          amount: monthly.mul(months).toFixed(2),
        });
      }
    }
    return {
      employee: {
        id: employee.id,
        userId,
        hireDate: employee.hireDate,
        legalName: employee.legalName,
      },
      currency: currencyCode,
      suggestedLines,
      blockers,
      warnings,
      canSubmit: blockers.length === 0,
    };
  }
  static async create(scope: Scope, payload: Input, key: string) {
    return idempotent(scope, key, 'SETTLEMENT_CREATE', payload, async (tx) => {
      const userId = int(payload.userId, 'userId', 1, 2147483647);
      const employee = await tx.employee.findFirst({
        where: { companyId: scope.companyId, userId, status: { in: ['ACTIVE', 'ON_LEAVE'] } },
        select: { id: true, userId: true, hireDate: true },
      });
      if (!employee)
        throw new HrBenefitsError(
          'El usuario no tiene expediente laboral activo en la empresa',
          404
        );
      const terminationDate = date(payload.terminationDate, 'terminationDate');
      if (terminationDate < employee.hireDate)
        throw new HrBenefitsError('La terminación no puede ser anterior a la contratación');
      const open = await tx.hrEmploymentSettlement.findFirst({
        where: {
          companyId: scope.companyId,
          employeeId: employee.id,
          status: { in: ['DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED'] },
        },
      });
      if (open)
        throw new HrBenefitsError(
          `Ya existe una liquidación abierta: ${open.code}`,
          409,
          'HR_SETTLEMENT_OPEN_EXISTS'
        );
      const exitType = text(payload.exitType, 'exitType', 30);
      if (!EXIT_TYPES.includes(exitType as (typeof EXIT_TYPES)[number]))
        throw new HrBenefitsError('Tipo de salida inválido');
      const lines = settlementLines(payload.lines);
      if (
        lines.some((line) => line.type === 'INDEMNITY') &&
        (payload.indemnityConfirmed !== true || !payload.indemnityJustification)
      )
        throw new HrBenefitsError(
          'La indemnización requiere decisión legal expresa y justificación'
        );
      const evidence = references(payload.evidenceReferences);
      const sum = totals(lines);
      const calculationHash = hash({
        exitType,
        cause: payload.cause,
        terminationDate: payload.terminationDate,
        lines,
        evidence,
      });
      const row = await tx.hrEmploymentSettlement.create({
        data: {
          companyId: scope.companyId,
          code: `LIQ-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          employeeId: employee.id,
          userId,
          exitType: exitType as never,
          cause: text(payload.cause, 'cause', 300),
          justification: text(payload.justification, 'justification'),
          terminationDate,
          currency: text(payload.currency, 'currency', 3).toUpperCase(),
          evidenceReferences: evidence,
          grossEarnings: sum.gross,
          totalDeductions: sum.deductions,
          netPay: sum.net,
          calculationHash,
          createdById: scope.actorId,
          lines: { create: lines.map((l) => ({ companyId: scope.companyId, ...l })) },
        },
        include: settlementInclude,
      });
      await tx.hrBenefitTrace.create({
        data: {
          companyId: scope.companyId,
          resourceType: 'SETTLEMENT',
          resourceId: row.id,
          event: 'CREATE_DRAFT',
          actorId: scope.actorId,
          toStatus: 'DRAFT',
          revision: 0,
          metadata: { calculationHash },
        },
      });
      return presentSettlement(row, true, tx);
    });
  }
  static async update(scope: Scope, id: number, payload: Input, key: string) {
    return idempotent(scope, key, `SETTLEMENT_UPDATE:${id}`, payload, async (tx) => {
      const current = await tx.hrEmploymentSettlement.findFirst({
        where: { id, companyId: scope.companyId },
        include: settlementInclude,
      });
      if (!current) throw new HrBenefitsError('Liquidación no encontrada', 404);
      if (current.status !== 'DRAFT')
        throw new HrBenefitsError('Solo un borrador puede ajustarse', 409);
      if (Number(payload.expectedRevision) !== current.revision)
        throw new HrBenefitsError(
          'La liquidación cambió; recargue',
          409,
          'HR_SETTLEMENT_REVISION_CONFLICT'
        );
      const terminationDate = date(payload.terminationDate, 'terminationDate');
      if (terminationDate < current.employee.hireDate)
        throw new HrBenefitsError('La terminación no puede ser anterior a la contratación');
      const exitType = text(payload.exitType, 'exitType', 30);
      if (!EXIT_TYPES.includes(exitType as (typeof EXIT_TYPES)[number]))
        throw new HrBenefitsError('Tipo de salida inválido');
      const lines = settlementLines(payload.lines);
      if (
        lines.some((line) => line.type === 'INDEMNITY') &&
        (payload.indemnityConfirmed !== true || !payload.indemnityJustification)
      )
        throw new HrBenefitsError(
          'La indemnización requiere decisión legal expresa y justificación'
        );
      const evidence = references(payload.evidenceReferences);
      const sum = totals(lines);
      const calculationHash = hash({
        exitType,
        cause: payload.cause,
        terminationDate: payload.terminationDate,
        lines,
        evidence,
      });
      const changed = await tx.hrEmploymentSettlement.updateMany({
        where: { id, companyId: scope.companyId, revision: current.revision },
        data: {
          exitType: exitType as never,
          cause: text(payload.cause, 'cause', 300),
          justification: text(payload.justification, 'justification'),
          terminationDate,
          currency: text(payload.currency, 'currency', 3).toUpperCase(),
          evidenceReferences: evidence,
          grossEarnings: sum.gross,
          totalDeductions: sum.deductions,
          netPay: sum.net,
          calculationHash,
          revision: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new HrBenefitsError('La liquidación cambió concurrentemente', 409);
      await tx.hrEmploymentSettlementLine.deleteMany({
        where: { settlementId: id, companyId: scope.companyId },
      });
      await tx.hrEmploymentSettlementLine.createMany({
        data: lines.map((line) => ({ companyId: scope.companyId, settlementId: id, ...line })),
      });
      await tx.hrBenefitTrace.create({
        data: {
          companyId: scope.companyId,
          resourceType: 'SETTLEMENT',
          resourceId: id,
          event: 'ADJUST_DRAFT',
          actorId: scope.actorId,
          reason: text(payload.adjustmentReason, 'adjustmentReason'),
          revision: current.revision + 1,
          metadata: { calculationHash },
        },
      });
      const loaded = await tx.hrEmploymentSettlement.findUniqueOrThrow({
        where: { id },
        include: settlementInclude,
      });
      return presentSettlement(loaded, true, tx);
    });
  }
  static async transition(scope: Scope, id: number, action: string, payload: Input, key: string) {
    return idempotent(scope, key, `SETTLEMENT_${action}:${id}`, payload, async (tx) => {
      const row = await tx.hrEmploymentSettlement.findFirst({
        where: { id, companyId: scope.companyId },
        include: settlementInclude,
      });
      if (!row) throw new HrBenefitsError('Liquidación no encontrada', 404);
      const expected = Number(payload.expectedRevision);
      if (!Number.isInteger(expected) || expected !== row.revision)
        throw new HrBenefitsError(
          'La liquidación cambió; recargue',
          409,
          'HR_SETTLEMENT_REVISION_CONFLICT'
        );
      if (payload.confirmed !== true) throw new HrBenefitsError('Debe confirmar la acción');
      const reason = text(payload.reason, 'reason');
      const transitions: Record<string, { from: string[]; to: string }> = {
        submit: { from: ['DRAFT'], to: 'SUBMITTED' },
        review: { from: ['SUBMITTED'], to: 'REVIEWED' },
        approve: { from: ['REVIEWED'], to: 'APPROVED' },
        reject: { from: ['SUBMITTED', 'REVIEWED'], to: 'REJECTED' },
        reopen: { from: ['REJECTED'], to: 'DRAFT' },
        pay: { from: ['APPROVED'], to: 'PAID' },
        void: { from: ['DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED'], to: 'VOID' },
      };
      const rule = transitions[action];
      if (!rule || !rule.from.includes(row.status))
        throw new HrBenefitsError(`Acción ${action} no permitida desde ${row.status}`, 409);
      const prior = await tx.hrBenefitTrace.findMany({
        where: { companyId: scope.companyId, resourceType: 'SETTLEMENT', resourceId: id },
        orderBy: { id: 'asc' },
      });
      if (
        action === 'review' &&
        (row.createdById === scope.actorId ||
          prior.some((trace) => trace.event === 'ADJUST_DRAFT' && trace.actorId === scope.actorId))
      )
        throw new HrBenefitsError(
          'Quien creó o ajustó no puede revisar',
          409,
          'HR_BENEFITS_DUTY_SEGREGATION'
        );
      if (
        action === 'approve' &&
        (row.createdById === scope.actorId ||
          prior.some((t) => t.event === 'REVIEW' && t.actorId === scope.actorId))
      )
        throw new HrBenefitsError(
          'Quien creó o revisó no puede aprobar',
          409,
          'HR_BENEFITS_DUTY_SEGREGATION'
        );
      if (
        action === 'pay' &&
        prior.some((t) => t.event === 'APPROVE' && t.actorId === scope.actorId)
      )
        throw new HrBenefitsError(
          'Quien aprobó no puede pagar',
          409,
          'HR_BENEFITS_DUTY_SEGREGATION'
        );
      const reference = typeof payload.reference === 'string' ? payload.reference.trim() : '';
      if (['pay', 'void'].includes(action) && !reference)
        throw new HrBenefitsError('La acción requiere referencia documental/financiera');
      const changed = await tx.hrEmploymentSettlement.updateMany({
        where: { id, companyId: scope.companyId, revision: row.revision },
        data: { status: rule.to as never, revision: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new HrBenefitsError('La liquidación cambió concurrentemente', 409);
      if (action === 'pay')
        await tx.employee.update({
          where: { id: row.employeeId },
          data: { terminationDate: row.terminationDate, status: 'INACTIVE' },
        });
      await tx.hrBenefitTrace.create({
        data: {
          companyId: scope.companyId,
          resourceType: 'SETTLEMENT',
          resourceId: id,
          event: action.toUpperCase(),
          actorId: scope.actorId,
          reason,
          fromStatus: row.status,
          toStatus: rule.to,
          revision: row.revision + 1,
          metadata: reference ? { reference } : undefined,
        },
      });
      const loaded = await tx.hrEmploymentSettlement.findUniqueOrThrow({
        where: { id },
        include: settlementInclude,
      });
      return presentSettlement(loaded, true, tx);
    });
  }
  static async pdf(scope: Scope, id: number) {
    const row = await this.get(scope, id);
    if (!['APPROVED', 'PAID'].includes(row.status))
      throw new HrBenefitsError('La constancia se genera después de aprobar', 409);
    const doc = new jsPDF();
    const tableDoc = doc as jsPDF & { lastAutoTable: { finalY: number } };
    const evidenceReferences = Array.isArray(row.evidenceReferences)
      ? row.evidenceReferences.filter(
          (reference): reference is string => typeof reference === 'string'
        )
      : [];
    doc.setFontSize(16);
    doc.text('Constancia de liquidación final', 14, 17);
    autoTable(doc, {
      startY: 24,
      theme: 'grid',
      head: [['Dato', 'Valor']],
      body: [
        ['Código', row.code],
        ['Empleado', `${row.employee.legalName} (${row.employee.employeeCode})`],
        ['Tipo de salida', row.exitType],
        ['Causal', row.cause],
        ['Fecha de terminación', String(row.terminationDate).slice(0, 10)],
        ['Justificación', row.justification],
        ['Estado', row.status],
      ],
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 42, fontStyle: 'bold' } },
    });
    autoTable(doc, {
      startY: tableDoc.lastAutoTable.finalY + 7,
      theme: 'striped',
      head: [['Tipo', 'Concepto', 'Base/Fórmula', 'Fuente', 'Monto']],
      body: row.lines.map((item) => [
        item.type,
        item.concept,
        item.formulaBasis,
        item.sourceReference,
        `${row.currency} ${item.amount}`,
      ]),
      styles: { fontSize: 7, overflow: 'linebreak' },
      columnStyles: { 2: { cellWidth: 48 }, 3: { cellWidth: 43 }, 4: { halign: 'right' } },
    });
    autoTable(doc, {
      startY: tableDoc.lastAutoTable.finalY + 6,
      theme: 'grid',
      body: [
        ['Ingresos', `${row.currency} ${row.grossEarnings}`],
        ['Deducciones', `${row.currency} ${row.totalDeductions}`],
        ['Neto', `${row.currency} ${row.netPay}`],
      ],
      styles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    });
    autoTable(doc, {
      startY: tableDoc.lastAutoTable.finalY + 7,
      theme: 'striped',
      head: [['Soportes / referencias']],
      body: evidenceReferences.map((reference) => [reference]),
      styles: { fontSize: 8 },
    });
    autoTable(doc, {
      startY: tableDoc.lastAutoTable.finalY + 7,
      theme: 'grid',
      head: [['Evento', 'Responsable', 'Fecha', 'Justificación']],
      body: (row.trace ?? []).map((event) => [
        event.event,
        event.actor?.name ?? 'Sistema',
        String(event.occurredAt).slice(0, 19),
        event.reason ?? '',
      ]),
      styles: { fontSize: 7, overflow: 'linebreak' },
    });
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setFontSize(6.5);
      doc.text(`Huella de cálculo: ${row.calculationHash}`, 14, 287);
      doc.text(`Página ${page} de ${pages}`, 180, 287);
    }
    return {
      buffer: Buffer.from(doc.output('arraybuffer')),
      filename: `liquidacion-${row.code}.pdf`,
    };
  }
}
