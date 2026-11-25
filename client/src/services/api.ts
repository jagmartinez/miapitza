import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import type {
    LoginResponse,
    MenuRecipe,
    MenuRecipeCreateInput,
    MenuRecipeUpdateInput,
} from '../types';
import { db, type SyncItem } from './db';
import { offlineManager } from './offlineManager';
import { shouldQueueOfflineMutation } from './offlinePolicy';
import { closeWebSocket } from '../utils/websocket';
import { resolveApiBaseUrl } from '../utils/runtime-routing';

type OfflineRequestMeta = Pick<SyncItem, 'operationType' | 'dependencyKey' | 'entityTempId'>;

declare module 'axios' {
    export interface AxiosRequestConfig {
        offlineMeta?: OfflineRequestMeta;
        /** Sensitive GETs (for example payroll receipts) must never enter IndexedDB or use stale fallback data. */
        skipOfflineCache?: boolean;
    }
}

const CSRF_STORAGE_KEY = 'csrf_token';

const readCsrfFromCookie = (): string | null => {
    const raw = document.cookie
        .split('; ')
        .find((c) => c.startsWith('csrf_token='))
        ?.split('=')[1];
    return raw ? decodeURIComponent(raw) : null;
};

const getStoredCsrfToken = (): string | null => {
    try {
        return sessionStorage.getItem(CSRF_STORAGE_KEY);
    } catch {
        return null;
    }
};

const storeCsrfToken = (token: string): void => {
    try {
        sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    } catch {
        // sessionStorage unavailable — cookie/header path still used per request
    }
};

const captureCsrfFromHeaders = (headers: Record<string, unknown> | undefined): void => {
    const token = headers?.['x-csrf-token'];
    if (typeof token === 'string' && token.length > 0) {
        storeCsrfToken(token);
    }
};

const resolveCsrfToken = async (): Promise<string | null> => {
    const existing = getStoredCsrfToken() || readCsrfFromCookie();
    if (existing) {
        return existing;
    }

    try {
        const health = await api.get('/health');
        captureCsrfFromHeaders(health.headers as Record<string, unknown>);
        return getStoredCsrfToken() || readCsrfFromCookie();
    } catch {
        return null;
    }
};

export const normalizeApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_URL as string | undefined;
    const sameOriginProxy = import.meta.env.VITE_API_PROXY_ENABLED === 'true';
    return resolveApiBaseUrl(
        envUrl,
        sameOriginProxy,
        typeof window !== 'undefined' ? window.location : undefined,
    );
};

/** Resolved base URL shared with the offline sync queue so queued mutations hit the same server. */
export const API_BASE_URL = normalizeApiBaseUrl();

/**
 * Build a stable cache key from an axios request's path + sorted query string.
 * Without the query string, filtered GET endpoints (e.g. `/orders?startDate=...`,
 * `/reports/*`, `/tables?branchId=...`) would all collide on the same cache id.
 */
export const buildCacheKey = (config: { url?: string; params?: unknown }): string => {
    const url = config.url || '';
    const params = config.params;
    if (!params || typeof params !== 'object') {
        return url;
    }
    const entries = Object.entries(params as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => [key, String(value)] as [string, string])
        .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
        return url;
    }
    const query = entries
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    return `${url}?${query}`;
};

const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

/** Drop stale GET cache entries after a mutation so lists refresh correctly. */
export async function invalidateApiCacheForPath(pathPrefix: string): Promise<void> {
    try {
        const entries = await db.caches.toArray();
        await Promise.all(
            entries
                .filter((e) => e.ownerKey && (e.url === pathPrefix || e.url.startsWith(`${pathPrefix}?`)))
                .map((e) => db.caches.delete(e.id))
        );
    } catch {
        // IndexedDB unavailable — non-critical
    }
}

// Request interceptor to handle offline mutations
api.interceptors.request.use(
    async (config) => {
        const requestConfig = config as InternalAxiosRequestConfig;
        const url = requestConfig.url || '';
        const isAuthRequest = url.startsWith('/auth/');
        // CSRF: sessionStorage (cross-origin) or cookie (same-origin) on mutations
        if (requestConfig.method !== 'get' && requestConfig.method !== 'GET') {
            const csrfToken = await resolveCsrfToken();
            if (csrfToken) {
                requestConfig.headers['x-csrf-token'] = csrfToken;
            }
        }

        // Only mutations whose caller supplies an explicit replay contract may be
        // queued. Treating every offline mutation as a synthetic success can make
        // destructive/admin workflows appear committed when they were not.
        if (shouldQueueOfflineMutation(
            requestConfig.method,
            offlineManager.getStatus(),
            isAuthRequest,
            Boolean(requestConfig.offlineMeta),
        )) {
            await offlineManager.enqueueRequest({
                url,
                method: (requestConfig.method?.toUpperCase() as SyncItem['method']) || 'POST',
                data: requestConfig.data,
                operationType: requestConfig.offlineMeta?.operationType || 'GENERIC_MUTATION',
                dependencyKey: requestConfig.offlineMeta?.dependencyKey || null,
                entityTempId: requestConfig.offlineMeta?.entityTempId || null,
            });

            // The response interceptor exposes `_offline`; opted-in callers must
            // present it as pending rather than as a server-confirmed mutation.
            return Promise.reject({
                isOfflineQueue: true,
                config: requestConfig,
                message: 'Petición encolada para sincronización offline'
            });
        }

        return requestConfig;
    },
    (error) => Promise.reject(error)
);

