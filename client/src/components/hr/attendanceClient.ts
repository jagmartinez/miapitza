import api from '../../services/api';
import type {
  HrAttendanceChallenge,
  HrAttendanceDevice,
  HrAttendanceDeviceCredential,
  HrAttendanceDevicePayload,
  HrAttendanceEnvelope,
  HrAttendanceEvent,
  HrAttendanceEventFilters,
  HrAttendanceEventPage,
  HrAttendanceManualPayload,
  HrAttendancePolicy,
  HrAttendancePolicyPayload,
  HrAttendancePunchPayload,
  HrAttendancePunchResult,
  HrAttendanceReviewPayload,
  HrBiometricEnrollPayload,
  HrBiometricMaintenanceResult,
  HrBiometricProviderHealth,
  HrBiometricProfile,
  HrAttendanceSettingsLookups,
  HrTodayAttendance,
} from '../../types/hr-attendance';
import type { HrNamedEntity, HrUserSummary } from '../../types/hr';

const HR_BASE = '/v1/hr';

function unwrap<T>(payload: HrAttendanceEnvelope<T> | T): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as HrAttendanceEnvelope<T>).data;
  }
  return payload as T;
}

function appendIfPresent(form: FormData, key: string, value: string | number | undefined | null) {
  if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
}

function punchForm(payload: HrAttendancePunchPayload): FormData {
  const form = new FormData();
  form.append('action', payload.action);
  form.append('challengeId', payload.challengeId);
  appendIfPresent(form, 'challengeToken', payload.challengeToken);
  if (payload.location) {
    form.append('latitude', String(payload.location.latitude));
    form.append('longitude', String(payload.location.longitude));
    form.append('accuracyM', String(payload.location.accuracyM));
    form.append('locationCapturedAt', payload.location.capturedAt);
  }
  if (payload.faceImage) form.append('faceImage', payload.faceImage, 'face-evidence.jpg');
  return form;
}

function enrollmentForm(payload: HrBiometricEnrollPayload): FormData {
  const form = new FormData();
  form.append('challengeId', payload.challengeId);
  appendIfPresent(form, 'challengeToken', payload.challengeToken);
  form.append('consentAccepted', 'true');
  form.append('consentVersion', payload.consentVersion);
  form.append('faceImage', payload.faceImage, 'face-enrollment.jpg');
  return form;
}

export function createAttendanceIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('El navegador no puede generar una clave segura para el marcaje.');
}

function eventPage(value: unknown, pagination?: unknown): HrAttendanceEventPage {
  if (Array.isArray(value))
    return { items: value as HrAttendanceEvent[], pagination: normalizePagination(pagination) };
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const items = raw.items ?? raw.events ?? [];
  return {
    items: Array.isArray(items) ? (items as HrAttendanceEvent[]) : [],
    pagination: normalizePagination(pagination ?? raw.pagination ?? raw.meta),
  };
}

function normalizePagination(value: unknown): HrAttendanceEventPage['pagination'] {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const page = Number(raw.page ?? 1);
  const pageSize = Number(raw.pageSize ?? raw.limit ?? 25);
  const total = Number(raw.total ?? 0);
  const totalPages = Number(raw.totalPages ?? Math.ceil(total / Math.max(1, pageSize)));
  if (![page, pageSize, total, totalPages].every(Number.isFinite)) return undefined;
  return { page, pageSize, total, totalPages };
}

function namedEntities(value: unknown): HrNamedEntity[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HrNamedEntity =>
    Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item)
  );
}

function settingsLookups(value: unknown): HrAttendanceSettingsLookups {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    branches: namedEntities(raw.branches),
    users: Array.isArray(raw.users) ? (raw.users as HrUserSummary[]) : [],
  };
}

