import type { Session } from '../core/session';

/** Same shape as the web client's SyncItem (client/src/services/db.ts); redefined because that module pulls Dexie. */
export type SyncOperationType = 'CREATE_ORDER' | 'ADD_ORDER_ITEM' | 'SEND_TO_KITCHEN' | 'CREATE_PAYMENT' | 'GENERIC_MUTATION';
export type SyncStatus = 'pending' | 'blocked' | 'processing' | 'failed';

export interface SyncItem {
    id?: number;
    /** Relative to the API base, e.g. '/orders/12/items'. */
    url: string;
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    data: unknown;
    timestamp: number;
    operationType: SyncOperationType;
    status: SyncStatus;
    retryCount: number;
    dependencyKey?: string | null;
    entityTempId?: string | null;
    lastError?: string | null;
    idempotencyKey?: string | null;
    nextAttemptAt?: number | null;
    /** Network-level failures (no HTTP response); they back off but never count toward the 5 retries. */
    networkFailures?: number;
    /** `${companyId}:${userId}`. Never a token. */
    ownerKey: string;
}

export interface CacheEntry {
    /** `${ownerKey}|${url}?sortedParams` */
    id: string;
    url: string;
    ownerKey: string;
    data: unknown;
    timestamp: number;
}

/** Offline-created order: temp id -> real id once its create synced. Kept 24 h. */
export interface TempIdRow {
    /** `${ownerKey}|${tempId}` */
    id: string;
    ownerKey: string;
    tempId: string;
    realId: number | string;
    /** Tombstone: the operation behind this temp id was discarded; late dependents must fail. */
    discarded?: boolean;
    timestamp: number;
}

export interface DraftRow {
    /** `${companyId}:${userId}:${tableId}` */
    id: string;
    ownerKey: string;
    tableId: number;
    data: DraftData;
    updatedAt: number;
}

export interface DraftLine {
    menuItemId: number;
    quantity: number;
    notes?: string;
    modifierIds?: number[];
}
export interface DraftData {
    items: DraftLine[];
    guests?: number;
    [extra: string]: unknown;
}

/** What a queued mutation resolves to instead of the server response. */
export interface QueuedOffline {
    success: true;
    _offline: true;
    entityTempId: string | null;
    queueId: number;
}

/** Format of the ids the app invents for orders created offline (`order-<ms>-<suffix>`). */
const TEMP_ORDER_ID = /^order-\d+-[A-Za-z0-9]{4,}$/;
export const isTempOrderId = (value: unknown): value is string => typeof value === 'string' && TEMP_ORDER_ID.test(value);

export function ownerKeyOf(session: Session | null): string | null {
    if (!session) return null;
    return `${session.user.companyId ?? 0}:${session.user.id}`;
}

/** Transient 409 codes the server marks as safe to retry (same list as the web queue). */
export const TRANSIENT_CONFLICT_CODES: ReadonlySet<string> = new Set(['CONCURRENT_UPDATE', 'DATABASE_BUSY', 'IDEMPOTENCY_IN_PROGRESS']);

/** True when a failed replay is permanent: 4xx except 408, 429 and transient 409s (mirrors the web rule). */
export function isPermanentSyncFailure(httpStatus: number | undefined, code?: unknown): boolean {
    if (!httpStatus || httpStatus < 400 || httpStatus >= 500) return false;
    if (httpStatus === 408 || httpStatus === 429) return false;
    if (httpStatus === 409 && typeof code === 'string' && TRANSIENT_CONFLICT_CODES.has(code)) return false;
    return true;
}
