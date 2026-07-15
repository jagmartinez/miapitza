import type { HrNamedEntity, HrUserSummary } from './hr';

export type HrTravelStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ADVANCED'
  | 'IN_SETTLEMENT'
  | 'SETTLED'
  | 'CANCELLED'
  | 'REVERSED';

export type HrTravelAction =
  | 'SUBMIT'
  | 'APPROVE'
  | 'REJECT'
  | 'REGISTER_ADVANCE'
  | 'START_SETTLEMENT'
  | 'SETTLE'
  | 'CANCEL'
  | 'REVERSE';

export type HrLoanStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'DISBURSED'
  | 'ACTIVE'
  | 'PAID'
  | 'CLOSED'
  | 'CANCELLED'
  | 'REVERSED';

export type HrLoanAction =
  | 'APPROVE'
  | 'REJECT'
  | 'DISBURSE'
  | 'REGISTER_PAYMENT'
  | 'CLOSE'
  | 'CANCEL'
  | 'REVERSE';

export type HrLoanLedgerType =
  | 'DISBURSEMENT'
  | 'CHARGE'
  | 'PAYMENT'
  | 'PAYROLL_DEDUCTION'
  | 'REVERSAL';

export type HrDeductionStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REVERSED';
export type HrDeductionFrequency = 'ONCE' | 'RECURRING';
export type HrDeductionAction = 'ACTIVATE' | 'PAUSE' | 'RESUME' | 'CANCEL' | 'REVERSE';

export interface HrBenefitsPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface HrBenefitsList<T> {
  items: T[];
  pagination?: HrBenefitsPagination;
}

export interface HrBenefitsEnvelope<T> {
  success: boolean;
  data: T;
  pagination?: HrBenefitsPagination;
  message?: string;
}

export interface HrBenefitsActor {
  id: number;
  name?: string | null;
  username?: string | null;
}

export interface HrBenefitTraceEvent {
  id: number;
  event: string;
  occurredAt: string;
  reason?: string | null;
  actor?: HrBenefitsActor | null;
}

export interface HrTravelExpense {
  id: number;
  travelRequestId: number;
  category: string;
  description: string;
  occurredOn: string;
  currency: string;
  claimedAmount: string;
  recognizedAmount?: string | null;
  receiptReference?: string | null;
  evidence?: {
    id: number;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REVERSED';
  createdAt: string;
}

export interface HrTravelRequest {
  id: number;
  code: string;
  userId: number;
  user?: HrUserSummary | null;
  branchId?: number | null;
  branch?: HrNamedEntity | null;
  destination: string;
  purpose: string;
  departureDate: string;
  returnDate: string;
  currency: string;
  requestedAmount: string;
  approvedAmount?: string | null;
  advanceAmount?: string | null;
  recognizedExpenseAmount?: string | null;
  employeeReturnAmount?: string | null;
  employeeReimbursementAmount?: string | null;
  status: HrTravelStatus;
  revision: number;
  allowedActions: HrTravelAction[];
  expenses?: HrTravelExpense[];
  trace?: HrBenefitTraceEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface HrTravelRequestPayload {
  userId?: number;
  branchId?: number;
  destination: string;
  purpose: string;
  departureDate: string;
  returnDate: string;
  currency: string;
  requestedAmount: string;
}

export interface HrTravelExpensePayload {
  category: string;
  description: string;
  occurredOn: string;
  currency: string;
  claimedAmount: string;
  receiptReference?: string;
  evidenceId?: number;
}

export interface HrLoanInstallment {
  id: number;
  number: number;
  dueDate: string;
  scheduledPrincipal: string;
  scheduledCharge: string;
  scheduledTotal: string;
  paidAmount: string;
  outstandingAmount: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED';
}

export interface HrLoanLedgerEntry {
  id: number;
  loanId: number;
  type: HrLoanLedgerType;
  amount: string;
  currency: string;
  effectiveDate: string;
  payrollRunId?: number | null;
  reference?: string | null;
  reason: string;
  reversedEntryId?: number | null;
  createdAt: string;
  actor?: HrBenefitsActor | null;
}

export interface HrLoan {
  id: number;
  code: string;
  userId: number;
  user?: HrUserSummary | null;
  purpose: string;
  currency: string;
  requestedAmount: string;
  approvedAmount?: string | null;
  disbursedAmount?: string | null;
  outstandingBalance: string;
  installmentCount: number;
  payrollDeductionRequested: boolean;
  firstDueDate?: string | null;
  status: HrLoanStatus;
  revision: number;
  allowedActions: HrLoanAction[];
  schedule?: HrLoanInstallment[];
  ledger?: HrLoanLedgerEntry[];
  trace?: HrBenefitTraceEvent[];
  requestedAt: string;
  updatedAt: string;
}

export interface HrLoanRequestPayload {
  userId?: number;
  purpose: string;
  currency: string;
  requestedAmount: string;
  preferredInstallments: number;
  payrollDeductionRequested: boolean;
  firstPreferredDeductionDate?: string;
}

export interface HrDeduction {
  id: number;
  code: string;
  userId: number;
  user?: HrUserSummary | null;
  name: string;
  reason: string;
  currency: string;
  frequency: HrDeductionFrequency;
  requestedAmount?: string | null;
  applicableAmount: string;
  remainingAmount?: string | null;
  perPeriodLimit?: string | null;
  priority: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: HrDeductionStatus;
  revision: number;
  allowedActions: HrDeductionAction[];
  source: 'MANUAL' | 'LOAN' | 'LEGAL' | string;
  lastPayrollApplicationId?: string | null;
  trace?: HrBenefitTraceEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface HrDeductionPayload {
  userId: number;
  name: string;
  reason: string;
  currency: string;
  frequency: HrDeductionFrequency;
  requestedAmount: string;
  perPeriodLimit?: string;
  priority: number;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface HrBenefitsTransitionPayload {
  reason: string;
  confirmed: true;
  expectedRevision: number;
  effectiveDate?: string;
  reference?: string;
}

export interface HrTravelDecisionPayload extends HrBenefitsTransitionPayload {
  approvedAmount?: string;
}

export interface HrTravelAdvancePayload extends HrBenefitsTransitionPayload {
  advanceReference: string;
}

export interface HrTravelSettlementPayload extends HrBenefitsTransitionPayload {
  settlementReference?: string;
}

export interface HrLoanDecisionPayload extends HrBenefitsTransitionPayload {
  approvedAmount?: string;
  installmentCount?: number;
  firstDueDate?: string;
}

export interface HrLoanDisbursementPayload extends HrBenefitsTransitionPayload {
  disbursementReference: string;
}

export interface HrLoanPaymentPayload extends HrBenefitsTransitionPayload {
  paymentReference: string;
  receivedAmount: string;
}

export interface HrBenefitsActionInput extends HrBenefitsTransitionPayload {
  proposedAmount?: string;
  installmentCount?: number;
  firstDueDate?: string;
  operationReference?: string;
}

export interface HrBenefitsFilters {
  status?: string;
  userId?: number;
  branchId?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}
