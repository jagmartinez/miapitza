import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const apiSource = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const toastSource = readFileSync(new URL('../context/ToastContext.tsx', import.meta.url), 'utf8');
const posSource = readFileSync(new URL('../pages/POS.tsx', import.meta.url), 'utf8');
const cashShiftSource = readFileSync(new URL('../pages/CashShift.tsx', import.meta.url), 'utf8');
const ordersSource = readFileSync(new URL('../pages/Orders.tsx', import.meta.url), 'utf8');
const invoiceHistorySource = readFileSync(new URL('../pages/InvoiceHistory.tsx', import.meta.url), 'utf8');

const slice = (source: string, start: string, end: string) => {
    const from = source.indexOf(start);
    return source.slice(from, source.indexOf(end, from));
};

describe('offline cache fallback is visible', () => {
    it('flags cached GET fallbacks and raises the app-shell notice', () => {
        const fallback = slice(apiSource, 'Handle GET failure due to network', 'return Promise.reject(error);');
        expect(fallback).toContain('_fromCache: true');
        expect(fallback).toContain('markServedFromCache(cacheKey)');
        expect(apiSource).toContain('markLiveResponse()');
        expect(toastSource).toContain("'Sin conexión — mostrando datos guardados'");
        expect(toastSource).toContain('<OfflineCacheNotice />');
    });
});

describe('order and cash idempotency keys', () => {
    it('lets callers pass a per-action key to order create/addItem and cash movements', () => {
        const ordersApi = slice(apiSource, 'export const ordersAPI', 'export const invoicesAPI');
        expect(ordersApi.match(/idempotencyHeaders\(idempotencyKey\)/g)).toHaveLength(2);
        const cashApi = slice(apiSource, 'export const cashShiftsAPI', 'export const paymentsAPI');
        expect(cashApi).toContain('idempotencyHeaders(idempotencyKey)');
        expect(apiSource).toContain('idempotencyKey: readIdempotencyHeader(requestConfig.headers)');
    });

    it('reuses the action key on ambiguous retries and clears it after confirmation', () => {
        expect(posSource).toContain('persistCartAttemptRef.current = attempt');
        expect(posSource).toContain('persistCartAttemptRef.current = null');
        expect(posSource).toContain('`${actionKey}:item-${index}`');
        expect(cashShiftSource).toContain('movementAttemptRef.current = attempt');
        expect(cashShiftSource).toContain('cashShiftsAPI.addMovement(Number(id), payload, attempt.key)');
    });
});

describe('server pagination', () => {
    it('requests explicit pages instead of relying on the server default or a client cap', () => {
        expect(ordersSource).toContain('limit: ORDERS_PAGE_SIZE');
        // La paginación de servidor la dibuja DataTable (@/ui) con su Pagination interna.
        expect(ordersSource).toContain("pagination={{ mode: 'server', page, pageSize: ORDERS_PAGE_SIZE");
        expect(invoiceHistorySource).not.toContain('limit: 200');
        expect(invoiceHistorySource).toContain('limit: PAGE_SIZE');
    });
});
