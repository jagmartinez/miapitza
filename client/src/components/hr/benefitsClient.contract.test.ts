import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./benefitsClient.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../../types/hr-benefits.ts', import.meta.url), 'utf8');

function interfaceBody(name: string): string {
  const match = types.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`No se encontró ${name}`);
  return match[1];
}

describe('Phase 6 benefits API contract', () => {
  it('uses versioned admin and self-service resources', () => {
    expect(source).toContain("const BENEFITS_BASE = '/v1/hr/benefits'");
    [
      '/travel-requests',
      '/travel-requests/${id}/expenses',
      '/loan-requests',
      '/loans/${id}',
      '/deductions/${id}',
      '/me/travel-requests',
      '/me/travel-requests/${id}/expenses',
      '/me/loan-requests',
      '/me/loans/${id}',
      '/me/deductions',
    ].forEach((endpoint) => expect(source).toContain(endpoint));
    ['advance', 'start-settlement', 'settle', 'disburse', 'payments', 'reverse'].forEach((action) =>
      expect(source).toContain(`'${action}'`)
    );
  });

  it('fails loudly for malformed financial resources', () => {
    expect(source).toContain('assertSuccessfulEnvelope(raw, resource)');
    expect(source).toContain('throw new BenefitsContractError(resource)');
    expect(source).toContain('requireTravel(response.data');
    expect(source).toContain('requireLoan(response.data');
    expect(source).toContain('requireDeduction(response.data');
    expect(source).toContain('requireTravelDetail(');
    expect(source).toContain('requireLoanDetail(');
    expect(source).toContain('requireDeductionDetail(');
    expect(source).toContain('result.items.forEach((item) => requireTravel(item))');
  });

  it('guards every mutation with online-only idempotency and keeps sensitive GETs fresh', () => {
    expect(source).toContain('navigator.onLine === false');
    expect(source).toContain("'Idempotency-Key': idempotencyKey");
    expect(source.match(/mutationConfig\(idempotencyKey\)/g)?.length).toBeGreaterThanOrEqual(12);
    expect(source).toContain('skipOfflineCache: true');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('indexedDB');
    expect(source).not.toContain('offlineMeta');
  });

  it('does not let self-service choose a user or calculate authoritative outputs', () => {
    expect(source.match(/delete selfPayload\.userId/g)?.length).toBe(2);
    const travel = interfaceBody('HrTravelRequestPayload');
    const loan = interfaceBody('HrLoanRequestPayload');
    const deduction = interfaceBody('HrDeductionPayload');
    [
      'outstandingBalance',
      'applicableAmount',
      'recognizedExpenseAmount',
      'employeeReturnAmount',
      'employeeReimbursementAmount',
    ].forEach((field) => {
      expect(travel).not.toContain(field);
      expect(loan).not.toContain(field);
      expect(deduction).not.toContain(field);
    });
  });
});