// Response interceptor for error handling and caching
api.interceptors.response.use(
    async (response) => {
        captureCsrfFromHeaders(response.headers as Record<string, unknown>);

        // Cache successful GET responses (skip auth endpoints and binary responses)
        const method = response.config.method?.toLowerCase();
        const url = response.config.url || '';
        const isBinaryResponse = response.config.responseType === 'arraybuffer'
            || response.config.responseType === 'blob';
        if (method === 'get' && !url.startsWith('/auth/') && !isBinaryResponse && !response.config.skipOfflineCache) {
            try {
                await offlineManager.putCachedData(buildCacheKey(response.config), response.data);
            } catch {
                // IndexedDB quota exceeded or unavailable — non-critical
            }
        }

        if (method && method !== 'get' && (url === '/products' || url.startsWith('/products/'))) {
            await invalidateApiCacheForPath('/products');
        }

        return response;
    },
    async (error) => {
        // Handle special offline queue error
        if (error.isOfflineQueue) {
            return {
                data: { success: true, _offline: true, message: error.message },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: error.config
            };
        }

        if (error.response?.status === 401) {
            const requestUrl = error.config?.url || '';
            const isLoginRequest = requestUrl.startsWith('/auth/login');
            const isOnLoginPage = window.location.pathname === '/login';

            // Tear down auth state consistently with logout: kill the socket first,
            // then clear persisted auth before redirecting.
            closeWebSocket();
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('authFlags');
            try {
                sessionStorage.removeItem(CSRF_STORAGE_KEY);
            } catch {
                // sessionStorage unavailable — ignore
            }

            if (!isLoginRequest && !isOnLoginPage) {
                window.location.href = '/login';
            }
        }

        // Handle GET failure due to network (offline fallback with TTL check)
        if (!error.response && !error.config?.skipOfflineCache && (error.config?.method === 'get' || error.config?.method === 'GET')) {
            const cacheKey = buildCacheKey(error.config);
            const cachedData = await offlineManager.getCachedData(cacheKey);
            if (cachedData !== null) {
                return {
                    data: cachedData,
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: error.config,
                    _fromCache: true
                };
            }
        }

        return Promise.reject(error);
    }
);

// Auth API
export const authAPI = {
    login: (username: string, password: string, twoFactorCode?: string) =>
        api.post<LoginResponse>('/auth/login', { username, password, twoFactorCode }),

    register: (data: Record<string, unknown>) =>
        api.post('/auth/register', data),

    /** Verify current token is still valid */
    me: () => api.get('/auth/me'),

    changePassword: (oldPassword: string, newPassword: string) =>
        api.post('/auth/change-password', { oldPassword, newPassword }),

    logout: () => api.post('/auth/logout'),

    // Sessions
    getSessions: () => api.get('/auth/sessions'),
    revokeSession: (id: string) => api.delete(`/auth/sessions/${id}`),
    revokeAllSessions: () => api.delete('/auth/sessions'),

    // 2FA
    setup2FA: () => api.post('/auth/2fa/setup'),
    verify2FA: (code: string) => api.post('/auth/2fa/verify', { code }),
    disable2FA: (code: string) => api.post('/auth/2fa/disable', { code }),
};

// Tables API
export const tablesAPI = {
    getAll: (branchId?: number) =>
        api.get('/tables', { params: { branchId } }),

    getById: (id: number) =>
        api.get(`/tables/${id}`),

    updateStatus: (id: number, status: string) =>
        api.patch(`/tables/${id}/status`, { status }),

    create: (data: Record<string, unknown>) =>
        api.post('/tables', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/tables/${id}`, data),

    delete: (id: number) =>
        api.delete(`/tables/${id}`),

    updateLayout: (branchId: number, tables: Array<Record<string, unknown>>, idempotencyKey: string) =>
        api.put('/tables/layout', { branchId, tables }, { headers: { 'X-Idempotency-Key': idempotencyKey } }),

    getFloorPlan: (branchId: number) =>
        api.get(`/tables/plan/${branchId}`),

    updateFloorPlan: (branchId: number, data: Record<string, unknown>, idempotencyKey: string) =>
        api.put(`/tables/plan/${branchId}`, data, { headers: { 'X-Idempotency-Key': idempotencyKey } }),

    consolidate: (data: Record<string, unknown>, idempotencyKey: string) =>
        api.post('/tables/consolidate', data, { headers: { 'X-Idempotency-Key': idempotencyKey } }),

    transfer: (data: Record<string, unknown>, idempotencyKey: string) =>
        api.post('/tables/transfer', data, { headers: { 'X-Idempotency-Key': idempotencyKey } }),
};

// Menu API
export const menuAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/menu-items', { params }),

    getById: (id: number) =>
        api.get(`/menu-items/${id}`),

    create: (data: Record<string, unknown>) =>
        api.post('/menu-items', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/menu-items/${id}`, data),

    delete: (id: number) =>
        api.delete(`/menu-items/${id}`),

    // Recipes
    getRecipes: (id: number) =>
        api.get<{ success: boolean; data: MenuRecipe[] }>(`/menu-items/${id}/recipes`),

    addRecipe: (id: number, data: MenuRecipeCreateInput) =>
        api.post<{ success: boolean; data: MenuRecipe }>(`/menu-items/${id}/recipes`, data),

    updateRecipe: (recipeId: number, data: MenuRecipeUpdateInput) =>
        api.put<{ success: boolean; data: MenuRecipe }>(`/menu-items/recipes/${recipeId}`, data),

    replaceRecipes: (id: number, recipes: MenuRecipeCreateInput[], menuItem?: Record<string, unknown>) =>
        api.put<{ success: boolean; data: { menuItem: Record<string, unknown>; recipes: MenuRecipe[] } }>(
            `/menu-items/${id}/recipes`,
            { recipes, ...(menuItem ? { menuItem } : {}) }
        ),

    deleteRecipe: (recipeId: number) =>
        api.delete(`/menu-items/recipes/${recipeId}`),

    // Images
    getImages: (id: number) =>
        api.get(`/menu-items/${id}/images`),

    addImage: (id: number, imageUrl: string) =>
        api.post(`/menu-items/${id}/images`, { imageUrl }),

    deleteImage: (imageId: number) =>
        api.delete(`/menu-items/images/${imageId}`),
};

