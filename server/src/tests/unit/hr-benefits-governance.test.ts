import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  completedCalendarMonths,
  validateTravelExpensePolicy,
} from '../../services/hr-benefits-governance.service';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/services/hr-benefits-governance.service.ts'),
  'utf8'
);
const benefitsSource = fs.readFileSync(
  path.join(process.cwd(), 'src/services/hr-benefits.service.ts'),
  'utf8'
);
const routes = fs.readFileSync(
  path.join(process.cwd(), 'src/routes/hr-benefits.routes.ts'),
  'utf8'
);
const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260716_hr_settlements_benefit_policies/migration.sql'
  ),
  'utf8'
);

describe('HR benefits governance', () => {
  const policy = {
    travelEvidenceRequired: true,
    travelCategories: [
      {
        code: 'ALIMENTACION',
        name: 'Alimentación',
        dailyLimit: '500.00',
        requiresEvidence: true,
        allowedAfter: '18:00',
        allowedBefore: '07:00',
      },
    ],
  };

  it('supports a cross-midnight OR window and enforces evidence and limit', () => {
    expect(
      validateTravelExpensePolicy(policy, {
        category: 'ALIMENTACION',
        claimedAmount: '100.00',
        occurredTime: '19:00',
        receiptReference: 'FAC-1',
      }).occurredTime
    ).toBe('19:00');
    expect(
      validateTravelExpensePolicy(policy, {
        category: 'ALIMENTACION',
        claimedAmount: '100.00',
        occurredTime: '06:00',
        receiptReference: 'FAC-2',
      }).occurredTime
    ).toBe('06:00');
    expect(() =>
      validateTravelExpensePolicy(policy, {
        category: 'ALIMENTACION',
        claimedAmount: '100.00',
        occurredTime: '12:00',
        receiptReference: 'FAC-3',
      })
    ).toThrow(/ventana/);
    expect(() =>
      validateTravelExpensePolicy(policy, {
        category: 'ALIMENTACION',
        claimedAmount: '600.00',
        occurredTime: '19:00',
        receiptReference: 'FAC-4',
      })
    ).toThrow(/límite/);
    expect(() =>
      validateTravelExpensePolicy(policy, {
        category: 'ALIMENTACION',
        claimedAmount: '100.00',
        occurredTime: '19:00',
      })
    ).toThrow(/soporte/);
  });

  it('keeps policies versioned, bounded and dual-controlled', () => {
    expect(source).toContain('percent.greaterThan(100)');
    expect(source).toContain('HR_BENEFITS_POLICY_OVERLAP');
    expect(benefitsSource).toContain('policyVersionId');
    expect(source).toContain("status: 'ACTIVE', effectiveTo: null");
    expect(source).toContain('data: { effectiveTo }');
    expect(source).not.toContain("data: { status: 'RETIRED', effectiveTo }");
    expect(source).toContain('effectiveFrom: { lte: effectiveDate }');
    expect(source).toContain('effectiveTo: { gte: effectiveDate }');
    expect(source).toContain("resourceType: 'BENEFIT_POLICY'");
    expect(source).toContain('Quien creó o ajustó la política no puede activarla');
    expect(source).toContain("status: 'DRAFT', revision: row.revision");
  });

  it('uses calendar tenure instead of an approximate day divisor', () => {
    expect(
      completedCalendarMonths(
        new Date('2026-01-31T00:00:00.000Z'),
        new Date('2026-07-30T00:00:00.000Z')
      )
    ).toBe(5);
    expect(
      completedCalendarMonths(
        new Date('2026-01-31T00:00:00.000Z'),
        new Date('2026-07-31T00:00:00.000Z')
      )
    ).toBe(6);
    expect(
      completedCalendarMonths(
        new Date('2025-08-31T00:00:00.000Z'),
        new Date('2026-02-28T00:00:00.000Z')
      )
    ).toBe(6);
    expect(source).toContain('HR_LOAN_COMPENSATION_REQUIRED');
  });

  it('blocks ambiguous settlement calculations and unsafe lifecycle shortcuts', () => {
    expect(source).toContain('La remuneración es por hora/variable');
    expect(source).toContain('No se determinó el corte pendiente de aguinaldo');
    expect(source).toContain('Hay más de un saldo de vacaciones aplicable');
    expect(source).toContain('La indemnización requiere decisión legal expresa');
    expect(source).toMatch(/reopen:\s*{\s*from:\s*\['REJECTED'\],\s*to:\s*'DRAFT'/);
    expect(source).toContain("['APPROVED', 'PAID'].includes(row.status)");
    expect(source).toMatch(/void:\s*{\s*from:\s*\['DRAFT',\s*'SUBMITTED',\s*'REVIEWED',\s*'APPROVED'\],\s*to:\s*'VOID'/);
    expect(source).not.toContain(
      "void: { from: ['DRAFT','SUBMITTED','REVIEWED','APPROVED','PAID']"
    );
    expect(source).toContain('Quien creó o ajustó no puede revisar');
  });

  it('exposes preview, editable draft, workflow and mandatory PDF', () => {
    for (const endpoint of [
      "'/settlements/preview'",
      "'/settlements/:id/pdf'",
      "'/settlements/:id'",
      "['submit', ownerManage]",
      "['review', ownerApprove]",
      "['approve', ownerApprove]",
      "['reject', ownerApprove]",
      "['pay', ownerApprove]",
    ])
      expect(routes).toContain(endpoint);
    expect(source).toContain('ADJUST_DRAFT');
    expect(routes).toContain("'/policies/:id'");
    expect(routes).toContain('HrBenefitsController.policyUpdate');
    expect(source).toContain('autoTable(doc');
    expect(source).toContain('Huella de cálculo');
  });

  it('enforces policy and settlement monetary invariants in MySQL', () => {
    expect(migration).toContain('HrBenefitPolicy_dates_ck');
    expect(migration).toContain('`effectiveTo` >= `effectiveFrom`');
    expect(migration).toContain('HrBenefitPolicy_limits_ck');
    expect(migration).toContain('`loanMaxPaymentPercent` <= 100');
    expect(migration).toContain('HrEmploymentSettlement_amounts_ck');
    expect(migration).toContain('`netPay` = `grossEarnings` - `totalDeductions`');
    expect(migration).toContain('HrEmploymentSettlementLine_amount_ck');
    expect(migration).toContain('CHECK (`amount` > 0)');
    expect(migration).toContain('`revision` INTEGER NOT NULL DEFAULT 0');
    expect(migration).not.toContain('mealAfterTime');
    expect(migration).not.toContain('breakfastBeforeTime');
  });

  it('keeps travel and loan policy checks authoritative in every write path', () => {
    expect(benefitsSource).toContain('HR_BENEFITS_POLICY_CURRENCY_MISMATCH');
    expect(benefitsSource).toContain('policyVersionId: policy.id');
    expect(benefitsSource).toContain('Los gastos acumulados exceden el limite diario');
    expect(benefitsSource).toContain('HR_TRAVEL_APPROVAL_AMOUNT_LIMIT');
    expect(benefitsSource).toContain('HR_LOAN_APPROVAL_AMOUNT_LIMIT');
    expect(benefitsSource).toContain('validateLoanTerms');
  });

  it('does not conflate quincenal with catorcenal in monthly benefit bases', () => {
    expect(source).toContain("compensation.payFrequency === 'BIWEEKLY'");
    expect(source).toContain('compensation.amount.mul(24).div(12)');
    expect(source).toContain("compensation.payFrequency === 'FORTNIGHTLY'");
    expect(source).toContain('compensation.amount.mul(26).div(12)');
  });
});
