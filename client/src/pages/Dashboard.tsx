import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { reportsAPI, reservationsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCurrency } from '../hooks/useCurrency';
import { getOrderStatusLabel } from '../utils/orderStatus';
import type { Order } from '../types';
import {
    Badge, Button, DataTable, FullScreenModal, LoadErrorState, PageContent, PageHeader, Skeleton, StatCard,
    formatNumber, toneFor, type Column, type Tone,
} from '@/ui';
import { RESERVATION_STATUS } from './dashboard/reservationStatus';
import './Dashboard.css';

interface ApiResponse {
    data: { data: unknown };
}

interface TopProduct {
    menuItemId: number;
    name: string;
    totalQuantity: number;
    totalRevenue: number;
    category?: string;
}

interface RecentOrder {
    id: number;
    table: string;
    total: number;
    status: string;
}

interface ReservationSummary {
    id: number;
    day?: string;
    time: string;
    name: string;
    pax: number;
    status: string;
}

interface UpcomingReservation {
    id: number;
    customerName: string;
    date: string;
    peopleCount: number;
    status: string;
}

interface KitchenQueueItem {
    id: number;
    table: string;
    items: number;
    elapsed: number;
    status: string;
}

interface TopDishItem {
    menuItemId: number;
    name: string;
    totalQuantity: number;
}

interface LowStockProduct {
    name: string;
    current: number;
    min: number;
    unit: string;
}

interface ConsumedProduct {
    name: string;
    consumed: number;
    unit: string;
}

interface MovementItem {
    product: string;
    type: string;
    quantity: number;
    unit: string;
    reason?: string;
}

interface ActiveShiftInfo {
    registerName: string;
    startAmount: number;
    cashAccumulated: number;
    startDate: string;
}

interface PaymentBreakdownItem {
    method: string;
    total: number;
}

interface MyStats {
    role: string;
    salesToday?: number;
    ordersToday?: number;
    avgTicket?: number;
    topProduct?: string;
    pendingOrders?: number;
    readyOrders?: number;
    lowStockCount?: number;
    criticalCount?: number;
    pendingPOs?: number;
    kitchenQueue?: KitchenQueueItem[];
    topDishes?: TopDishItem[];
    lowStockProducts?: LowStockProduct[];
    topConsumed?: ConsumedProduct[];
    recentMovements?: MovementItem[];
    myOrders?: RecentOrder[];
    topProducts?: TopProduct[];
    activeShift?: ActiveShiftInfo;
    paymentBreakdown?: PaymentBreakdownItem[];
}

const REQUEST_TIMEOUT_MS = 5000;
const PAGE_SIZE = 5;

const withTimeout = <T,>(promise: Promise<T>) =>
    Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT_MS))]);

const orderStatusLabel = (status: string) =>
    getOrderStatusLabel(status.toUpperCase().replace(/-/g, '_') as Order['status']);

const KITCHEN_STATUS: Record<string, { label: string; tone: Tone }> = {
    sent_to_kitchen: { label: 'En cocina', tone: 'warning' },
    ready: { label: 'Lista', tone: 'success' },
};

/** Bloque plano con título: sin caja propia, la tabla del kit es la única superficie. */
function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="dashboard-section" aria-label={title}>
            <h2 className="dashboard-section__title">{title}</h2>
            {children}
        </section>
    );
}

