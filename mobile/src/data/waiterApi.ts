import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { getIdempotentAttempt, isAmbiguousMutationFailure, newIdempotencyKey, type IdempotentAttempt } from '@web/utils/idempotency';
import { shouldQueueOfflineMutation } from '@web/services/offlinePolicy';
import type { SessionStore } from '../core/session';
import { TTL, type Cache, type CacheResult } from './cache';
import type { OfflineQueue } from './offlineQueue';
import { appEvents } from '../core/events';
import { isTempOrderId, ownerKeyOf, SessionChangedError, TableHasLocalOrderError, type QueuedOffline, type SyncMeta, type SyncOperationType } from './types';

export { SessionChangedError, TableHasLocalOrderError };

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
    /** The owner (`companyId:userId`) the action started under: once the session is anyone else's the call is refused. */
    owner?: string;
    /** Identity of the user action (one per draft line, one per "open table"): a retry reuses its key, a new action never does. */
    actionId?: string;
    /** What the pending list and the ticket show for this item if it is queued. */
    meta?: SyncMeta;
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
    queue?: { operationType: SyncOperationType; entityTempId?: string; dependencyKey?: string; forceQueue?: boolean; meta?: SyncMeta };
    config?: AxiosRequestConfig;
    /** Changes orders or tables: drop the owner's cached active orders and floor plan once applied. */
    invalidates?: boolean;
    /** Caller-owned idempotency key (one per payment leg): used as is, never taken from or stored in the retry map. */
    key?: string;
    /** Resolve to the whole response body instead of its `data` (a payment answers with the fiscal invoice beside it). */
    raw?: boolean;
    /** The owner the action started under (see QueueOptions.owner). */
    owner?: string;
    /** Part of the retry-key fingerprint, never of the body. */
    actionId?: string;
    /** Once applied, forget the retained keys of this order's other attempts (the batch went to the kitchen: the round is closed). */
    closesOrder?: string;
};

const MAX_ATTEMPTS_KEPT = 200;

