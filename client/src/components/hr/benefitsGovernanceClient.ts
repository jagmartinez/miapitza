import api from '../../services/api';
import { createBenefitsIdempotencyKey } from './benefitsClient';
import type {
  BenefitPolicy,
  BenefitPolicyPayload,
  BenefitPolicyUpdatePayload,
  EmploymentSettlement,
  SettlementPayload,
  SettlementPreview,
  SettlementPreviewPayload,
  SettlementUpdatePayload,
} from '../../types/hr-benefits-governance';

const BASE = '/v1/hr/benefits';
const unwrap = <T>(raw: { data?: T } | T): T =>
  raw && typeof raw === 'object' && 'data' in raw ? (raw as { data: T }).data : (raw as T);
const write = () => ({ headers: { 'Idempotency-Key': createBenefitsIdempotencyKey() } });

export const benefitsGovernanceClient = {
  async policies(filters: { page?: number; limit?: number; status?: string } = {}): Promise<{
    items: BenefitPolicy[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const response = await api.get(`${BASE}/policies`, { params: filters });
    const raw = response.data as {
      data?: BenefitPolicy[];
      pagination?: { page: number; pageSize: number; total: number; totalPages: number };
    };
    const items = unwrap<BenefitPolicy[]>(raw);
    return {
      items,
      pagination: raw.pagination ?? {
        page: filters.page ?? 1,
        pageSize: filters.limit ?? (items.length || 20),
        total: items.length,
        totalPages: 1,
      },
    };
  },
  async createPolicy(payload: BenefitPolicyPayload): Promise<BenefitPolicy> {
    const response = await api.post(`${BASE}/policies`, payload, write());
    return unwrap<BenefitPolicy>(response.data);
  },
  async updatePolicy(id: number, payload: BenefitPolicyUpdatePayload): Promise<BenefitPolicy> {
    const response = await api.put(`${BASE}/policies/${id}`, payload, write());
    return unwrap<BenefitPolicy>(response.data);
  },
  async activatePolicy(
    id: number,
    expectedRevision: number,
    confirmed: boolean
  ): Promise<BenefitPolicy> {
    const response = await api.post(
      `${BASE}/policies/${id}/activate`,
      { confirmed, expectedRevision },
      write()
    );
    return unwrap<BenefitPolicy>(response.data);
  },
  async settlements(
    filters: { status?: string; search?: string; page?: number; limit?: number } = {}
  ): Promise<{
    items: EmploymentSettlement[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const response = await api.get(`${BASE}/settlements`, { params: filters });
    const raw = response.data as {
      data?: EmploymentSettlement[];
      pagination?: { page: number; pageSize: number; total: number; totalPages: number };
    };
    const items = unwrap<EmploymentSettlement[]>(raw);
    return {
      items,
      pagination: raw.pagination ?? {
        page: filters.page ?? 1,
        pageSize: filters.limit ?? (items.length || 25),
        total: items.length,
        totalPages: 1,
      },
    };
  },
  async settlement(id: number): Promise<EmploymentSettlement> {
    const response = await api.get(`${BASE}/settlements/${id}`);
    return unwrap<EmploymentSettlement>(response.data);
  },
  async preview(payload: SettlementPreviewPayload): Promise<SettlementPreview> {
    const response = await api.post(`${BASE}/settlements/preview`, payload);
    return unwrap<SettlementPreview>(response.data);
  },
  async createSettlement(payload: SettlementPayload): Promise<EmploymentSettlement> {
    const response = await api.post(`${BASE}/settlements`, payload, write());
    return unwrap<EmploymentSettlement>(response.data);
  },
  async updateSettlement(
    id: number,
    payload: SettlementUpdatePayload
  ): Promise<EmploymentSettlement> {
    const response = await api.put(`${BASE}/settlements/${id}`, payload, write());
    return unwrap<EmploymentSettlement>(response.data);
  },
  async transition(
    id: number,
    action: string,
    revision: number,
    reason: string,
    reference?: string
  ): Promise<EmploymentSettlement> {
    const response = await api.post(
      `${BASE}/settlements/${id}/${action}`,
      { expectedRevision: revision, confirmed: true, reason, ...(reference ? { reference } : {}) },
      write()
    );
    return unwrap<EmploymentSettlement>(response.data);
  },
  async downloadPdf(id: number, code: string): Promise<void> {
    const response = await api.get(`${BASE}/settlements/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data as Blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `liquidacion-${code}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
  },
};