// Orders API
export const ordersAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/orders', { params }),

    getById: (id: number) =>
        api.get(`/orders/${id}`),

    create: (
        data: Record<string, unknown>,
        offlineMeta?: Pick<SyncItem, 'operationType' | 'dependencyKey' | 'entityTempId'>
    ) =>
        api.post('/orders', data, { offlineMeta }),

    addItem: (
        orderId: number,
        data: Record<string, unknown>,
        offlineMeta?: Pick<SyncItem, 'operationType' | 'dependencyKey' | 'entityTempId'>
    ) =>
        api.post(`/orders/${orderId}/items`, data, { offlineMeta }),

    removeItem: (itemId: number) =>
        api.delete(`/orders/items/${itemId}`),

    sendToKitchen: (
        orderId: number,
        offlineMeta?: Pick<SyncItem, 'operationType' | 'dependencyKey' | 'entityTempId'>
    ) =>
        api.post(`/orders/${orderId}/send-to-kitchen`, undefined, { offlineMeta }),

    complete: (orderId: number, warehouseId: number) =>
        api.post(`/orders/${orderId}/complete`, { warehouseId }),

    getActive: (branchId?: number) =>
        api.get('/orders/active', { params: { branchId } }),

    getKitchenConfig: () => api.get('/orders/kitchen/config'),

    getKitchenQueue: (branchId?: number) =>
        api.get('/orders/kitchen/queue', { params: { branchId } }),

    getKitchenHistory: (params?: { branchId?: number; limit?: number }) =>
        api.get('/orders/kitchen/history', { params }),

    startKitchenPreparation: (orderId: number) =>
        api.post(`/orders/${orderId}/kitchen/start`),

    markKitchenReady: (orderId: number) =>
        api.post(`/orders/${orderId}/kitchen/ready`),

    releaseKitchenOrder: (orderId: number) =>
        api.post(`/orders/${orderId}/kitchen/release`),

    updateStatus: (id: number, status: string) =>
        api.patch(`/orders/${id}/status`, { status }),

    updatePricing: (id: number, data: Record<string, unknown>) =>
        api.patch(`/orders/${id}/pricing`, data),

    updateFiscalCustomer: (id: number, data: Record<string, unknown>) =>
        api.patch(`/orders/${id}/fiscal-customer`, data),

    cancel: (id: number, cancelReason?: string, warehouseId?: number) =>
        api.post(`/orders/${id}/cancel`, { cancelReason, ...(warehouseId ? { warehouseId } : {}) }),

    startItem: (orderId: number, itemId: number) =>
        api.patch(`/orders/${orderId}/items/${itemId}/start`),

    finishItem: (orderId: number, itemId: number) =>
        api.patch(`/orders/${orderId}/items/${itemId}/finish`),

    reportProblem: (orderId: number, description: string) =>
        api.post(`/orders/${orderId}/report-problem`, { description }),
};

export const invoicesAPI = {
    issue: (orderId: number) => api.post(`/invoices/${orderId}/issue`),

    getData: (orderId: number) => api.get(`/invoices/${orderId}`),

    downloadPdf: (orderId: number) =>
        api.get(`/invoices/${orderId}/pdf`, { responseType: 'blob' }),

    cancel: (orderId: number, data: { idempotencyKey: string; reason: string; wasteWarehouseId?: number }) =>
        api.post(`/invoices/${orderId}/cancel`, data),

    getCancellation: (orderId: number) => api.get(`/invoices/${orderId}/cancellation`),

    downloadCancellationPdf: (orderId: number) =>
        api.get(`/invoices/${orderId}/cancellation/pdf`, { responseType: 'blob' }),

    issueCreditNote: (orderId: number, data: {
        idempotencyKey: string;
        reason: string;
        inventoryAction: 'NO_RETURN' | 'RETURN_TO_STOCK';
        externalRefunds: Array<{ paymentId: number; reference: string }>;
        lines?: Array<{ orderItemId: number; quantity: number }>;
    }) => api.post(`/invoices/${orderId}/credit-note`, data),

    getCreditNote: (orderId: number) => api.get(`/invoices/${orderId}/credit-note`),

    downloadCreditNotePdf: (orderId: number) =>
        api.get(`/invoices/${orderId}/credit-note/pdf`, { responseType: 'blob' }),

    listCreditNotes: (params?: Record<string, unknown>) => api.get('/invoices/credit-notes', { params }),

    getCreditNoteById: (creditNoteId: number) => api.get(`/invoices/credit-notes/${creditNoteId}`),

    downloadCreditNotePdfById: (creditNoteId: number) =>
        api.get(`/invoices/credit-notes/${creditNoteId}/pdf`, { responseType: 'blob' }),

    listCancellations: (params?: Record<string, unknown>) => api.get('/invoices/cancellations', { params }),
};

// Products API
export const productsAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/products', { params }),

    getLowStock: () =>
        api.get('/products/low-stock'),

    getById: (id: number) =>
        api.get(`/products/${id}`),

    create: (data: Record<string, unknown>) =>
        api.post('/products', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/products/${id}`, data),

    delete: (id: number) =>
        api.delete(`/products/${id}`),

    getImportTemplate: () =>
        api.get('/products/import/template', { responseType: 'arraybuffer' }),

    validateImport: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/products/import/validate', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
    },

    confirmImport: (items: unknown[]) =>
        api.post('/products/import/confirm', { items }),
};

// Production Recipes (BOM) API
export const productionRecipesAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/production-recipes', { params }),
    getById: (id: number) =>
        api.get(`/production-recipes/${id}`),
    getByProduct: (productId: number) =>
        api.get(`/production-recipes/product/${productId}`),
    previewCost: (data: Record<string, unknown>) =>
        api.post('/production-recipes/preview-cost', data),
    create: (data: Record<string, unknown>) =>
        api.post('/production-recipes', data),
    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/production-recipes/${id}`, data),
    setStatus: (id: number, status: string) =>
        api.patch(`/production-recipes/${id}/status`, { status }),
    createVersion: (id: number) =>
        api.post(`/production-recipes/${id}/version`),
    delete: (id: number) =>
        api.delete(`/production-recipes/${id}`),
};

// Production Orders API
export const productionOrdersAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/production-orders', { params }),
    getById: (id: number) =>
        api.get(`/production-orders/${id}`),
    preview: (data: Record<string, unknown>) =>
        api.post('/production-orders/preview', data),
    create: (data: Record<string, unknown>) =>
        api.post('/production-orders', data),
    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/production-orders/${id}`, data),
    setStatus: (id: number, status: string) =>
        api.patch(`/production-orders/${id}/status`, { status }),
    finish: (id: number, data: Record<string, unknown>) =>
        api.post(`/production-orders/${id}/finish`, data),
    cancel: (id: number, reason: string) =>
        api.post(`/production-orders/${id}/cancel`, { reason }),
};

// Production Reports API
export const productionReportsAPI = {
    getDashboard: (params?: Record<string, unknown>) =>
        api.get('/reports/production/dashboard', { params }),
    getProductions: (params?: Record<string, unknown>) =>
        api.get('/reports/production/productions', { params }),
    getInputConsumption: (params?: Record<string, unknown>) =>
        api.get('/reports/production/input-consumption', { params }),
    getPlanVsReal: (params?: Record<string, unknown>) =>
        api.get('/reports/production/plan-vs-real', { params }),
    getProducedKardex: (params?: Record<string, unknown>) =>
        api.get('/reports/production/produced-kardex', { params }),
    getProfitability: (params?: Record<string, unknown>) =>
        api.get('/reports/production/profitability', { params }),
    getTraceability: (orderId: number) =>
        api.get(`/reports/production/traceability/${orderId}`),
};

// Categories API
export const categoriesAPI = {
    getAll: () =>
        api.get('/categories'),

    getById: (id: number) =>
        api.get(`/categories/${id}`),

    create: (data: Record<string, unknown>) =>
        api.post('/categories', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/categories/${id}`, data),

    delete: (id: number) =>
        api.delete(`/categories/${id}`),

    ensureDefaults: () =>
        api.post('/categories/ensure-defaults'),
};

