import api from '../../services/api';
import type {
  HrAguinaldoRunPayload,
  HrPayrollAnomaly,
  HrPayrollComponent,
  HrPayrollComponentPayload,
  HrPayrollConfigurationReviewPayload,
  HrPayrollConfigurationUploadPayload,
  HrPayrollEnvelope,
  HrPayrollFilters,
  HrPayrollList,
  HrPayrollPagination,
  HrPayrollPeriod,
  HrPayrollPeriodPayload,
  HrPayrollReceiptDetail,
  HrPayrollReceiptSummary,
  HrPayrollRulePayload,
  HrPayrollRuleConfigurationRevision,
  HrPayrollRuleVersion,
  HrPayrollRun,
  HrPayrollRunDetail,
  HrPayrollRunKind,
  HrPayrollRunPayload,
  HrPayrollSnapshotLine,
  HrPayrollTransitionPayload,
} from '../../types/hr-payroll';

// The shared Axios instance prefixes /api, yielding /api/v1/hr/payroll on the wire.
const PAYROLL_BASE = '/v1/hr/payroll';

export class PayrollContractError extends Error {
  constructor(resource: string) {
    super(`El servidor devolvió una estructura inválida para ${resource}.`);
    this.name = 'PayrollContractError';
  }
}

export class PayrollOnlineRequiredError extends Error {
  constructor() {
    super('Esta operación de nómina requiere conexión. No se guardó ni se encoló ningún cambio.');
    this.name = 'PayrollOnlineRequiredError';
  }
}

function dataOf<T>(raw: HrPayrollEnvelope<T> | T): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
    return (raw as HrPayrollEnvelope<T>).data;
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
    throw new PayrollContractError(resource);
  }
}

function paginationOf(raw: unknown, nested?: unknown): HrPayrollPagination | undefined {
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

function requireList<T>(raw: unknown, resource: string, aliases: string[] = []): HrPayrollList<T> {
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
  throw new PayrollContractError(resource);
}

function requireObject<T>(raw: unknown, resource: string): T {
  assertSuccessfulEnvelope(raw, resource);
  const value = dataOf(raw as T);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PayrollContractError(resource);
  }
  return value as T;
}

function requireRun(raw: unknown, resource: string): HrPayrollRun {
  const value = requireObject<HrPayrollRun>(raw, resource);
  if (
    typeof value.id !== 'number' ||
    typeof value.code !== 'string' ||
    !['REGULAR', 'AGUINALDO'].includes(value.kind) ||
    !['DRAFT', 'CALCULATED', 'REVIEW', 'APPROVED', 'PAID', 'VOID'].includes(value.status) ||
    !Array.isArray(value.allowedActions) ||
    typeof value.revision !== 'number' ||
    typeof value.anomalyCount !== 'number' ||
    typeof value.blockingAnomalyCount !== 'number'
  ) {
    throw new PayrollContractError(resource);
  }
  return value;
}

function requireRule(raw: unknown): HrPayrollRuleVersion {
  const value = requireObject<HrPayrollRuleVersion>(raw, 'versión de regla');
  if (
    typeof value.id !== 'number' ||
    typeof value.version !== 'number' ||
    typeof value.revision !== 'number' ||
    !['DRAFT', 'ACTIVE', 'RETIRED'].includes(value.status)
  ) {
    throw new PayrollContractError('versión de regla');
  }
  return value;
}

function requirePeriod(raw: unknown): HrPayrollPeriod {
  const value = requireObject<HrPayrollPeriod>(raw, 'periodo de nómina');
  if (
    typeof value.id !== 'number' ||
    typeof value.code !== 'string' ||
    typeof value.revision !== 'number' ||
    !['DRAFT', 'OPEN', 'CLOSED', 'VOID'].includes(value.status)
  ) {
    throw new PayrollContractError('periodo de nómina');
  }
  return value;
}

function requireComponent(raw: unknown): HrPayrollComponent {
  const value = requireObject<HrPayrollComponent>(raw, 'componente de nómina');
  if (
    typeof value.id !== 'number' ||
    typeof value.userId !== 'number' ||
    typeof value.amount !== 'string' ||
    !['INCOME', 'DEDUCTION'].includes(value.type)
  ) {
    throw new PayrollContractError('componente de nómina');
  }
  return value;
}

