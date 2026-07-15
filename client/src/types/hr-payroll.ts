import type { HrNamedEntity, HrUserSummary } from './hr';

export type HrPayrollRuleStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type HrPayrollRunStatus = 'DRAFT' | 'CALCULATED' | 'REVIEW' | 'APPROVED' | 'PAID' | 'VOID';
export type HrPayrollRunKind = 'REGULAR' | 'AGUINALDO';
export type HrPayrollComponentType = 'INCOME' | 'DEDUCTION';
export type HrPayrollAnomalySeverity = 'INFO' | 'WARNING' | 'BLOCKING';
export type HrPayrollAction =
  | 'CALCULATE'
  | 'RECALCULATE'
  | 'SUBMIT_REVIEW'
  | 'APPROVE'
  | 'MARK_PAID'
  | 'VOID';

export interface HrPayrollPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface HrPayrollList<T> {
  items: T[];
  pagination?: HrPayrollPagination;
}

export interface HrPayrollActor {
  id: number;
  name?: string | null;
  username?: string | null;
}

export interface HrPayrollRuleVersion {
  id: number;
  name: string;
  version: number;
  status: HrPayrollRuleStatus;
  effectiveFrom: string;
  effectiveTo?: string | null;
  sourceReference: string;
  description?: string | null;
  configurationSummary?: string | null;
  activeConfigurationRevisionId?: number | null;
  revision: number;
  createdAt: string;
  activatedAt?: string | null;
  retiredAt?: string | null;
  createdBy?: HrPayrollActor | null;
}

export interface HrPayrollLegalConfiguration {
  schema: 'HR_PAYROLL_PARAMETRIC_V1';
  legallyValidated: true;
  currency: string;
  regular: {
    minuteDivisors: { WEEKLY: string; BIWEEKLY: string; MONTHLY: string };
    overtimeMultiplier: string;
    paidLeaveUnitMinutes: { DAYS: string; HOURS: string; MINUTES: string };
  };
  aguinaldo: {
    method: 'HISTORICAL_PAID_COMPONENTS';
    lookbackDays: number;
    incomeDivisor: string;
    prorationMode: 'NONE' | 'SERVICE_DAYS_RATIO';
    eligibleSources: string[];
    roundingScale: 2;
  };
}

export interface HrPayrollRuleConfigurationRevision {
  id: number;
  ruleVersionId: number;
  revision: number;
  configurationHash: string;
  sourceReference: string;
  evidenceReference: string;
  uploadReason: string;
  uploadedAt: string;
  uploadedBy?: HrPayrollActor | null;
  status: 'UPLOADED' | 'VALIDATED' | 'REJECTED';
  reviewedAt?: string | null;
  reviewer?: HrPayrollActor | null;
  reviewReason?: string | null;
}

export interface HrPayrollConfigurationUploadPayload {
  configuration: HrPayrollLegalConfiguration;
  sourceReference: string;
  evidenceReference: string;
  reason: string;
  expectedRevision: number;
}

export interface HrPayrollConfigurationReviewPayload {
  configurationRevisionId: number;
  decision: 'VALIDATED' | 'REJECTED';
  reason: string;
  expectedRevision: number;
}

export interface HrPayrollRulePayload {
  name: string;
  effectiveFrom: string;
  effectiveTo?: string;
  sourceReference: string;
  description?: string;
}

export interface HrPayrollPeriod {
  id: number;
  code: string;
  dateFrom: string;
  dateTo: string;
  payDate: string;
  timezone: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'VOID';
  revision: number;
  createdAt: string;
}

export interface HrPayrollPeriodPayload {
  code: string;
  dateFrom: string;
  dateTo: string;
  payDate: string;
  timezone?: string;
  reason: string;
}

export interface HrPayrollAnomaly {
  id: number;
  runId: number;
  employeeId?: number | null;
  userId?: number | null;
  user?: HrUserSummary | null;
  code: string;
  severity: HrPayrollAnomalySeverity;
  message: string;
  blocking: boolean;
  resolvedAt?: string | null;
  resolutionReason?: string | null;
}

export interface HrPayrollSnapshotLine {
  id: number;
  runId: number;
  userId: number;
  user?: HrUserSummary | null;
  branchId?: number | null;
  branch?: HrNamedEntity | null;
  attendancePeriodId?: number | null;
  ordinaryMinutes: number;
  approvedOvertimeMinutes: number;
  paidLeaveAmount?: string | null;
  unpaidLeaveAmount?: string | null;
  sourceRevision?: number | null;
  capturedAt: string;
}

export interface HrPayrollComponent {
  id: number;
  runId: number;
  receiptId?: number | null;
  userId: number;
  user?: HrUserSummary | null;
  code: string;
  name: string;
  type: HrPayrollComponentType;
  source: 'RULE' | 'ATTENDANCE' | 'OVERTIME' | 'LEAVE' | 'MANUAL' | 'LOAN' | string;
  amount: string;
  taxable?: boolean | null;
  traceReference?: string | null;
  createdAt?: string;
}

