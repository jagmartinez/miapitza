import api from '../../services/api';
import type {
  HrAttendanceCorrection,
  HrAttendanceCorrectionPayload,
  HrAttendanceIncident,
  HrAttendancePeriod,
  HrAttendancePeriodPayload,
  HrDailyAttendanceSummary,
  HrDecisionPayload,
  HrLeaveCalendarEntry,
  HrLeaveRequest,
  HrLeaveRequestPayload,
  HrLeaveType,
  HrLeaveTypePayload,
  HrMyWorkforce,
  HrOvertimeDecisionPayload,
  HrOvertimeRequest,
  HrOvertimeRequestPayload,
  HrReasonPayload,
  HrVacationAdjustmentPayload,
  HrVacationBalance,
  HrVacationLedgerEntry,
  HrWorkforceEnvelope,
  HrWorkforceFilters,
  HrWorkforceList,
  HrWorkforcePagination,
} from '../../types/hr-workforce';

const HR_BASE = '/v1/hr';

export class WorkforceContractError extends Error {
  constructor(resource: string) {
    super(`El servidor devolvió una estructura inválida para ${resource}.`);
    this.name = 'WorkforceContractError';
  }
}

export class WorkforceOnlineRequiredError extends Error {
  constructor() {
    super('Esta operación requiere conexión. No se guardó ni se encoló ningún cambio.');
    this.name = 'WorkforceOnlineRequiredError';
  }
}

function dataOf<T>(raw: HrWorkforceEnvelope<T> | T): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
    return (raw as HrWorkforceEnvelope<T>).data;
  }
  return raw as T;
}

function paginationOf(raw: unknown, nested?: unknown): HrWorkforcePagination | undefined {
  const value =
    nested ??
    (raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).pagination
      : undefined);
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const page = Number(source.page ?? 1);
  const pageSize = Number(source.pageSize ?? source.limit ?? 25);
  const total = Number(source.total ?? 0);
  const totalPages = Number(source.totalPages ?? Math.ceil(total / Math.max(1, pageSize)));
  if (![page, pageSize, total, totalPages].every(Number.isFinite)) return undefined;
  return { page, pageSize, total, totalPages };
}

function requireList<T>(
  raw: unknown,
  resource: string,
  aliases: string[] = []
): HrWorkforceList<T> {
  const envelopePagination =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).pagination
      : undefined;
  const value = dataOf(raw as T);
  if (Array.isArray(value))
    return { items: value as T[], pagination: paginationOf(raw, envelopePagination) };
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const items = record.items ?? aliases.map((alias) => record[alias]).find(Array.isArray);
    if (Array.isArray(items)) {
      return {
        items: items as T[],
        pagination: paginationOf(record, envelopePagination ?? record.pagination ?? record.meta),
      };
    }
  }
  throw new WorkforceContractError(resource);
}

function requireObject<T>(raw: unknown, resource: string): T {
  const value = dataOf(raw as T);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkforceContractError(resource);
  return value as T;
}

function requireMyWorkforce(raw: unknown): HrMyWorkforce {
  const value = requireObject<HrMyWorkforce>(raw, 'mi portal laboral');
  const collections: Array<
    keyof Pick<
      HrMyWorkforce,
      | 'incidents'
      | 'corrections'
      | 'overtimeRequests'
      | 'leaveRequests'
      | 'vacationBalances'
      | 'vacationLedger'
    >
  > = [
    'incidents',
    'corrections',
    'overtimeRequests',
    'leaveRequests',
    'vacationBalances',
    'vacationLedger',
  ];
  if (collections.some((key) => !Array.isArray(value[key]))) {
    throw new WorkforceContractError('mi portal laboral');
  }
  return value;
}

function paramsOf(filters: HrWorkforceFilters): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== '')
  ) as Record<string, string | number>;
}

function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    throw new WorkforceOnlineRequiredError();
}

function mutationConfig(idempotencyKey?: string) {
  assertOnline();
  return idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined;
}

export function createWorkforceIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('El navegador no puede generar una clave segura para esta operación.');
}