function requireReceiptSummary(raw: unknown): HrPayrollReceiptSummary {
  const value = requireObject<HrPayrollReceiptSummary>(raw, 'recibo publicado');
  if (
    typeof value.id !== 'number' ||
    typeof value.runId !== 'number' ||
    typeof value.grossIncome !== 'string' ||
    typeof value.totalDeductions !== 'string' ||
    typeof value.netPay !== 'string' ||
    !['PUBLISHED', 'VOID'].includes(value.status)
  ) {
    throw new PayrollContractError('recibo publicado');
  }
  return value;
}

function requireReceipt(raw: unknown): HrPayrollReceiptDetail {
  const value = requireObject<HrPayrollReceiptDetail>(raw, 'detalle de recibo');
  requireReceiptSummary(value);
  if (
    typeof value.userId !== 'number' ||
    !Array.isArray(value.components) ||
    !Array.isArray(value.trace)
  ) {
    throw new PayrollContractError('detalle de recibo');
  }
  value.components.forEach((component) => requireComponent(component));
  return value;
}

function paramsOf(filters: HrPayrollFilters): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== '')
  ) as Record<string, string | number>;
}

function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new PayrollOnlineRequiredError();
  }
}

function mutationConfig(idempotencyKey: string) {
  assertOnline();
  return { headers: { 'Idempotency-Key': idempotencyKey } };
}

export function createPayrollIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('El navegador no puede generar una clave segura para nómina.');
}

function runPath(kind: HrPayrollRunKind, id?: number): string {
  const base = kind === 'AGUINALDO' ? `${PAYROLL_BASE}/aguinaldo/runs` : `${PAYROLL_BASE}/runs`;
  return id === undefined ? base : `${base}/${id}`;
}

async function downloadAuthenticated(path: string, fallbackName: string): Promise<void> {
  assertOnline();
  const response = await api.get(path, { responseType: 'blob', skipOfflineCache: true });
  const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const disposition = String(response.headers?.['content-disposition'] ?? '');
  const headerName = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i)?.[1];
  const safeName = decodeURIComponent(headerName ?? fallbackName).replace(/[^a-zA-Z0-9._-]/g, '_');
  link.href = objectUrl;
  link.download = safeName || fallbackName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function transitionRun(
  kind: HrPayrollRunKind,
  id: number,
  action: 'calculate' | 'recalculate' | 'submit-review' | 'approve' | 'pay' | 'void',
  payload: HrPayrollTransitionPayload,
  idempotencyKey: string
): Promise<HrPayrollRun> {
  const response = await api.post(
    `${runPath(kind, id)}/${action}`,
    payload,
    mutationConfig(idempotencyKey)
  );
  return requireRun(response.data, `transición ${action} de nómina`);
}

