import type { Order } from '../types';

type WhereOrder = Pick<Order, 'table' | 'orderType' | 'customerName' | 'salesChannel'>;

const CHANNEL_LABEL: Record<string, string> = { PEDIDOSYA: 'PedidosYa' };

/**
 * Dónde se entrega una orden: "Mesa N", "Para llevar · nombre" o "Delivery · canal".
 * Una orden sin mesa nunca se muestra como "Mesa N/A".
 */
export function orderWhereLabel(order: WhereOrder): string {
    if (order.table?.number) return `Mesa ${order.table.number}`;
    const name = order.customerName?.trim();
    const channel = order.salesChannel && order.salesChannel !== 'RESTAURANT'
        ? CHANNEL_LABEL[order.salesChannel] ?? order.salesChannel
        : null;
    if (order.orderType === 'DELIVERY' || channel) {
        return ['Delivery', channel, name].filter(Boolean).join(' · ');
    }
    return name ? `Para llevar · ${name}` : 'Para llevar';
}
