import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'DEMO-RH-NOMINA';

function requiredPositiveInt(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${name} debe ser un entero positivo`);
  return value;
}

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function at(value: string): Date {
  return new Date(value);
}

function money(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const LEGAL_CONFIGURATION = {
  schema: 'HR_PAYROLL_PARAMETRIC_V4',
  legallyValidated: true,
  currency: 'NIO',
  regular: {
    minuteDivisors: { WEEKLY: '2400', BIWEEKLY: '4800', FORTNIGHTLY: '4800', MONTHLY: '9600' },
    overtimeMultiplier: '2',
    paidLeaveUnitMinutes: { DAYS: '480', HOURS: '60', MINUTES: '1' },
  },
  aguinaldo: {
    method: 'HISTORICAL_PAID_COMPONENTS',
    lookbackDays: 365,
    incomeDivisor: '12',
    prorationMode: 'SERVICE_DAYS_RATIO',
    eligibleSources: ['ORDINARY', 'OVERTIME', 'PAID_LEAVE'],
    roundingScale: 2,
  },
  statutory: {
    companyTaxRegime: {
      code: 'GENERAL',
      sourceReference: 'Ley 822 y Decreto 01-2013',
      incomeTaxApplicability: 'APPLIES',
    },
    inss: {
      applicability: 'APPLIES',
      sourceReference: 'Decreto 975 y reformas vigentes',
      regime: 'INTEGRAL',
      employeeRate: '0.07',
      employerRateBelowThreshold: '0.215',
      employerRateAtOrAboveThreshold: '0.225',
      employerSizeThreshold: 50,
      minimumMonthlyContributionBase: '10000',
      minimumBaseProration: 'PER_PAY_PERIOD_SERVICE_RATIO',
      annualPeriods: { WEEKLY: 52, BIWEEKLY: 24, FORTNIGHTLY: 26, MONTHLY: 12 },
    },
    inatec: {
      applicability: 'APPLIES',
      sourceReference: 'Decreto 3-91, aporte patronal INATEC',
      employerRate: '0.02',
    },
    incomeTax: {
      sourceReference: 'Ley 822 art. 23 y Decreto 01-2013 art. 19',
      regimeApplicabilityAcknowledged: true,
      calculationMethods: {
        fixed: 'FIXED_PERIOD_PROJECTION',
        salaryChange: 'FIXED_SALARY_CHANGE',
        variable: 'VARIABLE_ACCUMULATED',
        occasional: 'OCCASIONAL_INCREMENTAL',
      },
      inssEmployeeContributionDeductible: true,
      occasionalInssDeductionTreatment: 'DEDUCT_FROM_OCCASIONAL_NET',
      adjustmentMode: 'WITHHOLD_OR_REFUND',
      annualPeriods: { WEEKLY: 52, BIWEEKLY: 24, FORTNIGHTLY: 26, MONTHLY: 12 },
      brackets: [
        { lowerBound: '0', upperBound: '100000', baseTax: '0', rate: '0', excessOver: '0' },
        {
          lowerBound: '100000',
          upperBound: '200000',
          baseTax: '0',
          rate: '0.15',
          excessOver: '100000',
        },
        {
          lowerBound: '200000',
          upperBound: '350000',
          baseTax: '15000',
          rate: '0.20',
          excessOver: '200000',
        },
        {
          lowerBound: '350000',
          upperBound: '500000',
          baseTax: '45000',
          rate: '0.25',
          excessOver: '350000',
        },
        {
          lowerBound: '500000',
          upperBound: null,
          baseTax: '82500',
          rate: '0.30',
          excessOver: '500000',
        },
      ],
    },
    paymentConceptCatalog: [
      {
        code: 'INGRESO_ORDINARIO_FIJO',
        name: 'Ingreso ordinario fijo',
        type: 'INCOME',
        socialSecurityApplicable: true,
        trainingContributionApplicable: true,
        incomeTaxTreatment: 'REGULAR_FIXED',
        incomeTaxDeductible: false,
        sourceReference: 'Contrato laboral',
      },
      {
        code: 'HORAS_EXTRA_APROBADAS',
        name: 'Horas extra aprobadas',
        type: 'INCOME',
        socialSecurityApplicable: true,
        trainingContributionApplicable: true,
        incomeTaxTreatment: 'REGULAR_VARIABLE',
        incomeTaxDeductible: false,
        sourceReference: 'Código del Trabajo',
      },
      {
        code: 'VIATICO_REEMBOLSO',
        name: 'Reembolso de viático',
        type: 'INCOME',
        socialSecurityApplicable: false,
        trainingContributionApplicable: false,
        incomeTaxTreatment: null,
        incomeTaxDeductible: false,
        sourceReference: 'Política de viáticos',
      },
      {
        code: 'INSS_LABORAL',
        name: 'INSS laboral',
        type: 'DEDUCTION',
        socialSecurityApplicable: false,
        trainingContributionApplicable: false,
        incomeTaxTreatment: null,
        incomeTaxDeductible: true,
        sourceReference: 'Decreto 975',
      },
      {
        code: 'IR_LABORAL',
        name: 'IR laboral',
        type: 'DEDUCTION',
        socialSecurityApplicable: false,
        trainingContributionApplicable: false,
        incomeTaxTreatment: null,
        incomeTaxDeductible: false,
        sourceReference: 'Ley 822',
      },
      {
        code: 'DEDUCCION_PRESTAMO',
        name: 'Cuota de préstamo',
        type: 'DEDUCTION',
        socialSecurityApplicable: false,
        trainingContributionApplicable: false,
        incomeTaxTreatment: null,
        incomeTaxDeductible: false,
        sourceReference: 'Autorización del colaborador',
      },
    ],
  },
} as const;

async function main() {
  if (process.env.ALLOW_HR_DEMO_SEED !== 'true') {
    throw new Error('Defina ALLOW_HR_DEMO_SEED=true para confirmar la carga del escenario demo RH');
  }
  const companyId = requiredPositiveInt('HR_DEMO_COMPANY_ID');
  const expectedCompanyName = process.env.HR_DEMO_COMPANY_NAME?.trim();
  if (!expectedCompanyName) {
    throw new Error('Defina HR_DEMO_COMPANY_NAME con el nombre exacto de la empresa de destino');
  }

  const isProduction =
    process.env.NODE_ENV?.toLowerCase() === 'production' ||
    process.env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() === 'production';
  if (isProduction && process.env.ALLOW_HR_DEMO_PRODUCTION !== 'true') {
    throw new Error(
      'Defina ALLOW_HR_DEMO_PRODUCTION=true para confirmar explícitamente una carga en producción'
    );
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company?.active) throw new Error(`Empresa ${companyId} inexistente o inactiva`);
  if (company.name !== expectedCompanyName) {
    throw new Error(
      `La empresa ${companyId} se llama "${company.name}" y no coincide con HR_DEMO_COMPANY_NAME`
    );
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      payrollTaxRegime: LEGAL_CONFIGURATION.statutory.companyTaxRegime.code,
      payrollIncomeTaxWithholding: true,
      payrollTaxRegimeReference: LEGAL_CONFIGURATION.statutory.companyTaxRegime.sourceReference,
      payrollIncomeTaxException: null,
      payrollTaxProfileReady: true,
    },
  });

  const branch = await prisma.branch.findFirst({
    where: { companyId, status: 'ACTIVE' },
    orderBy: { id: 'asc' },
  });
  if (!branch) throw new Error('La empresa no tiene una sucursal activa');
  const actor =
    (await prisma.user.findFirst({
      where: { companyId, status: 'ACTIVE', role: { name: 'SUPERADMIN' } },
      orderBy: { id: 'asc' },
    })) ??
    (await prisma.user.findFirst({
      where: { companyId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    }));
  if (!actor) throw new Error('La empresa no tiene un usuario activo para la trazabilidad');

  const employeeRole = await prisma.role.upsert({
    where: { companyId_name: { companyId, name: 'EMPLEADO' } },
    update: { description: 'Cuenta interna de colaborador' },
    create: { companyId, name: 'EMPLEADO', description: 'Cuenta interna de colaborador' },
  });
  const department = await prisma.department.upsert({
    where: { companyId_code: { companyId, code: 'DEMO-RH-OPS' } },
    update: { active: true },
    create: {
      companyId,
      code: 'DEMO-RH-OPS',
      name: 'Operaciones Demo RH',
      description: 'Departamento para el flujo integral de nómina',
    },
  });
  const position = await prisma.jobPosition.upsert({
    where: { companyId_code: { companyId, code: 'DEMO-RH-COL' } },
    update: { departmentId: department.id, active: true },
    create: {
      companyId,
      departmentId: department.id,
      code: 'DEMO-RH-COL',
      name: 'Colaborador Demo de Nómina',
      active: true,
    },
  });
  const costCenter = await prisma.costCenter.upsert({
    where: { companyId_code: { companyId, code: 'DEMO-RH-CC' } },
    update: { active: true },
    create: { companyId, code: 'DEMO-RH-CC', name: 'Centro de costo Demo RH', active: true },
  });
  const lockedPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
  const people = [
    { key: 'ANA', name: 'Ana López Demo', salary: 16000, document: '001-010190-1001A' },
    { key: 'CARLOS', name: 'Carlos Méndez Demo', salary: 20000, document: '001-020288-1002B' },
    { key: 'SOFIA', name: 'Sofía Ruiz Demo', salary: 30000, document: '001-030395-1003C' },
  ];
  const employees: Array<{
    userId: number;
    employeeId: number;
    salary: number;
    key: string;
    name: string;
    compensationId: number;
  }> = [];

  for (const person of people) {
    const username = `demo.rh.${companyId}.${person.key.toLowerCase()}`;
    const user = await prisma.user.upsert({
      where: { username },
      update: {
        companyId,
        branchId: branch.id,
        roleId: employeeRole.id,
        accountType: 'INTERNAL',
        status: 'ACTIVE',
        name: person.name,
      },
      create: {
        companyId,
        branchId: branch.id,
        roleId: employeeRole.id,
        accountType: 'INTERNAL',
        status: 'ACTIVE',
        name: person.name,
        username,
        email: `${username}@example.invalid`,
        password: lockedPassword,
        mustChangePassword: true,
      },
    });
    await prisma.userBranch.upsert({
      where: { userId_branchId: { userId: user.id, branchId: branch.id } },
      update: {},
      create: { userId: user.id, branchId: branch.id },
    });
    const employee = await prisma.employee.upsert({
      where: { userId: user.id },
      update: {
        companyId,
        legalName: person.name,
        status: 'ACTIVE',
        departmentId: department.id,
        jobPositionId: position.id,
        costCenterId: costCenter.id,
      },
      create: {
        companyId,
        userId: user.id,
        employeeCode: `${PREFIX}-${companyId}-${person.key}`,
        legalName: person.name,
        preferredName: person.name.split(' ')[0],
        documentType: 'CÉDULA',
        documentNumber: person.document,
        socialSecurityNumber: `INSS-${companyId}-${person.key}`,
        taxId: `RUC-${companyId}-${person.key}`,
        hireDate: date('2025-01-06'),
        employmentType: 'FULL_TIME',
        status: 'ACTIVE',
        departmentId: department.id,
        jobPositionId: position.id,
        costCenterId: costCenter.id,
      },
    });
    const contractNumber = `${PREFIX}-CON-${companyId}-${person.key}`;
    const contract = await prisma.employmentContract.upsert({
      where: { companyId_contractNumber: { companyId, contractNumber } },
      update: {
        status: 'ACTIVE',
        employeeId: employee.id,
        jobPositionId: position.id,
        costCenterId: costCenter.id,
      },
      create: {
        companyId,
        employeeId: employee.id,
        jobPositionId: position.id,
        costCenterId: costCenter.id,
        contractNumber,
        employmentType: 'FULL_TIME',
        startDate: date('2025-01-06'),
        status: 'ACTIVE',
        signedAt: at('2025-01-03T16:00:00.000Z'),
        notes: 'Contrato demo para validar el ciclo completo de nómina',
      },
    });
    await prisma.employeeBranchAssignment.upsert({
      where: {
        employeeId_branchId_effectiveFrom: {
          employeeId: employee.id,
          branchId: branch.id,
          effectiveFrom: date('2025-01-06'),
        },
      },
      update: { isPrimary: true, effectiveTo: null },
      create: {
        companyId,
        employeeId: employee.id,
        branchId: branch.id,
        isPrimary: true,
        effectiveFrom: date('2025-01-06'),
      },
    });
    let compensation = await prisma.compensationHistory.findFirst({
      where: { companyId, employeeId: employee.id, effectiveFrom: date('2025-01-06') },
    });
    if (compensation) {
      compensation = await prisma.compensationHistory.update({
        where: { id: compensation.id },
        data: {
          contractId: contract.id,
          amount: money(person.salary),
          compensationType: 'SALARY',
          payFrequency: 'MONTHLY',
          currency: 'NIO',
          effectiveTo: null,
        },
      });
    } else {
      compensation = await prisma.compensationHistory.create({
        data: {
          companyId,
          employeeId: employee.id,
          contractId: contract.id,
          changedById: actor.id,
          compensationType: 'SALARY',
          payFrequency: 'MONTHLY',
          amount: money(person.salary),
          currency: 'NIO',
          effectiveFrom: date('2025-01-06'),
          reason: 'Salario inicial del escenario demo',
        },
      });
    }
    employees.push({
      userId: user.id,
      employeeId: employee.id,
      salary: person.salary,
      key: person.key,
      name: person.name,
      compensationId: compensation.id,
    });
  }

  const policy = await prisma.attendancePolicy.upsert({
    where: {
      companyId_scopeKey_version: { companyId, scopeKey: `${PREFIX}-${branch.id}`, version: 1 },
    },
    update: {
      active: true,
      currentKey: `${PREFIX}-CURRENT-${branch.id}`,
      allowManualFallback: true,
    },
    create: {
      companyId,
      branchId: branch.id,
      scopeKey: `${PREFIX}-${branch.id}`,
      currentKey: `${PREFIX}-CURRENT-${branch.id}`,
      version: 1,
      timezone: 'America/Managua',
      requireBiometric: false,
      requireLiveness: false,
      requireGeolocation: false,
      scheduleViolationMode: 'REVIEW',
      geofenceViolationMode: 'WARN',
      biometricViolationMode: 'WARN',
      allowUnscheduledPunch: true,
      unscheduledViolationMode: 'REVIEW',
      allowManualFallback: true,
      biometricConsentVersion: 'DEMO-v1',
      biometricRetentionDays: 30,
      biometricRetentionNotice: 'Datos sintéticos sin plantilla biométrica real',
      createdById: actor.id,
    },
  });
  const attendancePeriod = await prisma.attendancePeriod.upsert({
    where: {
      companyId_dateFrom_dateTo: {
        companyId,
        dateFrom: date('2026-07-01'),
        dateTo: date('2026-07-15'),
      },
    },
    update: {
      status: 'CLOSED',
      payrollEligible: true,
      revision: 1,
      lastActionReason: 'Cierre demo listo para nómina',
      closedById: actor.id,
      closedAt: at('2026-07-15T23:00:00.000Z'),
    },
    create: {
      companyId,
      dateFrom: date('2026-07-01'),
      dateTo: date('2026-07-15'),
      timezone: 'America/Managua',
      status: 'CLOSED',
      revision: 1,
      lastActionReason: 'Cierre demo listo para nómina',
      payrollEligible: true,
      createdById: actor.id,
      closedById: actor.id,
      closedAt: at('2026-07-15T23:00:00.000Z'),
    },
  });

  for (const [personIndex, employee] of employees.entries()) {
    for (const [dayIndex, day] of [
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-06',
      '2026-07-07',
    ].entries()) {
      const late = personIndex === 1 && dayIndex === 1 ? 18 : 0;
      const overtime = personIndex === 2 && dayIndex === 4 ? 90 : 0;
      const summary = await prisma.attendanceDailySummary.upsert({
        where: {
          companyId_userId_date_scopeKey: {
            companyId,
            userId: employee.userId,
            date: date(day),
            scopeKey: `${PREFIX}-${branch.id}`,
          },
        },
        update: {
          periodId: attendancePeriod.id,
          branchId: branch.id,
          ordinaryMinutes: 480 - late,
          lateMinutes: late,
          candidateOvertimeMinutes: overtime,
          approvedOvertimeMinutes: overtime,
          sourceRevision: 1,
        },
        create: {
          companyId,
          userId: employee.userId,
          branchId: branch.id,
          scopeKey: `${PREFIX}-${branch.id}`,
          date: date(day),
          timezone: 'America/Managua',
          periodId: attendancePeriod.id,
          scheduledMinutes: 480,
          ordinaryMinutes: 480 - late,
          breakMinutes: 60,
          lateMinutes: late,
          candidateOvertimeMinutes: overtime,
          approvedOvertimeMinutes: overtime,
          sourceRevision: 1,
        },
      });
      const checkInAt = at(`${day}T${late ? '14:18' : '14:00'}:00.000Z`);
      const checkOutAt = at(`${day}T${overtime ? '23:30' : '22:00'}:00.000Z`);
      for (const event of [
        {
          suffix: 'IN',
          action: 'CHECK_IN' as const,
          time: checkInAt,
          source: personIndex === 0 && dayIndex === 0 ? ('MANUAL' as const) : ('SELF' as const),
        },
        { suffix: 'OUT', action: 'CHECK_OUT' as const, time: checkOutAt, source: 'SELF' as const },
      ]) {
        const idempotencyKey = `${PREFIX}-${companyId}-${employee.key}-${day}-${event.suffix}`;
        const existingEvent = await prisma.attendanceEvent.findUnique({
          where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
          select: { id: true },
        });
        if (!existingEvent) {
          await prisma.attendanceEvent.create({
            data: {
              companyId,
              userId: employee.userId,
              actorUserId: event.source === 'MANUAL' ? actor.id : employee.userId,
              branchId: branch.id,
              policyId: policy.id,
              policyVersion: policy.version,
              idempotencyKey,
              requestHash: hash({ employee: employee.key, day, action: event.action }),
              sessionKey: `${PREFIX}-${employee.key}-${day}`,
              sequenceKey: `${PREFIX}-${employee.key}-${day}-${event.suffix}`,
              action: event.action,
              source: event.source,
              serverAt: event.time,
              clientAt: event.time,
              faceStatus: 'NOT_REQUIRED',
              livenessStatus: 'NOT_REQUIRED',
              decision: late ? 'REVIEW' : 'ACCEPTED',
              reasonCode:
                event.source === 'MANUAL' ? 'SUPERVISED_DEMO' : late ? 'LATE_ARRIVAL' : null,
              reasonCodes:
                event.source === 'MANUAL' ? ['SUPERVISED_DEMO'] : late ? ['LATE_ARRIVAL'] : [],
              message:
                event.source === 'MANUAL'
                  ? 'Marcaje manual supervisado de ejemplo'
                  : late
                    ? 'Llegada tardía para revisión'
                    : 'Marcaje aceptado',
              checks: { synthetic: true, policyVersion: policy.version },
            },
          });
        }
      }
      if (late) {
        await prisma.attendanceIncident.upsert({
          where: {
            companyId_dedupeKey: { companyId, dedupeKey: `${PREFIX}-LATE-${employee.key}-${day}` },
          },
          update: { dailySummaryId: summary.id, status: 'OPEN' },
          create: {
            companyId,
            dailySummaryId: summary.id,
            userId: employee.userId,
            branchId: branch.id,
            date: date(day),
            type: 'LATE_ARRIVAL',
            severity: 'WARNING',
            status: 'OPEN',
            reasonCode: 'LATE_ARRIVAL',
            message: 'Llegada 18 minutos tarde para revisión demo',
            dedupeKey: `${PREFIX}-LATE-${employee.key}-${day}`,
          },
        });
      }
    }
  }

  const vacationType = await prisma.leaveType.upsert({
    where: { companyId_code: { companyId, code: `${PREFIX}-VAC` } },
    update: { active: true },
    create: {
      companyId,
      code: `${PREFIX}-VAC`,
      name: 'Vacaciones Demo',
      description: 'Vacaciones remuneradas del flujo demo',
      paid: true,
      active: true,
      balanceTracked: true,
      unit: 'DAYS',
    },
  });
  const medicalType = await prisma.leaveType.upsert({
    where: { companyId_code: { companyId, code: `${PREFIX}-MED` } },
    update: { active: true },
    create: {
      companyId,
      code: `${PREFIX}-MED`,
      name: 'Subsidio médico Demo',
      paid: true,
      active: true,
      balanceTracked: false,
      unit: 'DAYS',
      requiresAttachment: true,
    },
  });
  for (const [index, employee] of employees.entries()) {
    const balance = await prisma.vacationBalance.upsert({
      where: {
        companyId_userId_scopeKey: {
          companyId,
          userId: employee.userId,
          scopeKey: `${PREFIX}-VAC-2026`,
        },
      },
      update: { leaveTypeId: vacationType.id, asOf: date('2026-07-15'), sourceRevision: 1 },
      create: {
        companyId,
        userId: employee.userId,
        leaveTypeId: vacationType.id,
        scopeKey: `${PREFIX}-VAC-2026`,
        periodLabel: 'Vacaciones 2026',
        unit: 'DAYS',
        asOf: date('2026-07-15'),
        sourceRevision: 1,
      },
    });
    const accrualRef = `${PREFIX}-ACCRUAL-${employee.key}`;
    const existingAccrual = await prisma.vacationLedgerEntry.findUnique({
      where: { companyId_reference: { companyId, reference: accrualRef } },
      select: { id: true },
    });
    if (!existingAccrual) {
      await prisma.vacationLedgerEntry.create({
        data: {
          companyId,
          balanceId: balance.id,
          userId: employee.userId,
          effectiveDate: date('2026-01-01'),
          amount: money(15),
          unit: 'DAYS',
          type: 'ACCRUAL',
          reason: 'Acreditación anual demo',
          reference: accrualRef,
          actorId: actor.id,
          resultingBalance: money(15),
        },
      });
    }
    if (index === 0) {
      let request = await prisma.leaveRequest.findFirst({
        where: {
          companyId,
          userId: employee.userId,
          leaveTypeId: vacationType.id,
          startDate: date('2026-07-10'),
        },
      });
      const data = {
        branchId: branch.id,
        endDate: date('2026-07-11'),
        fraction: 'FULL_DAY' as const,
        requestedAmount: money(2),
        balanceUnit: 'DAYS' as const,
        reason: 'Descanso familiar de ejemplo',
        status: 'APPROVED' as const,
        revision: 2,
        requestedById: employee.userId,
        decidedById: actor.id,
        decisionReason: 'Saldo y cobertura verificados',
        submittedAt: at('2026-07-01T15:00:00.000Z'),
        decidedAt: at('2026-07-02T15:00:00.000Z'),
      };
      request = request
        ? await prisma.leaveRequest.update({ where: { id: request.id }, data })
        : await prisma.leaveRequest.create({
            data: {
              companyId,
              userId: employee.userId,
              leaveTypeId: vacationType.id,
              startDate: date('2026-07-10'),
              ...data,
            },
          });
      const usageRef = `${PREFIX}-USAGE-${employee.key}`;
      const existingUsage = await prisma.vacationLedgerEntry.findUnique({
        where: { companyId_reference: { companyId, reference: usageRef } },
        select: { id: true },
      });
      if (!existingUsage) {
        await prisma.vacationLedgerEntry.create({
          data: {
            companyId,
            balanceId: balance.id,
            userId: employee.userId,
            leaveRequestId: request.id,
            effectiveDate: date('2026-07-10'),
            amount: money(-2),
            unit: 'DAYS',
            type: 'USAGE',
            reason: 'Vacaciones aprobadas demo',
            reference: usageRef,
            actorId: actor.id,
            resultingBalance: money(13),
          },
        });
      }
    }
  }
  void medicalType;

  const rule = await prisma.payrollRuleVersion.upsert({
    where: {
      companyId_name_version: { companyId, name: 'Regla legal Nicaragua Demo 2026', version: 1 },
    },
    update: {
      status: 'ACTIVE',
      effectiveFrom: date('2026-01-01'),
      sourceReference: 'Ley 822, Decreto 975 e INATEC',
      revision: 2,
      validatedById: actor.id,
      validatedAt: at('2026-01-02T15:00:00.000Z'),
      activatedAt: at('2026-01-02T16:00:00.000Z'),
    },
    create: {
      companyId,
      name: 'Regla legal Nicaragua Demo 2026',
      version: 1,
      status: 'ACTIVE',
      effectiveFrom: date('2026-01-01'),
      sourceReference: 'Ley 822, Decreto 975 e INATEC',
      description: 'IR laboral, INSS e INATEC configurados para el flujo demo',
      configurationSummary: 'IR progresivo + INSS integral + INATEC 2%',
      revision: 2,
      createdById: actor.id,
      validatedById: actor.id,
      validatedAt: at('2026-01-02T15:00:00.000Z'),
      activatedAt: at('2026-01-02T16:00:00.000Z'),
    },
  });
  const configurationHash = hash(LEGAL_CONFIGURATION);
  const existingConfiguration = await prisma.payrollRuleConfigurationRevision.findFirst({
    where: { ruleVersionId: rule.id, configurationHash },
  });
  const latestConfiguration = await prisma.payrollRuleConfigurationRevision.findFirst({
    where: { ruleVersionId: rule.id },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });
  const configuration =
    existingConfiguration ??
    (await prisma.payrollRuleConfigurationRevision.create({
      data: {
        companyId,
        ruleVersionId: rule.id,
        revision: (latestConfiguration?.revision ?? 0) + 1,
        configuration: LEGAL_CONFIGURATION as unknown as Prisma.InputJsonValue,
        configurationHash,
        sourceReference: 'Ley 822, Decreto 975 y Decreto 3-91',
        evidenceReference: `${PREFIX}-LEGAL-2026`,
        uploadReason: 'Configuración legal completa para demostración',
        uploadedById: actor.id,
      },
    }));
  const existingReview = await prisma.payrollRuleConfigurationReview.findUnique({
    where: { configurationRevisionId: configuration.id },
    select: { id: true },
  });
  if (!existingReview) {
    await prisma.payrollRuleConfigurationReview.create({
      data: {
        companyId,
        configurationRevisionId: configuration.id,
        decision: 'VALIDATED',
        reason: 'Fuentes y parámetros verificados para el escenario demo',
        reviewerId: actor.id,
      },
    });
  }
  await prisma.payrollRuleVersion.update({
    where: { id: rule.id },
    data: { activeConfigurationRevisionId: configuration.id },
  });

  const payrollPeriod = await prisma.payrollPeriod.upsert({
    where: { companyId_code: { companyId, code: `${PREFIX}-2026-07-Q1` } },
    update: { status: 'CLOSED', revision: 1 },
    create: {
      companyId,
      code: `${PREFIX}-2026-07-Q1`,
      dateFrom: date('2026-07-01'),
      dateTo: date('2026-07-15'),
      payDate: date('2026-07-16'),
      timezone: 'America/Managua',
      status: 'CLOSED',
      revision: 1,
      reason: 'Primera quincena demo con incidencias, beneficios y deducciones',
      createdById: actor.id,
    },
  });
  const run = await prisma.payrollRun.upsert({
    where: { companyId_code: { companyId, code: `${PREFIX}-RUN-2026-07-Q1` } },
    update: {
      status: 'PAID',
      periodId: payrollPeriod.id,
      ruleVersionId: rule.id,
      configurationRevisionId: configuration.id,
      revision: 5,
      calculationRevision: 1,
    },
    create: {
      companyId,
      kind: 'REGULAR',
      code: `${PREFIX}-RUN-2026-07-Q1`,
      status: 'PAID',
      periodId: payrollPeriod.id,
      ruleVersionId: rule.id,
      configurationRevisionId: configuration.id,
      revision: 5,
      calculationRevision: 1,
      currency: 'NIO',
      lastReason: 'Corrida demo calculada, revisada, aprobada y pagada',
      createdById: actor.id,
      calculatedById: actor.id,
      reviewSubmittedById: actor.id,
      approvedById: actor.id,
      paidById: actor.id,
      calculatedAt: at('2026-07-15T18:00:00.000Z'),
      reviewSubmittedAt: at('2026-07-15T19:00:00.000Z'),
      approvedAt: at('2026-07-15T20:00:00.000Z'),
      paidAt: at('2026-07-16T15:00:00.000Z'),
    },
  });

  const travel = await prisma.hrTravelRequest.upsert({
    where: { companyId_code: { companyId, code: `${PREFIX}-VIA-001` } },
    update: {
      status: 'SETTLED',
      approvedAmount: money(2500),
      advanceAmount: money(2500),
      recognizedExpenseAmount: money(2800),
      employeeReturnAmount: money(0),
      employeeReimbursementAmount: money(300),
      revision: 6,
    },
    create: {
      companyId,
      code: `${PREFIX}-VIA-001`,
      userId: employees[0].userId,
      employeeId: employees[0].employeeId,
      branchId: branch.id,
      destination: 'León, Nicaragua',
      purpose: 'Capacitación operativa y visita a proveedor',
      departureDate: date('2026-07-03'),
      returnDate: date('2026-07-05'),
      currency: 'NIO',
      requestedAmount: money(2800),
      approvedAmount: money(2500),
      advanceAmount: money(2500),
      recognizedExpenseAmount: money(2800),
      employeeReturnAmount: money(0),
      employeeReimbursementAmount: money(300),
      status: 'SETTLED',
      revision: 6,
      createdById: actor.id,
    },
  });
  for (const expense of [
    {
      category: 'TRANSPORTE',
      amount: 900,
      ref: `${PREFIX}-REC-VIA-001-A`,
      description: 'Transporte interurbano',
    },
    {
      category: 'HOSPEDAJE',
      amount: 1200,
      ref: `${PREFIX}-REC-VIA-001-B`,
      description: 'Hospedaje por dos noches',
    },
    {
      category: 'ALIMENTACION',
      amount: 700,
      ref: `${PREFIX}-REC-VIA-001-C`,
      description: 'Alimentación durante la misión',
    },
  ]) {
    const existing = await prisma.hrTravelExpense.findFirst({
      where: { companyId, travelRequestId: travel.id, receiptReference: expense.ref },
    });
    const data = {
      category: expense.category,
      description: expense.description,
      occurredOn: date('2026-07-04'),
      currency: 'NIO',
      claimedAmount: money(expense.amount),
      recognizedAmount: money(expense.amount),
      receiptReference: expense.ref,
      status: 'ACCEPTED' as const,
      createdById: employees[0].userId,
    };
    if (existing) await prisma.hrTravelExpense.update({ where: { id: existing.id }, data });
    else
      await prisma.hrTravelExpense.create({
        data: { companyId, travelRequestId: travel.id, ...data },
      });
  }
  for (const entry of [
    {
      type: 'ADVANCE' as const,
      amount: 2500,
      ref: `${PREFIX}-VIA-ADV-001`,
      reason: 'Anticipo de viático entregado',
    },
    {
      type: 'EXPENSE_RECOGNITION' as const,
      amount: 2800,
      ref: `${PREFIX}-VIA-EXP-001`,
      reason: 'Gastos reconocidos y conciliados',
    },
    {
      type: 'EMPLOYEE_REIMBURSEMENT' as const,
      amount: 300,
      ref: `${PREFIX}-VIA-REI-001`,
      reason: 'Reembolso al colaborador',
    },
  ]) {
    const existingTravelEntry = await prisma.hrTravelLedgerEntry.findUnique({
      where: {
        travelRequestId_type_reference: {
          travelRequestId: travel.id,
          type: entry.type,
          reference: entry.ref,
        },
      },
      select: { id: true },
    });
    if (!existingTravelEntry) {
      await prisma.hrTravelLedgerEntry.create({
        data: {
          companyId,
          travelRequestId: travel.id,
          type: entry.type,
          amount: money(entry.amount),
          currency: 'NIO',
          effectiveDate: date('2026-07-06'),
          reference: entry.ref,
          reason: entry.reason,
          actorId: actor.id,
        },
      });
    }
  }

  const loanDefinitions = [
    {
      key: 'PRESTAMO',
      employee: employees[1],
      amount: 12000,
      installments: 6,
      paid: 2000,
      purpose: 'Préstamo personal para reparación de vivienda',
    },
    {
      key: 'ADELANTO',
      employee: employees[2],
      amount: 5000,
      installments: 2,
      paid: 2500,
      purpose: 'Adelanto de salario solicitado por emergencia familiar',
    },
  ];
  const loanDeductions: Array<{
    deductionId: number;
    versionId: number;
    employee: (typeof employees)[number];
    amount: number;
    code: string;
  }> = [];
  for (const item of loanDefinitions) {
    const code = `${PREFIX}-${item.key}-001`;
    const loan = await prisma.hrLoan.upsert({
      where: { companyId_code: { companyId, code } },
      update: {
        status: 'ACTIVE',
        approvedAmount: money(item.amount),
        disbursedAmount: money(item.amount),
        outstandingBalance: money(item.amount - item.paid),
        revision: 4,
      },
      create: {
        companyId,
        code,
        userId: item.employee.userId,
        employeeId: item.employee.employeeId,
        purpose: item.purpose,
        currency: 'NIO',
        requestedAmount: money(item.amount),
        approvedAmount: money(item.amount),
        disbursedAmount: money(item.amount),
        outstandingBalance: money(item.amount - item.paid),
        preferredInstallments: item.installments,
        installmentCount: item.installments,
        payrollDeductionRequested: true,
        firstPreferredDeductionDate: date('2026-07-16'),
        firstDueDate: date('2026-07-16'),
        status: 'ACTIVE',
        revision: 4,
        createdById: actor.id,
        requestedAt: at('2026-06-20T15:00:00.000Z'),
      },
    });
    const existingSchedule = await prisma.hrLoanScheduleVersion.findUnique({
      where: { loanId_version: { loanId: loan.id, version: 1 } },
    });
    const schedule =
      existingSchedule ??
      (await prisma.hrLoanScheduleVersion.create({
        data: { companyId, loanId: loan.id, version: 1, status: 'ACTIVE', principalOnly: true },
      }));
    const installmentAmount = item.amount / item.installments;
    for (let number = 1; number <= item.installments; number += 1) {
      const month = 7 + number - 1;
      const due = new Date(Date.UTC(2026, month - 1, 16));
      const existingInstallment = await prisma.hrLoanInstallment.findUnique({
        where: { scheduleVersionId_number: { scheduleVersionId: schedule.id, number } },
        select: { id: true },
      });
      if (!existingInstallment) {
        await prisma.hrLoanInstallment.create({
          data: {
            companyId,
            scheduleVersionId: schedule.id,
            number,
            dueDate: due,
            scheduledPrincipal: money(installmentAmount),
            scheduledCharge: money(0),
            scheduledTotal: money(installmentAmount),
          },
        });
      }
    }
    const disbursementRef = `${code}-DISB`;
    const existingDisbursement = await prisma.hrLoanLedgerEntry.findUnique({
      where: {
        loanId_type_reference: {
          loanId: loan.id,
          type: 'DISBURSEMENT',
          reference: disbursementRef,
        },
      },
      select: { id: true },
    });
    if (!existingDisbursement) {
      await prisma.hrLoanLedgerEntry.create({
        data: {
          companyId,
          loanId: loan.id,
          type: 'DISBURSEMENT',
          amount: money(item.amount),
          currency: 'NIO',
          effectiveDate: date('2026-06-25'),
          reference: disbursementRef,
          reason: 'Desembolso aprobado del escenario demo',
          actorId: actor.id,
        },
      });
    }
    const deductionRef = `${code}-Q1`;
    const existingLoanDeduction = await prisma.hrLoanLedgerEntry.findUnique({
      where: {
        loanId_type_reference: {
          loanId: loan.id,
          type: 'PAYROLL_DEDUCTION',
          reference: deductionRef,
        },
      },
      select: { id: true },
    });
    if (!existingLoanDeduction) {
      await prisma.hrLoanLedgerEntry.create({
        data: {
          companyId,
          loanId: loan.id,
          type: 'PAYROLL_DEDUCTION',
          amount: money(item.paid),
          currency: 'NIO',
          effectiveDate: date('2026-07-16'),
          payrollRunId: run.id,
          reference: deductionRef,
          reason: 'Cuota descontada en la corrida demo',
          actorId: actor.id,
        },
      });
    }
    const deductionCode = `${code}-DED`;
    const deduction = await prisma.hrDeduction.upsert({
      where: { companyId_code: { companyId, code: deductionCode } },
      update: {
        loanId: loan.id,
        status: 'ACTIVE',
        remainingAmount: money(item.amount - item.paid),
        revision: 2,
      },
      create: {
        companyId,
        code: deductionCode,
        userId: item.employee.userId,
        employeeId: item.employee.employeeId,
        loanId: loan.id,
        source: 'LOAN',
        status: 'ACTIVE',
        revision: 2,
        remainingAmount: money(item.amount - item.paid),
        createdById: actor.id,
      },
    });
    const existingVersion = await prisma.hrDeductionVersion.findUnique({
      where: { deductionId_version: { deductionId: deduction.id, version: 1 } },
    });
    const version =
      existingVersion ??
      (await prisma.hrDeductionVersion.create({
        data: {
          companyId,
          deductionId: deduction.id,
          version: 1,
          name:
            item.key === 'ADELANTO'
              ? 'Recuperación de adelanto salarial'
              : 'Cuota de préstamo personal',
          reason: item.purpose,
          currency: 'NIO',
          frequency: 'RECURRING',
          requestedAmount: money(item.amount),
          applicableAmount: money(item.amount),
          perPeriodLimit: money(item.paid),
          priority: 20,
          effectiveFrom: date('2026-07-01'),
        },
      }));
    loanDeductions.push({
      deductionId: deduction.id,
      versionId: version.id,
      employee: item.employee,
      amount: item.paid,
      code: deductionCode,
    });
  }

  const manualDeduction = await prisma.hrDeduction.upsert({
    where: { companyId_code: { companyId, code: `${PREFIX}-DED-COOP-001` } },
    update: { status: 'ACTIVE', remainingAmount: money(900), revision: 1 },
    create: {
      companyId,
      code: `${PREFIX}-DED-COOP-001`,
      userId: employees[0].userId,
      employeeId: employees[0].employeeId,
      source: 'MANUAL',
      status: 'ACTIVE',
      revision: 1,
      remainingAmount: money(900),
      createdById: actor.id,
    },
  });
  const existingManualVersion = await prisma.hrDeductionVersion.findUnique({
    where: { deductionId_version: { deductionId: manualDeduction.id, version: 1 } },
  });
  const manualVersion =
    existingManualVersion ??
    (await prisma.hrDeductionVersion.create({
      data: {
        companyId,
        deductionId: manualDeduction.id,
        version: 1,
        name: 'Aporte cooperativa',
        reason: 'Deducción voluntaria autorizada',
        currency: 'NIO',
        frequency: 'RECURRING',
        requestedAmount: money(1200),
        applicableAmount: money(1200),
        perPeriodLimit: money(300),
        priority: 80,
        effectiveFrom: date('2026-07-01'),
      },
    }));
  loanDeductions.push({
    deductionId: manualDeduction.id,
    versionId: manualVersion.id,
    employee: employees[0],
    amount: 300,
    code: `${PREFIX}-DED-COOP-001`,
  });

  let runGross = 0;
  let runDeductions = 0;
  let runEmployer = 0;
  for (const [index, employee] of employees.entries()) {
    const base = employee.salary / 2;
    const overtime = index === 2 ? 900 : index === 1 ? 450 : 0;
    const reimbursement = index === 0 ? 300 : 0;
    const inss = Math.round((base + overtime) * 0.07 * 100) / 100;
    const incomeTax = index === 2 ? 950 : index === 1 ? 280 : 0;
    const benefitDeductions = loanDeductions.filter(
      (item) => item.employee.userId === employee.userId
    );
    const extraDeduction = benefitDeductions.reduce((sum, item) => sum + item.amount, 0);
    const gross = base + overtime + reimbursement;
    const deductions = inss + incomeTax + extraDeduction;
    const net = gross - deductions;
    const employerInss = Math.round((base + overtime) * 0.215 * 100) / 100;
    const inatec = Math.round((base + overtime) * 0.02 * 100) / 100;
    runGross += gross;
    runDeductions += deductions;
    runEmployer += employerInss + inatec;
    await prisma.payrollSnapshotLine.upsert({
      where: { runId_userId: { runId: run.id, userId: employee.userId } },
      update: {
        ordinaryMinutes: 2400,
        approvedOvertimeMinutes: index === 2 ? 90 : index === 1 ? 45 : 0,
        compensationAmount: money(employee.salary),
        attendancePeriodId: attendancePeriod.id,
        compensationHistoryId: employee.compensationId,
      },
      create: {
        companyId,
        runId: run.id,
        userId: employee.userId,
        employeeId: employee.employeeId,
        branchId: branch.id,
        attendancePeriodId: attendancePeriod.id,
        compensationHistoryId: employee.compensationId,
        ordinaryMinutes: 2400,
        approvedOvertimeMinutes: index === 2 ? 90 : index === 1 ? 45 : 0,
        paidLeaveAmount: money(index === 0 ? 2 : 0),
        unpaidLeaveAmount: money(0),
        compensationAmount: money(employee.salary),
        compensationType: 'SALARY',
        payFrequency: 'MONTHLY',
        currency: 'NIO',
        sourceRevision: 1,
        sourceTrace: { synthetic: true, period: attendancePeriod.id },
        coverageFrom: date('2026-07-01'),
        coverageTo: date('2026-07-15'),
        attendancePeriodRevision: 1,
        attendancePeriodStatus: 'CLOSED',
        summaryRevisions: [{ revision: 1 }],
        contractSegments: [{ from: '2026-07-01', to: '2026-07-15' }],
        compensationSegments: [{ amount: employee.salary, frequency: 'MONTHLY' }],
        aguinaldoIncomeSegments: [],
      },
    });
    const receipt = await prisma.payrollReceipt.upsert({
      where: { runId_userId: { runId: run.id, userId: employee.userId } },
      update: {
        grossIncome: money(gross),
        totalDeductions: money(deductions),
        netPay: money(net),
        status: 'PUBLISHED',
      },
      create: {
        companyId,
        runId: run.id,
        userId: employee.userId,
        employeeId: employee.employeeId,
        runKind: 'REGULAR',
        runCode: run.code,
        periodLabel: 'Primera quincena julio 2026',
        payDate: date('2026-07-16'),
        currency: 'NIO',
        grossIncome: money(gross),
        totalDeductions: money(deductions),
        netPay: money(net),
        status: 'PUBLISHED',
        publishedAt: at('2026-07-16T14:00:00.000Z'),
      },
    });
    const components = [
      {
        code: 'INGRESO_ORDINARIO_FIJO',
        name: 'Salario ordinario quincenal',
        type: 'INCOME' as const,
        source: 'CALCULATED',
        amount: base,
        taxable: true,
        social: true,
        inatec: true,
      },
      ...(overtime
        ? [
            {
              code: 'HORAS_EXTRA_APROBADAS',
              name: 'Horas extra aprobadas',
              type: 'INCOME' as const,
              source: 'ATTENDANCE',
              amount: overtime,
              taxable: true,
              social: true,
              inatec: true,
            },
          ]
        : []),
      ...(reimbursement
        ? [
            {
              code: 'VIATICO_REEMBOLSO',
              name: 'Reembolso de viático',
              type: 'INCOME' as const,
              source: 'BENEFITS',
              amount: reimbursement,
              taxable: false,
              social: false,
              inatec: false,
            },
          ]
        : []),
      {
        code: 'INSS_LABORAL',
        name: 'INSS laboral 7%',
        type: 'DEDUCTION' as const,
        source: 'STATUTORY',
        amount: inss,
        taxable: false,
        social: false,
        inatec: false,
      },
      ...(incomeTax
        ? [
            {
              code: 'IR_LABORAL',
              name: 'IR laboral',
              type: 'DEDUCTION' as const,
              source: 'STATUTORY',
              amount: incomeTax,
              taxable: false,
              social: false,
              inatec: false,
            },
          ]
        : []),
      ...benefitDeductions.map((item) => ({
        code: item.code,
        name: item.code.includes('COOP')
          ? 'Aporte cooperativa'
          : item.code.includes('ADELANTO')
            ? 'Recuperación de adelanto salarial'
            : 'Cuota de préstamo',
        type: 'DEDUCTION' as const,
        source: 'BENEFITS',
        amount: item.amount,
        taxable: false,
        social: false,
        inatec: false,
      })),
    ];
    for (const component of components) {
      let row = await prisma.payrollComponent.findFirst({
        where: { runId: run.id, userId: employee.userId, code: component.code },
      });
      const data = {
        receiptId: receipt.id,
        name: component.name,
        type: component.type,
        source: component.source,
        amount: money(component.amount),
        taxable: component.taxable,
        incomeTaxTreatment:
          component.type === 'INCOME' && component.taxable
            ? component.code === 'SALARIO_BASE'
              ? 'REGULAR_FIXED'
              : 'REGULAR_VARIABLE'
            : null,
        incomeTaxDeductible: component.code === 'INSS_LABORAL',
        socialSecurityApplicable: component.social,
        trainingContributionApplicable: component.inatec,
        traceReference: `${PREFIX}:${run.code}:${employee.key}:${component.code}`,
        reason: 'Componente generado para el escenario integral demo',
        createdById: actor.id,
      };
      row = row
        ? await prisma.payrollComponent.update({ where: { id: row.id }, data })
        : await prisma.payrollComponent.create({
            data: {
              companyId,
              runId: run.id,
              userId: employee.userId,
              code: component.code,
              ...data,
            },
          });
      const linked = benefitDeductions.find((item) => item.code === component.code);
      if (linked) {
        const existingApplication = await prisma.hrDeductionApplication.findUnique({
          where: {
            deductionId_payrollRunId_kind: {
              deductionId: linked.deductionId,
              payrollRunId: run.id,
              kind: 'APPLIED',
            },
          },
          select: { id: true },
        });
        if (!existingApplication) {
          await prisma.hrDeductionApplication.create({
            data: {
              companyId,
              deductionId: linked.deductionId,
              versionId: linked.versionId,
              payrollRunId: run.id,
              kind: 'APPLIED',
              amount: money(linked.amount),
              currency: 'NIO',
              componentId: row.id,
              reason: 'Aplicación en la corrida demo',
              actorId: actor.id,
            },
          });
        }
      }
    }
    for (const contribution of [
      {
        code: 'INSS_PATRONAL',
        name: 'INSS patronal',
        base: base + overtime,
        rate: 0.215,
        amount: employerInss,
      },
      {
        code: 'INATEC_PATRONAL',
        name: 'Aporte INATEC',
        base: base + overtime,
        rate: 0.02,
        amount: inatec,
      },
    ]) {
      const existing = await prisma.payrollEmployerContribution.findFirst({
        where: {
          runId: run.id,
          calculationRevision: 1,
          userId: employee.userId,
          code: contribution.code,
        },
      });
      const data = {
        name: contribution.name,
        baseAmount: money(contribution.base),
        rate: new Prisma.Decimal(contribution.rate),
        amount: money(contribution.amount),
        traceReference: `${PREFIX}:${contribution.code}`,
      };
      if (!existing)
        await prisma.payrollEmployerContribution.create({
          data: {
            companyId,
            runId: run.id,
            userId: employee.userId,
            calculationRevision: 1,
            code: contribution.code,
            ...data,
          },
        });
    }
    const statutory = await prisma.payrollStatutoryCalculation.findFirst({
      where: { runId: run.id, calculationRevision: 1, userId: employee.userId },
    });
    const statutoryData = {
      configurationRevisionId: configuration.id,
      companyTaxRegime: 'GENERAL',
      methodVersion: 'ART19_V3',
      incomeTaxMethod: 'FIXED_PERIOD_PROJECTION',
      payFrequency: 'BIWEEKLY',
      employerHeadcount: employees.length,
      inssBase: money(base + overtime),
      employeeInss: money(inss),
      regularEmployeeInss: money(inss),
      occasionalEmployeeInss: money(0),
      employerInssRate: new Prisma.Decimal('0.215'),
      employerInss: money(employerInss),
      inatecBase: money(base + overtime),
      employerInatec: money(inatec),
      fixedIncomeTaxGross: money(base),
      variableIncomeTaxGross: money(overtime),
      occasionalIncomeTaxGross: money(0),
      fixedCompensationAmount: money(base),
      currentRegularIncomeTaxNet: money(base + overtime - inss),
      currentOccasionalIncomeTaxNet: money(0),
      currentIncomeTaxNet: money(base + overtime - inss),
      otherIncomeTaxDeductions: money(0),
      priorIncomeTaxNet: money(0),
      priorOccasionalIncomeTaxNet: money(0),
      priorHadVariableIncome: false,
      accumulatedIncomeTaxNet: money(base + overtime - inss),
      elapsedPeriods: 1,
      elapsedFiscalMonths: 1,
      annualPeriods: 24,
      annualProjection: money((base + overtime - inss) * 24),
      regularAnnualIncomeTax: money(incomeTax * 24),
      annualIncomeTaxWithOccasional: money(incomeTax * 24),
      annualIncomeTax: money(incomeTax * 24),
      priorRegularIncomeTaxWithheld: money(0),
      priorOccasionalIncomeTaxWithheld: money(0),
      priorIncomeTaxWithheld: money(0),
      regularIncomeTaxWithheld: money(incomeTax),
      occasionalIncomeTaxWithheld: money(0),
      currentIncomeTaxWithheld: money(incomeTax),
      incomeTaxRefund: money(0),
      incomeTaxCreditBalance: money(0),
      bracketSnapshot: { synthetic: true, effectiveRate: gross ? incomeTax / gross : 0 },
      historyFingerprint: hash({ run: run.id, user: employee.userId, gross, deductions }),
    };
    if (!statutory)
      await prisma.payrollStatutoryCalculation.create({
        data: {
          companyId,
          runId: run.id,
          userId: employee.userId,
          calculationRevision: 1,
          ...statutoryData,
        },
      });
  }
  await prisma.payrollRun.update({
    where: { id: run.id },
    data: {
      grossIncome: money(runGross),
      totalDeductions: money(runDeductions),
      employerContributions: money(runEmployer),
      netPay: money(runGross - runDeductions),
      employeeCount: employees.length,
    },
  });
  await prisma.payrollPaymentRecord.upsert({
    where: { runId: run.id },
    update: {
      paymentReference: `${PREFIX}-PAY-2026-07-Q1`,
      paymentDate: date('2026-07-16'),
      paymentMethod: 'TRANSFERENCIA',
      evidenceReference: `${PREFIX}-BANK-BATCH-001`,
      actorId: actor.id,
    },
    create: {
      companyId,
      runId: run.id,
      paymentReference: `${PREFIX}-PAY-2026-07-Q1`,
      paymentDate: date('2026-07-16'),
      paymentMethod: 'TRANSFERENCIA',
      batchReference: `${PREFIX}-BATCH-001`,
      evidenceReference: `${PREFIX}-BANK-BATCH-001`,
      actorId: actor.id,
    },
  });
  for (const [revision, event, fromStatus, toStatus] of [
    [1, 'CREATE', null, 'DRAFT'],
    [2, 'CALCULATE', 'DRAFT', 'CALCULATED'],
    [3, 'SUBMIT_REVIEW', 'CALCULATED', 'REVIEW'],
    [4, 'APPROVE', 'REVIEW', 'APPROVED'],
    [5, 'MARK_PAID', 'APPROVED', 'PAID'],
  ] as const) {
    const existing = await prisma.payrollTrace.findFirst({
      where: { runId: run.id, revision, event },
    });
    if (!existing)
      await prisma.payrollTrace.create({
        data: {
          companyId,
          runId: run.id,
          event,
          actorId: actor.id,
          reason: 'Transición del escenario demo integral',
          fromStatus,
          toStatus,
          revision,
          metadata: { synthetic: true },
        },
      });
  }

  const employeeUserIds = employees.map((employee) => employee.userId);
  const [
    attendanceEvents,
    attendanceSummaries,
    vacationMovements,
    leaveRequests,
    travelLedgerEntries,
    loans,
    deductions,
    payrollReceipts,
    payrollComponents,
    employerContributions,
    statutoryCalculations,
    payrollTraces,
  ] = await Promise.all([
    prisma.attendanceEvent.count({
      where: { companyId, userId: { in: employeeUserIds }, idempotencyKey: { startsWith: PREFIX } },
    }),
    prisma.attendanceDailySummary.count({
      where: { companyId, periodId: attendancePeriod.id, userId: { in: employeeUserIds } },
    }),
    prisma.vacationLedgerEntry.count({
      where: { companyId, reference: { startsWith: PREFIX } },
    }),
    prisma.leaveRequest.count({
      where: { companyId, userId: { in: employeeUserIds } },
    }),
    prisma.hrTravelLedgerEntry.count({
      where: { companyId, travelRequestId: travel.id },
    }),
    prisma.hrLoan.count({
      where: { companyId, code: { startsWith: PREFIX } },
    }),
    prisma.hrDeduction.count({
      where: { companyId, code: { startsWith: PREFIX } },
    }),
    prisma.payrollReceipt.count({ where: { companyId, runId: run.id } }),
    prisma.payrollComponent.count({ where: { companyId, runId: run.id } }),
    prisma.payrollEmployerContribution.count({ where: { companyId, runId: run.id } }),
    prisma.payrollStatutoryCalculation.count({ where: { companyId, runId: run.id } }),
    prisma.payrollTrace.count({ where: { companyId, runId: run.id } }),
  ]);

  console.log(
    JSON.stringify(
      {
        companyId,
        branchId: branch.id,
        employees: employees.map((employee) => ({
          userId: employee.userId,
          employeeId: employee.employeeId,
          name: employee.name,
        })),
        attendancePeriodId: attendancePeriod.id,
        payrollRuleId: rule.id,
        payrollConfigurationRevisionId: configuration.id,
        payrollPeriodId: payrollPeriod.id,
        payrollRunId: run.id,
        travelRequestId: travel.id,
        deductions: loanDeductions.map((item) => item.deductionId),
        verification: {
          attendanceEvents,
          attendanceSummaries,
          vacationMovements,
          leaveRequests,
          travelLedgerEntries,
          loans,
          deductions,
          payrollReceipts,
          payrollComponents,
          employerContributions,
          statutoryCalculations,
          payrollTraces,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('HR payroll demo seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
