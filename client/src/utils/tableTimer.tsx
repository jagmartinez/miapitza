import { Clock } from 'lucide-react';
import type { Table } from '../types';

/** Table shape used on POS when listing occupation (API may attach open orders). */
type TableWithOccupationOrders = Table & {
    orders?: { createdAt: string }[];
};

const getOccupationTime = (table: TableWithOccupationOrders) => {
    if (table.status !== 'OCCUPIED' || !table.orders || table.orders.length === 0) {
        return null;
    }

    const latestOrder = table.orders[table.orders.length - 1];
    const orderTime = new Date(latestOrder.createdAt).getTime();
    const now = Date.now();
    const diffMinutes = Math.floor((now - orderTime) / 60000);

    if (diffMinutes < 60) {
        return `${diffMinutes} min`;
    }

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return `${hours}h ${minutes}m`;
};

const getOccupationColor = (table: TableWithOccupationOrders) => {
    if (table.status !== 'OCCUPIED' || !table.orders || table.orders.length === 0) {
        return '';
    }

    const latestOrder = table.orders[table.orders.length - 1];
    const orderTime = new Date(latestOrder.createdAt).getTime();
    const now = Date.now();
    const diffMinutes = Math.floor((now - orderTime) / 60000);

    if (diffMinutes < 30) return 'occupation-normal';
    if (diffMinutes < 60) return 'occupation-warning';
    return 'occupation-alert';
};

export default function OccupationTimer({ table }: { table: TableWithOccupationOrders }) {
    const time = getOccupationTime(table);
    const colorClass = getOccupationColor(table);

    if (!time) return null;

    return (
        <div className={`occupation-timer ${colorClass}`}>
            <Clock size={14} />
            <span>{time}</span>
        </div>
    );
}
