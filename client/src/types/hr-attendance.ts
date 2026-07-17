import type { HrNamedEntity, HrUserSummary } from './hr';

export type HrAttendanceAction = 'CHECK_IN' | 'BREAK_START' | 'BREAK_END' | 'CHECK_OUT';
export type HrAttendanceDecision = 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED';
export type HrAttendanceReviewDecision = 'APPROVED' | 'REJECTED';
export type HrBiometricStatus = 'NOT_ENROLLED' | 'PENDING' | 'ACTIVE' | 'REVOKED';
export type HrAttendanceViolationMode = 'BLOCK' | 'REVIEW' | 'WARN';
export type HrAttendanceDeviceStatus = 'ACTIVE' | 'REVOKED';

export interface HrAttendancePolicy {
  id?: number;
  version: number;
  branchId?: number | null;
  timezone: string;
  requireBiometric: boolean;
  requireLiveness: boolean;
  requireGeolocation: boolean;
  maxLocationAccuracyM: number;
  earlyCheckInMinutes: number;
  lateCheckInToleranceM: number;
  earlyCheckOutToleranceM: number;
  lateCheckOutMinutes: number;
  scheduleViolationMode: HrAttendanceViolationMode;
  geofenceViolationMode: HrAttendanceViolationMode;
  biometricViolationMode: HrAttendanceViolationMode;
  allowUnscheduledPunch: boolean;
  unscheduledViolationMode: HrAttendanceViolationMode;
  allowManualFallback: boolean;
  biometricConsentVersion: string;
  biometricRetentionDays: number;
  biometricRetentionNotice?: string | null;
}

export type HrAttendancePolicyPayload = Omit<HrAttendancePolicy, 'id' | 'version'>;

export interface HrAttendanceDevice {
  id: number;
  branchId: number;
  name: string;
  code: string;
  status: HrAttendanceDeviceStatus;
  branch?: HrNamedEntity | null;
  createdAt?: string;
  revokedAt?: string | null;
  lastSeenAt?: string | null;
}

/** The key only exists in the create response and must never be persisted by the client. */
export interface HrAttendanceDeviceCredential extends HrAttendanceDevice {
  key: string;
}

export interface HrAttendanceDevicePayload {
  branchId: number;
  name: string;
  code: string;
}

export interface HrBiometricMaintenanceResult {
  expiredProfilesRevoked: number;
  providerTemplatesPurged: number;
  pendingChecked: number;
}

export interface HrBiometricProviderHealth {
  provider: string;
  model: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  checkedAt: string;
  detail?: string;
}

export interface HrAttendanceSettingsLookups {
  branches: HrNamedEntity[];
  users: HrUserSummary[];
}

export interface HrAttendanceChallenge {
  id: string;
  purpose: 'ATTENDANCE_PUNCH' | 'BIOMETRIC_ENROLLMENT';
  action?: HrAttendanceAction;
  token?: string;
  instruction?: string;
  livenessInstruction?: string;
  livenessAction?: 'TURN_LEFT' | 'TURN_RIGHT';
  captureFrameCount?: number;
  captureIntervalMs?: number;
  expiresAt: string;
}

export interface HrFaceCaptureEvidence {
  frames: Blob[];
}

export interface HrCapturedLocation {
  latitude: number;
  longitude: number;
  accuracyM: number;
  capturedAt: string;
}

export interface HrBiometricProfile {
  status: HrBiometricStatus;
  consentVersion?: string | null;
  consentedAt?: string | null;
  enrolledAt?: string | null;
  retentionExpiresAt?: string | null;
  purgeRequestedAt?: string | null;
  revokedAt?: string | null;
  canEnroll?: boolean;
}

export interface HrAttendanceCheck {
  status: 'PASSED' | 'FAILED' | 'REVIEW' | 'NOT_REQUIRED';
  reasonCode?: string | null;
  message: string;
  measuredValue?: number | null;
  limitValue?: number | null;
}

export interface HrAttendancePunch {
  id: number;
  action: HrAttendanceAction;
  occurredAt: string;
  branchId?: number | null;
  branch?: HrNamedEntity | null;
  source?: 'SELF' | 'KIOSK' | 'MANUAL';
  decision?: HrAttendanceDecision;
}

export interface HrTodayAttendance {
  serverTime: string;
  timezone: string;
  availableActions: HrAttendanceAction[];
  punches: HrAttendancePunch[];
  scheduledShift?: {
    id: number;
    branchId: number;
    branch?: HrNamedEntity | null;
    startAt: string;
    endAt: string;
  } | null;
}

export interface HrAttendancePunchResult {
  decision: HrAttendanceDecision;
  reasonCode?: string | null;
  message: string;
  event?: HrAttendanceEvent | null;
  punch?: HrAttendancePunch | null;
  checks: {
    schedule?: HrAttendanceCheck;
    geofence?: HrAttendanceCheck;
    locationAccuracy?: HrAttendanceCheck;
    locationFreshness?: HrAttendanceCheck;
    biometric?: HrAttendanceCheck;
    sequence?: HrAttendanceCheck;
    device?: HrAttendanceCheck;
    branchAuthorization?: HrAttendanceCheck;
    branchStatus?: HrAttendanceCheck;
  };
}

export interface HrAttendancePunchPayload {
  action: HrAttendanceAction;
  challengeId: string;
  challengeToken?: string;
  location?: HrCapturedLocation | null;
  faceEvidence?: HrFaceCaptureEvidence | null;
}

export interface HrBiometricEnrollPayload {
  challengeId: string;
  challengeToken?: string;
  consentAccepted: true;
  consentVersion: string;
  faceEvidence: HrFaceCaptureEvidence;
}

export interface HrAttendanceEvent {
  id: number;
  userId: number;
  user?: HrUserSummary | null;
  branchId?: number | null;
  branch?: HrNamedEntity | null;
  action: HrAttendanceAction;
  occurredAt: string;
  source: 'SELF' | 'KIOSK' | 'MANUAL';
  decision: HrAttendanceDecision;
  reasonCode?: string | null;
  message?: string | null;
  scheduleId?: number | null;
  distanceM?: number | null;
  locationAccuracyM?: number | null;
  reviewedAt?: string | null;
  reviewedById?: number | null;
  reviewDecision?: HrAttendanceReviewDecision | null;
  reviewReason?: string | null;
  checks?: HrAttendancePunchResult['checks'];
}

export interface HrAttendanceEventFilters {
  dateFrom?: string;
  dateTo?: string;
  branchId?: number;
  userId?: number;
  action?: HrAttendanceAction;
  decision?: HrAttendanceDecision;
  page?: number;
  limit?: number;
}

export interface HrAttendanceEventPage {
  items: HrAttendanceEvent[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface HrAttendanceReviewPayload {
  decision: HrAttendanceReviewDecision;
  reason: string;
}

export interface HrAttendanceManualPayload {
  userId: number;
  branchId: number;
  action: HrAttendanceAction;
  occurredAt: string;
  reason: string;
  scheduleId?: number | null;
  targetEventId?: number | null;
}

export interface HrAttendanceEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}
