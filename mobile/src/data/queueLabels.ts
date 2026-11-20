import type { SyncItem } from './types';

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
            return 'Cambio del pedido';
    }
}

export const itemStatus = (item: SyncItem): string => (item.status === 'failed' ? 'No se pudo sincronizar' : item.status === 'blocked' ? 'Esperando el pedido' : item.status === 'processing' ? 'Sincronizando' : 'Pendiente');

/** hh:mm of when it was queued. */
export const itemTime = (item: SyncItem): string => new Date(item.timestamp).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