export interface HrPayrollComponentPayload {
  userId: number;
  code: string;
  type: HrPayrollComponentType;
  inputAmount: string;
  reason: string;
  reference?: string;
}

export interface HrPayrollRunTotals {
  currency: string;
  grossIncome: string;
  totalDeductions: string;
  employerContributions?: string | null;
  netPay: string;
  employeeCount: number;
}

export interface HrPayrollRun {
  id: number;
  kind: HrPayrollRunKind;
  code: string;
  status: HrPayrollRunStatus;
  periodId?: number | null;
  period?: HrPayrollPeriod | null;
  ruleVersionId: number;
  ruleVersion?: HrPayrollRuleVersion | null;
  year?: number | null;
  cutoffDate?: string | null;
  revision: number;
  allowedActions: HrPayrollAction[];
  totals?: HrPayrollRunTotals | null;
  anomalyCount: number;
  blockingAnomalyCount: number;
  createdAt: string;
  calculatedAt?: string | null;
  reviewSubmittedAt?: string | null;
  approvedAt?: string | null;
  paidAt?: string | null;
  voidedAt?: string | null;
  calculatedBy?: HrPayrollActor | null;
  reviewSubmittedBy?: HrPayrollActor | null;
  approvedBy?: HrPayrollActor | null;
  paidBy?: HrPayrollActor | null;
  voidedBy?: HrPayrollActor | null;
  lastReason?: string | null;
}

export interface HrPayrollRunDetail extends HrPayrollRun {
  anomalies: HrPayrollAnomaly[];
  snapshot: HrPayrollSnapshotLine[];
  components: HrPayrollComponent[];
  receipts: HrPayrollReceiptSummary[];
}

export interface HrPayrollReconciliationPayload {
  expectedGrossIncome: string;
  expectedTotalDeductions: string;
  expectedNetPay: string;
  expectedEmployeeCount: number;
  controlSource: string;
  evidenceReference: string;
}

export interface HrPayrollReconciliationCheck {
  code: string;
  label: string;
  passed: boolean;
  expected: string | number;
  actual: string | number;
  detail?: string | null;
}

export interface HrPayrollReconciliationReport {
  run: { id: number; code: string; kind: HrPayrollRunKind; status: HrPayrollRunStatus; revision: number; calculationRevision?: number | null; currency: string };
  control: { source: string; evidenceReference: string };
  expected: { grossIncome: string; totalDeductions: string; netPay: string; employeeCount: number };
  actual: { grossIncome: string; totalDeductions: string; netPay: string; employeeCount: number };
  checks: HrPayrollReconciliationCheck[];
  perEmployee: Array<{ userId: number; grossIncome: string; totalDeductions: string; netPay: string }>;
  readyForParallelSignoff: boolean;
  legalValidationAsserted: false;
  productionCertificationAsserted: false;
  reconciliationHash: string;
  generatedAt: string;
}

export interface HrPayrollRunPayload {
  periodId: number;
  ruleVersionId: number;
  branchIds?: number[];
  reason: string;
}

export interface HrAguinaldoRunPayload {
  year: number;
  cutoffDate: string;
  ruleVersionId: number;
  employeeIds?: number[];
  reason: string;
}

export interface HrPayrollTransitionPayload {
  reason: string;
  confirmed: true;
  expectedRevision: number;
  paymentReference?: string;
  paymentDate?: string;
  paymentMethod?: string;
  batchReference?: string;
  evidenceReference?: string;
  reversalReference?: string;
  reversalDate?: string;
  reversalMethod?: string;
}

export interface HrPayrollReceiptSummary {
  id: number;
  runId: number;
  runKind: HrPayrollRunKind;
  runCode: string;
  periodLabel: string;
  payDate: string;
  currency: string;
  grossIncome: string;
  totalDeductions: string;
  netPay: string;
  status: 'PUBLISHED' | 'VOID';
  publishedAt?: string | null;
}

export interface HrPayrollReceiptDetail extends HrPayrollReceiptSummary {
  userId: number;
  user?: HrUserSummary | null;
  employeeCode?: string | null;
  legalName?: string | null;
  components: HrPayrollComponent[];
  trace: Array<{
    id: number;
    event: string;
    occurredAt: string;
    actor?: HrPayrollActor | null;
    reason?: string | null;
  }>;
}

export interface HrPayrollFilters {
  kind?: HrPayrollRunKind;
  status?: HrPayrollRunStatus | HrPayrollRuleStatus | string;
  periodId?: number;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface HrPayrollEnvelope<T> {
  success: boolean;
  data: T;
  pagination?: HrPayrollPagination;
  message?: string;
}
