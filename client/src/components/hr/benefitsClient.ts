import api from '../../services/api';
import type {
  HrBenefitsEnvelope,
  HrBenefitsFilters,
  HrBenefitsList,
  HrBenefitsPagination,
  HrBenefitsTransitionPayload,
  HrDeduction,
  HrDeductionAction,
  HrDeductionPayload,
  HrLoan,
  HrLoanAction,
  HrLoanDecisionPayload,
  HrLoanDisbursementPayload,
  HrLoanPaymentPayload,
  HrLoanRequestPayload,
  HrTravelAction,
  HrTravelAdvancePayload,
  HrTravelDecisionPayload,
  HrTravelExpense,
  HrTravelExpensePayload,
  HrTravelRequest,
  HrTravelRequestPayload,
  HrTravelSettlementPayload,
} from '../../types/hr-benefits';

// The shared Axios instance prefixes /api, yielding /api/v1/hr/benefits on the wire.
const BENEFITS_BASE = '/v1/hr/benefits';

export class BenefitsContractError extends Error {
  constructor(resource: string) {
    super(`El servidor devolvió una estructura inválida para ${resource}.`);
    this.name = 'BenefitsContractError';
  }
}

export class BenefitsOnlineRequiredError extends Error {
  constructor() {
    super('Esta operación financiera requiere conexión. No se guardó ni se encoló ningún cambio.');
    this.name = 'BenefitsOnlineRequiredError';
  }
}

function dataOf<T>(raw: HrBenefitsEnvelope<T> | T): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
    return (raw as HrBenefitsEnvelope<T>).data;
  }
  return raw as T;
}

function assertSuccessfulEnvelope(raw: unknown, resource: string): void {
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'success' in raw &&
    (raw as { success?: unknown }).success !== true
  ) {
    throw new BenefitsContractError(resource);
  }
}

function paginationOf(raw: unknown, nested?: unknown): HrBenefitsPagination | undefined {
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

function requireList<T>(raw: unknown, resource: string, aliases: string[] = []): HrBenefitsList<T> {
  assertSuccessfulEnvelope(raw, resource);
  const envelopePagination =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).pagination
      : undefined;
  const value = dataOf(raw as T);
  if (Array.isArray(value)) return { items: value as T[], pagination: paginationOf(raw) };
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
  throw new BenefitsContractError(resource);
}

function requireObject<T>(raw: unknown, resource: string): T {
  assertSuccessfulEnvelope(raw, resource);
  const value = dataOf(raw as T);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BenefitsContractError(resource);
  }
  return value as T;
}

const TRAVEL_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'ADVANCED',
  'IN_SETTLEMENT',
  'SETTLED',
  'CANCELLED',
  'REVERSED',
];

function requireTravel(raw: unknown, resource = 'solicitud de viático'): HrTravelRequest {
  const value = requireObject<HrTravelRequest>(raw, resource);
  if (
    typeof value.id !== 'number' ||
    typeof value.code !== 'string' ||
    typeof value.userId !== 'number' ||
    typeof value.requestedAmount !== 'string' ||
    !TRAVEL_STATUSES.includes(value.status) ||
    !Array.isArray(value.allowedActions) ||
    typeof value.revision !== 'number'
  ) {
    throw new BenefitsContractError(resource);
  }
  return value;
}

function requireTravelDetail(raw: unknown, resource: string): HrTravelRequest {
  const value = requireTravel(raw, resource);
  if (!Array.isArray(value.expenses) || !Array.isArray(value.trace)) {
    throw new BenefitsContractError(resource);
  }
  value.expenses.forEach((expense) => requireExpense(expense));
  return value;
}

const LOAN_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'DISBURSED',
  'ACTIVE',
  'PAID',
  'CLOSED',
  'CANCELLED',
  'REVERSED',
];

function requireLoan(raw: unknown, resource = 'préstamo'): HrLoan {
  const value = requireObject<HrLoan>(raw, resource);
  if (
    typeof value.id !== 'number' ||
    typeof value.code !== 'string' ||
    typeof value.userId !== 'number' ||
    typeof value.requestedAmount !== 'string' ||
    typeof value.outstandingBalance !== 'string' ||
    !LOAN_STATUSES.includes(value.status) ||
    !Array.isArray(value.allowedActions) ||
    typeof value.revision !== 'number'
  ) {
    throw new BenefitsContractError(resource);
  }
  return value;
}

