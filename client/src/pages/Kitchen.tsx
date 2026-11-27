import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ordersAPI } from '../services/api';
import { Ban, ChefHat, CheckCircle, CheckCheck, AlertCircle, Volume2, VolumeX, AlertTriangle, Play, Check, ListOrdered, Maximize2, Minimize2, MonitorUp, ArrowLeft, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initializeSound, playNotificationSound } from '../utils/sound';
import { escapeHtml } from '../utils/escapeHtml';
import { useDebounce } from '../utils/useDebounce';
import { initializeWebSocket, subscribeWebSocket, WS_EVENTS } from '../utils/websocket';
import { getUserAccentColor, canOperateKitchenLineItems, canVoidKitchenLine, getUserRoleNames } from '../utils/authz';
import KitchenLineVoidModal from '../components/KitchenLineVoidModal';
import { isVoidableOrderLine, isVoidedOrderLine, orderLineVoidBlocker } from '../utils/orderLineVoid';
import { useAppToast } from '../context/ToastContext';
import './Kitchen.css';
import { getOrderStatusLabel, getOrderTimeline } from '../utils/orderStatus';
import { useConfirmDialog } from '../context/ConfirmContext';
import {
    AppSelect, Badge, Button, EmptyState, Field, FullScreenModal, IconButton, Input, LoadErrorState, PageHeader, Spinner,
    TableToolbar, Tabs, Textarea, formatNumber,
} from '@/ui';
import ThemeToggle from '../components/ThemeToggle';
import { orderWhereLabel } from '../utils/orderWhere';
import { ThemeContext } from '../context/theme-context';
import type { Order, OrderItem } from '../types';
import { getKdsTimeClass, getKdsWaitMinutes, getKitchenReceivedAt, summarizeKds } from '../utils/kdsTiming';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';

function axiosMsg(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    return fallback;
}

const dateFilterOptions = [
    { value: '24h', label: 'Últimas 24h' },
    { value: '48h', label: 'Últimas 48h' },
    { value: '7d', label: 'Últimos 7 días' },
    { value: 'all', label: 'Todas' }
];

const kitchenItemStatusLabel: Record<OrderItem['status'], string> = {
    PENDING: 'Pendiente',
    IN_PROGRESS: 'En preparación',
    DONE: 'Listo',
};

const kitchenOrderKey = (order: Order) => `${order.id}:${order.kitchenBatchId ?? 'legacy'}`;

