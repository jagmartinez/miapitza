import Dexie, { Table } from 'dexie';

export interface CacheEntry {
    id: string; // ownerKey + URL
    url: string;
    ownerKey: string;
    data: unknown;
    timestamp: number;
}

export type SyncOperationType =
    | 'CREATE_ORDER'
    | 'ADD_ORDER_ITEM'
    | 'SEND_TO_KITCHEN'
    | 'CREATE_PAYMENT'
    | 'GENERIC_MUTATION';

export type SyncStatus =
    | 'pending'
    | 'blocked'
    | 'processing'
    | 'failed';

export interface SyncItem {
    id?: number;
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
    ownerKey: string;
}

export class RestaurantDB extends Dexie {
    caches!: Table<CacheEntry, string>;
    syncQueue!: Table<SyncItem, number>;

    constructor() {
        super('RestaurantDB');
        this.version(1).stores({
            caches: 'id, timestamp',
            syncQueue: '++id, timestamp'
        });
        this.version(2).stores({
            caches: 'id, timestamp',
            syncQueue: '++id, status, timestamp, operationType, dependencyKey, entityTempId'
        }).upgrade(async (tx) => {
            await tx.table('syncQueue').toCollection().modify((item: Partial<SyncItem>) => {
                item.operationType = item.operationType || 'GENERIC_MUTATION';
                item.status = item.status || 'pending';
                item.retryCount = typeof item.retryCount === 'number' ? item.retryCount : 0;
                item.dependencyKey = item.dependencyKey ?? null;
                item.entityTempId = item.entityTempId ?? null;
                item.lastError = item.lastError ?? null;
            });
        });
        this.version(3).stores({
            caches: 'id, timestamp',
            syncQueue: '++id, status, timestamp, operationType, dependencyKey, entityTempId, idempotencyKey'
        }).upgrade(async (tx) => {
            await tx.table('syncQueue').toCollection().modify((item: Partial<SyncItem>) => {
                item.idempotencyKey = item.idempotencyKey ?? null;
            });
        });
        this.version(4).stores({
            caches: 'id, ownerKey, url, timestamp',
            syncQueue: '++id, ownerKey, status, timestamp, operationType, dependencyKey, entityTempId, idempotencyKey'
        });
    }
}

export const db = new RestaurantDB();