function requireLoanDetail(raw: unknown, resource: string): HrLoan {
  const value = requireLoan(raw, resource);
  if (
    !Array.isArray(value.schedule) ||
    !Array.isArray(value.ledger) ||
    !Array.isArray(value.trace)
  ) {
    throw new BenefitsContractError(resource);
  }
  return value;
}

const DEDUCTION_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'REVERSED'];

function requireDeduction(raw: unknown, resource = 'deducción'): HrDeduction {
  const value = requireObject<HrDeduction>(raw, resource);
  if (
    typeof value.id !== 'number' ||
    typeof value.code !== 'string' ||
    typeof value.userId !== 'number' ||
    typeof value.applicableAmount !== 'string' ||
    !DEDUCTION_STATUSES.includes(value.status) ||
    !Array.isArray(value.allowedActions) ||
    typeof value.revision !== 'number'
  ) {
    throw new BenefitsContractError(resource);
  }
  return value;
}

function requireDeductionDetail(raw: unknown, resource: string): HrDeduction {
  const value = requireDeduction(raw, resource);
  if (!Array.isArray(value.trace)) throw new BenefitsContractError(resource);
  return value;
}

function requireExpense(raw: unknown): HrTravelExpense {
  const value = requireObject<HrTravelExpense>(raw, 'gasto de viático');
  if (
    typeof value.id !== 'number' ||
    typeof value.travelRequestId !== 'number' ||
    typeof value.claimedAmount !== 'string' ||
    !['PENDING', 'ACCEPTED', 'REJECTED', 'REVERSED'].includes(value.status)
  ) {
    throw new BenefitsContractError('gasto de viático');
  }
  return value;
}

function paramsOf(filters: HrBenefitsFilters): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== '')
  ) as Record<string, string | number>;
}

function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new BenefitsOnlineRequiredError();
  }
}

function mutationConfig(idempotencyKey: string) {
  assertOnline();
  return { headers: { 'Idempotency-Key': idempotencyKey } };
}

export function createBenefitsIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('El navegador no puede generar una clave segura para beneficios de RH.');
}

async function getSensitive<T>(path: string, filters: HrBenefitsFilters = {}): Promise<T> {
  const response = await api.get(path, { params: paramsOf(filters), skipOfflineCache: true });
  return response.data as T;
}

const TRAVEL_ACTION_PATH: Record<HrTravelAction, string> = {
  SUBMIT: 'submit',
  APPROVE: 'approve',
  REJECT: 'reject',
  REGISTER_ADVANCE: 'advance',
  START_SETTLEMENT: 'start-settlement',
  SETTLE: 'settle',
  CANCEL: 'cancel',
  REVERSE: 'reverse',
};

const LOAN_ACTION_PATH: Record<HrLoanAction, string> = {
  APPROVE: 'approve',
  REJECT: 'reject',
  DISBURSE: 'disburse',
  REGISTER_PAYMENT: 'payments',
  CLOSE: 'close',
  CANCEL: 'cancel',
  REVERSE: 'reverse',
};

const DEDUCTION_ACTION_PATH: Record<HrDeductionAction, string> = {
  ACTIVATE: 'activate',
  PAUSE: 'pause',
  RESUME: 'resume',
  CANCEL: 'cancel',
  REVERSE: 'reverse',
};

