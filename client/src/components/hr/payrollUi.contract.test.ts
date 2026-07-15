import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const management = read('../../pages/hr/PayrollManagement.tsx');
const mine = read('../../pages/hr/MyPayroll.tsx');
const transition = read('./PayrollTransitionForm.tsx');
const configuration = read('./PayrollRuleConfigurationPanel.tsx');
const componentForm = read('./PayrollComponentForm.tsx');
const conceptCatalog = read('./PayrollPaymentConceptCatalogEditor.tsx');
const conceptDefaults = read('./payrollPaymentConceptDefaults.ts');
const receipt = read('./PayrollReceiptBreakdown.tsx');
const onlineNotice = read('./PayrollOnlineNotice.tsx');
const reconciliation = read('./PayrollReconciliationPanel.tsx');
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
    expect(transition).toContain("run.kind === 'REGULAR' ? run.period?.payDate : run.cutoffDate");
    expect(transition).toContain('value={paymentDate} readOnly required');
    expect(transition).not.toContain('setPaymentDate');
  });

  it('exposes the append-only legal configuration and second-actor review flow', () => {
    expect(management).toContain('getRuleConfigurations');
    expect(management).toContain('uploadRuleConfiguration');
    expect(management).toContain('reviewRuleConfiguration');
    expect(configuration).toContain("schema: 'HR_PAYROLL_PARAMETRIC_V4'");
    expect(configuration).toContain('SIMPLIFIED_FIXED_QUOTA');
    expect(configuration).toContain("setRegimeIncomeTaxApplicability('DOES_NOT_APPLY')");
    expect(configuration).toContain('paymentConceptCatalog');
    expect(conceptDefaults).toContain('VIATICOS_ALIMENTACION');
    expect(conceptDefaults).toContain('REEMBOLSO_DEPRECIACION');
    expect(conceptDefaults).toContain('incomeTaxTreatment: null');
    expect(conceptDefaults).toContain('socialSecurityApplicable: false');
    expect(conceptCatalog).toContain('El cálculo usa estas banderas congeladas');
    expect(configuration).toContain('Tabla progresiva anual');
    expect(configuration).toContain("occasionalInssDeductionTreatment: 'DEDUCT_FROM_OCCASIONAL_NET'");
    expect(configuration).not.toContain('DEDUCT_FROM_REGULAR_NET');
    expect(configuration).toContain('se deduce exclusivamente de la renta neta ocasional');
    expect(configuration).toContain("revision.status === 'UPLOADED'");
    expect(configuration).toContain("review(revision, 'VALIDATED')");
    expect(configuration).toContain('otra identidad revise la carga');
  });

  it('exposes an exact parallel reconciliation without claiming legal or production certification', () => {
    expect(management).toContain('PayrollReconciliationPanel');
    expect(reconciliation).toContain('reconcileParallelControl');
    expect(reconciliation).toContain('No se aplica tolerancia ni fallback');
    expect(reconciliation).toContain('expectedEmployerContributions');
    expect(reconciliation).toContain('no afirma validación legal ni certificación productiva');
  });

  it('presents regular payroll and aguinaldo as independent traceable runs', () => {
    expect(management).toContain("renderRuns('Nómina ordinaria'");
    expect(management).toContain("renderRuns('Aguinaldo'");
    expect(management).toContain('createAguinaldoRun');
    expect(management).toContain('Snapshot de fuentes');
    expect(management).toContain('Traza INSS, INATEC e IR');
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

  it('requires a fresh legal classification confirmation when manual classification changes', () => {
    expect(componentForm).toContain('classificationConfirmed: true');
    expect(componentForm).toContain('if (!classificationConfirmed || !selectedConcept) return');
    expect(componentForm).toMatch(/setCode\(event\.target\.value\);\s*setClassificationConfirmed\(false\);/);
    expect(componentForm).toContain('selectedConcept.socialSecurityApplicable');
    expect(componentForm).toContain('las banderas no pueden modificarse');
    expect(componentForm).toContain('!classificationConfirmed');
  });

  it('renders the complete immutable Art. 19 calculation trace', () => {
    for (const field of ['configurationRevisionId', 'fixedCompensationAmount', 'elapsedFiscalMonths', 'bracketSnapshot', 'historyFingerprint', 'createdAt']) {
      expect(management).toContain(`item.${field}`);
    }
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
