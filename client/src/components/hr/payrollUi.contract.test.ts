import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const management = read('../../pages/hr/PayrollManagement.tsx');
const legalSettings = read('../../pages/hr/PayrollLegalSettings.tsx');
const mine = read('../../pages/hr/MyPayroll.tsx');
const transition = read('./PayrollTransitionForm.tsx');
const configuration = read('./PayrollRuleConfigurationPanel.tsx');
const componentForm = read('./PayrollComponentForm.tsx');
const conceptCatalog = read('./PayrollPaymentConceptCatalogEditor.tsx');
const conceptDefaults = read('./payrollPaymentConceptDefaults.ts');
const receipt = read('./PayrollReceiptBreakdown.tsx');
const onlineNotice = read('./PayrollOnlineNotice.tsx');
const reconciliation = read('./PayrollReconciliationPanel.tsx');
const operation = read('./payroll-operation-workspace.tsx');
const operationCss = read('../../pages/hr/payroll-operations.css');
const css = read('../../pages/hr/payroll.css');
const legalCss = read('../../pages/hr/payroll-legal.css');
const ui = [management, operation, mine, transition, receipt, onlineNotice].join('\n');

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
    expect(operation).toContain('run.allowedActions');
    expect(operation).toContain('blockingAnomalyCount');
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
    expect(legalSettings).toContain('getRuleConfigurations');
    expect(legalSettings).toContain('uploadRuleConfiguration');
    expect(legalSettings).toContain('reviewRuleConfiguration');
    expect(configuration).toContain("schema: 'HR_PAYROLL_PARAMETRIC_V4'");
    expect(configuration).toContain('SIMPLIFIED_FIXED_QUOTA');
    expect(legalSettings).toContain('getCompanyTaxProfile');
    expect(legalSettings).toContain('cloneRule');
    expect(configuration).toContain('companyTaxProfile');
    expect(configuration).not.toContain('setRegimeIncomeTaxApplicability');
    expect(configuration).toContain('paymentConceptCatalog');
    expect(conceptDefaults).toContain('VIATICOS_ALIMENTACION');
    expect(conceptDefaults).toContain('REEMBOLSO_DEPRECIACION');
    expect(conceptDefaults).toContain('incomeTaxTreatment: null');
    expect(conceptDefaults).toContain('socialSecurityApplicable: false');
    expect(conceptCatalog).toContain('Inhabilitar conserva el histórico');
    expect(conceptCatalog).toContain('Nuevo concepto');
    expect(conceptCatalog).toContain('Inhabilitar');
    expect(configuration.toLocaleLowerCase()).toContain('tabla progresiva');
    expect(configuration).toContain("occasionalInssDeductionTreatment: 'DEDUCT_FROM_OCCASIONAL_NET'");
    expect(configuration).not.toContain('DEDUCT_FROM_REGULAR_NET');
    expect(configuration).toContain('El INSS laboral se descuenta de la renta gravable');
    expect(configuration).toContain("revision.status === 'UPLOADED'");
    expect(configuration).toContain("review(revision, 'VALIDATED')");
    expect(configuration).toContain('una persona distinta de quien cargó la revisión');
    expect(legalSettings).toContain('Una versión legal es la receta que usa cada nómina');
    expect(legalSettings).toContain('Activar versión legal');
    expect(configuration).toContain('Régimen de la empresa');
    expect(configuration).toContain('Tramos progresivos de IR laboral');
    expect(configuration).toContain('Qué ingresos llevan INSS, INATEC e IR');
    expect(configuration).toContain('Las tasas se ingresan como porcentajes normales');
    expect(configuration).toContain('Ver evidencia y huella técnica');
    expect(configuration).toContain('Configuración vigente en modo consulta');
    expect(configuration).toContain('Tramos anuales de IR laboral');
    expect(configuration).toContain('Qué aplica a cada ingreso y deducción');
    expect(configuration).toContain('statutory.paymentConceptCatalog.map');
    expect(legalCss).toContain('@media (max-width: 760px)');
  });

  it('loads legal revisions once per selected rule instead of coupling requests to URL object churn', () => {
    expect(legalSettings).toContain('const initialRequestedRuleId = useRef(requestedRuleId)');
    expect(legalSettings).toContain('void loadRules(initialRequestedRuleId.current)');
    expect(legalSettings).toContain('void loadRevisions(ruleId)');
    expect(legalSettings).toContain('[loadRevisions, selectedRuleId]');
    expect(legalSettings).not.toContain('[loadRevisions, selectedRule, setSearchParams]');
  });
  it('exposes an exact parallel reconciliation without claiming legal or production certification', () => {
    expect(operation).toContain('PayrollReconciliationPanel');
    expect(reconciliation).toContain('reconcileParallelControl');
    expect(reconciliation).toContain('No se aplica tolerancia ni fallback');
    expect(reconciliation).toContain('expectedEmployerContributions');
    expect(reconciliation).toContain('no afirma validación legal ni certificación productiva');
  });

  it('presents regular payroll and aguinaldo as independent traceable runs', () => {
    expect(management).toContain("setActiveKind('REGULAR')");
    expect(management).toContain("setActiveKind('AGUINALDO')");
    expect(management).toContain('createAguinaldoRun');
    expect(operation).toContain('Pago por colaborador');
    expect(operation).toContain('Traza de INSS e IR');
    expect(operation).toContain('Reportes y colillas');
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
      expect(operation).toContain(`row.statutory.${field}`);
    }
  });

  it('also reuses the idempotency key for ambiguous payroll transition retries', () => {
    expect(management).toContain('const transitionOperationKey = useRef<string | null>(null)');
    expect(management).toContain('transitionOperationKey.current ?? createPayrollIdempotencyKey()');
    expect(management).toContain('transitionOperationKey.current = key');
  });

  it('offers manual components only after the server has frozen a CALCULATED snapshot', () => {
    expect(operation).toContain("run.status === 'CALCULATED'");
    expect(management).not.toContain("selected.status === 'DRAFT' && (\n                        <Button");
  });

  it('includes keyboard focus, responsive layouts and accessible live states', () => {
    expect(mine).toContain('aria-live="polite"');
    expect(mine).toContain('aria-current=');
    expect(mine).toContain('role="alert"');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('.hr-my-payroll-layout');
    expect(operationCss).toContain('@media (max-width: 760px)');
    expect(operationCss).toContain(':focus-visible');
    expect(operationCss).toContain('background: var(--color-surface)');
    expect(operationCss).not.toContain('var(--surface, #fff)');
  });

  it('makes payroll operational with employee totals, reports, and individual or batch payslips', () => {
    for (const label of ['Ingresos', 'INSS laboral', 'IR laboral', 'Deducciones', 'Neto', 'Incidencias']) {
      expect(operation).toContain(label);
    }
    expect(operation).toContain('Registrar pago y publicar colillas');
    expect(operation).toContain('onDownloadReceipt(row.receipt!.id)');
    expect(operation).toContain('onDownloadReceiptBatch(receiptIds)');
    expect(management).toContain('downloadReceiptBatch');
    expect(management).toContain("payrollClient.exportRun(selected.kind, selected.id, format)");
  });
});