export const attendanceClient = {
  async getPolicy(branchId?: number): Promise<HrAttendancePolicy> {
    const response = await api.get(`${HR_BASE}/attendance/policy`, {
      ...(branchId ? { params: { branchId } } : {}),
      skipOfflineCache: true,
    });
    return unwrap(response.data);
  },

  async updatePolicy(payload: HrAttendancePolicyPayload): Promise<HrAttendancePolicy> {
    const response = await api.put(`${HR_BASE}/attendance/policy`, payload);
    return unwrap(response.data);
  },

  async getSettingsLookups(): Promise<HrAttendanceSettingsLookups> {
    const response = await api.get(`${HR_BASE}/lookups`, { skipOfflineCache: true });
    return settingsLookups(unwrap(response.data));
  },

  async getToday(): Promise<HrTodayAttendance> {
    const response = await api.get(`${HR_BASE}/me/attendance/today`, { skipOfflineCache: true });
    return unwrap(response.data);
  },

  async createChallenge(
    purpose: HrAttendanceChallenge['purpose'],
    action?: HrAttendanceChallenge['action']
  ): Promise<HrAttendanceChallenge> {
    const response = await api.post(`${HR_BASE}/biometrics/challenges`, {
      purpose,
      ...(action ? { action } : {}),
    });
    return unwrap(response.data);
  },

  async getMyBiometrics(): Promise<HrBiometricProfile> {
    const response = await api.get(`${HR_BASE}/biometrics/me`, { skipOfflineCache: true });
    return unwrap(response.data);
  },

  async enrollBiometrics(payload: HrBiometricEnrollPayload): Promise<HrBiometricProfile> {
    const response = await api.post(`${HR_BASE}/biometrics/enroll`, enrollmentForm(payload));
    return unwrap(response.data);
  },

  async revokeMyBiometrics(): Promise<void> {
    await api.delete(`${HR_BASE}/biometrics/me`);
  },

  async createPunch(
    payload: HrAttendancePunchPayload,
    idempotencyKey: string
  ): Promise<HrAttendancePunchResult> {
    try {
      const response = await api.post(`${HR_BASE}/attendance/punches`, punchForm(payload), {
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      return unwrap(response.data);
    } catch (error) {
      // Provider outages are HTTP 503 but still produce a structured,
      // immutable REVIEW_REQUIRED attempt that the worker must see.
      const response = (error as { response?: { status?: number; data?: unknown } }).response;
      if (
        response?.status === 503 &&
        response.data &&
        typeof response.data === 'object' &&
        'data' in response.data
      ) {
        return (response.data as { data: HrAttendancePunchResult }).data;
      }
      throw error;
    }
  },

  async getEvents(filters: HrAttendanceEventFilters = {}): Promise<HrAttendanceEventPage> {
    const params = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== '')
    );
    const response = await api.get(`${HR_BASE}/attendance/events`, {
      params,
      skipOfflineCache: true,
    });
    const raw = response.data as unknown;
    if (raw && typeof raw === 'object' && 'data' in raw) {
      const envelope = raw as { data: unknown; pagination?: unknown };
      return eventPage(envelope.data, envelope.pagination);
    }
    return eventPage(raw);
  },

  async reviewEvent(id: number, payload: HrAttendanceReviewPayload): Promise<HrAttendanceEvent> {
    const response = await api.post(`${HR_BASE}/attendance/events/${id}/review`, payload);
    return unwrap(response.data);
  },

  async createManualEvent(
    payload: HrAttendanceManualPayload,
    idempotencyKey: string
  ): Promise<HrAttendanceEvent> {
    const response = await api.post(`${HR_BASE}/attendance/manual`, payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return unwrap(response.data);
  },

  async getDevices(branchId?: number): Promise<HrAttendanceDevice[]> {
    const response = await api.get(`${HR_BASE}/attendance/devices`, {
      ...(branchId ? { params: { branchId } } : {}),
      skipOfflineCache: true,
    });
    const data = unwrap<unknown>(response.data);
    return Array.isArray(data) ? (data as HrAttendanceDevice[]) : [];
  },

  async createDevice(payload: HrAttendanceDevicePayload): Promise<HrAttendanceDeviceCredential> {
    const response = await api.post(`${HR_BASE}/attendance/devices`, payload);
    return unwrap(response.data);
  },

  async revokeDevice(id: number): Promise<HrAttendanceDevice> {
    const response = await api.post(`${HR_BASE}/attendance/devices/${id}/revoke`, {});
    return unwrap(response.data);
  },

  async revokeUserBiometrics(userId: number, reason: string): Promise<HrBiometricProfile> {
    const response = await api.post(`${HR_BASE}/biometrics/users/${userId}/revoke`, { reason });
    return unwrap(response.data);
  },

  async runBiometricMaintenance(): Promise<HrBiometricMaintenanceResult> {
    const response = await api.post(`${HR_BASE}/biometrics/maintenance/run`, {});
    return unwrap(response.data);
  },

  async getBiometricProviderHealth(): Promise<HrBiometricProviderHealth> {
    try {
      const response = await api.get(`${HR_BASE}/biometrics/provider/health`, { skipOfflineCache: true });
      return unwrap(response.data);
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: unknown } }).response;
      if (response?.status === 503 && response.data && typeof response.data === 'object' && 'data' in response.data) {
        return (response.data as { data: HrBiometricProviderHealth }).data;
      }
      throw error;
    }
  },
};

export function getAttendanceErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object' || !('response' in error)) return fallback;
  const data = (error as { response?: { data?: { message?: string; error?: string } } }).response
    ?.data;
  return data?.message || data?.error || fallback;
}