export default function Kitchen({ displayMode = false }: { displayMode?: boolean }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { error: showError, warning: showWarning, success } = useAppToast();
    const { confirm } = useConfirmDialog();
    const canKitchenLineOps = canOperateKitchenLineItems(user);
    const canVoidLines = canVoidKitchenLine(user);
    const [voidTarget, setVoidTarget] = useState<{ order: Order; itemId: number } | null>(null);
    const canReturnToAdministration = getUserRoleNames(user).some((role) => ['SUPERADMIN', 'ADMIN', 'CHEF'].includes(role));
    const pageRef = useRef<HTMLDivElement>(null);

    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [tableFilter, setTableFilter] = useState<string>('');
    const debouncedTableFilter = useDebounce(tableFilter, 300);
    const [dateFilter, setDateFilter] = useState<string>('24h');
    const [showProblemModal, setShowProblemModal] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
    const [problemDescription, setProblemDescription] = useState('');
    const [submittingProblem, setSubmittingProblem] = useState(false);
    const [detailOrderKey, setDetailOrderKey] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [timingConfig, setTimingConfig] = useState<{ warningMinutes: number; urgentMinutes: number } | null>(null);
    const [, setClockTick] = useState(0);
    const previousOrderCount = useRef(0);
    const loadOrdersRequestRef = useRef(0);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

    const themeContext = useContext(ThemeContext);
    const themeRef = useRef<'light' | 'dark'>(themeContext?.theme ?? 'light');
    themeRef.current = themeContext?.theme ?? 'light';

    // KDS screen is dark by default; a theme the user fixed explicitly is respected.
    useEffect(() => {
        if (!displayMode) return;
        let userSet = false;
        try { userSet = localStorage.getItem('theme_user_set') === '1'; } catch { /* storage unavailable */ }
        const root = document.documentElement;
        if (userSet || root.classList.contains('dark')) return;
        root.classList.add('dark');
        root.style.colorScheme = 'dark';
        return () => {
            root.classList.remove('dark');
            root.style.colorScheme = 'light';
        };
    }, [displayMode]);

    useEffect(() => {
        initializeSound();
        const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => document.removeEventListener('fullscreenchange', syncFullscreen);
    }, []);

    const toggleFullscreen = async () => {
        if (!displayMode) return;
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await pageRef.current?.requestFullscreen();
        } catch {
            showWarning('El navegador no permitió activar pantalla completa.');
        }
    };

    const loadOrders = useCallback(async () => {
        const requestId = ++loadOrdersRequestRef.current;
        try {
            const response = showHistory
                ? await ordersAPI.getKitchenHistory({ limit: 200 })
                : await ordersAPI.getKitchenQueue();
            // Ignore late responses (e.g. queue vs history toggle) superseded by a newer load.
            if (requestId !== loadOrdersRequestRef.current) return;
            const kitchenOrders = showHistory
                ? response.data.data
                : response.data.data.filter((o: Order) =>
                    o.status === 'SENT_TO_KITCHEN' || o.status === 'IN_PREPARATION' || o.status === 'READY'
                );

            if (soundEnabled && kitchenOrders.length > previousOrderCount.current && previousOrderCount.current > 0) {
                playNotificationSound();
            }

            previousOrderCount.current = kitchenOrders.length;
            setOrders(kitchenOrders);
            setLoadError(null);
        } catch (error: unknown) {
            if (requestId !== loadOrdersRequestRef.current) return;
            console.error('Error loading orders:', error);
            setLoadError(axiosMsg(error, 'No se pudo cargar la cola de cocina. Revisa la conexión o tus permisos.'));
        } finally {
            if (requestId === loadOrdersRequestRef.current) setLoading(false);
        }
    }, [showHistory, soundEnabled]);

    useEffect(() => {
        loadOrders();
        ordersAPI.getKitchenConfig()
            .then((response) => setTimingConfig(response.data.data))
            .catch((error) => {
                console.error('Error loading KDS timing config:', error);
                notifyError(error, 'No se pudo cargar la configuración de tiempos del KDS (se usan los tiempos por defecto)', { type: 'warning' });
            });
        initializeWebSocket();

        const unsubscribe = subscribeWebSocket((message) => {
            if (!message?.type) {
                return;
            }

            // Waiter-app edits of unsent lines never reach the kitchen queue.
            if (
                message.type === WS_EVENTS.ORDER_UPDATE &&
                (message.payload?.status === 'ITEMS_CHANGED' || message.payload?.status === 'GUESTS_CHANGED')
            ) {
                return;
            }

            if (
                message.type === WS_EVENTS.ORDER_SENT_TO_KITCHEN ||
                message.type === WS_EVENTS.ORDER_IN_PREPARATION ||
                message.type === WS_EVENTS.ORDER_READY ||
                message.type === WS_EVENTS.ORDER_UPDATE ||
                message.type === WS_EVENTS.CONNECTED
            ) {
                loadOrders();
            }
        });

        const clockInterval = window.setInterval(() => setClockTick((value) => value + 1), 30_000);

        return () => {
            unsubscribe();
            window.clearInterval(clockInterval);
        };
    }, [loadOrders]);

    const handleMarkReady = async (order: Order) => {
        if (!canKitchenLineOps) {
            showWarning('Tu rol no puede marcar órdenes listas.');
            return;
        }
        if (!(await confirm(`¿Marcar la tanda ${order.kitchenBatchSequence ?? ''} como lista?`, { variant: 'warning' }))) {
            return;
        }
        try {
            await ordersAPI.markKitchenReady(order.id, order.kitchenBatchId);
            printOrderTicket(order);
            loadOrders();
        } catch (error) {
            console.error('Error updating order:', error);
            showError(getApiErrorMessage(error, 'Error al actualizar orden'));
        }
    };

    const handleStartOrder = async (order: Order) => {
        if (!canKitchenLineOps) {
            showWarning('Tu rol no puede iniciar la preparación.');
            return;
        }
        try {
            await ordersAPI.startKitchenPreparation(order.id, order.kitchenBatchId);
            await loadOrders();
        } catch (error: unknown) {
            showError(axiosMsg(error, 'No se pudo iniciar la preparación'));
        }
    };

    const handleReleaseOrder = async (order: Order) => {
        if (!canKitchenLineOps) {
            showWarning('Tu rol no puede liberar órdenes del KDS.');
            return;
        }
        if (!(await confirm('¿Liberar esta orden de la cola activa? Permanecerá en el historial.', { variant: 'warning' }))) return;
        try {
            await ordersAPI.releaseKitchenOrder(order.id, order.kitchenBatchId);
            setDetailOrderKey(null);
            await loadOrders();
            success(`Tanda ${order.kitchenBatchSequence ?? ''} de la orden #${order.id} liberada del KDS`);
        } catch (error: unknown) {
            showError(axiosMsg(error, 'No se pudo liberar la orden'));
        }
    };

    const handleStartItem = async (orderId: number, itemId: number) => {
        if (!canKitchenLineOps) {
            showWarning('Tu rol no puede iniciar ítems en cocina. Esta vista es de consulta; coordina con cocina o un administrador.');
            return;
        }
        try {
            await ordersAPI.startItem(orderId, itemId);
            loadOrders();
        } catch (error: unknown) {
            showError(axiosMsg(error, 'Error al iniciar ítem'));
        }
    };

    const handleFinishItem = async (orderId: number, itemId: number) => {
        if (!canKitchenLineOps) {
            showWarning('Tu rol no puede finalizar ítems en cocina. Esta vista es de consulta; coordina con cocina o un administrador.');
            return;
        }
        try {
            const res = await ordersAPI.finishItem(orderId, itemId);
            const finished = res.data.data;
            if (finished?.allDone) {
                // Print the batch that was just finished, not the first card of the order.
                const order = orders.find(o => o.id === orderId && finished.kitchenBatchId != null && o.kitchenBatchId === finished.kitchenBatchId)
                    ?? orders.find(o => o.id === orderId && o.items?.some((item) => item.id === itemId))
                    ?? (finished.order as Order | undefined);
                if (order) printOrderTicket(order);
            }
            loadOrders();
        } catch (error: unknown) {
            showError(axiosMsg(error, 'Error al finalizar ítem'));
        }
    };

    const getItemTimeDiff = (from?: string) => {
        if (!from) return null;
        return Math.floor((Date.now() - new Date(from).getTime()) / 60000);
    };

    const printOrderTicket = (order: Order) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            showError('No se pudo abrir la impresión. Permite ventanas emergentes e inténtalo de nuevo.');
            return;
        }

        const e = escapeHtml;
        const ticketHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ticket Orden #${e(order.id)}</title>
                <style>
                    body { font-family: monospace; padding: 20px; }
                    h2 { text-align: center; margin: 0; }
                    .divider { border-top: 2px dashed; margin: 10px 0; }
                    .item { display: flex; justify-content: space-between; margin: 5px 0; }
                </style>
            </head>
            <body>
                <h2>ORDEN LISTA</h2>
                <div class="divider"></div>
                <p><strong>Orden #:</strong> ${e(order.id)}</p>
                <p><strong>Entrega:</strong> ${e(orderWhereLabel(order))}</p>
                <p><strong>Hora:</strong> ${e(new Date().toLocaleTimeString('es-ES'))}</p>
                <div class="divider"></div>
                <h3>Items:</h3>
                ${order.items?.filter((item: OrderItem) => !isVoidedOrderLine(item)).map((item: OrderItem) => `
                    <div class="item">
                        <span>${e(item.quantity)}x ${e(item.menuItem?.name)}</span>
                    </div>
                `).join('') || ''}
                <div class="divider"></div>
                <p style="font-weight: bold; font-size: 1.2em;">ORDEN COMPLETADA</p>
            </body>
            </html>
        `;

        printWindow.document.write(ticketHTML);
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 250);
    };

    const handleReportProblem = (orderId: number) => {
        if (!canKitchenLineOps) {
            showWarning('Tu rol no puede reportar problemas de cocina desde aquí. Coordina con cocina o un administrador.');
            return;
        }
        setSelectedOrderId(orderId);
        setShowProblemModal(true);
    };

    const submitProblemReport = async () => {
        if (!canKitchenLineOps) {
            showWarning('Tu rol no puede reportar problemas de cocina desde aquí. Coordina con cocina o un administrador.');
            return;
        }
        if (problemDescription.trim() && selectedOrderId) {
            setSubmittingProblem(true);
            try {
                await ordersAPI.reportProblem(selectedOrderId, problemDescription.trim());
                success(`Problema reportado para orden #${selectedOrderId}. Se ha notificado al gerente.`);
                setShowProblemModal(false);
                setProblemDescription('');
                setSelectedOrderId(null);
            } catch (error: unknown) {
                console.error('Error reporting problem:', error);
                showError(axiosMsg(error, 'Error al reportar problema'));
            } finally {
                setSubmittingProblem(false);
            }
        }
    };

    const getWaitTime = (order: Order) => {
        return getKdsWaitMinutes(order);
    };

    const getTimeClass = (minutes: number) => {
        if (!timingConfig) return 'time-normal';
        return getKdsTimeClass(minutes, timingConfig);
    };




    const isWithinDateRange = (createdAt: string) => {
        const orderDate = new Date(createdAt);
        const now = new Date();
        const hoursDiff = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);

        if (dateFilter === '24h') return hoursDiff <= 24;
        if (dateFilter === '48h') return hoursDiff <= 48;
        if (dateFilter === '7d') return hoursDiff <= 168; // 7 days
        return true; // 'all'
    };

    if (loading) {
        return (
            <div className="kitchen-loading">
                <Spinner size={28} label="Cargando comandas" />
            </div>
        );
    }

    const matchesFilters = (order: Order, status: string) => {
        // Status filter
        if (status !== 'all' && order.status !== status) return false;

        // Table filter
        if (debouncedTableFilter && order.table?.number?.toString() !== debouncedTableFilter) return false;

        // Date filter (only apply when status is 'all')
        if (status === 'all' && !isWithinDateRange(getKitchenReceivedAt(order))) return false;

        return true;
    };
    const statusCount = (status: string) => loadError ? undefined : orders.filter((order) => matchesFilters(order, status)).length;
    const sortedOrders = [...orders]
        .filter((order) => matchesFilters(order, statusFilter))
        .sort((a, b) =>
            new Date(getKitchenReceivedAt(a)).getTime() - new Date(getKitchenReceivedAt(b)).getTime()
        );

    const formatClock = (value?: string | null) => (value
        ? new Date(value).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : '--:--');

    const renderCard = (order: Order) => {
        const waitTime = getWaitTime(order);
        const timeClass = getTimeClass(waitTime);
        const where = orderWhereLabel(order);
        const isReady = order.status === 'READY';
        // Franja superior según la demora (umbrales del KDS); las listas y liberadas no alarman.
        const delay = order.kitchenReleasedAt || isReady
            ? 'calm'
            : timeClass === 'time-urgent' ? 'urgent' : timeClass === 'time-warning' ? 'warning' : 'calm';
        const delayLabel = delay === 'urgent' ? 'Atrasada' : delay === 'warning' ? 'Atención' : 'A tiempo';

        return (
            <article
                key={kitchenOrderKey(order)}
                className={`kds-ticket ${order.kitchenReleasedAt ? 'is-released' : ''}`}
                data-delay={delay}
                aria-label={`Orden ${order.id}, ${where}`}
            >
                <button
                    type="button"
                    className="kds-ticket__head"
                    aria-label={!showHistory && order.status === 'SENT_TO_KITCHEN'
                        ? `Iniciar preparación de la orden ${order.id}, ${where}`
                        : `Ver detalle de la orden ${order.id}, ${where}`}
                    onClick={() => setDetailOrderKey(kitchenOrderKey(order))}
                >
                    <strong className="kds-ticket__id">#{order.id}</strong>
                    <span className="kds-ticket__where">{where}</span>
                    {order.kitchenBatchSequence != null && order.kitchenBatchSequence > 1 && (
                        <span className="kds-ticket__batch">Tanda {order.kitchenBatchSequence}</span>
                    )}
                    <span className="kds-ticket__spacer" />
                    {order.kitchenReleasedAt ? (
                        <span className="kds-ticket__mins">Liberada</span>
                    ) : isReady ? (
                        <span className="kds-ticket__mins"><CheckCheck size={16} aria-hidden="true" /> Lista</span>
                    ) : (
                        <strong className="kds-ticket__mins" title={delayLabel}>
                            {delay === 'urgent' && <AlertCircle size={16} aria-label="Orden prioritaria" />} {waitTime} min
                        </strong>
                    )}
                </button>

                <div className={`kds-ticket__items ${displayMode ? 'is-display-mode' : 'is-pc-mode'}`}>
                    {order.items?.map((item) => {
                        const awaitingSend = !item.sentAt && item.status === 'PENDING';
                        if (isVoidedOrderLine(item)) {
                            return (
                                <div key={item.id} className="kds-ticket__item is-voided" title={item.voidReason || undefined}>
                                    <strong className="kds-ticket__qty">{item.voidedQuantity}</strong>
                                    <span className="kds-ticket__name">
                                        <span>{item.menuItem?.name || 'Producto'}</span>
                                        <Badge tone="danger">Anulado</Badge>
                                    </span>
                                </div>
                            );
                        }
                        const modifiers = (item.modifiers ?? []).map((mod) => mod.name).filter(Boolean).join(' · ');
                        const detail = [modifiers, item.notes].filter(Boolean).join(' · ');
                        return (
                            <div key={item.id} className="kds-ticket__item" data-status={item.status.toLowerCase()}>
                                <strong className="kds-ticket__qty">{item.quantity}</strong>
                                <span className="kds-ticket__name">
                                    <span>{item.menuItem?.name || 'Producto'}</span>
                                    {detail && <small>{detail}</small>}
                                    {(awaitingSend || item.status !== 'PENDING') && (
                                        <small className="kds-ticket__state">{awaitingSend ? 'Pendiente de envío' : kitchenItemStatusLabel[item.status]}</small>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className="kds-ticket__foot">
                    <span className="kds-ticket__who">
                        {order.user && (
                            <span className="kitchen-waiter-dot" style={{ backgroundColor: getUserAccentColor(order.user) }} aria-hidden="true" />
                        )}
                        {order.user?.name || 'Sin mesero'} · {formatClock(getKitchenReceivedAt(order))}
                    </span>
                    {order.kitchenReleasedAt ? (
                        <span className="kds-ticket__done"><CheckCircle size={16} aria-hidden="true" /> En historial</span>
                    ) : isReady ? (
                        canKitchenLineOps ? (
                            <Button variant="primary" size="lg" icon={CheckCheck} onClick={() => void handleReleaseOrder(order)} title="Confirmar liberación de la tanda">
                                Entregada
                            </Button>
                        ) : <span className="kds-ticket__done"><CheckCircle size={16} aria-hidden="true" /> Orden lista</span>
                    ) : canKitchenLineOps ? (
                        <>
                            <Button variant="secondary" size="lg" icon={AlertTriangle} onClick={() => handleReportProblem(order.id)} aria-label={`Reportar problema en orden ${order.id}`}>
                                Problema
                            </Button>
                            {order.status === 'SENT_TO_KITCHEN' && (
                                <Button variant="primary" size="lg" icon={Play} onClick={() => void handleStartOrder(order)} title="Primer toque: iniciar preparación">
                                    Iniciar
                                </Button>
                            )}
                            {order.status === 'IN_PREPARATION' && (
                                <Button variant="primary" size="lg" icon={CheckCircle} onClick={() => void handleMarkReady(order)} title="Marcar toda la tanda como lista">
                                    Lista
                                </Button>
                            )}
                        </>
                    ) : null}
                </div>
            </article>
        );
    };

    const kitchenColumns = [
        { key: "received", label: "Recibidas", tone: 'muted', orders: sortedOrders.filter((o) => o.status === "SENT_TO_KITCHEN") },
        { key: "preparing", label: "En preparación", tone: 'warning', orders: sortedOrders.filter((o) => o.status === "IN_PREPARATION") },
        { key: "ready", label: showHistory ? "Listas y liberadas" : "Listas para servir", tone: 'success', orders: sortedOrders.filter((o) => o.status !== "SENT_TO_KITCHEN" && o.status !== "IN_PREPARATION") },
    ];
    const summary = summarizeKds(orders, timingConfig);
    const lateOrders = timingConfig
        ? orders.filter((o) => (o.status === 'SENT_TO_KITCHEN' || o.status === 'IN_PREPARATION') && !o.kitchenReleasedAt && getWaitTime(o) >= timingConfig.urgentMinutes)
        : [];
    const lateLabel = summary.lateCount === null
        ? 'N/D'
        : lateOrders.length === 0
            ? 'Ninguna'
            : lateOrders.slice(0, 3).map((o) => `#${o.id} ${orderWhereLabel(o)}`).join(', ') + (lateOrders.length > 3 ? ` y ${lateOrders.length - 3} más` : '');

    const detailOrder = detailOrderKey !== null ? orders.find((o) => kitchenOrderKey(o) === detailOrderKey) ?? null : null;
    const detailWaitTime = detailOrder ? getWaitTime(detailOrder) : 0;
    const detailTimeline = detailOrder ? getOrderTimeline(detailOrder) : null;
    const detailWaitTone = detailOrder?.status === 'READY'
        ? 'success'
        : getTimeClass(detailWaitTime) === 'time-urgent' ? 'danger' : getTimeClass(detailWaitTime) === 'time-warning' ? 'warning' : 'neutral';
    const closeProblemModal = () => {
        setShowProblemModal(false);
        setProblemDescription('');
    };

    return (
        <div ref={pageRef} className={`kitchen-page-new ${displayMode ? 'kitchen-display-mode' : 'kitchen-admin-mode'}`}>
            <PageHeader
                title={displayMode ? 'Pantalla de Cocina' : 'Cocina'}
                description={showHistory ? 'Historial de comandas liberadas' : undefined}
                actions={
                    <>
                        {!showHistory && (
                            <dl className="kitchen-metrics" aria-label="Indicadores de cocina">
                                <div>
                                    <dt>Tiempo promedio en cocina</dt>
                                    <dd className={summary.avgMinutes !== null && summary.targetMinutes !== null && summary.avgMinutes > summary.targetMinutes ? 'is-warning' : undefined}>
                                        {summary.avgMinutes === null ? 'N/D' : `${formatNumber(summary.avgMinutes, 0)} min`}
                                        {summary.targetMinutes !== null && <span> / meta {formatNumber(summary.targetMinutes, 0)} min</span>}
                                    </dd>
                                </div>
                                <div>
                                    <dt>Atrasadas{timingConfig ? ` > ${formatNumber(timingConfig.urgentMinutes, 0)} min` : ''}</dt>
                                    <dd className={lateOrders.length ? 'is-danger' : undefined}>{lateLabel}</dd>
                                </div>
                            </dl>
                        )}
                        {!displayMode && <Button variant="secondary" icon={ListOrdered} onClick={() => setShowHistory((value) => !value)}>
                            {showHistory ? 'Ver cola activa' : 'Historial'}
                        </Button>}
                        <IconButton
                            icon={soundEnabled ? Volume2 : VolumeX}
                            label={soundEnabled ? 'Sonido ON' : 'Sonido OFF'}
                            tooltip={soundEnabled ? 'Silenciar avisos' : 'Activar sonido'}
                            onClick={() => setSoundEnabled(!soundEnabled)}
                        />
                        {/* /kds no tiene barra superior: el tema se cambia aquí. */}
                        {displayMode && <ThemeToggle />}
                        {displayMode && <Button variant="secondary" icon={isFullscreen ? Minimize2 : Maximize2} onClick={() => void toggleFullscreen()}>
                            {isFullscreen ? 'Salir de pantalla' : 'Pantalla completa'}
                        </Button>}
                        {!displayMode && <Button variant="secondary" icon={MonitorUp} onClick={() => navigate('/kds')}>Abrir KDS táctil</Button>}
                        {displayMode && canReturnToAdministration && <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/kitchen')}>Volver a administración</Button>}
                    </>
                }
            />

            <Tabs
                ariaLabel="Filtrar por estado"
                active={statusFilter}
                onChange={setStatusFilter}
                tabs={[
                    { id: 'all', label: 'Todas', badge: statusCount('all') },
                    { id: 'SENT_TO_KITCHEN', label: 'En cola', badge: statusCount('SENT_TO_KITCHEN') },
                    { id: 'IN_PREPARATION', label: 'En preparación', badge: statusCount('IN_PREPARATION') },
                    { id: 'READY', label: 'Listas', badge: statusCount('READY') },
                ]}
            />

            {!displayMode && (
                <TableToolbar>
                    <Input
                        id="table-filter"
                        type="search"
                        prefix={<Search size={16} aria-hidden="true" />}
                        aria-label="Filtrar por número de mesa"
                        placeholder="Mesa #"
                        value={tableFilter}
                        onChange={(e) => setTableFilter(e.target.value)}
                    />
                    <AppSelect
                        inputId="date-filter"
                        aria-label="Filtrar por fecha"
                        options={dateFilterOptions}
                        value={dateFilter}
                        onChange={(v) => setDateFilter(v ?? '24h')}
                        isClearable={false}
                        placeholder="Filtrar por fecha"
                    />
                </TableToolbar>
            )}

            {loadError && <LoadErrorState message={loadError} onRetry={() => void loadOrders()} />}

            {sortedOrders.length === 0 ? (
                <EmptyState
                    icon={ChefHat}
                    title={orders.length === 0 ? 'No hay órdenes pendientes' : 'Ninguna orden coincide con los filtros'}
                    description={
                        orders.length === 0
                            ? 'Las nuevas órdenes aparecerán aquí automáticamente'
                            : 'Prueba otro estado, mesa o rango de fecha'
                    }
                />
            ) : (
                <div className="kitchen-columns">
                    {kitchenColumns.map((col) => (
                        <section key={col.key} className="kitchen-column" aria-label={col.label}>
                            <h2 className="kitchen-column__title"><span className="kitchen-column__dot" data-tone={col.tone} aria-hidden="true" />{col.label} <span>{formatNumber(col.orders.length, 0)}</span></h2>
                            <div className="kitchen-column__body">
                                {col.orders.map(renderCard)}
                                {col.orders.length === 0 && <p className="kitchen-column__empty">Sin comandas</p>}
                            </div>
                        </section>
                    ))}
                </div>
            )}

            {/* Order Detail Modal */}
            <FullScreenModal
                isOpen={detailOrder !== null}
                onClose={() => setDetailOrderKey(null)}
                title={detailOrder ? `Orden #${detailOrder.id} — ${orderWhereLabel(detailOrder)}` : 'Orden'}
                subtitle={detailOrder
                    ? `Comanda de cocina · Tanda ${detailOrder.kitchenBatchSequence ?? '—'} · ${detailOrder.items?.length || 0} productos${detailOrder.user ? ` · ${detailOrder.user.name}` : ''}`
                    : undefined}
                status={detailOrder ? (
                    <Badge tone={detailWaitTone} dot>
                        {detailOrder.status === 'READY' ? 'Orden lista' : `${detailWaitTime} min`}
                    </Badge>
                ) : undefined}
                footerStart={detailOrder && !detailOrder.kitchenReleasedAt && canKitchenLineOps ? (
                    <Button variant="ghost" icon={AlertTriangle} className="kitchen-danger-text" onClick={() => { setDetailOrderKey(null); handleReportProblem(detailOrder.id); }}>
                        Reportar problema
                    </Button>
                ) : undefined}
                footer={detailOrder && !detailOrder.kitchenReleasedAt && canKitchenLineOps && (detailOrder.status === 'IN_PREPARATION' || detailOrder.status === 'READY') ? (
                    detailOrder.status === 'IN_PREPARATION'
                        ? <Button variant="primary" icon={CheckCircle} onClick={() => { void handleMarkReady(detailOrder); setDetailOrderKey(null); }}>Marcar todo listo</Button>
                        : <Button variant="primary" icon={Check} onClick={() => void handleReleaseOrder(detailOrder)}>Liberar del KDS</Button>
                ) : undefined}
            >
                {detailOrder && detailTimeline && (
                    <div className="kitchen-detail">
                        <dl className="kitchen-detail__timeline">
                            <div>
                                <dt>Estado</dt>
                                <dd>{getOrderStatusLabel(detailOrder.status)}</dd>
                            </div>
                            <div>
                                <dt>Recibida</dt>
                                <dd>{formatClock(getKitchenReceivedAt(detailOrder))}</dd>
                            </div>
                            <div>
                                <dt>Inicio</dt>
                                <dd>{formatClock(detailTimeline.firstStartedAt)}</dd>
                            </div>
                            <div>
                                <dt>Lista</dt>
                                <dd>{formatClock(detailTimeline.readyAt)}</dd>
                            </div>
                        </dl>

                        <section className="kitchen-detail__section" aria-label="Productos de la orden">
                            <h3 className="kitchen-detail__heading">Productos de la orden <span>{formatNumber(detailOrder.items?.length || 0, 0)}</span></h3>
                            <ul className="kitchen-detail__items">
                                {detailOrder.items?.map((item) => {
                                    const prepTime = getItemTimeDiff(item.startedAt);
                                    const awaitingSend = !item.sentAt && item.status === 'PENDING';
                                    if (isVoidedOrderLine(item)) {
                                        return (
                                            <li key={item.id} className="kitchen-detail__item is-voided">
                                                <span className="kitchen-detail__qty">{item.voidedQuantity}×</span>
                                                <span className="kitchen-detail__name">
                                                    <strong>{item.menuItem?.name || 'Producto'}</strong>
                                                    {item.voidReason && <small>Motivo: {item.voidReason}</small>}
                                                </span>
                                                <span className="kitchen-detail__actions"><Badge tone="danger">Anulado</Badge></span>
                                            </li>
                                        );
                                    }
                                    const stateTone = item.status === 'DONE' ? 'success' : item.status === 'IN_PROGRESS' ? 'warning' : 'neutral';
                                    return (
                                        <li key={item.id || item.menuItemId} className="kitchen-detail__item" data-status={item.status.toLowerCase()}>
                                            <span className="kitchen-detail__qty">{item.quantity}×</span>
                                            <span className="kitchen-detail__name">
                                                <strong>{item.menuItem?.name || 'Producto'}</strong>
                                                {item.notes && <small>{item.notes}</small>}
                                            </span>
                                            <span className="kitchen-detail__actions">
                                                <Badge tone={stateTone}>
                                                    {awaitingSend ? 'Pendiente de envío' : kitchenItemStatusLabel[item.status]}{item.status === 'IN_PROGRESS' && prepTime !== null ? ` · ${prepTime} min` : ''}
                                                </Badge>
                                                {canVoidLines && isVoidableOrderLine(item) && !orderLineVoidBlocker(detailOrder) && (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        icon={Ban}
                                                        className="kitchen-danger-text"
                                                        onClick={() => setVoidTarget({ order: detailOrder, itemId: item.id })}
                                                        title="Anular línea y registrar merma"
                                                    >
                                                        Anular
                                                    </Button>
                                                )}
                                                {detailOrder.status !== 'READY' && canKitchenLineOps && item.status === 'PENDING' && !awaitingSend && (
                                                    <Button size="sm" variant="secondary" icon={Play} onClick={() => handleStartItem(detailOrder.id, item.id)} title="Proceder">
                                                        Iniciar
                                                    </Button>
                                                )}
                                                {detailOrder.status !== 'READY' && canKitchenLineOps && item.status === 'IN_PROGRESS' && (
                                                    <Button size="sm" variant="primary" icon={Check} onClick={() => handleFinishItem(detailOrder.id, item.id)} title="Listo">
                                                        Listo
                                                    </Button>
                                                )}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    </div>
                )}
            </FullScreenModal>

            <KitchenLineVoidModal
                isOpen={voidTarget !== null}
                order={voidTarget?.order ?? null}
                initialItemId={voidTarget?.itemId ?? null}
                onClose={() => setVoidTarget(null)}
                onVoided={() => { void loadOrders(); }}
            />

            <FullScreenModal
                size="compact"
                isOpen={showProblemModal}
                onClose={closeProblemModal}
                title="Reportar Problema"
                subtitle={`Orden #${selectedOrderId ?? ''}`}
                dirty={problemDescription.trim().length > 0 && !submittingProblem}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="secondary" onClick={requestClose} disabled={submittingProblem}>Cancelar</Button>
                        <Button
                            variant="danger"
                            onClick={() => void submitProblemReport()}
                            loading={submittingProblem}
                            disabled={!problemDescription.trim()}
                        >
                            Reportar
                        </Button>
                    </>
                )}
            >
                <Field label="Descripción del problema" htmlFor="kitchen-problem-description" required>
                    <Textarea
                        id="kitchen-problem-description"
                        rows={5}
                        value={problemDescription}
                        onChange={(e) => setProblemDescription(e.target.value)}
                        placeholder="Describe el problema con esta orden..."
                        autoFocus
                    />
                </Field>
            </FullScreenModal>
        </div>
    );
}
