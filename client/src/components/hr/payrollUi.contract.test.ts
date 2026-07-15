import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const management = read('../../pages/hr/PayrollManagement.tsx');
const mine = read('../../pages/hr/MyPayroll.tsx');
const transition = read('./PayrollTransitionForm.tsx');
const configuration = read('./PayrollRuleConfigurationPanel.tsx');
const receipt = read('./PayrollReceiptBreakdown.tsx');
const onlineNotice = read('./PayrollOnlineNotice.tsx');
const css = read('../../pages/hr/payroll.css');
const ui = [management, mine, transition, receipt, onlineNotice].join('\n');

describe('Phase 5 payroll UI safety and UX contract', () => {
  it('keeps calculation, review, approval, payment and voiding as explicit server transitions', () => {
    [
      'payrollClient.calculateRun',
      'payrollClient.recalculateRun',
      'payrollClient.submitRunReview',
      'payrollClient.approveRun',
      'payrollClient.payRun',
      'payrollClient.voidRun',
    ].forEach((method) => expect(management).toContain(method));
    expect(management).toContain('selected.allowedActions.map');
    expect(management).toContain('blockingAnomalyCount');
    expect(transition).toContain('confirmed: true');
    expect(transition).toContain('expectedRevision: run.revision');
    expect(transition).toContain('Doble control');
    expect(transition).toContain('paymentReference');
    expect(transition).toContain('evidenceReference');
  });

  it('exposes the append-only legal configuration and second-actor review flow', () => {
    expect(management).toContain('getRuleConfigurations');
    expect(management).toContain('uploadRuleConfiguration');
    expect(management).toContain('reviewRuleConfiguration');
    expect(configuration).toContain("schema: 'HR_PAYROLL_PARAMETRIC_V1'");
    expect(configuration).toContain("revision.status === 'UPLOADED'");
    expect(configuration).toContain("review(revision, 'VALIDATED')");
    expect(configuration).toContain('otra identidad revise la carga');
  });

  it('presents regular payroll and aguinaldo as independent traceable runs', () => {
    expect(management).toContain("renderRuns('Nómina ordinaria'");
    expect(management).toContain("renderRuns('Aguinaldo'");
    expect(management).toContain('createAguinaldoRun');
    expect(management).toContain('Snapshot de fuentes');
    expect(management).toContain('Recibos y exportación');
  });

  it('uses self-only endpoints for employee receipts and exposes published breakdowns', () => {
    expect(mine).toContain('payrollClient.getMyReceipts(filters)');
    expect(mine).toContain('payrollClient.getMyReceipt(receipt.id)');
    expect(mine).toContain('payrollClient.downloadMyReceipt(selected.id)');
    expect(mine).not.toContain('getRunReceipts');
    expect(mine).not.toContain('downloadRunReceipt');
    expect(receipt).toContain("component.type === 'INCOME'");
    expect(receipt).toContain("component.type === 'DEDUCTION'");
    expect(receipt).toContain('receipt.trace.map');
  });

  it('does not calculate payroll or persist sensitive mutations in the browser', () => {
    expect(ui).not.toContain('.reduce(');
    expect(ui).not.toMatch(/INSS\s*[+*/-]/i);
    expect(ui).not.toMatch(/IR\s*[+*/-]/i);
    expect(ui).not.toContain('localStorage');
    expect(ui).not.toContain('sessionStorage');
    expect(ui).not.toContain('indexedDB');
    expect(ui).not.toContain('navigator.serviceWorker');
    expect(onlineNotice).toContain('No existe cola offline');
    expect(transition).toContain('La UI no envía totales');
  });

  it('reuses one idempotency key for ambiguous manual-component retries', () => {
    expect(management).toContain('const componentOperationKey = useRef<string | null>(null)');
    expect(management).toContain('componentOperationKey.current ?? createPayrollIdempotencyKey()');
    expect(management).toContain('componentOperationKey.current = idempotencyKey');
  });

  it('also reuses the idempotency key for ambiguous payroll transition retries', () => {
    expect(management).toContain('const transitionOperationKey = useRef<string | null>(null)');
    expect(management).toContain('transitionOperationKey.current ?? createPayrollIdempotencyKey()');
    expect(management).toContain('transitionOperationKey.current = key');
  });

  it('offers manual components only after the server has frozen a CALCULATED snapshot', () => {
    expect(management).toContain("selected.status === 'CALCULATED'");
    expect(management).not.toContain("selected.status === 'DRAFT' && (\n                        <Button");
  });

  it('includes keyboard focus, responsive layouts and accessible live states', () => {
    expect(mine).toContain('aria-live="polite"');
    expect(mine).toContain('aria-current=');
    expect(mine).toContain('role="alert"');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('.hr-my-payroll-layout');
  });
});
