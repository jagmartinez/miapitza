export type BenefitPolicyStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type SettlementStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'REVIEWED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'VOID';
export type SettlementExitType =
  | 'RESIGNATION'
  | 'DISMISSAL'
  | 'MUTUAL_AGREEMENT'
  | 'CONTRACT_END'
  | 'OTHER';
export type SettlementLineType =
  | 'EARNED_SALARY'
  | 'VACATION'
  | 'AGUINALDO'
  | 'INDEMNITY'
  | 'OTHER_EARNING'
  | 'DEDUCTION';

export interface TravelPolicyCategory {
  code: string;
  name: string;
  dailyLimit: string;
  requiresEvidence: boolean;
  allowedAfter?: string;
  allowedBefore?: string;
}
export interface BenefitPolicy {
  id: number;
  version: number;
  revision: number;
  status: BenefitPolicyStatus;
  effectiveFrom: string;
  effectiveTo?: string | null;
  currency: string;
  travelCategories: TravelPolicyCategory[];
  travelMaxDays: number;
  travelEvidenceRequired: boolean;
  loanMinTenureMonths: number;
  loanMaxAmount: string;
  loanMaxInstallments: number;
  loanMaxPaymentPercent: string;
  sourceReference: string;
  reason: string;
  createdBy?: { id: number; name: string };
  activatedBy?: { id: number; name: string } | null;
}
export type BenefitPolicyPayload = Omit<
  BenefitPolicy,
  'id' | 'version' | 'revision' | 'status' | 'effectiveTo' | 'createdBy' | 'activatedBy'
>;
export type BenefitPolicyUpdatePayload = BenefitPolicyPayload & {
  expectedRevision: number;
  adjustmentReason: string;
};

export interface SettlementLine {
  id?: number;
  type: SettlementLineType;
  concept: string;
  formulaBasis: string;
  sourceReference: string;
  amount: string;
}
export interface EmploymentSettlement {
  id: number;
  code: string;
  status: SettlementStatus;
  revision: number;
  userId: number;
  exitType: SettlementExitType;
  cause: string;
  justification: string;
  terminationDate: string;
  currency: string;
  evidenceReferences: string[];
  grossEarnings: string;
  totalDeductions: string;
  netPay: string;
  calculationHash: string;
  lines: SettlementLine[];
  allowedActions: string[];
  employee: { id: number; legalName: string; employeeCode: string; hireDate: string };
}
export interface SettlementPreview {
  employee: { id: number; userId: number; legalName: string; hireDate: string };
  currency: string;
  suggestedLines: SettlementLine[];
  blockers: string[];
  warnings: string[];
  canSubmit: boolean;
}
export interface SettlementPreviewPayload {
  userId: number;
  terminationDate: string;
  unpaidSalaryDays: number;
  indemnityApplicable: boolean;
  indemnityConfirmed?: boolean;
  indemnityJustification?: string;
  manualOrdinaryMonthlyBase?: string;
  manualBaseReference?: string;
  aguinaldoPendingAmount?: string;
  aguinaldoBasisReference?: string;
}
export interface SettlementPayload {
  userId: number;
  exitType: SettlementExitType;
  cause: string;
  justification: string;
  terminationDate: string;
  currency: string;
  evidenceReferences: string[];
  lines: SettlementLine[];
  indemnityConfirmed?: boolean;
  indemnityJustification?: string;
}
export type SettlementUpdatePayload = SettlementPayload & {
  expectedRevision: number;
  adjustmentReason: string;
};
