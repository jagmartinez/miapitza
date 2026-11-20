import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { getIdempotentAttempt, isAmbiguousMutationFailure, newIdempotencyKey, type IdempotentAttempt } from '@web/utils/idempotency';
import { shouldQueueOfflineMutation } from '@web/services/offlinePolicy';
import type { SessionStore } from '../core/session';
import { TTL, type Cache, type CacheResult } from './cache';
import type { OfflineQueue } from './offlineQueue';
import { ownerKeyOf, type QueuedOffline, type SyncOperationType } from './types';

export interface WaiterApiDeps {
    http: AxiosInstance;
    sessions: SessionStore;
    cache: Cache;
    queue: OfflineQueue;
    isOnline: () => boolean;
}

/** Loosely typed server payloads; screens narrow what they use. */
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface NewOrderLine {
    menuItemId: number;
    quantity: number;
    notes?: string;
    modifierIds?: number[];
}
export interface CreateOrderBody {
    tableId?: number;
    orderType?: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
    guests?: number;
    items?: NewOrderLine[];
    [extra: string]: unknown;
}
export interface PricingBody {
    discount?: number;
    discountCode?: string | null;
    discountReason?: string;
    tipAmount?: number;
}
export interface AuthorizeDiscountBody {
    supervisorUserId: number;
    pin: string;
    discount: number;
    discountReason: string;
}
export interface QueueOptions {
    entityTempId?: string;
    dependencyKey?: string;
    forceQueue?: boolean;
}

export function isQueuedOffline(value: unknown): value is QueuedOffline {
    return !!value && typeof value === 'object' && (value as QueuedOffline)._offline === true;
}

type Spec = {
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    data?: unknown;
    /** Present only for the four operations the web also queues. */
    queue?: { operationType: SyncOperationType; entityTempId?: string; dependencyKey?: string; forceQueue?: boolean };
    config?: AxiosRequestConfig;
};

const MAX_ATTEMPTS_KEPT = 200;

