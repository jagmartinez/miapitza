import { useEffect, useState, Fragment, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { reportsAPI, reservationsAPI, productsAPI } from '../services/api';
import { hasAnyRole } from '../utils/authz';
import { getOrderStatusLabel } from '../utils/orderStatus';
import { activateOnKeyboard } from '../utils/keyboardActivation';
import type { Order } from '../types';
import { ADMIN } from '../constants/roles';
import { useCurrency } from '../hooks/useCurrency';
import Select from '../components/Select';
import type { SingleValue } from 'react-select';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { LoadingOverlay } from '../components/LoadingSpinner';
import {
    DollarSign,
    Users,
    Package,
    Clock,
    Calendar,
    ChevronRight,
    Utensils,
    CreditCard,
    Ticket,
    Activity,
    Award,
    AlertCircle,
    AlertTriangle,
    ChefHat,
    Timer,
    Flame,
    Warehouse,
    TrendingDown,
    ArrowUpDown,
    Wallet,
    FileText,
    CalendarCheck,
    ClipboardList
} from 'lucide-react';
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Cell,
    ScatterChart,
    Scatter,
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    Treemap
} from 'recharts';
import './Dashboard.css';

interface ApiResponse {
    data: { data: unknown };
}

interface DashboardStats {
    todaySales: number;
    activeOrders: number;
    pendingPurchaseOrders: number;
    occupancyRate?: number;
    averageTicket?: number;
    settledOrdersCount?: number;
}

interface TopProduct {
    menuItemId: number;
    name: string;
    totalQuantity: number;
    totalRevenue: number;
    category: string;
}

interface IncomeDataPoint {
    name: string;
    value: number;
    fill: string;
}

interface ScatterDataPoint {
    waitTime?: number;
    tip?: number;
    dwellTime?: number;
    spend?: number;
}

interface HeatmapPoint {
    day: string;
    hour: number;
    value: number;
}

interface RadarDataPoint {
    subject: string;
    A: number;
    B: number;
}

interface RecentOrder {
    id: number;
    table: string;
    total: number;
    status: string;
    waiter?: string;
    createdAt?: string;
    items?: OrderItemSummary[];
    customerName?: string;
}

interface OrderItemSummary {
    id?: number;
    menuItemId?: number;
    name: string;
    quantity: number;
    price: number;
    subtotal?: number;
}

interface RecentInvoice {
    id: number;
    time: string;
    amount: number;
    status: string;
    paymentMethod?: string;
    customer?: string;
}

interface ReservationSummary {
    id: number;
    day?: string;
    time: string;
    name: string;
    pax: number;
    status: string;
    phone?: string;
    table?: string;
    notes?: string;
}

interface UpcomingReservation {
    id: number;
    customerName: string;
    date: string;
    peopleCount: number;
    status: string;
    phone?: string;
    notes?: string;
}

