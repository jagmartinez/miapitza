import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { getIdempotentAttempt, isAmbiguousMutationFailure, newIdempotencyKey, type IdempotentAttempt } from '@web/utils/idempotency';
import { shouldQueueOfflineMutation } from '@web/services/offlinePolicy';
import type { SessionStore } from '../core/session';
import { TTL, type Cache, type CacheResult } from './cache';
import type { OfflineQueue } from './offlineQueue';
import { isTempOrderId, ownerKeyOf, type QueuedOffline, type SyncOperationType } from './types';

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
/** A server order id, or the temp id of an order created offline that has not synced yet. */
export type OrderRef = number | string;

/** Cached lists that every order/table mutation makes stale. */
const STALE_AFTER_MUTATION = ['/orders/active', '/tables/plan'];

export interface QueueOptions {
    entityTempId?: string;
    dependencyKey?: string;
    forceQueue?: boolean;
    /** Per-batch nonce sent in the body: a new batch is never answered by the replay of an older one. */
    nonce?: string;
}

/** The order exists only in the offline queue; this operation cannot wait for it. */
export class OrderNotSyncedError extends Error {
    constructor(readonly tempId: string) {
        super('El pedido aún no se sincroniza; esta operación requiere conexión');
        this.name = 'OrderNotSyncedError';
    }
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
    /** Changes orders or tables: drop the owner's cached active orders and floor plan once applied. */
    invalidates?: boolean;
};

const MAX_ATTEMPTS_KEPT = 200;

