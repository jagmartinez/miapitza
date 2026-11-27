import { Link } from 'react-router-dom';
import { reportsAPI, ordersAPI, productsAPI } from '../../services/api';
import { Button, DataTable, EmptyState, LoadErrorState, Skeleton, StatCard, formatMoney, formatNumber, formatPercent, type Column } from '@/ui';
import { useSection } from './useSection';
import { RESERVATION_STATUS } from './reservationStatus';
import { SalonStatCards, useMinuteClock } from './SalonStatCards';
import type { Order } from '../../types';

interface LiveStats {
    todaySales: number;
    activeOrders: number;
    pendingPurchaseOrders: number;
    occupancyRate?: number;
    averageTicket?: number;
    settledOrdersCount?: number;
}
interface KitchenOrder { id: number; status: string }
interface ReservationRow { id: number; day?: string; time: string; name: string; pax: number; status: string; table?: string }
interface LowStockItem { name: string }

const KITCHEN_STATUSES = ['SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'];

interface AttentionItem { id: string; text: string; action: { label: string; to: string } }

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Pestaña "Operación en vivo": lo útil del dashboard anterior con el formato "Requiere atención". */
export function LiveOperations() {
    const stats = useSection<LiveStats>(async () => (await reportsAPI.getDashboardStats()).data.data, [], 'No se pudieron cargar los indicadores de hoy.');
    const kitchen = useSection<KitchenOrder[]>(async () => asArray<KitchenOrder>((await ordersAPI.getKitchenQueue()).data.data).filter((o) => KITCHEN_STATUSES.includes(o.status)), [], 'No se pudo cargar la cola de cocina.');
    const reservations = useSection<ReservationRow[]>(async () => asArray<ReservationRow>((await reportsAPI.getTodaysReservations(undefined, 7)).data.data), [], 'No se pudieron cargar las reservaciones.');
    // Salón: mismas órdenes activas de mesa que alimentaban las tarjetas del plano de mesas.
    const salon = useSection<Order[]>(async () => asArray<Order>((await ordersAPI.getActive(undefined, true)).data.data), [], 'No se pudo cargar el consumo de las mesas.');
    const lowStock = useSection<LowStockItem[]>(async () => asArray<LowStockItem>((await productsAPI.getLowStock()).data.data), [], 'No se pudo cargar el inventario.');

    // Una fuente que falló no aporta (ni "0 pendientes"): se avisa aparte y se excluye.
    const attention: AttentionItem[] = [];
    if (kitchen.data && kitchen.data.length > 0) {
        const ready = kitchen.data.filter((o) => o.status === 'READY').length;
        attention.push({
            id: 'kitchen',
            text: `${formatNumber(kitchen.data.length, 0)} órdenes en cocina${ready > 0 ? `, ${formatNumber(ready, 0)} listas para servir` : ''}`,
            action: { label: 'Abrir cocina', to: '/kitchen' },
        });
    }
    if (lowStock.data && lowStock.data.length > 0) {
        const names = lowStock.data.slice(0, 3).map((i) => i.name).join(', ');
        attention.push({
            id: 'stock',
            text: `${formatNumber(lowStock.data.length, 0)} productos bajo el mínimo: ${names}${lowStock.data.length > 3 ? '…' : ''}`,
            action: { label: 'Ver inventario', to: '/inventory' },
        });
    }
    if (stats.data && stats.data.pendingPurchaseOrders > 0) {
        attention.push({
            id: 'po',
            text: `${formatNumber(stats.data.pendingPurchaseOrders, 0)} órdenes de compra pendientes`,
            action: { label: 'Ver órdenes de compra', to: '/purchase-orders' },
        });
    }
    const failed = [
        stats.error && 'indicadores de hoy',
        kitchen.error && 'cola de cocina',
        reservations.error && 'reservaciones',
        salon.error && 'consumo de mesas',
        lowStock.error && 'inventario',
    ].filter(Boolean) as string[];

    const now = useMinuteClock();

    const columns: Column<ReservationRow>[] = [
        { key: 'day', header: 'Día', accessor: (r) => r.day ?? '' },
        { key: 'time', header: 'Hora', type: 'time' },
        { key: 'name', header: 'Cliente' },
        { key: 'pax', header: 'Personas', type: 'number', decimals: 0 },
        { key: 'status', header: 'Estado', type: 'status', accessor: (r) => RESERVATION_STATUS[r.status] ?? r.status },
    ];

    const statsLoading = stats.loading && !stats.data;

    return (
        <div className="bi-live">
            <div className="bi-kpis">
                {statsLoading ? <Skeleton height={104} /> : stats.error && !stats.data ? (
                    <section className="bi-section bi-kpis__wide"><LoadErrorState message={stats.error} onRetry={stats.reload} /></section>
                ) : stats.data ? (
                    <>
                        <StatCard
                            label="Ventas de hoy"
                            value={formatMoney(stats.data.todaySales)}
                            context={`${formatNumber(stats.data.settledOrdersCount ?? 0, 0)} órdenes cobradas · ticket ${formatMoney(stats.data.averageTicket ?? 0)}`}
                            action={{ label: 'Ver órdenes', to: '/orders' }}
                        />
                        <StatCard
                            label="Ocupación de mesas"
                            value={formatPercent(stats.data.occupancyRate ?? 0)}
                            context={`${formatNumber(stats.data.activeOrders, 0)} órdenes activas`}
                            action={{ label: 'Ver mesas', to: '/tables' }}
                        />
                    </>
                ) : null}
                {kitchen.data ? (
                    <StatCard
                        label="Cola de cocina"
                        value={formatNumber(kitchen.data.length, 0)}
                        context={`${formatNumber(kitchen.data.filter((o) => o.status === 'READY').length, 0)} listas para servir`}
                        tone={kitchen.data.some((o) => o.status === 'READY') ? 'warning' : 'neutral'}
                        action={{ label: 'Abrir cocina', to: '/kitchen' }}
                    />
                ) : null}
                {salon.data ? <SalonStatCards orders={salon.data} now={now} /> : null}
            </div>

            {failed.length > 0 ? (
                <div className="bi-notice" role="status">
                    <span>No disponible: {failed.join(', ')}. Se excluye de lo que requiere atención.</span>
                    <Button variant="ghost" size="sm" onClick={() => { stats.reload(); kitchen.reload(); reservations.reload(); salon.reload(); lowStock.reload(); }}>Reintentar</Button>
                </div>
            ) : null}

            <section className="bi-section" aria-labelledby="bi-attention">
                <header className="bi-section__head"><h2 id="bi-attention" className="bi-section__title">Requiere atención</h2></header>
                {attention.length === 0 ? (
                    <p className="bi-muted">{failed.length > 0 ? 'Sin alertas en las fuentes disponibles.' : 'Nada requiere atención ahora.'}</p>
                ) : (
                    <ul className="bi-attention">
                        {attention.map((a) => (
                            <li key={a.id} className="bi-attention__item">
                                <span className="bi-attention__text">{a.text}</span>
                                <Link className="bi-link" to={a.action.to}>{a.action.label}</Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="bi-section" aria-labelledby="bi-reservations">
                <header className="bi-section__head"><h2 id="bi-reservations" className="bi-section__title">Próximas reservas</h2></header>
                {reservations.loading && !reservations.data ? <Skeleton height={120} /> : reservations.error && !reservations.data ? (
                    <LoadErrorState message={reservations.error} onRetry={reservations.reload} />
                ) : (
                    <DataTable
                        columns={columns}
                        rows={reservations.data ?? []}
                        rowKey={(r) => r.id}
                        ariaLabel="Próximas reservas"
                        variant="flat"
                        empty={<EmptyState title="Sin reservas próximas" />}
                        minWidth="0"
                    />
                )}
            </section>
        </div>
    );
}