// Menu Brands (marcas) API
export const menuBrandsAPI = {
    getAll: () =>
        api.get('/menu-brands'),

    create: (data: Record<string, unknown>) =>
        api.post('/menu-brands', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/menu-brands/${id}`, data),

    delete: (id: number) =>
        api.delete(`/menu-brands/${id}`),
};

// Modifiers API (grupos de modificadores + modificadores con vínculo de inventario)
export const modifiersAPI = {
    getAllGroups: () =>
        api.get('/modifiers/groups'),

    createGroup: (data: Record<string, unknown>) =>
        api.post('/modifiers/groups', data),

    updateGroup: (id: number, data: Record<string, unknown>) =>
        api.put(`/modifiers/groups/${id}`, data),

    createModifier: (data: Record<string, unknown>) =>
        api.post('/modifiers/modifiers', data),

    updateModifier: (id: number, data: Record<string, unknown>) =>
        api.put(`/modifiers/modifiers/${id}`, data),

    deleteModifier: (id: number) =>
        api.delete(`/modifiers/modifiers/${id}`),

    assignGroupToMenuItem: (menuItemId: number, groupId: number) =>
        api.post('/modifiers/assign', { menuItemId, groupId }),

    removeGroupFromMenuItem: (menuItemId: number, groupId: number) =>
        api.post('/modifiers/remove', { menuItemId, groupId }),
};

// Warehouses API
export const warehousesAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/warehouses', { params }),
    getById: (id: number) =>
        api.get(`/warehouses/${id}`),
    getStock: (id: number) =>
        api.get(`/warehouses/${id}/stock`),
    create: (data: Record<string, unknown>) =>
        api.post('/warehouses', data),
    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/warehouses/${id}`, data),
    delete: (id: number) =>
        api.delete(`/warehouses/${id}`),
};

// Branches API
export const branchesAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/branches', { params }),

    getById: (id: number) =>
        api.get(`/branches/${id}`),

    create: (data: Record<string, unknown>) =>
        api.post('/branches', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/branches/${id}`, data),

    delete: (id: number) =>
        api.delete(`/branches/${id}`),
};

// Suppliers API
export const suppliersAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/suppliers', { params }),

    getById: (id: number) =>
        api.get(`/suppliers/${id}`),

    create: (data: Record<string, unknown>) =>
        api.post('/suppliers', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/suppliers/${id}`, data),

    delete: (id: number) =>
        api.delete(`/suppliers/${id}`),

    getPriceHistory: (id: number, params?: Record<string, unknown>) =>
        api.get(`/suppliers/${id}/price-history`, { params }),
};

// Purchase Orders API
export const purchaseOrdersAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/purchase-orders', { params }),

    getById: (id: number) =>
        api.get(`/purchase-orders/${id}`),

    getInvoice: (id: number) =>
        api.get(`/purchase-orders/${id}/invoice`, { responseType: 'blob' }),

    create: (data: Record<string, unknown> | FormData) => {
        if (data instanceof FormData) {
            return api.post('/purchase-orders', data, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        }
        return api.post('/purchase-orders', data);
    },

    update: (id: number, data: Record<string, unknown> | FormData) => {
        if (data instanceof FormData) {
            return api.put(`/purchase-orders/${id}`, data, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        }
        return api.put(`/purchase-orders/${id}`, data);
    },

    delete: (id: number) =>
        api.delete(`/purchase-orders/${id}`),

    addItem: (orderId: number, data: Record<string, unknown>) =>
        api.post(`/purchase-orders/${orderId}/items`, data),

    removeItem: (itemId: number) =>
        api.delete(`/purchase-orders/items/${itemId}`),

    receive: (id: number, warehouseId: number) =>
        api.post(`/purchase-orders/${id}/receive`, { warehouseId }),

    reverseReceipt: (id: number, reason: string) =>
        api.post(`/purchase-orders/${id}/reverse-receipt`, { reason }),

    getImportTemplate: () => api.get('/purchase-orders/import/template', { responseType: 'blob' }),

    validateImport: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/purchase-orders/import/validate', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },

    confirmImport: (data: Record<string, unknown>) => api.post('/purchase-orders/import/confirm', data),

    getPayments: (orderId: number) =>
        api.get(`/purchase-orders/${orderId}/payments`),

    addPayment: (orderId: number, data: { amount: number; date?: string; bank?: string; referenceNumber?: string; observations?: string }) =>
        api.post(`/purchase-orders/${orderId}/payments`, data),

    reversePayment: (orderId: number, paymentId: number, reason: string) =>
        api.post(`/purchase-orders/${orderId}/payments/${paymentId}/reverse`, { reason }),
};

export const kitchenNotificationsAPI = {
    getAll: (params?: { includeAttended?: boolean; limit?: number }) =>
        api.get('/kitchen-notifications', { params }),
    markSeen: (id: number) => api.patch(`/kitchen-notifications/${id}/seen`),
    markAttended: (id: number) => api.patch(`/kitchen-notifications/${id}/attended`)
};

// Cash Registers API
export const cashRegistersAPI = {
    getAll: (branchId?: number) =>
        api.get('/cash-registers', { params: { branchId } }),

    getById: (id: number) =>
        api.get(`/cash-registers/${id}`),

    getActiveShift: (id: number) =>
        api.get(`/cash-registers/${id}/active-shift`),

    create: (data: Record<string, unknown>) =>
        api.post('/cash-registers', data),
};

// Cash Shifts API
export const cashShiftsAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/cash-shifts', { params }),

    getById: (id: number) =>
        api.get(`/cash-shifts/${id}`),

    getSummary: (id: number) =>
        api.get(`/cash-shifts/${id}/summary`),

    getActiveStatus: () =>
        api.get('/cash-shifts/active-status'),

    open: (data: Record<string, unknown>) =>
        api.post('/cash-shifts/open', data),

    close: (id: number, data: Record<string, unknown>) =>
        api.post(`/cash-shifts/${id}/close`, data),

    addMovement: (id: number, data: Record<string, unknown>) =>
        api.post(`/cash-shifts/${id}/movements`, data),
};