export function createWaiterApi(deps: WaiterApiDeps) {
    const { http, sessions, cache, queue, isOnline } = deps;

    // Keys of ambiguous failures, by action fingerprint, so a retry of the same action reuses its key.
    const attempts = new Map<string, IdempotentAttempt>();

    // Replayed items change orders too: the owner's cached lists must not outlive them.
    queue.onSynced((item) => void cache.invalidate(item.ownerKey, STALE_AFTER_MUTATION));

    async function mutate<T>(spec: Spec): Promise<T | QueuedOffline> {
        const owner = ownerKeyOf(await sessions.load());
        // Scoped by owner so one user's pending retry key is never picked up by another.
        const fingerprint = `${owner ?? '-'} ${spec.method} ${spec.url} ${JSON.stringify(spec.data ?? null)}`;
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
            if (spec.invalidates && owner) await cache.invalidate(owner, STALE_AFTER_MUTATION);
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

    /**
     * Single entry point for every call that takes an order id. A number is used as is. A temp id
     * (order created offline) resolves to the real id once its create synced; until then
     * `pendingTemp` is set and queueable calls wait behind the create.
     */
    async function orderRef(orderId: OrderRef): Promise<{ id: OrderRef; pendingTemp: string | null }> {
        if (typeof orderId !== 'string') return { id: orderId, pendingTemp: null };
        if (/^\d+$/.test(orderId)) return { id: Number(orderId), pendingTemp: null }; // a route param, not a temp id
        if (!isTempOrderId(orderId)) throw new Error('Id de pedido inválido');
        const real = await queue.resolveTemp(orderId);
        return real !== null ? { id: real, pendingTemp: null } : { id: orderId, pendingTemp: orderId };
    }

    /** For operations that need a server id right now (pricing, PIN authorization, transfers, billing). */
    async function syncedOrderId(orderId: OrderRef): Promise<number | string> {
        const ref = await orderRef(orderId);
        if (ref.pendingTemp) throw new OrderNotSyncedError(ref.pendingTemp);
        return ref.id;
    }

    async function cached<T>(url: string, params: Record<string, unknown> | undefined, ttlMs: number, swr: boolean, onRefresh?: (d: T) => void): Promise<CacheResult<T>> {
        const owner = await ownerKey();
        return cache.read<T>({
            ownerKey: owner,
            url,
            params,
            ttlMs,
            swr,
            fetch: () => get<T>(url, params),
            isCurrent: async () => ownerKeyOf(await sessions.load()) === owner,
            onRefresh,
        });
    }

    return {
        // ---- reads (cached) ----
        floorPlan: (branchId: number, onRefresh?: (d: Json) => void) => cached<Json>(`/tables/plan/${branchId}`, undefined, TTL.plan, true, onRefresh),
        activeOrders: (branchId: number) => cached<Json[]>('/orders/active', { branchId }, TTL.orders, false),
        menu: (branchId: number, onRefresh?: (d: Json[]) => void) =>
            cached<Json[]>('/menu-items', { branchId, active: true, effectivePricing: true }, TTL.menu, true, onRefresh),
        /** Live order detail (payments included; /orders/active has none). Never cached. */
        orderDetail: (id: number) => get<Json>(`/orders/${id}`),
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
                invalidates: true,
                queue: { operationType: 'CREATE_ORDER', entityTempId: `order-${Date.now()}-${newIdempotencyKey().replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}` },
            });
        },
        /** `orderId` may be the temp id of an offline-created order: the call waits behind its create. */
        async addItem(orderId: OrderRef, body: NewOrderLine, opts: QueueOptions = {}) {
            const ref = await orderRef(orderId);
            return mutate<Json>({
                method: 'POST',
                url: `/orders/${ref.id}/items`,
                data: body,
                invalidates: true,
                queue: {
                    operationType: 'ADD_ORDER_ITEM',
                    entityTempId: opts.entityTempId,
                    dependencyKey: opts.dependencyKey ?? ref.pendingTemp ?? undefined,
                    forceQueue: opts.forceQueue || !!ref.pendingTemp,
                },
            });
        },
        async sendToKitchen(orderId: OrderRef, opts: QueueOptions = {}) {
            const ref = await orderRef(orderId);
            return mutate<Json>({
                method: 'POST',
                url: `/orders/${ref.id}/send-to-kitchen`,
                // The server ignores unknown body fields; the nonce only changes the idempotency fingerprint.
                data: opts.nonce ? { batchNonce: opts.nonce } : undefined,
                invalidates: true,
                queue: {
                    operationType: 'SEND_TO_KITCHEN',
                    entityTempId: opts.entityTempId,
                    dependencyKey: opts.dependencyKey ?? ref.pendingTemp ?? undefined,
                    forceQueue: opts.forceQueue || !!ref.pendingTemp,
                },
            });
        },
        async createPayment(body: { orderId: OrderRef; paymentMethodId: number; amount: number; reference?: string; payerName?: string }, opts: { legId?: string } = {}) {
            const ref = await orderRef(body.orderId);
            return mutate<Json>({
                method: 'POST',
                url: '/payments',
                data: { ...body, orderId: ref.id },
                invalidates: true,
                queue: {
                    operationType: 'CREATE_PAYMENT',
                    entityTempId: `payment-${ref.id}-${opts.legId ?? newIdempotencyKey().slice(0, 8)}`,
                    dependencyKey: ref.pendingTemp ?? undefined,
                    forceQueue: !!ref.pendingTemp,
                },
            });
        },
        /** Guests can be set on an order that is still only queued; it is applied after the create. */
        async setGuests(orderId: OrderRef, guests: number) {
            const ref = await orderRef(orderId);
            return mutate<Json>({
                method: 'PATCH',
                url: `/orders/${ref.id}/guests`,
                data: { guests },
                invalidates: true,
                queue: ref.pendingTemp ? { operationType: 'GENERIC_MUTATION', dependencyKey: ref.pendingTemp, forceQueue: true } : undefined,
            });
        },

        // ---- mutations (online only) ----
        updateItem: (itemId: number, body: { quantity?: number; notes?: string }) => mutate<Json>({ method: 'PATCH', url: `/orders/items/${itemId}`, data: body, invalidates: true }),
        removeItem: (itemId: number) => mutate<Json>({ method: 'DELETE', url: `/orders/items/${itemId}`, invalidates: true }),
        async deliverItems(orderId: OrderRef, itemIds: number[]) {
            const id = await syncedOrderId(orderId);
            return mutate<{ delivered: number[]; skipped: number[]; alreadyDelivered: number[] }>({ method: 'POST', url: `/orders/${id}/items/deliver`, data: { itemIds }, invalidates: true });
        },
        async transfer(body: { sourceTableId: number; destinationTableId: number; orderId: OrderRef; items?: { orderItemId: number; quantity: number }[]; reason?: string }) {
            const orderId = await syncedOrderId(body.orderId);
            return mutate<Json>({ method: 'POST', url: '/tables/transfer', data: { ...body, orderId }, invalidates: true });
        },
        groupTables: (body: { primaryTableId: number; memberTableIds: number[]; reason?: string }) => mutate<Json>({ method: 'POST', url: '/tables/groups', data: body, invalidates: true }),
        async pricing(orderId: OrderRef, body: PricingBody) {
            const id = await syncedOrderId(orderId);
            return mutate<Json>({ method: 'PATCH', url: `/orders/${id}/pricing`, data: body, invalidates: true });
        },
        async authorizeDiscount(orderId: OrderRef, body: AuthorizeDiscountBody) {
            const id = await syncedOrderId(orderId);
            // Not through mutate(): its retry-key map is keyed by the body, and this body carries the supervisor's PIN,
            // which must live nowhere but the caller's state. The route is never replayed server-side, so every attempt
            // gets a fresh key; it is never queued either.
            const owner = ownerKeyOf(await sessions.load());
            const res = await http.request({ method: 'POST', url: `/orders/${id}/discount/authorize`, data: body, headers: { 'X-Idempotency-Key': newIdempotencyKey() } });
            if (owner) await cache.invalidate(owner, STALE_AFTER_MUTATION);
            return (res.data?.data ?? res.data) as Json;
        },
        async preinvoice(orderId: OrderRef) {
            const id = await syncedOrderId(orderId);
            return mutate<Json>({ method: 'POST', url: `/invoices/${id}/preinvoice` });
        },
        validateCoupon: (body: { code: string; orderTotal: number; branchId?: number; items?: Json[] }) => mutate<Json>({ method: 'POST', url: '/promotions/validate', data: body }),
        async splitEvenly(orderId: OrderRef, numberOfPeople: number) {
            const id = await syncedOrderId(orderId);
            return mutate<Json>({ method: 'POST', url: `/split-bill/${id}/evenly`, data: { numberOfPeople } });
        },
        async splitByItems(orderId: OrderRef, itemAssignments: Json[]) {
            const id = await syncedOrderId(orderId);
            return mutate<Json>({ method: 'POST', url: `/split-bill/${id}/by-items`, data: { itemAssignments } });
        },
        async splitByAmount(orderId: OrderRef, customSplits: { personName: string; amount: number }[]) {
            const id = await syncedOrderId(orderId);
            return mutate<Json>({ method: 'POST', url: `/split-bill/${id}/by-amount`, data: { customSplits } });
        },
        markNotificationSeen: (id: number) => mutate<Json>({ method: 'PATCH', url: `/kitchen-notifications/${id}/seen` }),
    };
}

export type WaiterApi = ReturnType<typeof createWaiterApi>;
