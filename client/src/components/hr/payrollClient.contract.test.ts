import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./payrollClient.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../../types/hr-payroll.ts', import.meta.url), 'utf8');

function interfaceBody(name: string): string {
  const match = types.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`No se encontró ${name}`);
  return match[1];
}

describe('Phase 5 payroll API contract', () => {
  it('uses versioned payroll, aguinaldo, receipt and self-service resources', () => {
    expect(source).toContain("const PAYROLL_BASE = '/v1/hr/payroll'");
    [
      '/rules',
      '/rules/${id}/activate',
      '/rules/${id}/retire',
      '/rules/${id}/configuration-revisions',
      '/rules/${id}/configuration-reviews',
      '/periods',
      '/runs',
      '/aguinaldo/runs',
      '/anomalies',
      '/snapshot',
      '/components',
      '/receipts',
      '/export?format=',
      '/me/receipts',
      '/me/receipts/${id}',
      '/me/receipts/${id}/pdf',
    ].forEach((endpoint) => expect(source).toContain(endpoint));

    ['calculate', 'recalculate', 'submit-review', 'approve', 'pay', 'void'].forEach((action) =>
      expect(source).toContain(`'${action}'`)
    );
  });

  it('fails loudly when envelopes or critical payroll resources are malformed', () => {
    expect(source).toContain('assertSuccessfulEnvelope(raw, resource)');
    expect(source).toContain('throw new PayrollContractError(resource)');
    expect(source).toContain('requireRun(response.data');
    expect(source).toContain('requireRule(response.data)');
    expect(source).toContain('requirePeriod(response.data)');
    expect(source).toContain('requireReceipt(response.data)');
    expect(source).toContain('result.items.forEach((receipt) => requireReceiptSummary(receipt))');
  });

  it('makes every sensitive write online-only and idempotent without browser queues', () => {
    expect(source).toContain('navigator.onLine === false');
    expect(source).toContain("'Idempotency-Key': idempotencyKey");
    // Six run transitions share transitionRun, so one guarded call protects all six actions.
    expect(source.match(/mutationConfig\(idempotencyKey\)/g)?.length).toBeGreaterThanOrEqual(9);
    expect(source).toContain("transitionRun(kind, id, 'approve', payload, key)");
    expect(source).toContain("transitionRun(kind, id, 'pay', payload, key)");
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('indexedDB');
    expect(source).not.toContain('offlineMeta');
  });

  it('never accepts authoritative legal calculations or run totals from the client', () => {
    const run = interfaceBody('HrPayrollRunPayload');
    const aguinaldo = interfaceBody('HrAguinaldoRunPayload');
    const transition = interfaceBody('HrPayrollTransitionPayload');
    const rule = interfaceBody('HrPayrollRulePayload');
    const authoritativeFields = [
      'grossIncome',
      'totalDeductions',
      'netPay',
      'inss',
      'incomeTax',
      'aguinaldoAmount',
      'calculatedTotal',
    ];

    authoritativeFields.forEach((field) => {
      expect(run).not.toContain(field);
      expect(aguinaldo).not.toContain(field);
      expect(transition).not.toContain(field);
      expect(rule).not.toContain(field);
    });
    expect(transition).toContain('confirmed: true');
    expect(transition).toContain('expectedRevision: number');
  });

  it('supports dual-control legal configuration without exposing calculations to the browser', () => {
    expect(source).toContain('getRuleConfigurations');
    expect(source).toContain('uploadRuleConfiguration');
    expect(source).toContain('reviewRuleConfiguration');
    expect(types).toContain("schema: 'HR_PAYROLL_PARAMETRIC_V2'");
    expect(types).toContain("decision: 'VALIDATED' | 'REJECTED'");
  });
});