// Payments API
export const paymentsAPI = {
    create: (
        data: { orderId: number; paymentMethodId: number; amount: number; reference?: string; payerName?: string },
        offlineMeta?: Pick<SyncItem, 'operationType' | 'dependencyKey' | 'entityTempId'>,
        idempotencyKey?: string,
    ) =>
        api.post('/payments', data, {
            offlineMeta,
            ...(idempotencyKey ? { headers: { 'X-Idempotency-Key': idempotencyKey } } : {}),
        }),
    getByOrderId: (orderId: number) =>
        api.get(`/payments/order/${orderId}`),
    getSummary: (orderId: number) =>
        api.get(`/payments/order/${orderId}/summary`),
    getPaymentMethods: () =>
        api.get('/payments/methods'),
    reverse: (id: number, reason: string) =>
        api.delete(`/payments/${id}`, { data: { reason } }),
};

// Reports API
export const reportsAPI = {
    getDashboardStats: (branchId?: number) =>
        api.get('/reports/dashboard-stats', { params: { branchId } }),

    getSalesChart: (period: 'week' | 'month', branchId?: number) =>
        api.get('/reports/sales-chart', { params: { period, branchId } }),

    getTopProducts: (branchId?: number, limit?: number) =>
        api.get('/reports/top-products', { params: { branchId, limit } }),

    getSalesByUser: (branchId?: number, startDate?: string, endDate?: string) =>
        api.get('/reports/sales-by-user', { params: { branchId, startDate, endDate } }),

    getRecentOrders: (branchId?: number, limit?: number) =>
        api.get('/reports/recent-orders', { params: { branchId, limit } }),

    getRecentInvoices: (branchId?: number, limit?: number, todayOnly?: boolean) =>
        api.get('/reports/recent-invoices', { params: { branchId, limit, todayOnly } }),

    getTodaysReservations: (branchId?: number, days?: number) =>
        api.get('/reports/todays-reservations', { params: { branchId, days } }),

    getIncomeBreakdown: (period: string, branchId?: number) =>
        api.get('/reports/income-breakdown', { params: { period, branchId } }),

    getOccupancyHeatmap: (period: string, branchId?: number) =>
        api.get('/reports/occupancy-heatmap', { params: { period, branchId } }),

    getShiftEvaluation: (period: string, branchId?: number) =>
        api.get('/reports/shift-evaluation', { params: { period, branchId } }),

    getConversionFunnel: (branchId?: number) =>
        api.get('/reports/conversion-funnel', { params: { branchId } }),

    getServiceTrends: (tipsPeriod: string, spendPeriod: string, branchId?: number) =>
        api.get('/reports/service-trends', { params: { tipsPeriod, spendPeriod, branchId } }),
    getMyStats: () => api.get('/reports/my-stats'),
    getMyActivity: (limit?: number) => api.get('/reports/my-activity', { params: { limit } }),
    getMyPerformance: () => api.get('/reports/my-performance'),
    getMyPasswordInfo: () => api.get('/reports/my-password-info'),
    getCostReport: (params?: Record<string, unknown>) => api.get('/reports/costs', { params }),
    getKardex: (params?: Record<string, string>) => api.get('/reports/kardex', { params }),
    exportKardex: (params?: Record<string, string>) => api.get('/reports/kardex/export', { params, responseType: 'arraybuffer' }),

    getInventoryReport: (params?: Record<string, string>) => api.get('/reports/inventory', { params }),
    exportInventoryReport: (params?: Record<string, string>) => api.get('/reports/inventory/export', { params, responseType: 'arraybuffer' }),
    getPurchasesReport: (params?: Record<string, string>) => api.get('/reports/purchases', { params }),
    exportPurchasesReport: (params?: Record<string, string>) => api.get('/reports/purchases/export', { params, responseType: 'arraybuffer' }),
    getSalesReport: (params?: Record<string, string>) => api.get('/reports/sales', { params }),
    exportSalesReport: (params?: Record<string, string>) => api.get('/reports/sales/export', { params, responseType: 'arraybuffer' }),
    getProfitabilityReport: (params?: Record<string, string>) => api.get('/reports/profitability', { params }),
    exportProfitabilityReport: (params?: Record<string, string>) => api.get('/reports/profitability/export', { params, responseType: 'arraybuffer' }),
    getLowStockReport: (params?: Record<string, string>) => api.get('/reports/low-stock', { params }),
    exportLowStockReport: (params?: Record<string, string>) => api.get('/reports/low-stock/export', { params, responseType: 'arraybuffer' }),

    // Extended Purchase Reports
    getPurchasesByDay: (params?: Record<string, string>) => api.get('/reports/purchases-by-day', { params }),
    exportPurchasesByDay: (params?: Record<string, string>) => api.get('/reports/purchases-by-day/export', { params, responseType: 'arraybuffer' }),
    getPurchasesByMonth: (params?: Record<string, string>) => api.get('/reports/purchases-by-month', { params }),
    exportPurchasesByMonth: (params?: Record<string, string>) => api.get('/reports/purchases-by-month/export', { params, responseType: 'arraybuffer' }),
    getPriceComparison: (params?: Record<string, string>) => api.get('/reports/price-comparison', { params }),
    exportPriceComparison: (params?: Record<string, string>) => api.get('/reports/price-comparison/export', { params, responseType: 'arraybuffer' }),
    getMostPurchased: (params?: Record<string, string>) => api.get('/reports/most-purchased', { params }),
    exportMostPurchased: (params?: Record<string, string>) => api.get('/reports/most-purchased/export', { params, responseType: 'arraybuffer' }),
    getPurchasesBySupplier: (params?: Record<string, string>) => api.get('/reports/purchases-by-supplier', { params }),
    exportPurchasesBySupplier: (params?: Record<string, string>) => api.get('/reports/purchases-by-supplier/export', { params, responseType: 'arraybuffer' }),

    // Extended Sales Reports
    getSalesByCategory: (params?: Record<string, string>) => api.get('/reports/sales-by-category', { params }),
    exportSalesByCategory: (params?: Record<string, string>) => api.get('/reports/sales-by-category/export', { params, responseType: 'arraybuffer' }),
    getSalesByProduct: (params?: Record<string, string>) => api.get('/reports/sales-by-product', { params }),
    exportSalesByProduct: (params?: Record<string, string>) => api.get('/reports/sales-by-product/export', { params, responseType: 'arraybuffer' }),
    getSalesByBrand: (params?: Record<string, string>) => api.get('/reports/sales-by-brand', { params }),
    exportSalesByBrand: (params?: Record<string, string>) => api.get('/reports/sales-by-brand/export', { params, responseType: 'arraybuffer' }),
    getSalesDaily: (params?: Record<string, string>) => api.get('/reports/sales-daily', { params }),
    exportSalesDaily: (params?: Record<string, string>) => api.get('/reports/sales-daily/export', { params, responseType: 'arraybuffer' }),
    getSalesMonthly: (params?: Record<string, string>) => api.get('/reports/sales-monthly', { params }),
    exportSalesMonthly: (params?: Record<string, string>) => api.get('/reports/sales-monthly/export', { params, responseType: 'arraybuffer' }),
    getSalesByPaymentMethod: (params?: Record<string, string>) => api.get('/reports/sales-by-payment-method', { params }),
    exportSalesByPaymentMethod: (params?: Record<string, string>) => api.get('/reports/sales-by-payment-method/export', { params, responseType: 'arraybuffer' }),
    getSalesByWaiter: (params?: Record<string, string>) => api.get('/reports/sales-by-waiter', { params }),
    exportSalesByWaiter: (params?: Record<string, string>) => api.get('/reports/sales-by-waiter/export', { params, responseType: 'arraybuffer' }),
    getSalesByChannel: (params?: Record<string, string>) => api.get('/reports/sales-by-channel', { params }),
    exportSalesByChannel: (params?: Record<string, string>) => api.get('/reports/sales-by-channel/export', { params, responseType: 'arraybuffer' }),
    getSalesByHour: (params?: Record<string, string>) => api.get('/reports/sales-by-hour', { params }),
    exportSalesByHour: (params?: Record<string, string>) => api.get('/reports/sales-by-hour/export', { params, responseType: 'arraybuffer' }),

    // Cost Reports
    getFoodCostByCategory: (params?: Record<string, string>) => api.get('/reports/food-cost-by-category', { params }),
    exportFoodCostByCategory: (params?: Record<string, string>) => api.get('/reports/food-cost-by-category/export', { params, responseType: 'arraybuffer' }),
    getMarginByProduct: (params?: Record<string, string>) => api.get('/reports/margin-by-product', { params }),
    exportMarginByProduct: (params?: Record<string, string>) => api.get('/reports/margin-by-product/export', { params, responseType: 'arraybuffer' }),

    // Audit Reports
    getAuditReport: (params?: Record<string, string>) => api.get('/reports/audit', { params }),
    exportAuditReport: (params?: Record<string, string>) => api.get('/reports/audit/export', { params, responseType: 'arraybuffer' }),

    // Decision Reports
    getDayAnalysis: (params?: Record<string, string>) => api.get('/reports/day-analysis', { params }),
    exportDayAnalysis: (params?: Record<string, string>) => api.get('/reports/day-analysis/export', { params, responseType: 'arraybuffer' }),
    getMonthComparison: (params?: Record<string, string>) => api.get('/reports/month-comparison', { params }),
    exportMonthComparison: (params?: Record<string, string>) => api.get('/reports/month-comparison/export', { params, responseType: 'arraybuffer' }),

    // Production & Engineering Reports
    getRecipeCostAnalysis: (params?: Record<string, string>) => api.get('/reports/recipe-cost', { params }),
    exportRecipeCostAnalysis: (params?: Record<string, string>) => api.get('/reports/recipe-cost/export', { params, responseType: 'arraybuffer' }),
    getProductionYield: (params?: Record<string, string>) => api.get('/reports/production-yield', { params }),
    exportProductionYield: (params?: Record<string, string>) => api.get('/reports/production-yield/export', { params, responseType: 'arraybuffer' }),
    getMenuEngineering: (params?: Record<string, string>) => api.get('/reports/menu-engineering', { params }),
    exportMenuEngineering: (params?: Record<string, string>) => api.get('/reports/menu-engineering/export', { params, responseType: 'arraybuffer' }),
    getPurchaseProjection: (params?: Record<string, string>) => api.get('/reports/purchase-projection', { params }),
    exportPurchaseProjection: (params?: Record<string, string>) => api.get('/reports/purchase-projection/export', { params, responseType: 'arraybuffer' }),
};

