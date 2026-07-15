import type { HrNamedEntity, HrUserSummary } from './hr';
import type { HrAttendanceAction } from './hr-attendance';

export type HrWorkflowStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type HrDecision = 'APPROVED' | 'REJECTED';
export type HrAttendancePeriodStatus = 'OPEN' | 'CLOSED' | 'REOPENED';
export type HrCorrectionType =
  | 'ADD_PUNCH'
  | 'VOID_PUNCH'
  | 'CHANGE_TIME'
  | 'ASSIGN_BRANCH'
  | 'OTHER';
export type HrIncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type HrLeaveFraction = 'FULL_DAY' | 'HALF_DAY' | 'HOURS';
export type HrBalanceUnit = 'DAYS' | 'HOURS' | 'MINUTES';

export interface HrWorkforcePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface HrWorkforceList<T> {
  items: T[];
  pagination?: HrWorkforcePagination;
}

export interface HrDailyAttendanceSummary {
  id: number;
  date: string;
  timezone: string;
  userId: number;
  user?: HrUserSummary | null;
  branchId?: number | null;
  branch?: HrNamedEntity | null;
  periodId?: number | null;
  periodStatus?: HrAttendancePeriodStatus | null;
  scheduledMinutes?: number | null;
  ordinaryMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  candidateOvertimeMinutes: number;
  approvedOvertimeMinutes?: number | null;
  incidentCount?: number;
  calculatedAt?: string | null;
  sourceRevision?: number | null;
}

export interface HrAttendanceIncident {
  id: number;
  dailySummaryId?: number | null;
  userId: number;
  user?: HrUserSummary | null;
  branchId?: number | null;
  branch?: HrNamedEntity | null;
  date: string;
  type: string;
  severity: HrIncidentSeverity;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  reasonCode?: string | null;
  message: string;
  attendanceEventId?: number | null;
  resolvedAt?: string | null;
}

export interface HrAttendanceCorrection {
  id: number;
  userId: number;
  user?: HrUserSummary | null;
  dailySummaryId?: number | null;
  incidentId?: number | null;
  targetEventId?: number | null;
  type: HrCorrectionType;
  requestedAction?: HrAttendanceAction;
  requestedOccurredAt?: string | null;
  requestedBranchId?: number | null;
  requestedBranch?: HrNamedEntity | null;
  reason: string;
  status: HrWorkflowStatus | 'APPLIED';
  requestedById?: number | null;
  decidedById?: number | null;
  decisionReason?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  appliedAt?: string | null;
  auditReference?: string | null;
}

export interface HrAttendanceCorrectionPayload {
  userId?: number;
  dailySummaryId?: number;
  incidentId?: number;
  targetEventId?: number;
  type: HrCorrectionType;
  requestedAction?: HrAttendanceAction;
  requestedOccurredAt?: string;
  requestedTimezone?: string;
  requestedBranchId?: number;
  reason: string;
}

export interface HrDecisionPayload {
  decision: HrDecision;
  reason: string;
}

export interface HrAttendancePeriod {
  id: number;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  status: HrAttendancePeriodStatus;
  summaryCount?: number;
  unresolvedIncidentCount?: number;
  pendingCorrectionCount?: number;
  pendingOvertimeCount?: number;
  pendingLeaveCount?: number;
  createdAt?: string;
  closedAt?: string | null;
  reopenedAt?: string | null;
  lastActionReason?: string | null;
  payrollReference?: string | null;
}

export interface HrAttendancePeriodPayload {
  dateFrom: string;
  dateTo: string;
  timezone?: string;
  reason?: string;
}

export interface HrReasonPayload {
  reason: string;
}

export interface HrOvertimeRequest {
  id: number;
  userId: number;
  user?: HrUserSummary | null;
  dailySummaryId?: number | null;
  date: string;
  candidateMinutes?: number | null;
  requestedMinutes: number;
  approvedMinutes?: number | null;
  reason: string;
  status: HrWorkflowStatus;
  requestedById?: number | null;
  decisionReason?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  cancelledAt?: string | null;
}

export interface HrOvertimeRequestPayload {
  userId?: number;
  dailySummaryId?: number;
  date: string;
  requestedMinutes: number;
  reason: string;
}

export interface HrOvertimeDecisionPayload extends HrDecisionPayload {
  approvedMinutes?: number;
}

export interface HrLeaveType {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  paid: boolean;
  active: boolean;
  balanceTracked: boolean;
  unit: HrBalanceUnit;
  requiresAttachment?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface HrLeaveTypePayload {
  code: string;
  name: string;
  description?: string;
  paid: boolean;
  active: boolean;
  balanceTracked: boolean;
  unit: HrBalanceUnit;
  requiresAttachment?: boolean;
}

export interface HrLeaveRequest {
  id: number;
  userId: number;
  user?: HrUserSummary | null;
  leaveTypeId: number;
  leaveType?: HrLeaveType | null;
  startDate: string;
  endDate: string;
  fraction: HrLeaveFraction;
  startTime?: string | null;
  endTime?: string | null;
  requestedAmount?: number | null;
  balanceUnit?: HrBalanceUnit | null;
  reason: string;
  status: HrWorkflowStatus;
  decisionReason?: string | null;
  createdAt: string;
  submittedAt?: string | null;
  decidedAt?: string | null;
  cancelledAt?: string | null;
}

export interface HrLeaveRequestPayload {
  userId?: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  fraction: HrLeaveFraction;
  startTime?: string;
  endTime?: string;
  requestedAmount?: number;
  reason: string;
}

export interface HrLeaveCalendarEntry {
  id: string;
  leaveRequestId: number;
  userId: number;
  user?: HrUserSummary | null;
  leaveTypeId: number;
  leaveType?: HrLeaveType | null;
  date: string;
  fraction: HrLeaveFraction;
  status: HrWorkflowStatus;
  branchId?: number | null;
  branch?: HrNamedEntity | null;
}

export interface HrVacationBalance {
  id: number;
  userId: number;
  user?: HrUserSummary | null;
  leaveTypeId?: number | null;
  leaveType?: HrLeaveType | null;
  periodLabel?: string | null;
  unit: HrBalanceUnit;
  accrued: number;
  used: number;
  pending: number;
  available: number;
  asOf: string;
  sourceRevision?: number | null;
}

export interface HrVacationLedgerEntry {
  id: number;
  balanceId: number;
  userId: number;
  effectiveDate: string;
  amount: number;
  unit: HrBalanceUnit;
  type: 'ACCRUAL' | 'USAGE' | 'ADJUSTMENT' | 'REVERSAL' | string;
  reason: string;
  reference?: string | null;
  actorId?: number | null;
  createdAt: string;
  resultingBalance?: number | null;
}

export interface HrVacationAdjustmentPayload {
  userId: number;
  balanceId?: number;
  effectiveDate: string;
  amount: number;
  unit: HrBalanceUnit;
  reason: string;
  reference?: string;
}

export interface HrWorkforceFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  branchId?: number;
  userId?: number;
  status?: string;
  page?: number;
  limit?: number;
}

export interface HrMyWorkforce {
  serverTime?: string;
  timezone?: string;
  attendanceSummaries?: HrDailyAttendanceSummary[];
  incidents: HrAttendanceIncident[];
  corrections: HrAttendanceCorrection[];
  overtimeRequests: HrOvertimeRequest[];
  leaveRequests: HrLeaveRequest[];
  vacationBalances: HrVacationBalance[];
  vacationLedger: HrVacationLedgerEntry[];
}

export interface HrWorkforceEnvelope<T> {
  success: boolean;
  data: T;
  pagination?: HrWorkforcePagination;
  message?: string;
}