export const payrollClient = {
  async getRules(filters: HrPayrollFilters = {}): Promise<HrPayrollList<HrPayrollRuleVersion>> {
    const response = await api.get(`${PAYROLL_BASE}/rules`, { params: paramsOf(filters), skipOfflineCache: true });
    const result = requireList<HrPayrollRuleVersion>(response.data, 'reglas de nómina', [
      'rules',
      'versions',
    ]);
    result.items.forEach((rule) => requireRule(rule));
    return result;
  },

  async createRule(
    payload: HrPayrollRulePayload,
    idempotencyKey: string
  ): Promise<HrPayrollRuleVersion> {
    const response = await api.post(
      `${PAYROLL_BASE}/rules`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireRule(response.data);
  },

  async updateRule(
    id: number,
    payload: HrPayrollRulePayload,
    idempotencyKey: string
  ): Promise<HrPayrollRuleVersion> {
    const response = await api.put(
      `${PAYROLL_BASE}/rules/${id}`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireRule(response.data);
  },

  async getRuleConfigurations(id: number): Promise<HrPayrollRuleConfigurationRevision[]> {
    const response = await api.get(`${PAYROLL_BASE}/rules/${id}/configuration-revisions`, {
      skipOfflineCache: true,
    });
    return requireList<HrPayrollRuleConfigurationRevision>(
      response.data,
      'revisiones legales de nómina',
      ['configurationRevisions']
    ).items;
  },

  async uploadRuleConfiguration(
    id: number,
    payload: HrPayrollConfigurationUploadPayload,
    idempotencyKey: string
  ): Promise<HrPayrollRuleConfigurationRevision> {
    const response = await api.post(
      `${PAYROLL_BASE}/rules/${id}/configuration-revisions`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject<HrPayrollRuleConfigurationRevision>(
      response.data,
      'revisión legal cargada'
    );
  },

  async reviewRuleConfiguration(
    id: number,
    payload: HrPayrollConfigurationReviewPayload,
    idempotencyKey: string
  ): Promise<{ configurationRevisionId: number; decision: 'VALIDATED' | 'REJECTED' }> {
    const response = await api.post(
      `${PAYROLL_BASE}/rules/${id}/configuration-reviews`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireObject(response.data, 'revisión legal validada');
  },

  async activateRule(
    id: number,
    payload: HrPayrollTransitionPayload,
    idempotencyKey: string
  ): Promise<HrPayrollRuleVersion> {
    const response = await api.post(
      `${PAYROLL_BASE}/rules/${id}/activate`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireRule(response.data);
  },

  async retireRule(
    id: number,
    payload: HrPayrollTransitionPayload,
    idempotencyKey: string
  ): Promise<HrPayrollRuleVersion> {
    const response = await api.post(
      `${PAYROLL_BASE}/rules/${id}/retire`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireRule(response.data);
  },

  async getPeriods(filters: HrPayrollFilters = {}): Promise<HrPayrollList<HrPayrollPeriod>> {
    const response = await api.get(`${PAYROLL_BASE}/periods`, { params: paramsOf(filters), skipOfflineCache: true });
    const result = requireList<HrPayrollPeriod>(response.data, 'periodos de nómina', ['periods']);
    result.items.forEach((period) => requirePeriod(period));
    return result;
  },

  async createPeriod(
    payload: HrPayrollPeriodPayload,
    idempotencyKey: string
  ): Promise<HrPayrollPeriod> {
    const response = await api.post(
      `${PAYROLL_BASE}/periods`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requirePeriod(response.data);
  },

  async getRuns(
    kind: HrPayrollRunKind,
    filters: HrPayrollFilters = {}
  ): Promise<HrPayrollList<HrPayrollRun>> {
    const response = await api.get(runPath(kind), { params: paramsOf(filters), skipOfflineCache: true });
    const result = requireList<HrPayrollRun>(response.data, 'corridas de nómina', [
      'runs',
      'payrollRuns',
      'aguinaldoRuns',
    ]);
    result.items.forEach((run) => requireRun(run, 'corrida de nómina'));
    return result;
  },

  async getRun(kind: HrPayrollRunKind, id: number): Promise<HrPayrollRun> {
    const response = await api.get(runPath(kind, id), { skipOfflineCache: true });
    return requireRun(response.data, 'corrida de nómina');
  },

  async createRun(payload: HrPayrollRunPayload, idempotencyKey: string): Promise<HrPayrollRun> {
    const response = await api.post(runPath('REGULAR'), payload, mutationConfig(idempotencyKey));
    return requireRun(response.data, 'corrida de nómina');
  },

  async createAguinaldoRun(
    payload: HrAguinaldoRunPayload,
    idempotencyKey: string
  ): Promise<HrPayrollRun> {
    const response = await api.post(runPath('AGUINALDO'), payload, mutationConfig(idempotencyKey));
    return requireRun(response.data, 'corrida de aguinaldo');
  },

  calculateRun: (
    kind: HrPayrollRunKind,
    id: number,
    payload: HrPayrollTransitionPayload,
    key: string
  ) => transitionRun(kind, id, 'calculate', payload, key),
  recalculateRun: (
    kind: HrPayrollRunKind,
    id: number,
    payload: HrPayrollTransitionPayload,
    key: string
  ) => transitionRun(kind, id, 'recalculate', payload, key),
  submitRunReview: (
    kind: HrPayrollRunKind,
    id: number,
    payload: HrPayrollTransitionPayload,
    key: string
  ) => transitionRun(kind, id, 'submit-review', payload, key),
  approveRun: (
    kind: HrPayrollRunKind,
    id: number,
    payload: HrPayrollTransitionPayload,
    key: string
  ) => transitionRun(kind, id, 'approve', payload, key),
  payRun: (kind: HrPayrollRunKind, id: number, payload: HrPayrollTransitionPayload, key: string) =>
    transitionRun(kind, id, 'pay', payload, key),
  voidRun: (kind: HrPayrollRunKind, id: number, payload: HrPayrollTransitionPayload, key: string) =>
    transitionRun(kind, id, 'void', payload, key),

  async getAnomalies(kind: HrPayrollRunKind, id: number): Promise<HrPayrollAnomaly[]> {
    const response = await api.get(`${runPath(kind, id)}/anomalies`, { skipOfflineCache: true });
    return requireList<HrPayrollAnomaly>(response.data, 'anomalías de nómina', ['anomalies']).items;
  },

  async getSnapshot(kind: HrPayrollRunKind, id: number): Promise<HrPayrollSnapshotLine[]> {
    const response = await api.get(`${runPath(kind, id)}/snapshot`, { skipOfflineCache: true });
    return requireList<HrPayrollSnapshotLine>(response.data, 'snapshot de nómina', ['snapshot'])
      .items;
  },

  async getComponents(kind: HrPayrollRunKind, id: number): Promise<HrPayrollComponent[]> {
    const response = await api.get(`${runPath(kind, id)}/components`, { skipOfflineCache: true });
    const result = requireList<HrPayrollComponent>(response.data, 'componentes de nómina', [
      'components',
    ]).items;
    result.forEach((component) => requireComponent(component));
    return result;
  },

  async addComponent(
    kind: HrPayrollRunKind,
    id: number,
    payload: HrPayrollComponentPayload,
    idempotencyKey: string
  ): Promise<HrPayrollComponent> {
    const response = await api.post(
      `${runPath(kind, id)}/components`,
      payload,
      mutationConfig(idempotencyKey)
    );
    return requireComponent(response.data);
  },

  async getRunReceipts(kind: HrPayrollRunKind, id: number): Promise<HrPayrollReceiptSummary[]> {
    const response = await api.get(`${runPath(kind, id)}/receipts`, { skipOfflineCache: true });
    const result = requireList<HrPayrollReceiptSummary>(response.data, 'recibos de corrida', [
      'receipts',
    ]).items;
    result.forEach((receipt) => requireReceiptSummary(receipt));
    return result;
  },

  async getRunWorkspace(kind: HrPayrollRunKind, id: number): Promise<HrPayrollRunDetail> {
    const [run, anomalies, snapshot, components, receipts] = await Promise.all([
      this.getRun(kind, id),
      this.getAnomalies(kind, id),
      this.getSnapshot(kind, id),
      this.getComponents(kind, id),
      this.getRunReceipts(kind, id),
    ]);
    return { ...run, anomalies, snapshot, components, receipts };
  },

  exportRun: (kind: HrPayrollRunKind, id: number, format: 'csv' | 'xlsx') =>
    downloadAuthenticated(
      `${runPath(kind, id)}/export?format=${format}`,
      `${kind.toLowerCase()}-${id}.${format}`
    ),

  downloadRunReceipt: (kind: HrPayrollRunKind, runId: number, receiptId: number) =>
    downloadAuthenticated(
      `${runPath(kind, runId)}/receipts/${receiptId}/pdf`,
      `recibo-${receiptId}.pdf`
    ),

  async getMyReceipts(
    filters: HrPayrollFilters = {}
  ): Promise<HrPayrollList<HrPayrollReceiptSummary>> {
    const response = await api.get(`${PAYROLL_BASE}/me/receipts`, { params: paramsOf(filters), skipOfflineCache: true });
    const result = requireList<HrPayrollReceiptSummary>(response.data, 'mis recibos publicados', [
      'receipts',
    ]);
    result.items.forEach((receipt) => requireReceiptSummary(receipt));
    return result;
  },

  async getMyReceipt(id: number): Promise<HrPayrollReceiptDetail> {
    const response = await api.get(`${PAYROLL_BASE}/me/receipts/${id}`, { skipOfflineCache: true });
    return requireReceipt(response.data);
  },

  downloadMyReceipt: (id: number) =>
    downloadAuthenticated(`${PAYROLL_BASE}/me/receipts/${id}/pdf`, `mi-recibo-${id}.pdf`),
};

export function getPayrollErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof Error &&
    (error instanceof PayrollContractError || error instanceof PayrollOnlineRequiredError)
  ) {
    return error.message;
  }
  if (!error || typeof error !== 'object' || !('response' in error)) return fallback;
  const data = (error as { response?: { data?: { message?: string; error?: string } } }).response
    ?.data;
  return data?.message || data?.error || fallback;
}