export const benefitsClient = {
  async getTravelRequests(
    filters: HrBenefitsFilters = {}
  ): Promise<HrBenefitsList<HrTravelRequest>> {
    const raw = await getSensitive<unknown>(`${BENEFITS_BASE}/travel-requests`, filters);
    const result = requireList<HrTravelRequest>(raw, 'solicitudes de viáticos', ['travelRequests']);
    result.items.forEach((item) => requireTravel(item));
    return result;
  },

  async getTravelRequest(id: number): Promise<HrTravelRequest> {
    return requireTravelDetail(
      await getSensitive(`${BENEFITS_BASE}/travel-requests/${id}`),
      'detalle de viático'
    );
  },

  async createTravelRequest(
    payload: HrTravelRequestPayload,
    idempotencyKey: string
  ): Promise<HrTravelRequest> {
    const response = await api.post(
      `${BENEFITS_BASE}/travel-requests`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireTravel(response.data);
  },

  async updateTravelDraft(
    id: number,
    payload: HrTravelRequestPayload & { expectedRevision: number },
    idempotencyKey: string
  ): Promise<HrTravelRequest> {
    const response = await api.put(
      `${BENEFITS_BASE}/travel-requests/${id}`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireTravel(response.data);
  },

  async transitionTravel(
    id: number,
    action: HrTravelAction,
    payload:
      | HrBenefitsTransitionPayload
      | HrTravelDecisionPayload
      | HrTravelAdvancePayload
      | HrTravelSettlementPayload,
    idempotencyKey: string
  ): Promise<HrTravelRequest> {
    const response = await api.post(
      `${BENEFITS_BASE}/travel-requests/${id}/${TRAVEL_ACTION_PATH[action]}`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireTravel(response.data, `transición ${action} de viático`);
  },

  async addTravelExpense(
    id: number,
    payload: HrTravelExpensePayload,
    idempotencyKey: string
  ): Promise<HrTravelExpense> {
    const response = await api.post(
      `${BENEFITS_BASE}/travel-requests/${id}/expenses`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireExpense(response.data);
  },

  async getLoans(filters: HrBenefitsFilters = {}): Promise<HrBenefitsList<HrLoan>> {
    const raw = await getSensitive<unknown>(`${BENEFITS_BASE}/loans`, filters);
    const result = requireList<HrLoan>(raw, 'préstamos', ['loans']);
    result.items.forEach((item) => requireLoan(item));
    return result;
  },

  async getLoan(id: number): Promise<HrLoan> {
    return requireLoanDetail(
      await getSensitive(`${BENEFITS_BASE}/loans/${id}`),
      'detalle de préstamo'
    );
  },

  async createLoanRequest(payload: HrLoanRequestPayload, idempotencyKey: string): Promise<HrLoan> {
    const response = await api.post(
      `${BENEFITS_BASE}/loan-requests`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireLoan(response.data);
  },

  async transitionLoan(
    id: number,
    action: HrLoanAction,
    payload:
      | HrBenefitsTransitionPayload
      | HrLoanDecisionPayload
      | HrLoanDisbursementPayload
      | HrLoanPaymentPayload,
    idempotencyKey: string
  ): Promise<HrLoan> {
    const response = await api.post(
      `${BENEFITS_BASE}/loans/${id}/${LOAN_ACTION_PATH[action]}`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireLoan(response.data, `transición ${action} de préstamo`);
  },

  async getDeductions(filters: HrBenefitsFilters = {}): Promise<HrBenefitsList<HrDeduction>> {
    const raw = await getSensitive<unknown>(`${BENEFITS_BASE}/deductions`, filters);
    const result = requireList<HrDeduction>(raw, 'deducciones', ['deductions']);
    result.items.forEach((item) => requireDeduction(item));
    return result;
  },

  async getDeduction(id: number): Promise<HrDeduction> {
    return requireDeductionDetail(
      await getSensitive(`${BENEFITS_BASE}/deductions/${id}`),
      'detalle de deducción'
    );
  },

  async createDeduction(payload: HrDeductionPayload, idempotencyKey: string): Promise<HrDeduction> {
    const response = await api.post(
      `${BENEFITS_BASE}/deductions`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireDeduction(response.data);
  },

  async updateDeduction(
    id: number,
    payload: HrDeductionPayload & { expectedRevision: number },
    idempotencyKey: string
  ): Promise<HrDeduction> {
    const response = await api.put(
      `${BENEFITS_BASE}/deductions/${id}`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireDeduction(response.data);
  },

  async transitionDeduction(
    id: number,
    action: HrDeductionAction,
    payload: HrBenefitsTransitionPayload,
    idempotencyKey: string
  ): Promise<HrDeduction> {
    const response = await api.post(
      `${BENEFITS_BASE}/deductions/${id}/${DEDUCTION_ACTION_PATH[action]}`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireDeduction(response.data, `transición ${action} de deducción`);
  },

  async getMyTravelRequests(
    filters: HrBenefitsFilters = {}
  ): Promise<HrBenefitsList<HrTravelRequest>> {
    const raw = await getSensitive<unknown>(`${BENEFITS_BASE}/me/travel-requests`, filters);
    const result = requireList<HrTravelRequest>(raw, 'mis viáticos', ['travelRequests']);
    result.items.forEach((item) => requireTravel(item));
    return result;
  },

  async getMyTravelRequest(id: number): Promise<HrTravelRequest> {
    return requireTravelDetail(
      await getSensitive(`${BENEFITS_BASE}/me/travel-requests/${id}`),
      'detalle de mi viático'
    );
  },

  async createMyTravelRequest(
    payload: HrTravelRequestPayload,
    idempotencyKey: string
  ): Promise<HrTravelRequest> {
    const selfPayload = { ...payload };
    delete selfPayload.userId;
    const response = await api.post(
      `${BENEFITS_BASE}/me/travel-requests`,
      selfPayload,
      mutationConfig(idempotencyKey)
    );
    return requireTravel(response.data);
  },

  async transitionMyTravel(
    id: number,
    action: Extract<HrTravelAction, 'SUBMIT' | 'START_SETTLEMENT' | 'CANCEL'>,
    payload: HrBenefitsTransitionPayload,
    idempotencyKey: string
  ): Promise<HrTravelRequest> {
    const response = await api.post(
      `${BENEFITS_BASE}/me/travel-requests/${id}/${TRAVEL_ACTION_PATH[action]}`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireTravel(response.data, 'actualización de mi viático');
  },

  async addMyTravelExpense(
    id: number,
    payload: HrTravelExpensePayload,
    idempotencyKey: string
  ): Promise<HrTravelExpense> {
    const response = await api.post(
      `${BENEFITS_BASE}/me/travel-requests/${id}/expenses`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireExpense(response.data);
  },

  async getMyLoans(filters: HrBenefitsFilters = {}): Promise<HrBenefitsList<HrLoan>> {
    const raw = await getSensitive<unknown>(`${BENEFITS_BASE}/me/loans`, filters);
    const result = requireList<HrLoan>(raw, 'mis préstamos', ['loans']);
    result.items.forEach((item) => requireLoan(item));
    return result;
  },

  async getMyLoan(id: number): Promise<HrLoan> {
    return requireLoanDetail(
      await getSensitive(`${BENEFITS_BASE}/me/loans/${id}`),
      'detalle de mi préstamo'
    );
  },

  async createMyLoanRequest(
    payload: HrLoanRequestPayload,
    idempotencyKey: string
  ): Promise<HrLoan> {
    const selfPayload = { ...payload };
    delete selfPayload.userId;
    const response = await api.post(
      `${BENEFITS_BASE}/me/loan-requests`,
      selfPayload,
      mutationConfig(idempotencyKey)
    );
    return requireLoan(response.data);
  },

  async getMyDeductions(filters: HrBenefitsFilters = {}): Promise<HrBenefitsList<HrDeduction>> {
    const raw = await getSensitive<unknown>(`${BENEFITS_BASE}/me/deductions`, filters);
    const result = requireList<HrDeduction>(raw, 'mis deducciones', ['deductions']);
    result.items.forEach((item) => requireDeduction(item));
    return result;
  },

  async getMyDeduction(id: number): Promise<HrDeduction> {
    return requireDeductionDetail(
      await getSensitive(`${BENEFITS_BASE}/me/deductions/${id}`),
      'detalle de mi deducción'
    );
  },
};

export function getBenefitsErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof Error &&
    (error instanceof BenefitsContractError || error instanceof BenefitsOnlineRequiredError)
  ) {
    return error.message;
  }
  if (!error || typeof error !== 'object' || !('response' in error)) return fallback;
  const data = (error as { response?: { data?: { message?: string; error?: string } } }).response
    ?.data;
  return data?.message || data?.error || fallback;
}