// Inventory Movements API
export const usersAPI = {
    getAll: (params?: Record<string, unknown>) => api.get('/users', { params }),
    getById: (id: number) => api.get(`/users/${id}`),
    updateProfile: (data: Record<string, unknown>) => api.put('/users/profile', data),
    create: (data: Record<string, unknown>) => api.post('/users', data),
    update: (id: number, data: Record<string, unknown>) => api.put(`/users/${id}`, data),
    delete: (id: number) => api.delete(`/users/${id}`)
};

const HR_API_BASE = '/v1/hr';

export interface BranchGeofencePayload {
    name?: string;
    code?: string;
    address?: string | null;
    phone?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
    latitude: number | null;
    longitude: number | null;
    geofenceRadiusM: number | null;
    maxLocationAccuracyM: number | null;
    timezone: string | null;
    attendanceEnabled: boolean;
    expectedVersion?: number;
}

/**
 * Phase 1 Human Resources contract. Keeping the versioned prefix in one place
 * prevents HR pages from accidentally falling back to unversioned routes.
 */
export const hrAPI = {
    getDashboard: () => api.get(`${HR_API_BASE}/dashboard`),
    getEmployees: (params?: Record<string, unknown>) =>
        api.get(`${HR_API_BASE}/employees`, { params }),
    getEmployee: (employeeId: number) =>
        api.get(`${HR_API_BASE}/employees/${employeeId}`),
    createEmployee: (data: Record<string, unknown>) =>
        api.post(`${HR_API_BASE}/employees`, data),
    updateEmployee: (employeeId: number, data: Record<string, unknown>) =>
        api.put(`${HR_API_BASE}/employees/${employeeId}`, data),
    changeEmployeeStatus: (employeeId: number, data: Record<string, unknown>) =>
        api.patch(`${HR_API_BASE}/employees/${employeeId}/status`, data),
    getOrganization: (params?: Record<string, unknown>) =>
        api.get(`${HR_API_BASE}/lookups`, { params }),
    getBranchGeofence: (branchId: number) =>
        api.get(`${HR_API_BASE}/branches/${branchId}/geofence`),
    createBranch: (data: BranchGeofencePayload & { name: string; code: string }) =>
        api.post(`${HR_API_BASE}/branches`, data),
    updateBranchGeofence: (branchId: number, data: BranchGeofencePayload) =>
        api.put(`${HR_API_BASE}/branches/${branchId}/geofence`, data),
};

