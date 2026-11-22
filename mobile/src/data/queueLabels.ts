import type { SyncItem } from './types';

/** Where the customer survey is posted (the API root is /api, the module lives under v1). */
export const SURVEY_URL = '/v1/surveys';
/** A customer survey: it never expires and its owner cannot discard it (the rated person must not decide if a score arrives). */
export const isSurveyItem = (item: Pick<SyncItem, 'url'>): boolean => item.url.split('?')[0] === SURVEY_URL;

/** The server answered a replayed survey with a verdict no retry changes (its own SURVEY_* code, a key reused with other answers, or the device is not allowed): the row is dropped. */
export function isDefinitiveSurveyRejection(status: number | undefined, code: unknown): boolean {
    const c = typeof code === 'string' ? code : '';
    return c.startsWith('SURVEY_') || c === 'IDEMPOTENCY_MISMATCH' || status === 403;
}

/** One queued line save of a blind inventory count: PUT /v1/inventory-counts/:sheetId/lines/:productId. */
export const INVENTORY_COUNT_URL_RE = /^\/v1\/inventory-counts\/\d+\/lines\/\d+$/;
/** A queued count line: like the survey it never expires and its owner cannot discard it (the count must reach the sheet as typed). */
export const isInventoryCountItem = (item: Pick<SyncItem, 'url'>): boolean => INVENTORY_COUNT_URL_RE.test(item.url.split('?')[0]);

/** The server answered a replayed count line with a verdict no retry changes (its own INVENTORY_COUNT_* code, e.g. the sheet is no longer editable, or the device is not allowed): the row is dropped. */
export function isDefinitiveCountRejection(status: number | undefined, code: unknown): boolean {
    const c = typeof code === 'string' ? code : '';
    return c.startsWith('INVENTORY_COUNT_') || status === 403;
}

/** What a queued item is, in the waiter's words (the label saved with it wins). */
export function itemTitle(item: SyncItem): string {
    if (item.meta?.label) return item.meta.label;
    switch (item.operationType) {
        case 'CREATE_ORDER':
            return 'Abrir mesa';
        case 'ADD_ORDER_ITEM': {
            const q = Number((item.data as { quantity?: unknown } | null)?.quantity);
            return Number.isFinite(q) && q > 0 ? `${q} × producto` : 'Agregar producto';
        }
        case 'SEND_TO_KITCHEN':
            return 'Enviar a cocina';
        case 'CREATE_PAYMENT':
            return 'Pago';
        default:
            return isSurveyItem(item) ? 'Encuesta del cliente' : isInventoryCountItem(item) ? 'Conteo de inventario' : 'Cambio del pedido';
    }
}

export const itemStatus = (item: SyncItem): string => (item.status === 'failed' ? 'No se pudo sincronizar' : item.status === 'blocked' ? 'Esperando el pedido' : item.status === 'processing' ? 'Sincronizando' : 'Pendiente');

/** hh:mm of when it was queued. */
export const itemTime = (item: SyncItem): string => new Date(item.timestamp).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
