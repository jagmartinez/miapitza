import api from './api';

export type SettingType = 'string' | 'number' | 'integer' | 'boolean' | 'enum';

export interface SettingDef {
    key: string;
    type: SettingType;
    default: string;
    group: string;
    section: string;
    label: string;
    description: string;
    min?: number;
    max?: number;
    options?: { value: string; label: string }[];
    prefix?: string;
    suffix?: string;
    branchable: boolean;
    readOnly?: 'system' | 'legal-version';
}

export interface SectionDef {
    id: string;
    group: string;
    title: string;
    description: string;
    note?: string;
}

export interface ResolvedSetting {
    key: string;
    value: string;
    source: 'company' | 'branch' | 'default';
    companyValue: string;
}

export interface ResolvedPayload {
    values: Record<string, ResolvedSetting>;
    version: string;
}

export interface SettingHistoryEntry {
    name: string;
    branchId: number | null;
    oldValue: string | null;
    newValue: string | null;
    userName: string;
    createdAt: string;
}

export async function fetchRegistry(): Promise<{ sections: SectionDef[]; definitions: SettingDef[] }> {
    const res = await api.get('/settings/registry');
    return res.data.data;
}

export async function fetchResolved(branchId: number | null): Promise<ResolvedPayload> {
    const res = await api.get('/settings/resolved', { params: branchId == null ? {} : { branchId } });
    return res.data.data;
}

export async function saveResolved(
    branchId: number | null,
    version: string,
    changes: Record<string, string | number | boolean>
): Promise<ResolvedPayload> {
    const res = await api.patch('/settings/resolved', { branchId, version, changes });
    return res.data.data;
}

export async function fetchHistory(section?: string, limit = 20): Promise<SettingHistoryEntry[]> {
    const res = await api.get('/settings/history', { params: { ...(section ? { section } : {}), limit } });
    return res.data.data;
}