/** Focused alias for branch administration screens. */
export const branchGeofenceAPI = {
    get: hrAPI.getBranchGeofence,
    update: hrAPI.updateBranchGeofence,
};

export const inventoryMovementsAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/inventory-movements', { params }),

    getKardex: (productId: number, warehouseId?: number) =>
        api.get(`/inventory-movements/product/${productId}/kardex`, { params: { warehouseId } }),

    create: (data: {
        warehouseId: number;
        productId: number;
        type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
        quantity: number;
        reason?: string;
        reference?: string;
        unit?: string;
    }, idempotencyKey?: string) =>
        api.post('/inventory-movements', data, {
            ...(idempotencyKey ? { headers: { 'X-Idempotency-Key': idempotencyKey } } : {})
        }),

    transfer: (data: Record<string, unknown>, idempotencyKey?: string) =>
        api.post('/inventory-movements/transfer', data, {
            ...(idempotencyKey ? { headers: { 'X-Idempotency-Key': idempotencyKey } } : {})
        }),

    reverse: (movementId: number, reason: string, idempotencyKey: string) =>
        api.post(`/inventory-movements/${movementId}/reverse`, { reason }, {
            headers: { 'X-Idempotency-Key': idempotencyKey }
        }),
};

// Units of Measure API
export const unitsAPI = {
    getAll: (params?: { includeInactive?: boolean }) =>
        api.get('/units', {
            params: params?.includeInactive ? { includeInactive: true } : undefined
        }),

    create: (data: {
        name: string;
        abbreviation: string;
        measurementType: 'MASS' | 'VOLUME' | 'UNIT' | 'PACKAGE';
        systemFactor: number;
        active?: boolean;
    }) =>
        api.post('/units', data),

    update: (id: number, data: {
        name?: string;
        abbreviation?: string;
        measurementType?: 'MASS' | 'VOLUME' | 'UNIT' | 'PACKAGE';
        systemFactor?: number;
        active?: boolean;
    }) =>
        api.put(`/units/${id}`, data),

    getProductUnits: (productId: number) =>
        api.get(`/units/product/${productId}`),

    setProductUnits: (productId: number, data: { baseUnitId: number; allowedUnits: Array<{ unitId: number; conversionFactor: number; isDefault?: boolean }> }) =>
        api.put(`/units/product/${productId}`, data),

    seedDefaults: () =>
        api.post('/units/seed'),

    autoConfigureProduct: (productId: number) =>
        api.post(`/units/product/${productId}/auto-configure`),

    autoConfigureAll: () =>
        api.post('/units/auto-configure-all'),
};

// Sales Channel Config API
export const salesChannelsAPI = {
    getAll: () => api.get('/sales-channels'),
    upsert: (data: { channel: string; priceMarkupPct: number; commissionPct: number; isActive?: boolean }) =>
        api.put('/sales-channels', data),
    ensureDefaults: () => api.post('/sales-channels/ensure-defaults'),
    calculatePricing: (basePrice: number, channel: string) =>
        api.get('/sales-channels/calculate-pricing', { params: { basePrice, channel } }),
};

// Stock Alerts API
export const stockAlertsAPI = {
    getAll: (warehouseId?: number) =>
        api.get('/stock-alerts', { params: { warehouseId } }),
    getSummary: () => api.get('/stock-alerts/summary'),
    getByProduct: (productId: number) => api.get(`/stock-alerts/product/${productId}`)
};

export const autoPurchaseOrdersAPI = {
    getSuggestions: (warehouseId?: number) =>
        api.get('/advanced/auto-po/suggestions', { params: { warehouseId } }),
    createFromSuggestions: (data: Record<string, unknown>) =>
        api.post('/advanced/auto-po/create', data)
};

export const branchPricingAPI = {
    getMenuItemMatrix: (menuItemId: number) =>
        api.get(`/advanced/pricing/${menuItemId}`),
    setBranchPrice: (menuItemId: number, branchId: number, price: number) =>
        api.post(`/advanced/pricing/${menuItemId}/branch/${branchId}`, { price })
};

// Promotions API
export const promotionsAPI = {
    getAll: (activeOnly = true) =>
        api.get('/promotions', { params: { activeOnly } }),
    validate: (code: string, orderTotal: number) =>
        api.post('/promotions/validate', { code, orderTotal }),
    create: (data: Record<string, unknown>) => api.post('/promotions', data),
    update: (id: number, data: Record<string, unknown>) => api.put(`/promotions/${id}`, data),
    deactivate: (id: number) => api.patch(`/promotions/${id}/deactivate`)
};

// Cash Arqueo API
export const cashArqueoAPI = {
    getDetails: (shiftId: number) => api.get(`/cash-arqueo/${shiftId}`),
    performCount: (shiftId: number, data: Record<string, unknown>) => api.post(`/cash-arqueo/${shiftId}/count`, data),
    previewClose: (shiftId: number, data: Record<string, unknown>) => api.post(`/cash-arqueo/${shiftId}/preview-close`, data),
    closeShift: (shiftId: number, data: Record<string, unknown>) => api.post(`/cash-arqueo/${shiftId}/close`, data),
    getReport: (shiftId: number) => api.get(`/cash-arqueo/${shiftId}/report`)
};

// Split Bill API
export interface SplitBillItemQuantity {
    orderItemId: number;
    quantity: number;
}

export type SplitBillItemAssignment =
    | { personName: string; itemIds: number[]; items?: never }
    | { personName: string; items: SplitBillItemQuantity[]; itemIds?: never };