export const workforceClient = {
  async getDailySummaries(
    filters: HrWorkforceFilters = {}
  ): Promise<HrWorkforceList<HrDailyAttendanceSummary>> {
    const response = await api.get(`${HR_BASE}/attendance/daily-summaries`, {
      params: paramsOf(filters),
      skipOfflineCache: true,
    });
    return requireList(response.data, 'resúmenes diarios', ['summaries', 'dailySummaries']);
  },

  async getIncidents(
    filters: HrWorkforceFilters = {}
  ): Promise<HrWorkforceList<HrAttendanceIncident>> {
    const response = await api.get(`${HR_BASE}/attendance/incidents`, {
      params: paramsOf(filters),
      skipOfflineCache: true,
    });
    return requireList(response.data, 'incidencias de asistencia', ['incidents']);
  },

  async getCorrections(
    filters: HrWorkforceFilters = {}
  ): Promise<HrWorkforceList<HrAttendanceCorrection>> {
    const response = await api.get(`${HR_BASE}/attendance/corrections`, {
      params: paramsOf(filters),
      skipOfflineCache: true,
    });
    return requireList(response.data, 'correcciones de asistencia', ['corrections']);
  },

  async createCorrection(
    payload: HrAttendanceCorrectionPayload,
    idempotencyKey: string
  ): Promise<HrAttendanceCorrection> {
    const response = await api.post(
      `${HR_BASE}/attendance/corrections`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'corrección creada');
  },

  async decideCorrection(
    id: number,
    payload: HrDecisionPayload,
    idempotencyKey: string
  ): Promise<HrAttendanceCorrection> {
    const response = await api.post(
      `${HR_BASE}/attendance/corrections/${id}/decide`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'decisión de corrección');
  },

  async getPeriods(filters: HrWorkforceFilters = {}): Promise<HrWorkforceList<HrAttendancePeriod>> {
    const response = await api.get(`${HR_BASE}/attendance/periods`, { params: paramsOf(filters), skipOfflineCache: true });
    return requireList(response.data, 'periodos de asistencia', ['periods']);
  },

  async createPeriod(
    payload: HrAttendancePeriodPayload,
    idempotencyKey: string
  ): Promise<HrAttendancePeriod> {
    const response = await api.post(
      `${HR_BASE}/attendance/periods`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'periodo creado');
  },

  async closePeriod(
    id: number,
    payload: HrReasonPayload,
    idempotencyKey: string
  ): Promise<HrAttendancePeriod> {
    const response = await api.post(
      `${HR_BASE}/attendance/periods/${id}/close`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'cierre de periodo');
  },

  async reopenPeriod(
    id: number,
    payload: HrReasonPayload,
    idempotencyKey: string
  ): Promise<HrAttendancePeriod> {
    const response = await api.post(
      `${HR_BASE}/attendance/periods/${id}/reopen`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'reapertura de periodo');
  },

  async getOvertimeRequests(
    filters: HrWorkforceFilters = {}
  ): Promise<HrWorkforceList<HrOvertimeRequest>> {
    const response = await api.get(`${HR_BASE}/overtime/requests`, { params: paramsOf(filters), skipOfflineCache: true });
    return requireList(response.data, 'solicitudes de horas extra', [
      'requests',
      'overtimeRequests',
    ]);
  },

  async createOvertimeRequest(
    payload: HrOvertimeRequestPayload,
    idempotencyKey: string
  ): Promise<HrOvertimeRequest> {
    const response = await api.post(
      `${HR_BASE}/overtime/requests`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'solicitud de horas extra');
  },

  async decideOvertimeRequest(
    id: number,
    payload: HrOvertimeDecisionPayload,
    idempotencyKey: string
  ): Promise<HrOvertimeRequest> {
    const response = await api.post(
      `${HR_BASE}/overtime/requests/${id}/decide`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'decisión de horas extra');
  },

  async cancelOvertimeRequest(
    id: number,
    payload: HrReasonPayload,
    idempotencyKey: string
  ): Promise<HrOvertimeRequest> {
    const response = await api.post(
      `${HR_BASE}/overtime/requests/${id}/cancel`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'cancelación de horas extra');
  },

  async getLeaveTypes(): Promise<HrLeaveType[]> {
    const response = await api.get(`${HR_BASE}/leave/types`, { skipOfflineCache: true });
    return requireList<HrLeaveType>(response.data, 'tipos de ausencia', ['types', 'leaveTypes'])
      .items;
  },

  async createLeaveType(payload: HrLeaveTypePayload): Promise<HrLeaveType> {
    const response = await api.post(`${HR_BASE}/leave/types`, payload, mutationConfig());
    return requireObject(response.data, 'tipo de ausencia creado');
  },

  async updateLeaveType(id: number, payload: HrLeaveTypePayload): Promise<HrLeaveType> {
    const response = await api.put(`${HR_BASE}/leave/types/${id}`, payload, mutationConfig());
    return requireObject(response.data, 'tipo de ausencia actualizado');
  },

  async getLeaveRequests(
    filters: HrWorkforceFilters = {}
  ): Promise<HrWorkforceList<HrLeaveRequest>> {
    const response = await api.get(`${HR_BASE}/leave/requests`, { params: paramsOf(filters), skipOfflineCache: true });
    return requireList(response.data, 'solicitudes de ausencia', ['requests', 'leaveRequests']);
  },

  async createLeaveRequest(payload: HrLeaveRequestPayload): Promise<HrLeaveRequest> {
    const response = await api.post(`${HR_BASE}/leave/requests`, payload, mutationConfig());
    return requireObject(response.data, 'solicitud de ausencia');
  },

  async submitLeaveRequest(id: number): Promise<HrLeaveRequest> {
    const response = await api.post(`${HR_BASE}/leave/requests/${id}/submit`, {}, mutationConfig());
    return requireObject(response.data, 'envío de solicitud de ausencia');
  },

  async decideLeaveRequest(id: number, payload: HrDecisionPayload): Promise<HrLeaveRequest> {
    const response = await api.post(
      `${HR_BASE}/leave/requests/${id}/decide`,
      payload,
      mutationConfig()
    );
    return requireObject(response.data, 'decisión de ausencia');
  },

  async cancelLeaveRequest(id: number, payload: HrReasonPayload): Promise<HrLeaveRequest> {
    const response = await api.post(
      `${HR_BASE}/leave/requests/${id}/cancel`,
      payload,
      mutationConfig()
    );
    return requireObject(response.data, 'cancelación de ausencia');
  },

  async getLeaveCalendar(filters: HrWorkforceFilters = {}): Promise<HrLeaveCalendarEntry[]> {
    const response = await api.get(`${HR_BASE}/leave/calendar`, { params: paramsOf(filters), skipOfflineCache: true });
    return requireList<HrLeaveCalendarEntry>(response.data, 'calendario de ausencias', [
      'entries',
      'calendar',
    ]).items;
  },

  async getVacationBalances(filters: HrWorkforceFilters = {}): Promise<HrVacationBalance[]> {
    const response = await api.get(`${HR_BASE}/vacation/balances`, { params: paramsOf(filters), skipOfflineCache: true });
    return requireList<HrVacationBalance>(response.data, 'saldos de vacaciones', ['balances'])
      .items;
  },

  async getVacationLedger(
    filters: HrWorkforceFilters = {}
  ): Promise<HrWorkforceList<HrVacationLedgerEntry>> {
    const response = await api.get(`${HR_BASE}/vacation/ledger`, { params: paramsOf(filters), skipOfflineCache: true });
    return requireList(response.data, 'ledger de vacaciones', ['entries', 'ledger']);
  },

  async createVacationAdjustment(
    payload: HrVacationAdjustmentPayload,
    idempotencyKey: string
  ): Promise<HrVacationLedgerEntry> {
    const response = await api.post(
      `${HR_BASE}/vacation/adjustments`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'ajuste de vacaciones');
  },

  async getMyAttendanceSummary(
    filters: HrWorkforceFilters = {}
  ): Promise<HrWorkforceList<HrDailyAttendanceSummary>> {
    const response = await api.get(`${HR_BASE}/me/attendance/summary`, {
      params: paramsOf(filters),
      skipOfflineCache: true,
    });
    return requireList(response.data, 'mis resúmenes de asistencia', [
      'summaries',
      'dailySummaries',
    ]);
  },

  async getMyWorkforce(filters: HrWorkforceFilters = {}): Promise<HrMyWorkforce> {
    const response = await api.get(`${HR_BASE}/me/workforce`, { params: paramsOf(filters), skipOfflineCache: true });
    return requireMyWorkforce(response.data);
  },
};

export function getWorkforceErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof Error &&
    (error instanceof WorkforceContractError || error instanceof WorkforceOnlineRequiredError)
  )
    return error.message;
  if (!error || typeof error !== 'object' || !('response' in error)) return fallback;
  const data = (error as { response?: { data?: { message?: string; error?: string } } }).response
    ?.data;
  return data?.message || data?.error || fallback;
}
