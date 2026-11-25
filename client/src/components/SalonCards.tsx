import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatCard, formatNumber } from '@/ui';
import { ordersAPI, reservationsAPI, tablesAPI } from '../services/api';
import { useCurrency } from '../hooks/useCurrency';
import type { Order, Table } from '../types';
import {
    computeOpenConsumption,
    longestOpenTable,
    nextReservation,
    type UpcomingReservation,
} from '../utils/salonInsights';
import './SalonCards.css';

type Source<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/**
 * Tarjetas del salón: consumo abierto, mesa abierta más tiempo y próxima reserva.
 * Si una fuente falla se muestra N/D (nunca 0) y la tarjeta ofrece reintentar.
 */
export default function SalonCards({ branchId, tables, onReviewOrders, only }: {
    branchId?: number | null;
    /** Si se omite, las mesas se cargan aquí para saber si la mesa de la próxima reserva sigue ocupada. */
    tables?: Table[];
    onReviewOrders?: () => void;
    /** Limita las tarjetas visibles (por defecto las tres). */
    only?: 'reservation';
}) {
    const { symbol } = useCurrency();
    const [orders, setOrders] = useState<Source<Order[]>>({ status: 'loading' });
    const [reservations, setReservations] = useState<Source<UpcomingReservation[]>>({ status: 'loading' });
    const [ownTables, setOwnTables] = useState<Source<Table[]>>({ status: 'loading' });
    const [now, setNow] = useState(() => Date.now());
    const ownsTables = tables === undefined;
    const onlyReservation = only === 'reservation';

    const load = useCallback(async () => {
        setOrders({ status: 'loading' });
        setReservations({ status: 'loading' });
        if (ownsTables) setOwnTables({ status: 'loading' });
        const [o, r, t] = await Promise.allSettled([
            onlyReservation ? Promise.resolve(null) : ordersAPI.getActive(branchId ?? undefined),
            reservationsAPI.getUpcoming(1, branchId ?? undefined),
            ownsTables ? tablesAPI.getAll(branchId ?? undefined) : Promise.resolve(null),
        ]);
        setOrders(o.status === 'fulfilled' ? { status: 'ready', data: (o.value?.data.data ?? []) as Order[] } : { status: 'error' });
        setReservations(r.status === 'fulfilled' ? { status: 'ready', data: (r.value.data.data ?? []) as UpcomingReservation[] } : { status: 'error' });
        if (ownsTables) {
            setOwnTables(t.status === 'fulfilled' && t.value ? { status: 'ready', data: (t.value.data.data ?? []) as Table[] } : { status: 'error' });
        }
        setNow(Date.now());
    }, [branchId, onlyReservation, ownsTables]);

    useEffect(() => {
        void load();
        const timer = window.setInterval(() => setNow(Date.now()), 60000);
        return () => window.clearInterval(timer);
    }, [load]);

    const consumption = useMemo(() => (orders.status === 'ready' ? computeOpenConsumption(orders.data) : null), [orders]);
    const longest = useMemo(() => (orders.status === 'ready' ? longestOpenTable(orders.data, now) : null), [orders, now]);
    const knownTables = useMemo(
        () => tables ?? (ownTables.status === 'ready' ? ownTables.data : []),
        [tables, ownTables],
    );
    const tablesUnknown = ownsTables && ownTables.status === 'error';
    const next = useMemo(
        () => (reservations.status === 'ready' ? nextReservation(reservations.data, knownTables, now) : null),
        [reservations, knownTables, now],
    );
    const retry = { label: 'Reintentar', onClick: () => void load() };

    const reservationContext = next
        ? `${next.reservation.customerName} · ${formatNumber(next.reservation.peopleCount, 0)} pers.${
            next.reservation.table
                ? ` · Mesa ${next.reservation.table.number}${next.mustRelease ? ' sigue ocupada: debe liberarse' : tablesUnknown ? ' (no se pudo verificar si está libre)' : ''}`
                : ' · sin mesa asignada'
        }`
        : 'No hay reservas pendientes en las próximas 24 horas';

    return (
        <div className="salon-cards" role="group" aria-label="Indicadores del salón">
            {!onlyReservation && (orders.status === 'error' ? (
                <StatCard label="Consumo abierto" value="N/D" context="No disponible: no se pudieron cargar las órdenes activas." tone="warning" action={retry} />
            ) : (
                <StatCard
                    label="Consumo abierto"
                    value={consumption ? `${symbol} ${formatNumber(consumption.amount)}` : '...'}
                    context={consumption
                        ? `${consumption.orderCount} órdenes de mesa sin cobrar · ${consumption.invoicedUnpaid} facturadas sin cobrar${consumption.partialCount ? ` · ${consumption.partialCount} con pago parcial no incluidas` : ''}`
                        : 'Cargando órdenes activas'}
                    tone={consumption && consumption.invoicedUnpaid > 0 ? 'warning' : 'neutral'}
                    action={onReviewOrders ? { label: 'Ver órdenes', onClick: onReviewOrders } : undefined}
                />
            ))}
            {!onlyReservation && (orders.status === 'error' ? (
                <StatCard label="Mesa abierta más tiempo" value="N/D" context="No disponible: no se pudieron cargar las órdenes activas." tone="warning" action={retry} />
            ) : (
                <StatCard
                    label="Mesa abierta más tiempo"
                    value={orders.status === 'loading' ? '...' : longest ? `${formatNumber(longest.minutes, 0)} min` : 'Sin mesas abiertas'}
                    context={longest ? `Mesa ${longest.tableNumber} · orden #${longest.orderId}` : 'No hay consumo abierto en mesas'}
                    tone={longest && longest.minutes >= 90 ? 'warning' : 'neutral'}
                />
            ))}
            {reservations.status === 'error' ? (
                <StatCard label="Próxima reserva" value="N/D" context="No disponible: no se pudieron cargar las reservas." tone="warning" action={retry} />
            ) : (
                <StatCard
                    label="Próxima reserva"
                    value={reservations.status === 'loading' ? '...' : next
                        ? new Date(next.reservation.date).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })
                        : 'Sin reservas'}
                    context={reservationContext}
                    tone={next?.mustRelease ? 'danger' : 'neutral'}
                />
            )}
        </div>
    );
}