export const splitBillAPI = {
    splitEvenly: (orderId: number, numberOfPeople: number) =>
        api.post(`/split-bill/${orderId}/evenly`, { numberOfPeople }),
    splitByItems: (orderId: number, itemAssignments: SplitBillItemAssignment[]) =>
        api.post(`/split-bill/${orderId}/by-items`, { itemAssignments }),
    splitByAmount: (orderId: number, customSplits: Record<string, unknown>[]) =>
        api.post(`/split-bill/${orderId}/by-amount`, { customSplits }),
    getSuggestedTips: (subtotal: number) =>
        api.get('/split-bill/suggested-tips', { params: { subtotal } })
};

export const settingsAPI = {
    getAll: () => api.get('/settings'),
    update: (data: Record<string, string>) => api.put('/settings', data)
};

export const rolesAPI = {
    getAll: (params?: Record<string, unknown>) => api.get('/roles', { params }),
    getById: (id: number) => api.get(`/roles/${id}`),
    create: (data: Record<string, unknown>) => api.post('/roles', data),
    update: (id: number, data: Record<string, unknown>) => api.put(`/roles/${id}`, data),
    delete: (id: number) => api.delete(`/roles/${id}`)
};

export const companiesAPI = {
    getAll: (params?: Record<string, unknown>) => api.get('/companies', { params }),
    getById: (id: number) => api.get(`/companies/${id}`),
    create: (data: Record<string, unknown>) => api.post('/companies', data),
    update: (id: number, data: Record<string, unknown>) => api.put(`/companies/${id}`, data),
};

export const permissionsAPI = {
    getAll: () => api.get('/permissions'),
    getById: (id: number) => api.get(`/permissions/${id}`),
    create: (data: Record<string, unknown>) => api.post('/permissions', data),
    update: (id: number, data: Record<string, unknown>) => api.put(`/permissions/${id}`, data),
    delete: (id: number) => api.delete(`/permissions/${id}`)
};

export const uploadAPI = {
    uploadLogo: (formData: FormData) => {
        return api.post('/upload/logo', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },
    deleteLogo: (filename: string) => api.delete(`/upload/logo/${filename}`)
};

export const backupAPI = {
    create: () => api.post('/backup/create'),
    list: () => api.get('/backup/list'),
    download: async (filename: string) => {
        const response = await api.get(`/backup/download/${filename}`, { responseType: 'blob' });
        const blob = new Blob([response.data]);
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(link.href);
    },
    delete: (filename: string) => api.delete(`/backup/${filename}`)
};

// Reservations API
export const reservationsAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/reservations', { params }),

    getUpcoming: (days = 7, branchId?: number) =>
        api.get('/reservations/upcoming', { params: { days, branchId } }),

    getById: (id: number) =>
        api.get(`/reservations/${id}`),

    create: (data: Record<string, unknown>) =>
        api.post('/reservations', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/reservations/${id}`, data),

    updateStatus: (id: number, status: string) =>
        api.patch(`/reservations/${id}/status`, { status }),

    checkIn: (id: number) =>
        api.post(`/reservations/${id}/check-in`),

    delete: (id: number) =>
        api.delete(`/reservations/${id}`),
};

// Catering API
export const cateringAPI = {
    getAllEvents: (params?: Record<string, unknown>) =>
        api.get('/catering', { params }),

    getEventById: (id: number) =>
        api.get(`/catering/${id}`),

    createEvent: (data: Record<string, unknown>) =>
        api.post('/catering', data),

    updateEvent: (id: number, data: Record<string, unknown>) =>
        api.put(`/catering/${id}`, data),

    addPayment: (eventId: number, data: Record<string, unknown>, idempotencyKey: string) =>
        api.post(`/catering/${eventId}/payments`, data, {
            headers: { 'X-Idempotency-Key': idempotencyKey }
        }),

    reversePayment: (eventId: number, paymentId: number, reason: string) =>
        api.post(`/catering/${eventId}/payments/${paymentId}/reverse`, { reason }),

    issueFiscalInvoice: (eventId: number, idempotencyKey: string) =>
        api.post(`/catering/${eventId}/fiscal-invoice`, {}, {
            headers: { 'X-Idempotency-Key': idempotencyKey }
        }),

    getFiscalInvoice: (eventId: number) =>
        api.get(`/catering/${eventId}/fiscal-invoice`),

    issueFiscalCreditNote: (eventId: number, data: Record<string, unknown>, idempotencyKey: string) =>
        api.post(`/catering/${eventId}/fiscal-credit-note`, data, {
            headers: { 'X-Idempotency-Key': idempotencyKey }
        }),

    getFiscalCreditNote: (eventId: number) =>
        api.get(`/catering/${eventId}/fiscal-credit-note`),

    getAllServices: () =>
        api.get('/catering/services'),

    createService: (data: Record<string, unknown>) =>
        api.post('/catering/services', data),

    updateService: (id: number, data: Record<string, unknown>) =>
        api.put(`/catering/services/${id}`, data),

    deleteService: (id: number) =>
        api.delete(`/catering/services/${id}`),

    checkAvailability: (date: string, branchId?: number) =>
        api.get('/catering/availability', { params: { date, branchId } }),

    deleteEvent: (id: number) =>
        api.delete(`/catering/${id}`),
};

// PedidosYa Integration API
export const pedidosYaAPI = {
    getConfig: (branchId?: number) =>
        api.get('/pedidosya/config', { params: { branchId } }),
    upsertConfig: (data: Record<string, unknown>) =>
        api.put('/pedidosya/config', data),
    testConnection: () =>
        api.post('/pedidosya/test-connection'),
    syncMenu: () =>
        api.post('/pedidosya/sync-menu'),
    getMappings: () =>
        api.get('/pedidosya/mappings'),
    upsertMapping: (data: { externalId: string; externalName: string; menuItemId?: number | null; isActive?: boolean }) =>
        api.put('/pedidosya/mappings', data),
    deleteMapping: (id: number) =>
        api.delete(`/pedidosya/mappings/${id}`),
    getWebhookLogs: (params?: Record<string, unknown>) =>
        api.get('/pedidosya/webhook-logs', { params }),
    getOrderSyncs: (params?: Record<string, unknown>) =>
        api.get('/pedidosya/order-syncs', { params }),
};

export default api;