export function createWaiterApi(deps: WaiterApiDeps) {
    const { http, sessions, cache, queue, isOnline } = deps;

    // Keys of ambiguous failures, by action fingerprint, so a retry of the same action reuses its key.
    const attempts = new Map<string, IdempotentAttempt>();

    // Replayed items change orders too: the owner's cached lists must not outlive them.
    queue.onSynced((item) => void cache.invalidate(item.ownerKey, STALE_AFTER_MUTATION));

    async function mutate<T>(spec: Spec): Promise<T | QueuedOffline> {
        const session = await sessions.load();
        const owner = ownerKeyOf(session);
        // Work that one user started never continues under another session (lock, PIN switch).
        if (spec.owner !== undefined && spec.owner !== owner) throw new SessionChangedError();
        // Scoped by owner so one user's pending retry key is never picked up by another.
        const prefix = `${owner ?? '-'} ${spec.method} ${spec.url} `;
        const fingerprint = `${prefix}${spec.actionId ?? ''} ${JSON.stringify(spec.data ?? null)}`;
        const attempt = spec.key ? { fingerprint, key: spec.key } : getIdempotentAttempt(attempts.get(fingerprint) ?? null, fingerprint);
        if (!spec.key) attempts.set(fingerprint, attempt);
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
                meta: spec.queue.meta,
                ownerKey: spec.owner,
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
                // The token of the session the call started with: a switch while it is in flight cannot re-bind it.
                headers: { ...(spec.config?.headers as object | undefined), ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), 'X-Idempotency-Key': attempt.key },
            });
            attempts.delete(fingerprint);
            // An applied call settles the earlier attempts at the same route (e.g. quantity 2, then 3: a later "2" is a new action).
            for (const k of [...attempts.keys()]) if (k.startsWith(prefix)) attempts.delete(k);
            if (spec.closesOrder) for (const k of [...attempts.keys()]) if (k.startsWith(`${owner ?? '-'} `) && k.includes(` /orders/${spec.closesOrder}/`)) attempts.delete(k);
            if (spec.invalidates && owner) await cache.invalidate(owner, STALE_AFTER_MUTATION);
            return (spec.raw ? res.data : (res.data?.data ?? res.data)) as T;
        } catch (error) {
            if (session?.token && (error as { response?: { status?: number } } | null)?.response?.status === 401) await expireIfCurrent(session.token);
            // Only an ambiguous failure (network, 5xx, 408/409/429) may have been applied: keep its key.
            if (!isAmbiguousMutationFailure(error)) attempts.delete(fingerprint);
            throw error;
        }
    }

    /** The request carried an explicit token, so the http layer did not track it: a 401 ends the session here. */
    async function expireIfCurrent(token: string): Promise<void> {
        const cur = await sessions.load();
        if (!cur || cur.token !== token) return;
        try {
            await sessions.clear();
        } finally {
            appEvents.emit('session-expired');
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
        /** Generic queued mutation, for features that own their route (customer survey). */
        mutate,
        /** A cached GET for features that own their route (inventory count): network first when `ttlMs` has passed, the cache when the network fails. */
        cachedRead: <T>(url: string, params: Record<string, unknown> | undefined, ttlMs: number): Promise<CacheResult<T>> => cached<T>(url, params, ttlMs, false),
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
        /** `remaining` is what is still owed after active payments and credit notes: the authority for the next leg. */
        paymentSummary: (orderId: number) => get<Json>(`/payments/order/${orderId}/summary`),
        settings: () => get<Json>('/settings'),
        cashShiftStatus: () => get<Json>('/cash-shifts/active-status'),
        kitchenNotifications: (params: { includeAttended?: boolean; limit?: number } = {}) => get<Json[]>('/kitchen-notifications', params),

        // ---- mutations (queueable offline, same four as the web) ----
        async createOrder(body: CreateOrderBody, opts: { owner?: string; actionId?: string; meta?: SyncMeta } = {}) {
            if (body.tableId != null) {
                const held = (await queue.pendingCreates()).find((c) => c.tableId === body.tableId);
                if (held) throw new TableHasLocalOrderError(held.tempId);
            }
            return mutate<Json>({
                method: 'POST',
                url: '/orders',
                data: body,
                owner: opts.owner,
                actionId: opts.actionId,
                invalidates: true,
                queue: { operationType: 'CREATE_ORDER', meta: opts.meta, entityTempId: `order-${Date.now()}-${newIdempotencyKey().replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}` },
            });
        },
        /** `orderId` may be the temp id of an offline-created order: the call waits behind its create. */
        async addItem(orderId: OrderRef, body: NewOrderLine, opts: QueueOptions = {}) {
            const ref = await orderRef(orderId);
            return mutate<Json>({
                method: 'POST',
                url: `/orders/${ref.id}/items`,
                data: body,
                owner: opts.owner,
                actionId: opts.actionId,
                invalidates: true,
                queue: {
                    operationType: 'ADD_ORDER_ITEM',
                    meta: opts.meta,
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
                owner: opts.owner,
                closesOrder: String(ref.id),
                invalidates: true,
                queue: {
                    operationType: 'SEND_TO_KITCHEN',
                    meta: { label: 'Enviar a cocina' },
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
        /**
         * One payment leg, online only. Unlike createPayment it is never queued (a payment is taken with the server's answer
         * in hand: invoice, change, table released) and the caller owns the key, one per leg, kept across retries of that leg.
         */
        async payLeg(body: { orderId: OrderRef; paymentMethodId: number; amount: number; reference?: string; payerName?: string }, idempotencyKey: string, owner?: string) {
            const id = await syncedOrderId(body.orderId);
            return mutate<{ data: Json; fiscalInvoice?: Json | null; fiscalInvoiceError?: string | null }>({
                method: 'POST',
                url: '/payments',
                data: { ...body, orderId: id },
                invalidates: true,
                key: idempotencyKey,
                owner,
                raw: true,
            }) as Promise<{ data: Json; fiscalInvoice?: Json | null; fiscalInvoiceError?: string | null }>;
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
        async pricing(orderId: OrderRef, body: PricingBody, owner?: string) {
            const id = await syncedOrderId(orderId);
            return mutate<Json>({ method: 'PATCH', url: `/orders/${id}/pricing`, data: body, owner, invalidates: true });
        },
        async authorizeDiscount(orderId: OrderRef, body: AuthorizeDiscountBody) {
            const id = await syncedOrderId(orderId);
            // Not through mutate(): its retry-key map is keyed by the body, and this body carries the supervisor's PIN,
            // which must live nowhere but the caller's state. The route is never replayed server-side, so every attempt
            // gets a fresh key; it is never queued either.
            const owner = ownerKeyOf(await sessions.load());
            let res;
            try {
                res = await http.request({ method: 'POST', url: `/orders/${id}/discount/authorize`, data: body, headers: { 'X-Idempotency-Key': newIdempotencyKey() } });
            } catch (error) {
                // The axios error carries the request config, and with it the serialized body (the PIN).
                const config = (error as { config?: { data?: unknown } } | null)?.config;
                if (config) config.data = undefined;
                throw error;
            }
            if (owner) await cache.invalidate(owner, STALE_AFTER_MUTATION);
            return (res.data?.data ?? res.data) as Json;
        },
        async updateFiscalCustomer(orderId: OrderRef, body: { customerName?: string; customerTaxId?: string; customerTaxIdType?: string; customerFiscalAddress?: string; customerEmail?: string; customerPhone?: string }, owner?: string) {
            const id = await syncedOrderId(orderId);
            return mutate<Json>({ method: 'PATCH', url: `/orders/${id}/fiscal-customer`, data: body, owner, invalidates: true });
        },
        async preinvoice(orderId: OrderRef, owner?: string) {
            const id = await syncedOrderId(orderId);
            return mutate<Json>({ method: 'POST', url: `/invoices/${id}/preinvoice`, owner });
        },
        /**
         * The invoice PDF of an order (GET /invoices/:orderId/pdf: the id is the ORDER id; the server needs `invoices.view`).
         * Online only, never queued; the answer is refused if the session changed while it downloaded.
         */
        async invoicePdf(orderId: OrderRef): Promise<Blob> {
            if (!isOnline()) throw new Error('Requiere conexión');
            const id = await syncedOrderId(orderId);
            const owner = ownerKeyOf(await sessions.load());
            const res = await http.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
            if (ownerKeyOf(await sessions.load()) !== owner) throw new SessionChangedError();
            return res.data as Blob;
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
