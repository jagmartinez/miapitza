import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import type { LoginResponse } from '../types';
import { db, type SyncItem } from './db';
import { offlineManager } from './offlineManager';

type OfflineRequestMeta = Pick<SyncItem, 'operationType' | 'dependencyKey' | 'entityTempId'>;

declare module 'axios' {
    export interface AxiosRequestConfig {
        offlineMeta?: OfflineRequestMeta;
    }
}

const normalizeApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_URL as string | undefined;
    if (envUrl) {
        return envUrl.replace(/\/+$/, '');
    }

    if (typeof window !== 'undefined') {
        const host = window.location.hostname;
        if (host.includes('-web-') && host.endsWith('.up.railway.app')) {
            // Railway naming convention: <service>-web-<env>.up.railway.app -> <service>-<env>.up.railway.app
            return `https://${host.replace('-web-', '-')}/api`;
        }
    }

    return '/api';
};

const api = axios.create({
    baseURL: normalizeApiBaseUrl(),
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor to handle offline mutations
api.interceptors.request.use(
    async (config) => {
        const requestConfig = config as InternalAxiosRequestConfig;
        const url = requestConfig.url || '';
        const isAuthRequest = url.startsWith('/auth/');
        const token = localStorage.getItem('token');

        if (token && !requestConfig.headers.Authorization) {
            requestConfig.headers.Authorization = `Bearer ${token}`;
        }

        // If offline and NOT a GET request, enqueue for sync
        if (!isAuthRequest && !offlineManager.getStatus() && requestConfig.method !== 'get' && requestConfig.method !== 'GET') {
            await offlineManager.enqueueRequest({
                url,
                method: (requestConfig.method?.toUpperCase() as SyncItem['method']) || 'POST',
                data: requestConfig.data,
                operationType: requestConfig.offlineMeta?.operationType || 'GENERIC_MUTATION',
                dependencyKey: requestConfig.offlineMeta?.dependencyKey || null,
                entityTempId: requestConfig.offlineMeta?.entityTempId || null,
            });

            // Return a fake successful response to keep the UI moving
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
        // Cache successful GET responses (skip auth endpoints and binary responses)
        const method = response.config.method?.toLowerCase();
        const url = response.config.url || '';
        if (method === 'get' && !url.startsWith('/auth/') && response.config.responseType !== 'arraybuffer') {
            try {
                await db.caches.put({
                    id: url,
                    data: response.data,
                    timestamp: Date.now()
                });
            } catch {
                // IndexedDB quota exceeded or unavailable — non-critical
            }
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
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }

        // Handle GET failure due to network (offline fallback with TTL check)
        if (!error.response && (error.config?.method === 'get' || error.config?.method === 'GET')) {
            const url = error.config.url!;
            const cachedData = await offlineManager.getCachedData(url);
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
        api.get(`/menu-items/${id}/recipes`),

    addRecipe: (id: number, data: Record<string, unknown>) =>
        api.post(`/menu-items/${id}/recipes`, data),

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

    updateStatus: (id: number, status: string) =>
        api.patch(`/orders/${id}/status`, { status }),

    updatePricing: (id: number, data: Record<string, unknown>) =>
        api.patch(`/orders/${id}/pricing`, data),

    cancel: (id: number, cancelReason?: string) =>
        api.post(`/orders/${id}/cancel`, { cancelReason }),

    startItem: (orderId: number, itemId: number) =>
        api.patch(`/orders/${orderId}/items/${itemId}/start`),

    finishItem: (orderId: number, itemId: number) =>
        api.patch(`/orders/${orderId}/items/${itemId}/finish`),

    reportProblem: (orderId: number, description: string) =>
        api.post(`/orders/${orderId}/report-problem`, { description }),
};

// Products API
export const productsAPI = {
    getAll: (params?: Record<string, unknown>) =>
        api.get('/products', { params }),

    getLowStock: () =>
        api.get('/products/low-stock'),

    create: (data: Record<string, unknown>) =>
        api.post('/products', data),

    update: (id: number, data: Record<string, unknown>) =>
        api.put(`/products/${id}`, data),

    delete: (id: number) =>
        api.delete(`/products/${id}`),
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

    getImportTemplate: () => api.get('/purchase-orders/import/template', { responseType: 'blob' }),

    validateImport: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/purchase-orders/import/validate', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    },

    confirmImport: (data: Record<string, unknown>) => api.post('/purchase-orders/import/confirm', data),
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
        offlineMeta?: Pick<SyncItem, 'operationType' | 'dependencyKey' | 'entityTempId'>
    ) =>
        api.post('/payments', data, { offlineMeta }),
    getByOrderId: (orderId: number) =>
        api.get(`/payments/order/${orderId}`),
    getPaymentMethods: () =>
        api.get('/payments/methods'),
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

    getOccupancyHeatmap: (branchId?: number) =>
        api.get('/reports/occupancy-heatmap', { params: { branchId } }),

    getShiftEvaluation: (branchId?: number) =>
        api.get('/reports/shift-evaluation', { params: { branchId } }),

    getConversionFunnel: (branchId?: number) =>
        api.get('/reports/conversion-funnel', { params: { branchId } }),

    getServiceTrends: (branchId?: number) =>
        api.get('/reports/service-trends', { params: { branchId } }),
    getMyStats: () => api.get('/reports/my-stats'),
    getMyActivity: (limit?: number) => api.get('/reports/my-activity', { params: { limit } }),
    getMyPerformance: () => api.get('/reports/my-performance'),
    getMyPasswordInfo: () => api.get('/reports/my-password-info'),
    getCostReport: (params?: Record<string, unknown>) => api.get('/reports/costs', { params }),
    getKardex: (params?: Record<string, string>) => api.get('/reports/kardex', { params }),
    exportKardex: (params?: Record<string, string>) => api.get('/reports/kardex/export', { params, responseType: 'arraybuffer' }),
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
    }) =>
        api.post('/inventory-movements', data),

    transfer: (data: Record<string, unknown>) =>
        api.post('/inventory-movements/transfer', data),
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
export const splitBillAPI = {
    splitEvenly: (orderId: number, numberOfPeople: number) =>
        api.post(`/split-bill/${orderId}/evenly`, { numberOfPeople }),
    splitByItems: (orderId: number, itemAssignments: Record<string, unknown>[]) =>
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

    addPayment: (eventId: number, data: Record<string, unknown>) =>
        api.post(`/catering/${eventId}/payments`, data),

    getAllServices: () =>
        api.get('/catering/services'),

    createService: (data: Record<string, unknown>) =>
        api.post('/catering/services', data),

    updateService: (id: number, data: Record<string, unknown>) =>
        api.put(`/catering/services/${id}`, data),

    deleteService: (id: number) =>
        api.delete(`/catering/services/${id}`),

    checkAvailability: (date: string) =>
        api.get('/catering/availability', { params: { date } }),

    deleteEvent: (id: number) =>
        api.delete(`/catering/${id}`),
};

export default api;