interface MyStats {
    role: string;
    salesToday?: number;
    ordersToday?: number;
    avgTicket?: number;
    topProduct?: string;
    pendingOrders?: number;
    readyOrders?: number;
    dishesToday?: number;
    lowStockCount?: number;
    criticalCount?: number;
    pendingPOs?: number;
    invoicesToday?: number;
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

interface CategoryOption {
    value: string;
    label: string;
}

export default function Dashboard() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { formatMoney: formatCurrency, symbol: currencySymbol } = useCurrency();
    const isAdmin = hasAnyRole(user, ADMIN);
    const [stats, setStats] = useState({
        todaySales: 0,
        activeOrders: 0,
        pendingPurchaseOrders: 0
    });
    /** True only after at least one successful KPI fetch — avoids painting fake zeros as success. */
    const [statsHydrated, setStatsHydrated] = useState(false);
    const statsHydratedRef = useRef(false);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [incomeData, setIncomeData] = useState<IncomeDataPoint[]>([]);
    const [scatterTipsData, setScatterTipsData] = useState<ScatterDataPoint[]>([]);
    const [scatterSpendData, setScatterSpendData] = useState<ScatterDataPoint[]>([]);
    const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);
    const [radarData, setRadarData] = useState<RadarDataPoint[]>([]);
    const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([]);
    const [todaysReservations, setTodaysReservations] = useState<ReservationSummary[]>([]);
    const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
    const [myStats, setMyStats] = useState<MyStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(new Date());

    // Individual period states for BI charts
    type ChartPeriod = 'today' | 'week' | 'month' | 'year';
    const [incomePeriod, setIncomePeriod] = useState<ChartPeriod>('month');
    const [tipsPeriod, setTipsPeriod] = useState<ChartPeriod>('week');
    const [spendPeriod, setSpendPeriod] = useState<ChartPeriod>('week');
    const [heatmapPeriod, setHeatmapPeriod] = useState<ChartPeriod>('week');
    const [radarPeriod, setRadarPeriod] = useState<ChartPeriod>('week');
    const [treemapCategory, setTreemapCategory] = useState<{ value: string; label: string }>({ value: 'all', label: 'Todas las Categorías' });

    // Period labels for display
    const periodLabels: Record<ChartPeriod, string> = {
        today: 'Hoy',
        week: 'Sem',
        month: 'Mes',
        year: 'Año'
    };

    // Period Selector Component
    const PeriodSelector = ({ value, onChange }: { value: ChartPeriod; onChange: (p: ChartPeriod) => void }) => (
        <div className="period-selector">
            {(['today', 'week', 'month', 'year'] as ChartPeriod[]).map(p => (
                <button
                    key={p}
                    className={`period-btn ${value === p ? 'active' : ''}`}
                    onClick={() => onChange(p)}
                >
                    {periodLabels[p]}
                </button>
            ))}
        </div>
    );

    // Pagination states for widgets
    const [ordersPage, setOrdersPage] = useState(0);
    const [invoicesPage, setInvoicesPage] = useState(0);
    const [reservationsPage, setReservationsPage] = useState(0);
    const WIDGET_PAGE_SIZE = 5;

    // Modal states
    const [selectedProduct, setSelectedProduct] = useState<TopProduct | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<RecentOrder | null>(null);
    const [selectedInvoice, setSelectedInvoice] = useState<RecentInvoice | null>(null);
    const [selectedReservation, setSelectedReservation] = useState<ReservationSummary | null>(null);
    const [stockAlerts, setStockAlerts] = useState<{ name: string }[]>([]);

    const formatOrderStatus = (status: string) => {
        const normalized = status.toUpperCase().replace(/-/g, '_') as Order['status'];
        return getOrderStatusLabel(normalized);
    };

    const loadData = useCallback(async () => {
        try {
            setLoadError(null);
            const timeout = (ms: number) => new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), ms)
            );

            // Personal dashboard for non-admin roles
            if (!isAdmin) {
                const [myStatsRes, reservationsRes] = await Promise.allSettled([
                    Promise.race([reportsAPI.getMyStats(), timeout(5000)]),
                    Promise.race([reservationsAPI.getUpcoming(7), timeout(5000)]),
                ]);
                if (myStatsRes.status === 'fulfilled') setMyStats((myStatsRes.value as ApiResponse).data.data as MyStats);
                else setLoadError('No se pudieron cargar las estadísticas del panel.');
                if (reservationsRes.status === 'fulfilled') {
                    const reservations = ((reservationsRes.value as ApiResponse).data.data as UpcomingReservation[]) || [];
                    const mapped: ReservationSummary[] = reservations.map((reservation) => ({
                        id: reservation.id,
                        day: new Date(reservation.date).toLocaleDateString('es-MX', { weekday: 'short' }),
                        time: new Date(reservation.date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
                        name: reservation.customerName,
                        pax: reservation.peopleCount,
                        status: reservation.status,
                        phone: reservation.phone,
                        notes: reservation.notes
                    }));
                    setTodaysReservations(mapped);
                }
                setLoading(false);
                return;
            }

            // Full BI dashboard for admin roles
            const [statsRes, topProductsRes, ordersRes, invoicesRes, reservationsRes, incomeRes, heatmapRes, radarRes, trendsRes, lowStockRes] = await Promise.allSettled([
                Promise.race([reportsAPI.getDashboardStats(), timeout(5000)]),
                Promise.race([reportsAPI.getTopProducts(undefined, 40), timeout(5000)]),
                Promise.race([reportsAPI.getRecentOrders(undefined, 50), timeout(5000)]),
                Promise.race([reportsAPI.getRecentInvoices(undefined, 50, true), timeout(5000)]),
                Promise.race([reportsAPI.getTodaysReservations(undefined, 7), timeout(5000)]),
                Promise.race([reportsAPI.getIncomeBreakdown(incomePeriod), timeout(5000)]),
                Promise.race([reportsAPI.getOccupancyHeatmap(heatmapPeriod), timeout(5000)]),
                Promise.race([reportsAPI.getShiftEvaluation(radarPeriod), timeout(5000)]),
                Promise.race([reportsAPI.getServiceTrends(tipsPeriod, spendPeriod), timeout(5000)]),
                Promise.race([productsAPI.getLowStock(), timeout(5000)]),
            ]);

            if (statsRes.status === 'fulfilled') {
                const data = (statsRes.value as ApiResponse).data.data as DashboardStats;
                setStats(data);
                setStatsHydrated(true);
                statsHydratedRef.current = true;
            }
            // On KPI failure: keep last good values (or unhydrated state). Never paint fake zeros as success.

            if (topProductsRes.status === 'fulfilled') {
                setTopProducts((topProductsRes.value as ApiResponse).data.data as TopProduct[]);
            } else if (topProductsRes.status === 'rejected') setTopProducts([]);

            if (ordersRes.status === 'fulfilled') {
                setRecentOrders((ordersRes.value as ApiResponse).data.data as RecentOrder[]);
            } else if (ordersRes.status === 'rejected') setRecentOrders([]);

            if (invoicesRes.status === 'fulfilled') {
                setRecentInvoices((invoicesRes.value as ApiResponse).data.data as RecentInvoice[]);
            } else if (invoicesRes.status === 'rejected') setRecentInvoices([]);

            if (reservationsRes.status === 'fulfilled') {
                setTodaysReservations((reservationsRes.value as ApiResponse).data.data as ReservationSummary[]);
            } else if (reservationsRes.status === 'rejected') setTodaysReservations([]);

            if (incomeRes.status === 'fulfilled') {
                setIncomeData((incomeRes.value as ApiResponse).data.data as IncomeDataPoint[]);
            } else if (incomeRes.status === 'rejected') setIncomeData([]);

            if (heatmapRes.status === 'fulfilled') {
                setHeatmapData((heatmapRes.value as ApiResponse).data.data as HeatmapPoint[]);
            } else if (heatmapRes.status === 'rejected') setHeatmapData([]);

            if (radarRes.status === 'fulfilled') {
                setRadarData((radarRes.value as ApiResponse).data.data as RadarDataPoint[]);
            } else if (radarRes.status === 'rejected') setRadarData([]);

            if (trendsRes.status === 'fulfilled') {
                const data = (trendsRes.value as ApiResponse).data.data as { tips: ScatterDataPoint[]; spend: ScatterDataPoint[] };
                setScatterTipsData(data.tips);
                setScatterSpendData(data.spend);
            } else if (trendsRes.status === 'rejected') {
                setScatterTipsData([]);
                setScatterSpendData([]);
            }

            if (lowStockRes.status === 'fulfilled') {
                const items = (lowStockRes.value as ApiResponse).data.data as { name: string }[];
                setStockAlerts(items || []);
            } else if (lowStockRes.status === 'rejected') {
                setStockAlerts([]);
            }

            const widgetResults: Array<{ name: string; result: PromiseSettledResult<unknown> }> = [
                { name: 'indicadores', result: statsRes }, { name: 'productos', result: topProductsRes },
                { name: 'órdenes', result: ordersRes }, { name: 'facturas', result: invoicesRes },
                { name: 'reservaciones', result: reservationsRes }, { name: 'ingresos', result: incomeRes },
                { name: 'demanda horaria', result: heatmapRes }, { name: 'turnos', result: radarRes },
                { name: 'tendencias', result: trendsRes }, { name: 'inventario', result: lowStockRes }
            ];
            const failedWidgets = widgetResults.filter(({ result }) => result.status === 'rejected').map(({ name }) => name);
            if (failedWidgets.length > 0) {
                const kpiFailed = failedWidgets.includes('indicadores');
                setLoadError(
                    kpiFailed && !statsHydratedRef.current
                        ? `No se pudieron cargar: ${failedWidgets.join(', ')}. Los indicadores no muestran valores hasta reintentar.`
                        : `No se pudieron actualizar: ${failedWidgets.join(', ')}. Los componentes afectados se muestran vacíos o con el último valor válido.`
                );
            }

        } catch {
            setLoadError('No se pudieron cargar los datos del panel.');
        } finally {
            setLoading(false);
        }
    }, [heatmapPeriod, incomePeriod, isAdmin, radarPeriod, spendPeriod, tipsPeriod]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const occupancyRate = (stats as DashboardStats).occupancyRate || 0;
    const averageTicket = (stats as DashboardStats).averageTicket || 0;
    const settledOrdersCount = (stats as DashboardStats).settledOrdersCount || 0;
    const kpisUnavailable = Boolean(loadError?.includes('indicadores')) && !statsHydrated;
    const formatKpiMoney = (value: number) => (kpisUnavailable ? '—' : formatCurrency(Number(value)));
    const formatKpiNumber = (value: number, suffix = '') => (kpisUnavailable ? '—' : `${value.toLocaleString()}${suffix}`);

    if (loading) {
        return <LoadingOverlay text="Cargando panel..." />;
    }

    const retryLoad = () => {
        setLoading(true);
        void loadData();
    };

    if (loadError && !isAdmin && !myStats) {
        return (
            <div className="dashboard">
                <div className="dashboard-load-error">
                    <AlertTriangle size={48} />
                    <h2>Error al cargar el panel</h2>
                    <p>{loadError}</p>
                    <button type="button" className="dashboard-retry-btn" onClick={retryLoad}>
                        Reintentar
                    </button>
                </div>
            </div>
        );
    }

    // ═══════════════════════════════════════════════════
    // ROLE-SPECIFIC DASHBOARDS (non-admin)
    // ═══════════════════════════════════════════════════

    /** Shared header for personal dashboards */
    const PersonalHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
        <header className="dashboard-header-hero">
            <div className="header-greeting">
                <h1>{title}</h1>
                <p className="subtitle">{subtitle}</p>
            </div>
            <div className="header-actions-wrapper">
                <div className="header-meta-group">
                    <div className="header-time">
                        <Clock size={16} className="text-primary" />
                        <span>{currentTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                        <div className="divider-v"></div>
                        <Calendar size={16} className="text-secondary" />
                        <span className="date-text">{currentTime.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
                    </div>
                </div>
            </div>
        </header>
    );

    // ── COCINA DASHBOARD ──
    if (!isAdmin && myStats?.role === 'COCINA') {
        return (
            <div className="dashboard">
                <PersonalHeader title="Cocina" subtitle={`Chef ${user?.name}`} />
                <div className="bento-grid final-layout">
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-orange"><Flame size={20} className="text-orange" /></div><span className="stat-percentage warning">Pendientes</span></div>
                        <div className="stat-body"><h3>En Cola</h3><div className="stat-number">{myStats.pendingOrders || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-green"><ChefHat size={20} className="text-green" /></div><span className="stat-percentage positive">Listas</span></div>
                        <div className="stat-body"><h3>Para Entregar</h3><div className="stat-number">{myStats.readyOrders || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-primary"><Utensils size={20} className="text-primary" /></div><span className="stat-percentage neutral">Hoy</span></div>
                        <div className="stat-body"><h3>Platos Preparados</h3><div className="stat-number">{myStats.dishesToday || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-purple"><Timer size={20} className="text-purple" /></div><span className="stat-percentage neutral">Cola</span></div>
                        <div className="stat-body"><h3>Órdenes en Cocina</h3><div className="stat-number">{(myStats.pendingOrders || 0) + (myStats.readyOrders || 0)}</div></div>
                    </div>

                    {/* Kitchen Queue */}
                    <div className="bento-item orders-section" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Cola de Cocina</h3><ChefHat size={16} className="text-warning" /></div>
                        <div className="orders-list">
                            {(!myStats.kitchenQueue || myStats.kitchenQueue.length === 0) ? (
                                <div className="dashboard-widget-empty">
                                    <EmptyState
                                        icon={<ChefHat size={32} />}
                                        title="Sin órdenes en cola"
                                    />
                                </div>
                            ) : myStats.kitchenQueue.map((ord: KitchenQueueItem) => (
                                <div key={ord.id} className="ord-row">
                                    <div className="ord-meta">
                                        <span className="ord-id">{ord.id}</span>
                                        <span className="ord-table">Mesa {ord.table}</span>
                                    </div>
                                    <div className="ord-right">
                                        <span className="ord-total">{ord.items} platos</span>
                                        <span className="ord-total" style={{ opacity: 0.7 }}>{ord.elapsed} min</span>
                                        <span className={`ord-status status-${ord.status}`}>{ord.status === 'sent_to_kitchen' ? 'EN COCINA' : 'LISTA'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Top Dishes Today */}
                    <div className="bento-item top-products-compact" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Platos Más Solicitados Hoy</h3><Award size={16} className="text-warning" /></div>
                        <div className="leaderboard-compact-list">
                            {(myStats.topDishes || []).map((p: TopDishItem, i: number) => (
                                <div key={p.menuItemId} className="lb-compact-row">
                                    <div className={`lb-rank rank-${i + 1}`}>{i + 1}</div>
                                    <div className="lb-info"><span className="lb-name">{p.name}</span><span className="lb-sub">{p.totalQuantity} pedidos</span></div>
                                </div>
                            ))}
                            {(!myStats.topDishes || myStats.topDishes.length === 0) && <div className="widget-empty">Sin datos aún</div>}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── CHEF DASHBOARD (kitchen + inventory) ──
    if (!isAdmin && myStats?.role === 'CHEF') {
        return (
            <div className="dashboard">
                <PersonalHeader title="Chef" subtitle={`${user?.name} — Jefe de Cocina`} />
                <div className="bento-grid final-layout">
                    {/* Kitchen KPIs */}
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-orange"><Flame size={20} className="text-orange" /></div><span className="stat-percentage warning">Pendientes</span></div>
                        <div className="stat-body"><h3>En Cola</h3><div className="stat-number">{myStats.pendingOrders || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-green"><ChefHat size={20} className="text-green" /></div><span className="stat-percentage positive">Listas</span></div>
                        <div className="stat-body"><h3>Para Entregar</h3><div className="stat-number">{myStats.readyOrders || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-primary"><Utensils size={20} className="text-primary" /></div><span className="stat-percentage neutral">Hoy</span></div>
                        <div className="stat-body"><h3>Platos Preparados</h3><div className="stat-number">{myStats.dishesToday || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-purple"><AlertTriangle size={20} className="text-purple" /></div><span className="stat-percentage warning">Alerta</span></div>
                        <div className="stat-body"><h3>Stock Bajo</h3><div className="stat-number">{myStats.lowStockCount || 0}</div></div>
                    </div>

                    {/* Top Dishes Today */}
                    <div className="bento-item top-products-compact" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Platos Más Solicitados Hoy</h3><Award size={16} className="text-warning" /></div>
                        <div className="leaderboard-compact-list">
                            {(myStats.topDishes || []).map((p: TopDishItem, i: number) => (
                                <div key={p.menuItemId} className="lb-compact-row">
                                    <div className={`lb-rank rank-${i + 1}`}>{i + 1}</div>
                                    <div className="lb-info"><span className="lb-name">{p.name}</span><span className="lb-sub">{p.totalQuantity} pedidos</span></div>
                                </div>
                            ))}
                            {(!myStats.topDishes || myStats.topDishes.length === 0) && <div className="widget-empty">Sin datos aún</div>}
                        </div>
                    </div>

                    {/* Low Stock Alerts */}
                    <div className="bento-item orders-section" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Ingredientes con Stock Bajo</h3><AlertTriangle size={16} className="text-danger" /></div>
                        <div className="orders-list">
                            {(!myStats.lowStockProducts || myStats.lowStockProducts.length === 0) ? (
                                <div className="widget-empty">Inventario OK</div>
                            ) : myStats.lowStockProducts.map((p: LowStockProduct, i: number) => (
                                <div key={i} className="ord-row">
                                    <div className="ord-meta"><span className="ord-id">{p.name}</span></div>
                                    <div className="ord-right">
                                        <span className="ord-total" style={{ color: p.current === 0 ? 'var(--color-danger)' : 'var(--color-warning)' }}>{p.current} {p.unit}</span>
                                        <span className="ord-total" style={{ opacity: 0.5 }}>min: {p.min}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Top Consumed This Week */}
                    <div className="bento-item top-products-compact" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Más Consumidos (Semana)</h3><Warehouse size={16} className="text-secondary" /></div>
                        <div className="leaderboard-compact-list">
                            {(myStats.topConsumed || []).map((p: ConsumedProduct, i: number) => (
                                <div key={i} className="lb-compact-row">
                                    <div className={`lb-rank rank-${i + 1}`}>{i + 1}</div>
                                    <div className="lb-info"><span className="lb-name">{p.name}</span><span className="lb-sub">{p.consumed} {p.unit}</span></div>
                                </div>
                            ))}
                            {(!myStats.topConsumed || myStats.topConsumed.length === 0) && <div className="widget-empty">Sin datos</div>}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── BODEGA DASHBOARD ──
    if (!isAdmin && myStats?.role === 'BODEGA') {
        return (
            <div className="dashboard">
                <PersonalHeader title="Bodega" subtitle={`${user?.name} — Inventario`} />
                <div className="bento-grid final-layout">
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-orange"><AlertTriangle size={20} className="text-orange" /></div><span className="stat-percentage warning">Alerta</span></div>
                        <div className="stat-body"><h3>Stock Bajo</h3><div className="stat-number">{myStats.lowStockCount || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-primary"><TrendingDown size={20} className="text-primary" /></div><span className="stat-percentage neutral">Crítico</span></div>
                        <div className="stat-body"><h3>Sin Stock</h3><div className="stat-number">{myStats.criticalCount || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-purple"><ArrowUpDown size={20} className="text-purple" /></div><span className="stat-percentage neutral">Recientes</span></div>
                        <div className="stat-body"><h3>Movimientos</h3><div className="stat-number">{myStats.recentMovements?.length || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-green"><ClipboardList size={20} className="text-green" /></div><span className="stat-percentage neutral">OCs</span></div>
                        <div className="stat-body"><h3>OCs Pendientes</h3><div className="stat-number">{myStats.pendingPOs || 0}</div></div>
                    </div>

                    {/* Low Stock Products */}
                    <div className="bento-item orders-section" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Productos con Stock Bajo</h3><AlertTriangle size={16} className="text-danger" /></div>
                        <div className="orders-list">
                            {(!myStats.lowStockProducts || myStats.lowStockProducts.length === 0) ? (
                                <div className="widget-empty">Todo el inventario está bien</div>
                            ) : myStats.lowStockProducts.map((p: LowStockProduct, i: number) => (
                                <div key={i} className="ord-row">
                                    <div className="ord-meta"><span className="ord-id">{p.name}</span></div>
                                    <div className="ord-right">
                                        <span className="ord-total" style={{ color: p.current === 0 ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                                            {p.current} {p.unit}
                                        </span>
                                        <span className="ord-total" style={{ opacity: 0.5 }}>min: {p.min}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Top Consumed This Week */}
                    <div className="bento-item top-products-compact">
                        <div className="section-header"><h3>Más Consumidos (Semana)</h3><Warehouse size={16} className="text-warning" /></div>
                        <div className="leaderboard-compact-list">
                            {(myStats.topConsumed || []).map((p: ConsumedProduct, i: number) => (
                                <div key={i} className="lb-compact-row">
                                    <div className={`lb-rank rank-${i + 1}`}>{i + 1}</div>
                                    <div className="lb-info"><span className="lb-name">{p.name}</span><span className="lb-sub">{p.consumed} {p.unit}</span></div>
                                </div>
                            ))}
                            {(!myStats.topConsumed || myStats.topConsumed.length === 0) && <div className="widget-empty">Sin datos</div>}
                        </div>
                    </div>

                    {/* Recent Movements */}
                    <div className="bento-item invoices-section" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Últimos Movimientos</h3><ArrowUpDown size={16} className="text-secondary" /></div>
                        <div className="invoices-list">
                            {(myStats.recentMovements || []).slice(0, 8).map((m: MovementItem, i: number) => (
                                <div key={i} className="invoice-row">
                                    <div className="invoice-info">
                                        <span className="inv-id">{m.product}</span>
                                        <span className="inv-meta">{m.reason || m.type}</span>
                                    </div>
                                    <div className="invoice-right">
                                        <span className="inv-amount" style={{ color: m.type === 'IN' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                            {m.type === 'IN' ? '+' : '-'}{m.quantity} {m.unit}
                                        </span>
                                        <span className={`inv-status status-${m.type === 'IN' ? 'paid' : 'cancelled'}`}>{m.type}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── CAJERO DASHBOARD ──
    if (!isAdmin && myStats?.role === 'CAJERO') {
        return (
            <div className="dashboard">
                <PersonalHeader title="Mi Caja" subtitle={`${user?.name} — Cajero`} />
                <div className="bento-grid final-layout">
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-primary"><DollarSign size={20} className="text-primary" /></div><span className="stat-percentage neutral">Hoy</span></div>
                        <div className="stat-body"><h3>Mis Ventas</h3><div className="stat-number">{formatCurrency(myStats.salesToday || 0)}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-orange"><Ticket size={20} className="text-orange" /></div><span className="stat-percentage neutral">Hoy</span></div>
                        <div className="stat-body"><h3>Ticket Promedio</h3><div className="stat-number">{formatCurrency(myStats.avgTicket || 0)}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-green"><FileText size={20} className="text-green" /></div><span className="stat-percentage neutral">Hoy</span></div>
                        <div className="stat-body"><h3>Facturas Emitidas</h3><div className="stat-number">{myStats.invoicesToday || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-purple"><ClipboardList size={20} className="text-purple" /></div><span className="stat-percentage neutral">Hoy</span></div>
                        <div className="stat-body"><h3>Órdenes Cobradas</h3><div className="stat-number">{myStats.ordersToday || 0}</div></div>
                    </div>

                    {/* Active Shift Info */}
                    <div className="bento-item orders-section" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Turno Activo</h3><Wallet size={16} className="text-primary" /></div>
                        <div className="orders-list">
                            {myStats.activeShift ? (
                                <>
                                    <div className="ord-row">
                                        <div className="ord-meta"><span className="ord-id">Caja</span></div>
                                        <div className="ord-right"><span className="ord-total">{myStats.activeShift.registerName}</span></div>
                                    </div>
                                    <div className="ord-row">
                                        <div className="ord-meta"><span className="ord-id">Monto Apertura</span></div>
                                        <div className="ord-right"><span className="ord-total">{formatCurrency(myStats.activeShift.startAmount)}</span></div>
                                    </div>
                                    <div className="ord-row">
                                        <div className="ord-meta"><span className="ord-id">Efectivo Acumulado</span></div>
                                        <div className="ord-right"><span className="ord-total" style={{ color: 'var(--color-success)' }}>{formatCurrency(myStats.activeShift.cashAccumulated)}</span></div>
                                    </div>
                                    <div className="ord-row">
                                        <div className="ord-meta"><span className="ord-id">Apertura</span></div>
                                        <div className="ord-right"><span className="ord-total" style={{ opacity: 0.7 }}>{new Date(myStats.activeShift.startDate).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span></div>
                                    </div>
                                </>
                            ) : (
                                <div className="widget-empty">Sin turno activo — abre uno desde Caja</div>
                            )}
                        </div>
                    </div>

                    {/* Payment Breakdown */}
                    <div className="bento-item top-products-compact" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Métodos de Pago Hoy</h3><CreditCard size={16} className="text-warning" /></div>
                        <div className="leaderboard-compact-list">
                            {(myStats.paymentBreakdown || []).map((p: PaymentBreakdownItem, i: number) => (
                                <div key={i} className="lb-compact-row">
                                    <div className={`lb-rank rank-${i + 1}`}>{i + 1}</div>
                                    <div className="lb-info"><span className="lb-name">{p.method}</span></div>
                                    <span className="lb-revenue-right">{formatCurrency(p.total)}</span>
                                </div>
                            ))}
                            {(!myStats.paymentBreakdown || myStats.paymentBreakdown.length === 0) && <div className="widget-empty">Sin pagos hoy</div>}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── MESERO / HOST / DEFAULT DASHBOARD ──
    if (!isAdmin && myStats) {
        return (
            <div className="dashboard">
                <PersonalHeader title="Mi Panel" subtitle={`Bienvenido, ${user?.name}`} />
                <div className="bento-grid final-layout">
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-primary"><DollarSign size={20} className="text-primary" /></div><span className="stat-percentage neutral">Hoy</span></div>
                        <div className="stat-body"><h3>Mis Ventas</h3><div className="stat-number">{formatCurrency(myStats.salesToday || 0)}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-orange"><ClipboardList size={20} className="text-orange" /></div><span className="stat-percentage neutral">Hoy</span></div>
                        <div className="stat-body"><h3>Mis Órdenes</h3><div className="stat-number">{myStats.ordersToday || 0}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-purple"><Activity size={20} className="text-purple" /></div><span className="stat-percentage neutral">Prom.</span></div>
                        <div className="stat-body"><h3>Ticket Promedio</h3><div className="stat-number">{formatCurrency(myStats.avgTicket || 0)}</div></div>
                    </div>
                    <div className="bento-item stat-card-modern">
                        <div className="stat-header"><div className="stat-icon-bg bg-green"><Award size={20} className="text-green" /></div><span className="stat-percentage neutral">Top</span></div>
                        <div className="stat-body"><h3>Mi Producto Top</h3><div className="stat-number" style={{ fontSize: 'var(--font-size-lg)' }}>{myStats.topProduct || 'Ninguno'}</div></div>
                    </div>

                    <div className="bento-item orders-section" style={{ gridColumn: 'span 2' }}>
                        <div className="section-header"><h3>Mis Órdenes Activas</h3><ClipboardList size={16} className="text-primary" /></div>
                        <div className="orders-list">
                            {(!myStats.myOrders || myStats.myOrders.length === 0) ? (
                                <div className="dashboard-widget-empty">
                                    <EmptyState
                                        icon={<ClipboardList size={32} />}
                                        title="Sin órdenes activas"
                                    />
                                </div>
                            ) : myStats.myOrders.map((ord: RecentOrder) => (
                                <div key={ord.id} className="ord-row clickable" role="button" tabIndex={0} aria-label={`Ver orden ${ord.id}`} onClick={() => setSelectedOrder(ord)} onKeyDown={(event) => activateOnKeyboard(event, () => setSelectedOrder(ord))}>
                                    <div className="ord-meta"><span className="ord-id">{ord.id}</span><span className="ord-table">{ord.table}</span></div>
                                    <div className="ord-right"><span className="ord-total">{formatCurrency(ord.total)}</span><span className={`ord-status status-${ord.status}`}>{ord.status}</span></div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bento-item top-products-compact">
                        <div className="section-header"><h3>Mi Top 5</h3><Award size={16} className="text-warning" /></div>
                        <div className="leaderboard-compact-list">
                            {(myStats.topProducts || []).map((p: TopProduct, i: number) => (
                                <div key={p.menuItemId} className="lb-compact-row">
                                    <div className={`lb-rank rank-${i + 1}`}>{i + 1}</div>
                                    <div className="lb-info"><span className="lb-name">{p.name}</span><span className="lb-sub">{p.totalQuantity} vendidos</span></div>
                                    <span className="lb-revenue-right">{formatCurrency(p.totalRevenue)}</span>
                                </div>
                            ))}
                            {(!myStats.topProducts || myStats.topProducts.length === 0) && <div className="widget-empty">Sin datos aún</div>}
                        </div>
                    </div>

                    <div className="bento-item reservations-section">
                        <div className="section-header"><h3>Reservas Próximas</h3><CalendarCheck size={16} className="text-primary" /></div>
                        <div className="reservations-list">
                            {todaysReservations.length === 0 ? (
                                <div className="dashboard-widget-empty">
                                    <EmptyState
                                        icon={<CalendarCheck size={32} />}
                                        title="Sin reservas próximas"
                                    />
                                </div>
                            ) : todaysReservations.slice(0, 5).map(res => (
                                <div key={res.id} className="res-row">
                                    <div className="res-time">{res.day || res.time}</div>
                                    <div className="res-info"><span className="res-name">{res.name}</span></div>
                                    <div className={`res-badge badge-${res.status}`}>{res.pax}p</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <Modal isOpen={!!selectedOrder} onClose={() => setSelectedOrder(null)} title="Detalle de Orden" size="sm" variant="sidebar">
                    {selectedOrder && (
                        <div className="detail-modal-content">
                            <div className="detail-header-section"><h3 className="detail-main-title">{selectedOrder.id}</h3><span className="detail-main-value">{formatCurrency(selectedOrder.total)}</span></div>
                            <div className="detail-row"><span className="detail-label">Mesa</span><span className="detail-value">{selectedOrder.table}</span></div>
                            <div className="detail-row"><span className="detail-label">Estado</span><span className={`detail-badge status-${selectedOrder.status}`}>{selectedOrder.status}</span></div>
                        </div>
                    )}
                </Modal>
            </div>
        );
    }

    // ═══════════════════════════════════════════════════
    // FULL BI DASHBOARD (admin roles)
    // ═══════════════════════════════════════════════════

    return (
        <div className="dashboard">
            {/* Header with Command Bar */}
            <header className="dashboard-header-hero">
                <div className="header-greeting">
                    <h1>Business Intelligence</h1>
                    <p className="subtitle">Análisis estratégico de operación</p>
                </div>

                <div className="header-actions-wrapper">
                    <div className="command-bar">
                        <button className="cmd-btn" onClick={() => navigate('/tables')} title="Centro operativo de mesas">
                            <CreditCard size={18} /> <span className="cmd-label">Mesas</span>
                        </button>
                        <button className="cmd-btn" onClick={() => navigate('/kitchen')} title="Cocina">
                            <ChefHat size={18} /> <span className="cmd-label">Cocina</span>
                        </button>
                        <button className="cmd-btn" onClick={() => navigate('/inventory')} title="Inventario">
                            <Package size={18} /> <span className="cmd-label">Stock</span>
                        </button>
                        <button className="cmd-btn" onClick={() => navigate('/users')} title="Personal">
                            <Users size={18} /> <span className="cmd-label">Staff</span>
                        </button>
                    </div>

                    <div className="header-meta-group">
                        {stockAlerts.length > 0 && (
                            <div className="compact-alert-ticker" role="button" tabIndex={0} onClick={() => navigate('/inventory')} onKeyDown={(event) => activateOnKeyboard(event, () => navigate('/inventory'))} title="Ver inventario con stock bajo">
                                <AlertCircle size={16} className="text-danger" />
                                <span className="ticker-label text-danger">Stock bajo</span>
                                <span className="ticker-count">{stockAlerts.length}</span>
                                <span className="ticker-message">
                                    {stockAlerts.length === 1 ? 'producto requiere atención' : 'productos requieren atención'}
                                </span>
                                <ChevronRight size={14} />
                            </div>
                        )}

                        <div className="header-time">
                            <Clock size={16} className="text-primary" />
                            <span>{currentTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                            <div className="divider-v"></div>
                            <Calendar size={16} className="text-secondary" />
                            <span className="date-text">{currentTime.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
                        </div>
                    </div>
                </div>
            </header>

            {loadError && (
                <div className="dashboard-error-banner" role="alert">
                    <AlertTriangle size={20} />
                    <span>{loadError}</span>
                    <button type="button" className="dashboard-retry-btn" onClick={retryLoad}>
                        Reintentar
                    </button>
                </div>
            )}

            <div className="bento-grid final-layout">

                {/* --- ROW 1: KPI CARDS --- */}
                <div className="bento-item stat-card-modern">
                    <div className="stat-header">
                        <div className="stat-icon-bg bg-primary"><DollarSign size={20} className="text-primary" /></div>
                    </div>
                    <div className="stat-body">
                        <h3>Ventas</h3>
                        <div className="stat-number">{formatKpiMoney(Number(stats.todaySales))}</div>
                    </div>
                </div>
                <div className="bento-item stat-card-modern">
                    <div className="stat-header">
                        <div className="stat-icon-bg bg-orange"><Ticket size={20} className="text-orange" /></div>
                    </div>
                    <div className="stat-body">
                        <h3>Ticket Prom.</h3>
                        <div className="stat-number">{formatKpiMoney(averageTicket)}</div>
                    </div>
                </div>
                <div className="bento-item stat-card-modern">
                    <div className="stat-header">
                        <div className="stat-icon-bg bg-purple"><Activity size={20} className="text-purple" /></div>
                    </div>
                    <div className="stat-body">
                        <h3>Ocupación</h3>
                        <div className="stat-number">{formatKpiNumber(occupancyRate, '%')}</div>
                        {!kpisUnavailable && (
                            <div className="occupancy-bar"><div className="occupancy-fill" style={{ width: `${occupancyRate}%` }}></div></div>
                        )}
                    </div>
                </div>
                <div className="bento-item stat-card-modern">
                    <div className="stat-header">
                        <div className="stat-icon-bg bg-green"><Users size={20} className="text-green" /></div>
                    </div>
                    <div className="stat-body">
                        <h3>Órdenes cobradas</h3>
                        <div className="stat-number">{formatKpiNumber(settledOrdersCount)}</div>
                    </div>
                </div>

                {/* --- ROW 2: TRAFFIC & PERFORMANCE (Heatmap + Radar) --- */}

                <div className="bento-item heatmap-section">
                    <div className="section-header mb-large">
                        <h3>Demanda relativa por hora</h3>
                        <PeriodSelector value={heatmapPeriod} onChange={setHeatmapPeriod} />
                    </div>
                    <div className="heatmap-container">
                        <div className="heatmap-grid mode-7-10">
                            <div className="hm-cell-header"></div>
                            {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => (
                                <div key={h} className="hm-cell-header">{h}h</div>
                            ))}
                            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => (
                                <Fragment key={d}>
                                    <div key={`label-${d}`} className="hm-cell-row-label">{d}</div>
                                    {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => {
                                        const point = heatmapData.find(p => p.day === d && p.hour === h) || { value: 0 };
                                        const opacity = Math.max(0.1, point.value / 100);
                                        return (
                                            <div
                                                key={`${d}-${h}`}
                                                className="hm-cell"
                                                style={{ backgroundColor: `rgba(99, 102, 241, ${opacity})` }}
                                                title={`${d} ${h}:00 - ${point.value}% del pico del período`}
                                            ></div>
                                        )
                                    })}
                                </Fragment>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="bento-item radar-section">
                    <div className="section-header mb-large">
                        <h3>Evaluación de Turnos</h3>
                        <PeriodSelector value={radarPeriod} onChange={setRadarPeriod} />
                    </div>
                    <div className="chart-wrapper">
                        <ResponsiveContainer width="100%" height={280}>
                            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                                <PolarGrid />
                                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                                <Radar name="Turno A" dataKey="A" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
                                <Radar name="Turno B" dataKey="B" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.6} />
                                <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                            </RadarChart>
                        </ResponsiveContainer>
                        <div className="chart-legend-center">
                            <span style={{ color: '#8884d8' }}>● Turno A</span>
                            <span style={{ color: '#82ca9d' }}>● Turno B</span>
                            <span>Índice relativo (mejor turno = 100)</span>
                        </div>
                    </div>
                </div>

                {/* --- ROW 3: FINANCIAL BREAKDOWN (Bar Chart + Horizontal Bar) --- */}

                <div className="bento-item waterfall-section">
                    <div className="section-header mb-large">
                        <h3>Venta bruta por categoría</h3>
                        <PeriodSelector value={incomePeriod} onChange={setIncomePeriod} />
                    </div>
                    <div className="chart-wrapper">
                        <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={incomeData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${currencySymbol}${Number(v) / 1000}k`} />
                                <Tooltip
                                    cursor={{ fill: '#f1f5f9' }}
                                    formatter={(value) => [formatCurrency(Number(value)), 'Venta bruta']}
                                    contentStyle={{ borderRadius: '8px' }}
                                />
                                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                    {incomeData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bento-item treemap-section">
                    <div className="section-header mb-large">
                        <h3>Demanda histórica por producto</h3>
                        <div className="treemap-filters" style={{ width: '250px' }}>
                            <Select
                                className="category-select-container"
                                value={treemapCategory}
                                onChange={(val: SingleValue<CategoryOption>) => val && setTreemapCategory(val)}
                                options={[
                                    { value: 'all', label: 'Todas las Categorías' },
                                    ...Array.from(new Set(topProducts?.map(p => p.category) || []))
                                        .filter(cat => cat && cat !== 'N/A')
                                        .map(cat => ({ value: cat, label: cat }))
                                ]}
                                isSearchable={false}
                            />
                        </div>
                    </div>
                    <div className="chart-wrapper">
                        <ResponsiveContainer width="100%" height="100%">
                            <Treemap
                                data={(topProducts || [])
                                    .filter(p => treemapCategory.value === 'all' || p.category === treemapCategory.value)
                                    .map(p => ({
                                        name: p.name,
                                        size: Math.max(0, Number(p.totalQuantity || 0)),
                                        fill: p.category === 'Bebidas' ? '#60a5fa' :
                                            p.category === 'Platos' ? '#818cf8' :
                                                p.category === 'Postres' ? '#fbbf24' :
                                                    p.category === 'Entradas' ? '#34d399' : '#94a3b8'
                                    }))}
                                dataKey="size"
                                stroke="#1e293b"
                                fill="#8884d8"
                            >
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: 'var(--color-surface)',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                                        color: 'var(--color-text)'
                                    }}
                                    itemStyle={{ color: 'var(--color-text)' }}
                                    formatter={(value: number, _name: string, props: { payload?: { name: string } }) => [
                                        `${Number(value).toFixed(0)} unidades`,
                                        props.payload?.name ?? ''
                                    ]}
                                />
                            </Treemap>
                        </ResponsiveContainer>
                    </div>
                </div>


                {/* --- ROW 4: TRENDS (Scatter) --- */}
                <div className="bento-item chart-section scatter-section-large">
                    <div className="section-header mb-large">
                        <h3>Servicio vs Propina</h3>
                        <PeriodSelector value={tipsPeriod} onChange={setTipsPeriod} />
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                        <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis type="number" dataKey="waitTime" name="Espera" unit="min" tick={{ fontSize: 10 }} label={{ value: 'Tiempo Espera (min)', position: 'insideBottom', offset: -10 }} />
                            <YAxis type="number" dataKey="tip" name="Propina" tickFormatter={(v) => `${currencySymbol}${v}`} tick={{ fontSize: 10 }} />
                            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: '8px' }} />
                            <Scatter name="Mesas" data={scatterTipsData} fill="#8884d8" />
                        </ScatterChart>
                    </ResponsiveContainer>
                </div>

                <div className="bento-item chart-section scatter-section-large">
                    <div className="section-header mb-large">
                        <h3>Gasto vs Permanencia</h3>
                        <PeriodSelector value={spendPeriod} onChange={setSpendPeriod} />
                    </div>
                    <ResponsiveContainer width="100%" height={280}>
                        <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis type="number" dataKey="dwellTime" name="Tiempo" unit="min" tick={{ fontSize: 10 }} label={{ value: 'Permanencia (min)', position: 'insideBottom', offset: -10 }} />
                            <YAxis type="number" dataKey="spend" name="Consumo" tickFormatter={(v) => `${currencySymbol}${v}`} tick={{ fontSize: 10 }} />
                            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: '8px' }} />
                            <Scatter name="Mesas" data={scatterSpendData} fill="#82ca9d" />
                        </ScatterChart>
                    </ResponsiveContainer>
                </div>

                {/* --- ROW 5: OPERATIONS (Top 5, Active Orders, Today Invoices, Upcoming Reservations) --- */}
                {/* 1. Top 5 Products */}
                <div className="bento-item top-products-compact">
                    <div className="section-header">
                        <h3>Top 5</h3>
                        <Award size={16} className="text-warning" />
                    </div>
                    <div className="leaderboard-compact-list">
                        {topProducts.slice(0, 5).map((p, i) => (
                            <div key={p.menuItemId} className="lb-compact-row clickable" role="button" tabIndex={0} aria-label={`Ver producto ${p.name}`} onClick={() => setSelectedProduct(p)} onKeyDown={(event) => activateOnKeyboard(event, () => setSelectedProduct(p))}>
                                <div className={`lb-rank rank-${i + 1}`}>{i + 1}</div>
                                <div className="lb-info">
                                    <span className="lb-name">{p.name}</span>
                                    <span className="lb-sub">{p.totalQuantity} vendidos</span>
                                </div>
                                {p.totalRevenue && <span className="lb-revenue-right">{formatCurrency(p.totalRevenue)}</span>}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 2. Active Orders */}
                <div className="bento-item orders-section">
                    <div className="section-header">
                        <h3>Ordenes Activas</h3>
                        <ClipboardList size={16} className="text-primary" />
                    </div>
                    <div className="orders-list">
                        {recentOrders.length === 0 ? (
                            <div className="dashboard-widget-empty">
                                <EmptyState
                                    icon={<ClipboardList size={32} />}
                                    title="Sin órdenes activas"
                                />
                            </div>
                        ) : recentOrders.slice(ordersPage * WIDGET_PAGE_SIZE, (ordersPage + 1) * WIDGET_PAGE_SIZE).map(ord => (
                            <div key={ord.id} className="ord-row clickable" role="button" tabIndex={0} aria-label={`Ver orden ${ord.id}`} onClick={() => setSelectedOrder(ord)} onKeyDown={(event) => activateOnKeyboard(event, () => setSelectedOrder(ord))}>
                                <div className="ord-meta">
                                    <span className="ord-id">{ord.id}</span>
                                    <span className="ord-table">{ord.table}</span>
                                </div>
                                <div className="ord-right">
                                    <span className="ord-total">{formatCurrency(ord.total)}</span>
                                    <span className={`ord-status status-${ord.status}`}>{formatOrderStatus(ord.status)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    {recentOrders.length > WIDGET_PAGE_SIZE && (
                        <div className="widget-pagination">
                            <button disabled={ordersPage === 0} onClick={() => setOrdersPage(p => p - 1)}>&lsaquo;</button>
                            <span>{ordersPage + 1}/{Math.ceil(recentOrders.length / WIDGET_PAGE_SIZE)}</span>
                            <button disabled={(ordersPage + 1) * WIDGET_PAGE_SIZE >= recentOrders.length} onClick={() => setOrdersPage(p => p + 1)}>&rsaquo;</button>
                        </div>
                    )}
                </div>

                {/* 3. Today's Invoices */}
                <div className="bento-item invoices-section">
                    <div className="section-header">
                        <h3>Facturas Hoy</h3>
                        <FileText size={16} className="text-secondary" />
                    </div>
                    <div className="invoices-list">
                        {recentInvoices.length === 0 ? (
                            <div className="dashboard-widget-empty">
                                <EmptyState
                                    icon={<FileText size={32} />}
                                    title="Sin facturas hoy"
                                />
                            </div>
                        ) : recentInvoices.slice(invoicesPage * WIDGET_PAGE_SIZE, (invoicesPage + 1) * WIDGET_PAGE_SIZE).map(inv => (
                            <div key={inv.id} className="invoice-row clickable" role="button" tabIndex={0} aria-label={`Ver factura ${inv.id}`} onClick={() => setSelectedInvoice(inv)} onKeyDown={(event) => activateOnKeyboard(event, () => setSelectedInvoice(inv))}>
                                <div className="invoice-info">
                                    <span className="inv-id">{inv.id}</span>
                                    <span className="inv-meta">{inv.time}</span>
                                </div>
                                <div className="invoice-right">
                                    <span className="inv-amount">{formatCurrency(inv.amount)}</span>
                                    <span className={`inv-status status-${inv.status}`}>{inv.status}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    {recentInvoices.length > WIDGET_PAGE_SIZE && (
                        <div className="widget-pagination">
                            <button disabled={invoicesPage === 0} onClick={() => setInvoicesPage(p => p - 1)}>&lsaquo;</button>
                            <span>{invoicesPage + 1}/{Math.ceil(recentInvoices.length / WIDGET_PAGE_SIZE)}</span>
                            <button disabled={(invoicesPage + 1) * WIDGET_PAGE_SIZE >= recentInvoices.length} onClick={() => setInvoicesPage(p => p + 1)}>&rsaquo;</button>
                        </div>
                    )}
                </div>

                {/* 4. Upcoming Reservations (7 days) */}
                <div className="bento-item reservations-section">
                    <div className="section-header">
                        <h3>Reservas</h3>
                        <CalendarCheck size={16} className="text-primary" />
                    </div>
                    <div className="reservations-list">
                        {todaysReservations.length === 0 ? (
                            <div className="dashboard-widget-empty">
                                <EmptyState
                                    icon={<CalendarCheck size={32} />}
                                    title="Sin reservas próximas"
                                />
                            </div>
                        ) : todaysReservations.slice(reservationsPage * WIDGET_PAGE_SIZE, (reservationsPage + 1) * WIDGET_PAGE_SIZE).map(res => (
                            <div key={res.id} className="res-row clickable" role="button" tabIndex={0} aria-label={`Ver reservación ${res.id}`} onClick={() => setSelectedReservation(res)} onKeyDown={(event) => activateOnKeyboard(event, () => setSelectedReservation(res))}>
                                <div className="res-time">{res.day || res.time}</div>
                                <div className="res-info">
                                    <span className="res-name">{res.name}</span>
                                </div>
                                <div className={`res-badge badge-${res.status}`}>
                                    {res.pax}p
                                </div>
                            </div>
                        ))}
                    </div>
                    {todaysReservations.length > WIDGET_PAGE_SIZE && (
                        <div className="widget-pagination">
                            <button disabled={reservationsPage === 0} onClick={() => setReservationsPage(p => p - 1)}>&lsaquo;</button>
                            <span>{reservationsPage + 1}/{Math.ceil(todaysReservations.length / WIDGET_PAGE_SIZE)}</span>
                            <button disabled={(reservationsPage + 1) * WIDGET_PAGE_SIZE >= todaysReservations.length} onClick={() => setReservationsPage(p => p + 1)}>&rsaquo;</button>
                        </div>
                    )}
                </div>

            </div>

            {/* Detail Modals */}
            {/* Product Detail Modal */}
            <Modal
                isOpen={!!selectedProduct}
                onClose={() => setSelectedProduct(null)}
                title="Detalle del Producto"
                size="sm"
                variant="sidebar"
            >
                {selectedProduct && (
                    <div className="detail-modal-content">
                        <div className="detail-header-section">
                            <h3 className="detail-main-title">{selectedProduct.name}</h3>
                            <span className="detail-main-value">{formatCurrency(selectedProduct.totalRevenue || 0)}</span>
                        </div>
                        <div className="detail-stats-grid">
                            <div className="detail-stat">
                                <span className="detail-stat-value">{selectedProduct.totalQuantity}</span>
                                <span className="detail-stat-label">Unidades Vendidas</span>
                            </div>
                            <div className="detail-stat">
                                <span className="detail-stat-value">{formatCurrency((selectedProduct.totalRevenue || 0) / (selectedProduct.totalQuantity || 1))}</span>
                                <span className="detail-stat-label">Precio Promedio</span>
                            </div>
                        </div>
                        {selectedProduct.category && (
                            <div className="detail-row">
                                <span className="detail-label">Categoría</span>
                                <span className="detail-value">{selectedProduct.category}</span>
                            </div>
                        )}
                        <div className="detail-row">
                            <span className="detail-label">Posición en Ranking</span>
                            <span className="detail-value font-bold">Top {topProducts.findIndex(p => p.menuItemId === selectedProduct.menuItemId) + 1}</span>
                        </div>
                        <div className="detail-note">
                            <span>💡 Este producto está generando buenos ingresos. Considere destacarlo en el menú.</span>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Order Detail Modal */}
            <Modal
                isOpen={!!selectedOrder}
                onClose={() => setSelectedOrder(null)}
                title="Detalle de Orden"
                size="md"
                variant="sidebar"
            >
                {selectedOrder && (
                    <div className="detail-modal-content">
                        <div className="detail-header-section">
                            <h3 className="detail-main-title">{selectedOrder.id}</h3>
                            <span className="detail-main-value">{formatCurrency(selectedOrder.total)}</span>
                        </div>
                        <div className="detail-stats-grid">
                            <div className="detail-stat">
                                <span className="detail-stat-value">{selectedOrder.table}</span>
                                <span className="detail-stat-label">Mesa</span>
                            </div>
                            <div className="detail-stat">
                                <span className="detail-stat-value">{selectedOrder.items?.length || 0}</span>
                                <span className="detail-stat-label">Items</span>
                            </div>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Estado</span>
                            <span className={`detail-badge status-${selectedOrder.status}`}>{formatOrderStatus(selectedOrder.status)}</span>
                        </div>
                        {selectedOrder.waiter && (
                            <div className="detail-row">
                                <span className="detail-label">Mesero</span>
                                <span className="detail-value">{selectedOrder.waiter}</span>
                            </div>
                        )}
                        {selectedOrder.createdAt && (
                            <div className="detail-row">
                                <span className="detail-label">Creada</span>
                                <span className="detail-value">{new Date(selectedOrder.createdAt).toLocaleString('es-MX')}</span>
                            </div>
                        )}
                        {selectedOrder.items && selectedOrder.items.length > 0 && (
                            <div className="detail-items-section">
                                <h4>Items del Pedido</h4>
                                <div className="detail-items-list">
                                    {selectedOrder.items.map((item: OrderItemSummary) => (
                                        <div key={item.id || item.menuItemId} className="detail-item-row">
                                            <span>{item.quantity}x {item.name}</span>
                                            <span>{formatCurrency(item.subtotal ?? item.price * item.quantity)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="detail-note">
                            <span>📦 Tiempo estimado de preparación: 15-20 min</span>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Invoice Detail Modal */}
            <Modal
                isOpen={!!selectedInvoice}
                onClose={() => setSelectedInvoice(null)}
                title="Detalle de Factura"
                size="sm"
                variant="sidebar"
            >
                {selectedInvoice && (
                    <div className="detail-modal-content">
                        <div className="detail-header-section">
                            <h3 className="detail-main-title">{selectedInvoice.id}</h3>
                            <span className="detail-main-value">{formatCurrency(selectedInvoice.amount)}</span>
                        </div>
                        <div className="detail-stats-grid">
                            <div className="detail-stat">
                                <span className="detail-stat-value">{selectedInvoice.time}</span>
                                <span className="detail-stat-label">Hora de Emisión</span>
                            </div>
                            <div className="detail-stat">
                                <span className={`detail-stat-badge status-${selectedInvoice.status}`}>{selectedInvoice.status}</span>
                                <span className="detail-stat-label">Estado</span>
                            </div>
                        </div>
                        {selectedInvoice.paymentMethod && (
                            <div className="detail-row">
                                <span className="detail-label">Método de Pago</span>
                                <span className="detail-value">{selectedInvoice.paymentMethod}</span>
                            </div>
                        )}
                        {selectedInvoice.customer && (
                            <div className="detail-row">
                                <span className="detail-label">Cliente</span>
                                <span className="detail-value">{selectedInvoice.customer}</span>
                            </div>
                        )}
                        <div className="detail-note">
                            <span>🧾 Factura generada automáticamente. Disponible para reimpresión.</span>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Reservation Detail Modal */}
            <Modal
                isOpen={!!selectedReservation}
                onClose={() => setSelectedReservation(null)}
                title="Detalle de Reserva"
                size="sm"
                variant="sidebar"
            >
                {selectedReservation && (
                    <div className="detail-modal-content">
                        <div className="detail-header-section">
                            <h3 className="detail-main-title">{selectedReservation.name}</h3>
                            <span className="detail-main-value">{selectedReservation.pax}p</span>
                        </div>
                        <div className="detail-stats-grid">
                            <div className="detail-stat">
                                <span className="detail-stat-value">{selectedReservation.time}</span>
                                <span className="detail-stat-label">Hora</span>
                            </div>
                            <div className="detail-stat">
                                <span className={`detail-stat-badge badge-${selectedReservation.status}`}>{selectedReservation.status}</span>
                                <span className="detail-stat-label">Estado</span>
                            </div>
                        </div>
                        {selectedReservation.phone && (
                            <div className="detail-row">
                                <span className="detail-label">Teléfono</span>
                                <span className="detail-value">{selectedReservation.phone}</span>
                            </div>
                        )}
                        {selectedReservation.table && (
                            <div className="detail-row">
                                <span className="detail-label">Mesa Asignada</span>
                                <span className="detail-value font-bold">{selectedReservation.table}</span>
                            </div>
                        )}
                        {selectedReservation.notes && (
                            <div className="detail-row">
                                <span className="detail-label">Notas</span>
                                <span className="detail-value">{selectedReservation.notes}</span>
                            </div>
                        )}
                        <div className="detail-note">
                            <span>🗓️ Recuerde confirmar la reserva 1 hora antes de la llegada del cliente.</span>
                        </div>
                    </div>
                )}
            </Modal>
        </div >
    );
}
