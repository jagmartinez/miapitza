import { useEffect, useState } from 'react';
import { ordersAPI } from '../../services/api';
import { StatCard, formatMoney, formatNumber } from '@/ui';
import { computeOpenConsumption, longestOpenTable } from '../../utils/salonInsights';
import type { Order } from '../../types';

/** Minutos desde `Date.now()` que se refrescan cada minuto, para que "mesa abierta más tiempo" avance. */
export function useMinuteClock(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(id);
    }, []);
    return now;
}

/** Tarjetas de salón (consumo abierto y mesa abierta más tiempo) a partir de las órdenes activas de mesa. */
export function SalonStatCards({ orders, now }: { orders: Order[]; now: number }) {
    const consumption = computeOpenConsumption(orders);
    const longest = longestOpenTable(orders, now);
    return (
        <>
            <StatCard
                label="Consumo abierto en mesas"
                value={formatMoney(consumption.amount)}
                context={`${formatNumber(consumption.orderCount, 0)} órdenes sin cobrar · ${formatNumber(consumption.invoicedUnpaid, 0)} facturadas sin cobrar${consumption.partialCount ? ` · ${formatNumber(consumption.partialCount, 0)} con pago parcial no incluidas` : ''}${consumption.unknownTotalCount ? ` · ${formatNumber(consumption.unknownTotalCount, 0)} sin total disponible no incluidas` : ''}`}
                tone={consumption.invoicedUnpaid > 0 ? 'warning' : 'neutral'}
                action={{ label: 'Ver mesas', to: '/tables' }}
            />
            <StatCard
                label="Mesa abierta más tiempo"
                value={longest ? `${formatNumber(longest.minutes, 0)} min` : 'Sin mesas abiertas'}
                context={longest ? `Mesa ${longest.tableNumber} · orden #${longest.orderId}` : 'No hay consumo abierto en mesas'}
                tone={longest && longest.minutes >= 90 ? 'warning' : 'neutral'}
                action={{ label: 'Ver mesas', to: '/tables' }}
            />
        </>
    );
}

/** Versión autónoma: carga las órdenes de mesa y no muestra nada si la fuente falla. */
export function SalonStatCardsLoader() {
    const [orders, setOrders] = useState<Order[] | null>(null);
    const now = useMinuteClock();
    useEffect(() => {
        let alive = true;
        ordersAPI.getActive(undefined, true)
            .then((res) => { const d = res.data.data; if (alive && Array.isArray(d)) setOrders(d as Order[]); })
            .catch(() => { /* sin datos de salón: no se muestran las tarjetas */ });
        return () => { alive = false; };
    }, []);
    return orders ? <SalonStatCards orders={orders} now={now} /> : null;
}