export default function Dashboard() {
    const { user } = useAuth();
    const { formatMoney: formatCurrency } = useCurrency();
    const [myStats, setMyStats] = useState<MyStats | null>(null);
    const [reservations, setReservations] = useState<ReservationSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<RecentOrder | null>(null);

    const loadData = useCallback(async () => {
        setLoadError(null);
        try {
            const [myStatsRes, reservationsRes] = await Promise.allSettled([
                withTimeout(reportsAPI.getMyStats()),
                withTimeout(reservationsAPI.getUpcoming(7)),
            ]);
            if (myStatsRes.status === 'fulfilled') setMyStats((myStatsRes.value as ApiResponse).data.data as MyStats);
            else setLoadError('No se pudieron cargar las estadísticas del panel.');
            if (reservationsRes.status === 'fulfilled') {
                const upcoming = ((reservationsRes.value as ApiResponse).data.data as UpcomingReservation[]) || [];
                setReservations(upcoming.map((reservation) => ({
                    id: reservation.id,
                    day: new Date(reservation.date).toLocaleDateString('es-MX', { weekday: 'short' }),
                    time: new Date(reservation.date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
                    name: reservation.customerName,
                    pax: reservation.peopleCount,
                    status: reservation.status,
                })));
            }
        } catch {
            setLoadError('No se pudieron cargar los datos del panel.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const retryLoad = () => {
        setLoading(true);
        void loadData();
    };

    const money = useCallback((value: unknown) => formatCurrency(Number(value) || 0), [formatCurrency]);

    // ── Columnas reutilizables ──
    const orderColumns: Column<RecentOrder>[] = useMemo(() => [
        { key: 'id', header: 'Orden', width: '0.8fr' },
        { key: 'table', header: 'Mesa', width: '1fr' },
        { key: 'total', header: 'Total', width: '1fr', align: 'right', render: (row) => money(row.total) },
        {
            key: 'status', header: 'Estado', width: '1.2fr',
            render: (row) => <Badge tone={toneFor(row.status.toUpperCase())} dot>{orderStatusLabel(row.status)}</Badge>,
        },
    ], [money]);

    const kitchenColumns: Column<KitchenQueueItem>[] = useMemo(() => [
        { key: 'id', header: 'Orden', width: '0.8fr' },
        { key: 'table', header: 'Mesa', width: '1fr', render: (row) => `Mesa ${row.table}` },
        { key: 'items', header: 'Platos', width: '0.8fr', type: 'number', decimals: 0 },
        { key: 'elapsed', header: 'Min', headerTitle: 'Minutos en cola', width: '0.8fr', type: 'number', decimals: 0 },
        {
            key: 'status', header: 'Estado', width: '1.2fr',
            render: (row) => {
                const meta = KITCHEN_STATUS[row.status] ?? { label: 'Lista', tone: 'success' as Tone };
                return <Badge tone={meta.tone} dot>{meta.label}</Badge>;
            },
        },
    ], []);

    const dishColumns: Column<TopDishItem>[] = [
        { key: 'name', header: 'Plato', width: '1.6fr' },
        { key: 'totalQuantity', header: 'Pedidos', width: '1fr', type: 'number', decimals: 0 },
    ];

    const productColumns: Column<TopProduct>[] = useMemo(() => [
        { key: 'name', header: 'Producto', width: '1.6fr' },
        { key: 'totalQuantity', header: 'Vendidos', width: '1fr', type: 'number', decimals: 0 },
        { key: 'totalRevenue', header: 'Ingreso', width: '1fr', align: 'right', render: (row) => money(row.totalRevenue) },
    ], [money]);

    const lowStockColumns: Column<LowStockProduct>[] = [
        { key: 'name', header: 'Producto', width: '1.6fr' },
        {
            key: 'current', header: 'Existencia', width: '1.2fr', align: 'right',
            render: (row) => (
                <span className={row.current === 0 ? 'dashboard-stock dashboard-stock--out' : 'dashboard-stock dashboard-stock--low'}>
                    {formatNumber(row.current)} {row.unit}
                </span>
            ),
        },
        { key: 'min', header: 'Mínimo', width: '1fr', type: 'number' },
    ];

    const consumedColumns: Column<ConsumedProduct>[] = [
        { key: 'name', header: 'Producto', width: '1.6fr' },
        { key: 'consumed', header: 'Consumo', width: '1.2fr', align: 'right', render: (row) => `${formatNumber(row.consumed)} ${row.unit}` },
    ];

    const movementColumns: Column<MovementItem>[] = [
        { key: 'product', header: 'Producto', width: '1.6fr' },
        { key: 'reason', header: 'Motivo', width: '1.2fr', render: (row) => row.reason || row.type },
        {
            key: 'quantity', header: 'Cantidad', width: '1.2fr', align: 'right',
            render: (row) => (
                <span className={row.type === 'IN' ? 'dashboard-stock dashboard-stock--in' : 'dashboard-stock dashboard-stock--out'}>
                    {row.type === 'IN' ? '+' : '-'}{formatNumber(row.quantity)} {row.unit}
                </span>
            ),
        },
    ];

    const paymentColumns: Column<PaymentBreakdownItem>[] = useMemo(() => [
        { key: 'method', header: 'Método', width: '1.6fr' },
        { key: 'total', header: 'Total', width: '1fr', align: 'right', render: (row) => money(row.total) },
    ], [money]);

    const reservationColumns: Column<ReservationSummary>[] = [
        { key: 'when', header: 'Cuándo', width: '1fr', render: (row) => [row.day, row.time].filter(Boolean).join(' ') },
        { key: 'name', header: 'Cliente', width: '1.6fr' },
        { key: 'pax', header: 'Personas', width: '0.8fr', type: 'number', decimals: 0 },
        { key: 'status', header: 'Estado', width: '1fr', render: (row) => <Badge tone={toneFor(row.status.toUpperCase())} dot>{RESERVATION_STATUS[row.status] ?? row.status}</Badge> },
    ];

    if (loading) {
        return (
            <PageContent>
                <PageHeader title="Mi panel" description="Cargando tu resumen del día…" />
                <div className="dashboard-skeleton" aria-busy="true">
                    <Skeleton height={96} />
                    <Skeleton height={96} />
                    <Skeleton height={240} />
                </div>
            </PageContent>
        );
    }

    if (loadError && !myStats) {
        return (
            <PageContent>
                <PageHeader title="Mi panel" />
                <LoadErrorState message={loadError} onRetry={retryLoad} />
            </PageContent>
        );
    }

    const stats: MyStats = myStats ?? { role: '' };
    const role = stats.role;
    const greeting = user?.name ? `Hola, ${user.name}` : undefined;

    const reservationsSection = (
        <Section title="Reservas próximas">
            <DataTable
                ariaLabel="Reservas próximas"
                columns={reservationColumns}
                rows={reservations}
                rowKey={(row) => row.id}
                defaultPageSize={PAGE_SIZE}
                pageSizeOptions={[PAGE_SIZE, 10, 20]}
                hidePaginationIfSinglePage
                empty="Sin reservas próximas"
            />
        </Section>
    );

    const stockCard = (low: number | undefined) => (
        <StatCard
            label="Stock bajo"
            value={formatNumber(low ?? 0, 0)}
            tone={(low ?? 0) > 0 ? 'warning' : 'success'}
            context={(low ?? 0) > 0 ? 'Productos bajo el mínimo: conviene reponer' : 'Inventario sobre el mínimo'}
            action={(low ?? 0) > 0 ? { label: 'Ver inventario', to: '/inventory' } : undefined}
        />
    );

    const kitchenCards = (
        <>
            <StatCard
                label="En cola"
                value={formatNumber(stats.pendingOrders ?? 0, 0)}
                tone={(stats.pendingOrders ?? 0) > 0 ? 'warning' : 'neutral'}
                context="Órdenes pendientes de preparar"
                action={{ label: 'Abrir cocina', to: '/kitchen' }}
            />
            <StatCard
                label="Para entregar"
                value={formatNumber(stats.readyOrders ?? 0, 0)}
                tone={(stats.readyOrders ?? 0) > 0 ? 'success' : 'neutral'}
                context="Listas esperando al mesero"
            />
        </>
    );

    const topDishesSection = (
        <Section title="Platos más solicitados hoy">
            <DataTable
                ariaLabel="Platos más solicitados hoy"
                columns={dishColumns}
                rows={stats.topDishes ?? []}
                rowKey={(row) => row.menuItemId}
                defaultPageSize={PAGE_SIZE}
                hidePaginationIfSinglePage
                empty="Sin datos aún"
            />
        </Section>
    );

    const consumedSection = (
        <Section title="Más consumidos (semana)">
            <DataTable
                ariaLabel="Más consumidos de la semana"
                columns={consumedColumns}
                rows={stats.topConsumed ?? []}
                rowKey={(row) => row.name}
                defaultPageSize={PAGE_SIZE}
                hidePaginationIfSinglePage
                empty="Sin datos"
            />
        </Section>
    );

    let title = 'Mi panel';
    let cards: ReactNode;
    let body: ReactNode;

    if (role === 'COCINA') {
        title = 'Panel de cocina';
        cards = kitchenCards;
        body = (
            <>
                <Section title="Cola de cocina">
                    <DataTable
                        ariaLabel="Cola de cocina"
                        columns={kitchenColumns}
                        rows={stats.kitchenQueue ?? []}
                        rowKey={(row) => row.id}
                        defaultPageSize={PAGE_SIZE}
                        pageSizeOptions={[PAGE_SIZE, 10, 20]}
                        hidePaginationIfSinglePage
                        empty="Sin órdenes en cola"
                    />
                </Section>
                {topDishesSection}
            </>
        );
    } else if (role === 'CHEF') {
        title = 'Panel de chef';
        cards = (
            <>
                {kitchenCards}
                {stockCard(stats.lowStockCount)}
            </>
        );
        body = (
            <>
                <Section title="Ingredientes con stock bajo">
                    <DataTable
                        ariaLabel="Ingredientes con stock bajo"
                        columns={lowStockColumns}
                        rows={stats.lowStockProducts ?? []}
                        rowKey={(row) => row.name}
                        defaultPageSize={PAGE_SIZE}
                        hidePaginationIfSinglePage
                        empty="Inventario OK"
                    />
                </Section>
                {consumedSection}
                {topDishesSection}
            </>
        );
    } else if (role === 'BODEGA') {
        title = 'Panel de bodega';
        cards = (
            <>
                {stockCard(stats.lowStockCount)}
                <StatCard
                    label="Sin existencia"
                    value={formatNumber(stats.criticalCount ?? 0, 0)}
                    tone={(stats.criticalCount ?? 0) > 0 ? 'danger' : 'success'}
                    context={(stats.criticalCount ?? 0) > 0 ? 'Productos agotados: riesgo de faltante' : 'Sin productos agotados'}
                    action={(stats.criticalCount ?? 0) > 0 ? { label: 'Ver inventario', to: '/inventory' } : undefined}
                />
                <StatCard
                    label="OCs pendientes"
                    value={formatNumber(stats.pendingPOs ?? 0, 0)}
                    tone={(stats.pendingPOs ?? 0) > 0 ? 'warning' : 'neutral'}
                    context="Órdenes de compra por recibir o aprobar"
                    action={(stats.pendingPOs ?? 0) > 0 ? { label: 'Ver órdenes de compra', to: '/purchase-orders' } : undefined}
                />
            </>
        );
        body = (
            <>
                <Section title="Productos con stock bajo">
                    <DataTable
                        ariaLabel="Productos con stock bajo"
                        columns={lowStockColumns}
                        rows={stats.lowStockProducts ?? []}
                        rowKey={(row) => row.name}
                        defaultPageSize={PAGE_SIZE}
                        pageSizeOptions={[PAGE_SIZE, 10, 20]}
                        hidePaginationIfSinglePage
                        empty="Todo el inventario está bien"
                    />
                </Section>
                {consumedSection}
                <Section title="Últimos movimientos">
                    <DataTable
                        ariaLabel="Últimos movimientos de inventario"
                        columns={movementColumns}
                        rows={stats.recentMovements ?? []}
                        rowKey={(row) => `${row.product}-${row.type}-${row.quantity}-${row.reason ?? ''}`}
                        defaultPageSize={PAGE_SIZE}
                        hidePaginationIfSinglePage
                        empty="Sin movimientos recientes"
                    />
                </Section>
            </>
        );
    } else if (role === 'CAJERO') {
        title = 'Panel de caja';
        const shift = stats.activeShift;
        cards = (
            <>
                <StatCard
                    label="Mis ventas hoy"
                    value={money(stats.salesToday)}
                    tone="primary"
                    context={`${formatNumber(stats.ordersToday ?? 0, 0)} órdenes cobradas · ticket promedio ${money(stats.avgTicket)}`}
                />
                {shift ? (
                    <StatCard
                        label="Efectivo en caja"
                        value={money(shift.cashAccumulated)}
                        tone="success"
                        context={`${shift.registerName} · apertura ${money(shift.startAmount)} a las ${new Date(shift.startDate).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`}
                    />
                ) : (
                    <StatCard
                        label="Turno de caja"
                        value="Sin turno"
                        tone="warning"
                        context="No hay turno activo: ábrelo para poder cobrar"
                        action={{ label: 'Ir a Caja', to: '/cash-registers' }}
                    />
                )}
            </>
        );
        body = (
            <>
                <Section title="Métodos de pago hoy">
                    <DataTable
                        ariaLabel="Métodos de pago hoy"
                        columns={paymentColumns}
                        rows={stats.paymentBreakdown ?? []}
                        rowKey={(row) => row.method}
                        defaultPageSize={PAGE_SIZE}
                        hidePaginationIfSinglePage
                        empty="Sin pagos hoy"
                    />
                </Section>
                {reservationsSection}
            </>
        );
    } else {
        cards = (
            <StatCard
                label="Mis ventas hoy"
                value={money(stats.salesToday)}
                tone="primary"
                context={`${formatNumber(stats.ordersToday ?? 0, 0)} órdenes · ticket promedio ${money(stats.avgTicket)}${stats.topProduct ? ` · top: ${stats.topProduct}` : ''}`}
            />
        );
        body = (
            <>
                <Section title="Mis órdenes activas">
                    <DataTable
                        ariaLabel="Mis órdenes activas"
                        columns={orderColumns}
                        rows={stats.myOrders ?? []}
                        rowKey={(row) => row.id}
                        defaultPageSize={PAGE_SIZE}
                        pageSizeOptions={[PAGE_SIZE, 10, 20]}
                        hidePaginationIfSinglePage
                        empty="Sin órdenes activas"
                        onRowClick={setSelectedOrder}
                    />
                </Section>
                <Section title="Mi top 5">
                    <DataTable
                        ariaLabel="Mi top 5 de productos"
                        columns={productColumns}
                        rows={stats.topProducts ?? []}
                        rowKey={(row) => row.menuItemId}
                        defaultPageSize={PAGE_SIZE}
                        hidePaginationIfSinglePage
                        empty="Sin datos aún"
                    />
                </Section>
                {reservationsSection}
            </>
        );
    }

    return (
        <PageContent>
            <PageHeader title={title} description={greeting} />
            {loadError ? <LoadErrorState message={loadError} onRetry={retryLoad} /> : null}
            <div className="dashboard-kpis">{cards}</div>
            <div className="dashboard-grid">{body}</div>

            <FullScreenModal
                isOpen={!!selectedOrder}
                onClose={() => setSelectedOrder(null)}
                title="Detalle de orden"
                subtitle={selectedOrder ? `Orden ${selectedOrder.id}` : undefined}
                size="compact"
                footer={({ requestClose }) => <Button onClick={requestClose}>Cerrar</Button>}
            >
                {selectedOrder && (
                    <dl className="dashboard-detail">
                        <div><dt>Mesa</dt><dd>{selectedOrder.table}</dd></div>
                        <div><dt>Estado</dt><dd><Badge tone={toneFor(selectedOrder.status.toUpperCase())} dot>{orderStatusLabel(selectedOrder.status)}</Badge></dd></div>
                        <div><dt>Total</dt><dd className="dashboard-detail__num">{money(selectedOrder.total)}</dd></div>
                    </dl>
                )}
            </FullScreenModal>
        </PageContent>
    );
}
