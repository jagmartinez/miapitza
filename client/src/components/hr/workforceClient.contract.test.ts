import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./workforceClient.ts', import.meta.url), 'utf8');

describe('Phase 4 workforce API contract', () => {
  it('uses the exact attendance, overtime, leave and vacation resources', () => {
    const endpoints = [
      '/attendance/daily-summaries',
      '/attendance/incidents',
      '/attendance/corrections',
      '/attendance/corrections/${id}/decide',
      '/attendance/periods',
      '/attendance/periods/${id}/close',
      '/attendance/periods/${id}/reopen',
      '/overtime/requests',
      '/overtime/requests/${id}/decide',
      '/overtime/requests/${id}/cancel',
      '/leave/types',
      '/leave/types/${id}',
      '/leave/requests',
      '/leave/requests/${id}/submit',
      '/leave/requests/${id}/decide',
      '/leave/requests/${id}/cancel',
      '/leave/calendar',
      '/vacation/balances',
      '/vacation/ledger',
      '/vacation/adjustments',
      '/me/attendance/summary',
      '/me/workforce',
    ];

    expect(source).toContain("const HR_BASE = '/v1/hr'");
    endpoints.forEach((endpoint) => expect(source).toContain(endpoint));
  });

  it('fails loudly for malformed critical resources while accepting raw and enveloped lists', () => {
    expect(source).toContain("'data' in raw");
    expect(source).toContain('aliases.map((alias) => record[alias]).find(Array.isArray)');
    expect(source).toContain('throw new WorkforceContractError(resource)');
    expect(source).toContain('requireMyWorkforce(response.data)');
    expect(source).toContain('collections.some((key) => !Array.isArray(value[key]))');
  });

  it('marks mutations online-only and protects correction, period, overtime and ledger writes with idempotency', () => {
    expect(source).toContain('navigator.onLine === false');
    expect(source).toContain("'Idempotency-Key': idempotencyKey");
    [
      'createCorrection',
      'decideCorrection',
      'closePeriod',
      'createOvertimeRequest',
      'createVacationAdjustment',
    ].forEach((method) => expect(source).toContain(`async ${method}(`));
    expect(source.match(/mutationConfig\(idempotencyKey\)/g)?.length).toBeGreaterThanOrEqual(9);
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('indexedDB');
  });
});