export function createWaiterApi(deps: WaiterApiDeps) {
    const { http, sessions, cache, queue, isOnline } = deps;

    // Keys of ambiguous failures, by action fingerprint, so a retry of the same action reuses its key.
    const attempts = new Map<string, IdempotentAttempt>();

    async function mutate<T>(spec: Spec): Promise<T | QueuedOffline> {
        const fingerprint = `${spec.method} ${spec.url} ${JSON.stringify(spec.data ?? null)}`;
        const attempt = getIdempotentAttempt(attempts.get(fingerprint) ?? null, fingerprint);
        attempts.set(fingerprint, attempt);
        if (attempts.size > MAX_ATTEMPTS_KEPT) attempts.delete(attempts.keys().next().value as string);

        if (spec.queue && (spec.queue.forceQueue || shouldQueueOfflineMutation(spec.method, isOnline(), false, true))) {
            const item = await queue.enqueue({
                url: spec.url,
                method: spec.method,
                data: spec.data,
                operationType: spec.queue.operationType,
                entityTempId: spec.queue.entityTempId,
                dependencyKey: spec.queue.dependencyKey,
                idempotencyKey: attempt.key,
            });
            attempts.delete(fingerprint);
            if (isOnline()) void queue.process();
            return { success: true, _offline: true, entityTempId: item.entityTempId ?? null, queueId: item.id! };
        }

        try {
            const res = await http.request({
                ...spec.config,
                method: spec.method,
                url: spec.url,
                data: spec.data,
                headers: { ...(spec.config?.headers as object | undefined), 'X-Idempotency-Key': attempt.key },
            });
            attempts.delete(fingerprint);
            return (res.data?.data ?? res.data) as T;
        } catch (error) {
            // Only an ambiguous failure (network, 5xx, 408/409/429) may have been applied: keep its key.
            if (!isAmbiguousMutationFailure(error)) attempts.delete(fingerprint);
            throw error;
        }
    }

    async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
        const res = await http.get(url, { params });
        return (res.data?.data ?? res.data) as T;
    }

    async function ownerKey(): Promise<string> {
        const key = ownerKeyOf(await sessions.load());
        if (!key) throw new Error('No hay sesión activa');
        return key;
    }

    async function cached<T>(url: string, params: Record<string, unknown> | undefined, ttlMs: number, swr: boolean, onRefresh?: (d: T) => void): Promise<CacheResult<T>> {
        return cache.read<T>({ ownerKey: await ownerKey(), url, params, ttlMs, swr, fetch: () => get<T>(url, params), onRefresh });
    }

    return {
        // ---- reads (cached) ----
        floorPlan: (branchId: number, onRefresh?: (d: Json) => void) => cached<Json>(`/tables/plan/${branchId}`, undefined, TTL.plan, true, onRefresh),
        activeOrders: (branchId: number) => cached<Json[]>('/orders/active', { branchId }, TTL.orders, false),
        menu: (branchId: number, onRefresh?: (d: Json[]) => void) =>
            cached<Json[]>('/menu-items', { branchId, active: true, effectivePricing: true }, TTL.menu, true, onRefresh),
        menuItem: (id: number) => cached<Json>(`/menu-items/${id}`, undefined, TTL.menu, false),
        categories: () => cached<Json[]>('/categories', undefined, TTL.categories, false),
        topSellers: (branchId: number, opts: { days?: number; limit?: number } = {}) => cached<Json[]>('/menu-items/top', { branchId, ...opts }, TTL.default, false),
        promotions: (branchId: number) => cached<Json[]>('/promotions', { activeOnly: true, availableNow: true, branchId }, TTL.default, false),

        // ---- reads (never cached: sensitive or must be live) ----
        supervisors: () => get<Json[]>('/orders/discount/supervisors'),
        discountLimit: () => get<{ limitPercent: number }>('/auth/me/discount-limit'),
        paymentMethods: () => get<Json[]>('/payments/methods'),
        cashShiftStatus: () => get<Json>('/cash-shifts/active-status'),
        kitchenNotifications: (params: { includeAttended?: boolean; limit?: number } = {}) => get<Json[]>('/kitchen-notifications', params),

        // ---- mutations (queueable offline, same four as the web) ----
        createOrder(body: CreateOrderBody) {
            return mutate<Json>({
                method: 'POST',
                url: '/orders',
                data: body,
                queue: { operationType: 'CREATE_ORDER', entityTempId: `order-${Date.now()}-${newIdempotencyKey().slice(0, 8)}` },
            });
        },
        addItem(orderId: number, body: NewOrderLine, opts: QueueOptions = {}) {
            return mutate<Json>({
                method: 'POST',
                url: `/orders/${orderId}/items`,
                data: body,
                queue: { operationType: 'ADD_ORDER_ITEM', entityTempId: opts.entityTempId, dependencyKey: opts.dependencyKey, forceQueue: opts.forceQueue },
            });
        },
        sendToKitchen(orderId: number, opts: QueueOptions = {}) {
            return mutate<Json>({
                method: 'POST',
                url: `/orders/${orderId}/send-to-kitchen`,
                queue: { operationType: 'SEND_TO_KITCHEN', entityTempId: opts.entityTempId, dependencyKey: opts.dependencyKey, forceQueue: opts.forceQueue },
            });
        },
        createPayment(body: { orderId: number; paymentMethodId: number; amount: number; reference?: string; payerName?: string }, opts: { legId?: string } = {}) {
            return mutate<Json>({
                method: 'POST',
                url: '/payments',
                data: body,
                queue: { operationType: 'CREATE_PAYMENT', entityTempId: `payment-${body.orderId}-${opts.legId ?? newIdempotencyKey().slice(0, 8)}` },
            });
        },

        // ---- mutations (online only) ----
        updateItem: (itemId: number, body: { quantity?: number; notes?: string }) => mutate<Json>({ method: 'PATCH', url: `/orders/items/${itemId}`, data: body }),
        removeItem: (itemId: number) => mutate<Json>({ method: 'DELETE', url: `/orders/items/${itemId}` }),
        deliverItems: (orderId: number, itemIds: number[]) =>
            mutate<{ delivered: number[]; skipped: number[]; alreadyDelivered: number[] }>({ method: 'POST', url: `/orders/${orderId}/items/deliver`, data: { itemIds } }),
        setGuests: (orderId: number, guests: number) => mutate<Json>({ method: 'PATCH', url: `/orders/${orderId}/guests`, data: { guests } }),
        transfer: (body: { sourceTableId: number; destinationTableId: number; orderId: number; items?: { orderItemId: number; quantity: number }[]; reason?: string }) =>
            mutate<Json>({ method: 'POST', url: '/tables/transfer', data: body }),
        groupTables: (body: { primaryTableId: number; memberTableIds: number[]; reason?: string }) => mutate<Json>({ method: 'POST', url: '/tables/groups', data: body }),
        pricing: (orderId: number, body: PricingBody) => mutate<Json>({ method: 'PATCH', url: `/orders/${orderId}/pricing`, data: body }),
        authorizeDiscount: (orderId: number, body: AuthorizeDiscountBody) => mutate<Json>({ method: 'POST', url: `/orders/${orderId}/discount/authorize`, data: body }),
        preinvoice: (orderId: number) => mutate<Json>({ method: 'POST', url: `/invoices/${orderId}/preinvoice` }),
        validateCoupon: (body: { code: string; orderTotal: number; branchId?: number; items?: Json[] }) => mutate<Json>({ method: 'POST', url: '/promotions/validate', data: body }),
        splitEvenly: (orderId: number, numberOfPeople: number) => mutate<Json>({ method: 'POST', url: `/split-bill/${orderId}/evenly`, data: { numberOfPeople } }),
        splitByItems: (orderId: number, itemAssignments: Json[]) => mutate<Json>({ method: 'POST', url: `/split-bill/${orderId}/by-items`, data: { itemAssignments } }),
        splitByAmount: (orderId: number, customSplits: { personName: string; amount: number }[]) =>
            mutate<Json>({ method: 'POST', url: `/split-bill/${orderId}/by-amount`, data: { customSplits } }),
        markNotificationSeen: (id: number) => mutate<Json>({ method: 'PATCH', url: `/kitchen-notifications/${id}/seen` }),
    };
}

export type WaiterApi = ReturnType<typeof createWaiterApi>;
