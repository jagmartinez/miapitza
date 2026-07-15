import api from '../../services/api';
import type {
    HrDashboardData,
    HrEmployee,
    HrEmployeeFilters,
    HrEmployeeListResult,
    HrEmployeePayload,
    HrEnvelope,
    HrNamedEntity,
    HrOrganizationCatalogs,
    HrUserSummary,
} from '../../types/hr';

const HR_BASE = '/v1/hr';

function unwrap<T>(payload: HrEnvelope<T> | T): T {
    if (payload && typeof payload === 'object' && 'data' in payload) {
        return (payload as HrEnvelope<T>).data;
    }
    return payload as T;
}

function asNamedEntities(value: unknown): HrNamedEntity[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is HrNamedEntity =>
        Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item)
    );
}

function normalizePagination(value: unknown): HrEmployeeListResult['pagination'] {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    const page = Number(raw.page ?? raw.currentPage ?? 1);
    const pageSize = Number(raw.pageSize ?? raw.limit ?? 25);
    const total = Number(raw.total ?? raw.totalItems ?? 0);
    const totalPages = Number(raw.totalPages ?? Math.max(1, Math.ceil(total / pageSize)));
    if (![page, pageSize, total, totalPages].every(Number.isFinite)) return undefined;
    return { page, pageSize, total, totalPages };
}

function normalizeEmployeeList(value: unknown, pagination?: unknown): HrEmployeeListResult {
    if (Array.isArray(value)) {
        return { items: value as HrEmployee[], pagination: normalizePagination(pagination) };
    }
    if (!value || typeof value !== 'object') return { items: [] };
    const raw = value as Record<string, unknown>;
    const items = (raw.items ?? raw.employees ?? []) as HrEmployee[];
    return {
        items: Array.isArray(items) ? items : [],
        pagination: normalizePagination(pagination ?? raw.pagination ?? raw.meta),
    };
}

function normalizeOrganization(value: unknown): HrOrganizationCatalogs {
    if (!value || typeof value !== 'object') {
        return { departments: [], positions: [], costCenters: [] };
    }
    const raw = value as Record<string, unknown>;
    return {
        departments: asNamedEntities(raw.departments),
        positions: asNamedEntities(raw.jobPositions ?? raw.positions),
        costCenters: asNamedEntities(raw.costCenters),
        branches: asNamedEntities(raw.branches),
        users: Array.isArray(raw.users) ? raw.users as HrUserSummary[] : [],
        employees: Array.isArray(raw.employees) ? raw.employees as HrEmployee[] : [],
        enums: raw.enums && typeof raw.enums === 'object'
            ? raw.enums as HrOrganizationCatalogs['enums']
            : undefined,
    };
}

function buildParams(filters: HrEmployeeFilters): Record<string, string | number> {
    const params: Record<string, string | number> = {};
    if (filters.search?.trim()) params.search = filters.search.trim();
    if (filters.status && filters.status !== 'ALL') params.status = filters.status;
    if (filters.branchId) params.branchId = filters.branchId;
    if (filters.departmentId) params.departmentId = filters.departmentId;
    if (filters.jobPositionId) params.jobPositionId = filters.jobPositionId;
    if (filters.costCenterId) params.costCenterId = filters.costCenterId;
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;
    return params;
}

export const hrClient = {
    async getDashboard(): Promise<HrDashboardData> {
        const response = await api.get<HrEnvelope<HrDashboardData> | HrDashboardData>(`${HR_BASE}/dashboard`);
        return unwrap(response.data);
    },

    async getEmployees(filters: HrEmployeeFilters = {}): Promise<HrEmployeeListResult> {
        const response = await api.get(`${HR_BASE}/employees`, { params: buildParams(filters) });
        const rawResponse = response.data as unknown;
        if (rawResponse && typeof rawResponse === 'object' && 'data' in rawResponse) {
            const envelope = rawResponse as { data: unknown; pagination?: unknown };
            return normalizeEmployeeList(envelope.data, envelope.pagination);
        }
        return normalizeEmployeeList(rawResponse);
    },

    async getEmployee(id: number): Promise<HrEmployee> {
        const response = await api.get<HrEnvelope<HrEmployee> | HrEmployee>(`${HR_BASE}/employees/${id}`);
        return unwrap(response.data);
    },

    async createEmployee(payload: HrEmployeePayload): Promise<HrEmployee> {
        const response = await api.post<HrEnvelope<HrEmployee> | HrEmployee>(`${HR_BASE}/employees`, payload);
        return unwrap(response.data);
    },

    async updateEmployee(id: number, payload: HrEmployeePayload): Promise<HrEmployee> {
        const response = await api.put<HrEnvelope<HrEmployee> | HrEmployee>(`${HR_BASE}/employees/${id}`, payload);
        return unwrap(response.data);
    },

    async changeEmployeeStatus(
        id: number,
        status: HrEmployee['status'],
        details?: { terminationDate?: string; reason?: string }
    ): Promise<HrEmployee> {
        const response = await api.patch<HrEnvelope<HrEmployee> | HrEmployee>(
            `${HR_BASE}/employees/${id}/status`,
            { status, ...details }
        );
        return unwrap(response.data);
    },

    async getOrganization(): Promise<HrOrganizationCatalogs> {
        const response = await api.get(`${HR_BASE}/lookups`);
        return normalizeOrganization(unwrap(response.data));
    },

    async getUsers(): Promise<HrUserSummary[]> {
        const response = await api.get('/users');
        const value = unwrap<unknown>(response.data);
        if (Array.isArray(value)) return value as HrUserSummary[];
        if (value && typeof value === 'object') {
            const raw = value as Record<string, unknown>;
            const users = raw.items ?? raw.users;
            return Array.isArray(users) ? users as HrUserSummary[] : [];
        }
        return [];
    },

    async getBranches(): Promise<HrNamedEntity[]> {
        const response = await api.get('/branches');
        const value = unwrap<unknown>(response.data);
        if (Array.isArray(value)) return asNamedEntities(value);
        if (value && typeof value === 'object') {
            const raw = value as Record<string, unknown>;
            return asNamedEntities(raw.items ?? raw.branches);
        }
        return [];
    },
};

export function employeePrimaryBranch(employee: HrEmployee): HrNamedEntity | null {
    if (employee.primaryBranch) return employee.primaryBranch;
    const primary = employee.branchAssignments?.find((assignment) =>
        assignment.isPrimary && !assignment.effectiveTo && !assignment.activeTo
    );
    return primary?.branch ?? null;
}

export function getHrErrorMessage(error: unknown, fallback: string): string {
    if (!error || typeof error !== 'object') return fallback;
    const response = 'response' in error
        ? (error as { response?: { data?: { message?: string; error?: string } } }).response
        : undefined;
    return response?.data?.message || response?.data?.error || fallback;
}
