import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ordersAPI } from '../services/api';
import { ChefHat, CheckCircle, AlertCircle, Volume2, VolumeX, AlertTriangle, Play, Check, ListOrdered } from 'lucide-react';
import { initializeSound, playNotificationSound } from '../utils/sound';
import { escapeHtml } from '../utils/escapeHtml';
import { useDebounce } from '../utils/useDebounce';
import { initializeWebSocket, subscribeWebSocket, WS_EVENTS } from '../utils/websocket';
import { getUserAccentColor, canOperateKitchenLineItems } from '../utils/authz';
import './Kitchen.css';
import { getOrderStatusLabel, getOrderTimeline } from '../utils/orderStatus';
import Select from '../components/Select';
import Modal from '../components/Modal';
import type { SingleValue } from 'react-select';
import type { Order, OrderItem } from '../types';

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

export default function Kitchen() {
    const { user } = useAuth();
    const canKitchenLineOps = canOperateKitchenLineItems(user);

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
    const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
    const previousOrderCount = useRef(0);

    useEffect(() => {
        initializeSound();
    }, []);

    const loadOrders = useCallback(async () => {
        try {
            const response = await ordersAPI.getActive();
            const kitchenOrders = response.data.data.filter((o: Order) =>
                o.status === 'SENT_TO_KITCHEN' || o.status === 'IN_PREPARATION' || o.status === 'READY'
            );

            if (soundEnabled && kitchenOrders.length > previousOrderCount.current && previousOrderCount.current > 0) {
                playNotificationSound();
            }

            previousOrderCount.current = kitchenOrders.length;
            setOrders(kitchenOrders);
        } catch (error) {
            console.error('Error loading orders:', error);
        } finally {
            setLoading(false);
        }
    }, [soundEnabled]);

    useEffect(() => {
        loadOrders();
        initializeWebSocket();

        const unsubscribe = subscribeWebSocket((message) => {
            if (!message?.type) {
                return;
            }

            if (
                message.type === WS_EVENTS.ORDER_SENT_TO_KITCHEN ||
                message.type === WS_EVENTS.ORDER_IN_PREPARATION ||
                message.type === WS_EVENTS.ORDER_READY ||
                message.type === WS_EVENTS.ORDER_UPDATE
            ) {
                loadOrders();
            }
        });

        const interval = setInterval(loadOrders, 30000);

        return () => {
            unsubscribe();
            clearInterval(interval);
        };
    }, [loadOrders]);

    const handleMarkReady = async (orderId: number) => {
        try {
            await ordersAPI.updateStatus(orderId, 'READY');
            const order = orders.find(o => o.id === orderId);
            if (order) {
                printOrderTicket(order);
            }
            loadOrders();
        } catch (error) {
            console.error('Error updating order:', error);
            alert('Error al actualizar orden');
        }
    };

    const handleStartItem = async (orderId: number, itemId: number) => {
        if (!canKitchenLineOps) {
            alert('Tu rol no puede iniciar ítems en cocina. Esta vista es de consulta; coordina con cocina o un administrador.');
            return;
        }
        try {
            await ordersAPI.startItem(orderId, itemId);
            loadOrders();
        } catch (error: unknown) {
            alert(axiosMsg(error, 'Error al iniciar ítem'));
        }
    };

    const handleFinishItem = async (orderId: number, itemId: number) => {
        if (!canKitchenLineOps) {
            alert('Tu rol no puede finalizar ítems en cocina. Esta vista es de consulta; coordina con cocina o un administrador.');
            return;
        }
        try {
            const res = await ordersAPI.finishItem(orderId, itemId);
            if (res.data.data?.allDone) {
                const order = orders.find(o => o.id === orderId);
                if (order) printOrderTicket(order);
            }
            loadOrders();
        } catch (error: unknown) {
            alert(axiosMsg(error, 'Error al finalizar ítem'));
        }
    };

    const getItemTimeDiff = (from?: string) => {
        if (!from) return null;
        return Math.floor((Date.now() - new Date(from).getTime()) / 60000);
    };

    const printOrderTicket = (order: Order) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const e = escapeHtml;
        const ticketHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ticket Orden #${e(order.id)}</title>
                <style>
                    body { font-family: monospace; padding: 20px; }
                    h2 { text-align: center; margin: 0; }
                    .divider { border-top: 2px dashed #000; margin: 10px 0; }
                    .item { display: flex; justify-content: space-between; margin: 5px 0; }
                </style>
            </head>
            <body>
                <h2>ORDEN LISTA</h2>
                <div class="divider"></div>
                <p><strong>Orden #:</strong> ${e(order.id)}</p>
                <p><strong>Mesa:</strong> ${e(order.table?.number || 'N/A')}</p>
                <p><strong>Hora:</strong> ${e(new Date().toLocaleTimeString('es-ES'))}</p>
                <div class="divider"></div>
                <h3>Items:</h3>
                ${order.items?.map((item: OrderItem) => `
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
            alert('Tu rol no puede reportar problemas de cocina desde aquí. Coordina con cocina o un administrador.');
            return;
        }
        setSelectedOrderId(orderId);
        setShowProblemModal(true);
    };

    const submitProblemReport = async () => {
        if (!canKitchenLineOps) {
            alert('Tu rol no puede reportar problemas de cocina desde aquí. Coordina con cocina o un administrador.');
            return;
        }
        if (problemDescription.trim() && selectedOrderId) {
            try {
                await ordersAPI.reportProblem(selectedOrderId, problemDescription.trim());
                alert(`Problema reportado para orden #${selectedOrderId}.\nSe ha notificado al gerente.`);
                setShowProblemModal(false);
                setProblemDescription('');
                setSelectedOrderId(null);
            } catch (error: unknown) {
                console.error('Error reporting problem:', error);
                alert(axiosMsg(error, 'Error al reportar problema'));
            }
        }
    };

    const getWaitTime = (createdAt: string) => {
        const minutes = Math.floor((new Date().getTime() - new Date(createdAt).getTime()) / 60000);
        return minutes;
    };

    const getTimeClass = (minutes: number) => {
        if (minutes > 20) return 'time-urgent';
        if (minutes > 10) return 'time-warning';
        return 'time-normal';
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
        return <div className="kitchen-loading">Cargando comandas...</div>;
    }

    const sortedOrders = [...orders]
        .filter(order => {
            // Status filter
            if (statusFilter !== 'all' && order.status !== statusFilter) return false;

            // Table filter
            if (debouncedTableFilter && order.table?.number?.toString() !== debouncedTableFilter) return false;

            // Date filter (only apply when statusFilter is 'all')
            if (statusFilter === 'all' && !isWithinDateRange(order.createdAt)) return false;

            return true;
        })
        .sort((a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

    return (
        <div className="kitchen-page-new">
            <div className="kitchen-header-new">
                <div className="header-left-kitchen">
                    <h1><ChefHat size={28} /> Cocina (KDS)</h1>
                    <p className="kitchen-subtitle-new">{orders.length} órdenes pendientes</p>
                </div>
                <div className="kitchen-controls">
                    <button
                        className={`sound-toggle-new ${soundEnabled ? 'enabled' : 'disabled'}`}
                        onClick={() => setSoundEnabled(!soundEnabled)}
                    >
                        {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                        <span>{soundEnabled ? 'Sonido ON' : 'Sonido OFF'}</span>
                    </button>
                </div>
            </div>


            {/* Filters Row */}
            <div className="filters-row">
                <div className="status-filters-new">
                    <button
                        className={`status-filter-btn-new ${statusFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('all')}
                    >
                        Todas
                    </button>
                    <button
                        className={`status-filter-btn-new ${statusFilter === 'SENT_TO_KITCHEN' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('SENT_TO_KITCHEN')}
                    >
                        En Cola
                    </button>
                    <button
                        className={`status-filter-btn-new ${statusFilter === 'IN_PREPARATION' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('IN_PREPARATION')}
                    >
                        En Preparación
                    </button>
                    <button
                        className={`status-filter-btn-new ${statusFilter === 'READY' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('READY')}
                    >
                        Listas
                    </button>
                </div>

                <div className="additional-filters">
                    <div className="filter-group">
                        <input
                            id="table-filter"
                            type="text"
                            className="table-filter-input"
                            placeholder="Mesa #"
                            value={tableFilter}
                            onChange={(e) => setTableFilter(e.target.value)}
                        />
                    </div>
                    <div className="filter-group date-filter-group">
                        <Select
                            id="date-filter"
                            options={dateFilterOptions}
                            value={dateFilterOptions.find(opt => opt.value === dateFilter)}
                            onChange={(option: SingleValue<{ value: string; label: string }>) => setDateFilter(option?.value || '24h')}
                            isSearchable={false}
                            placeholder="Filtrar por fecha"
                        />
                    </div>
                </div>
            </div>

            <div className="kitchen-grid-new">
                {sortedOrders.map(order => {
                    const waitTime = getWaitTime(order.createdAt);
                    const timeClass = getTimeClass(waitTime);
                    const timeline = getOrderTimeline(order);
                    const waiterAccent = getUserAccentColor(order.user);


                    const itemsCount = order.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || 0;

                    return (
                        <div
                            key={order.id}
                            className={`kitchen-card-new ${order.status === 'READY' ? 'order-ready' : timeClass}`}
                            style={{ borderTop: `4px solid ${waiterAccent}` }}
                            onClick={() => setDetailOrderId(order.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setDetailOrderId(order.id);
                                }
                            }}
                        >
                            {/* Status Badge */}
                            <div className={`status-badge-new status-${order.status === 'READY' ? 'ready' : timeClass.replace('time-', '')}`}>
                                <span>{order.status === 'READY' ? 'Lista' : `${waitTime} min`}</span>
                            </div>

                            {/* Card Body */}
                            <div className="kitchen-card-body-new">
                                <div className="kitchen-card-top-row">
                                    <div className="table-number-new">Mesa {order.table?.number || 'N/A'}</div>
                                    {order.user && (
                                        <span
                                            className="kitchen-waiter-chip"
                                            style={{
                                                backgroundColor: `${waiterAccent}25`,
                                                color: waiterAccent,
                                                borderColor: waiterAccent
                                            }}
                                        >
                                            <span
                                                className="kitchen-waiter-dot"
                                                style={{ backgroundColor: waiterAccent }}
                                            />
                                            {order.user.name}
                                        </span>
                                    )}
                                </div>
                                <div className="order-meta-new">
                                    <span className="order-id-kitchen">Orden #{order.id}</span>
                                    <span className="order-time-kitchen">
                                        • Recibida: {new Date(order.createdAt).toLocaleTimeString('es-ES', {
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </span>
                                </div>

                                <div className="kitchen-timeline-grid">
                                    <div className="kitchen-timeline-cell">
                                        <div className="kitchen-timeline-label">Estado</div>
                                        <div className="kitchen-timeline-value">{getOrderStatusLabel(order.status)}</div>
                                    </div>
                                    <div className="kitchen-timeline-cell">
                                        <div className="kitchen-timeline-label">Inicio</div>
                                        <div className="kitchen-timeline-value">
                                            {timeline.firstStartedAt ? new Date(timeline.firstStartedAt).toLocaleTimeString('es-ES', {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            }) : '--:--'}
                                        </div>
                                    </div>
                                    <div className="kitchen-timeline-cell">
                                        <div className="kitchen-timeline-label">Lista</div>
                                        <div className="kitchen-timeline-value">
                                            {timeline.readyAt ? new Date(timeline.readyAt).toLocaleTimeString('es-ES', {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            }) : '--:--'}
                                        </div>
                                    </div>
                                </div>

                                {/* Priority Alert */}
                                {waitTime > 15 && order.status !== 'READY' && (
                                    <div className="priority-alert-new">
                                        <AlertCircle size={14} />
                                        Orden prioritaria
                                    </div>
                                )}

                                {/* Items summary (click card to see detail) */}
                                <div className="kitchen-items-summary">
                                    <span className="kitchen-items-summary-icon">
                                        <ListOrdered size={14} />
                                    </span>
                                    <span className="kitchen-items-summary-text">
                                        {itemsCount} {itemsCount === 1 ? 'producto' : 'productos'}
                                    </span>
                                    <span className="kitchen-items-summary-hint">Ver detalle</span>
                                </div>
                            </div>

                            {/* Actions Footer */}
                            <div className="kitchen-card-actions-new" onClick={(e) => e.stopPropagation()}>
                                {order.status === 'READY' ? (
                                    <div className="ready-badge-footer">
                                        <CheckCircle size={16} />
                                        Orden Lista
                                    </div>
                                ) : (
                                    <>
                                        {canKitchenLineOps && (
                                            <button
                                                className="action-btn-new problem"
                                                onClick={() => handleReportProblem(order.id)}
                                                title="Reportar Problema"
                                            >
                                                <AlertTriangle size={20} />
                                                <span>Problema</span>
                                            </button>
                                        )}
                                        <button
                                            className="action-btn-new"
                                            onClick={() => handleMarkReady(order.id)}
                                            title="Marcar toda la orden como lista"
                                        >
                                            <CheckCircle size={20} />
                                            <span>Todo Listo</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>


                    );
                })}

                {orders.length === 0 && (
                    <div className="no-orders-new">
                        <ChefHat size={48} />
                        <p>No hay órdenes pendientes</p>
                        <small>Las nuevas órdenes aparecerán aquí automáticamente</small>
                    </div>
                )}
            </div>

            {/* Order Detail Modal */}
            {detailOrderId !== null && (() => {
                const detailOrder = orders.find(o => o.id === detailOrderId);
                if (!detailOrder) return null;
                const detailWaitTime = getWaitTime(detailOrder.createdAt);
                const detailTimeline = getOrderTimeline(detailOrder);
                const detailWaiterAccent = getUserAccentColor(detailOrder.user);
                return (
                    <Modal
                        isOpen={true}
                        onClose={() => setDetailOrderId(null)}
                        title={`Orden #${detailOrder.id} — Mesa ${detailOrder.table?.number || 'N/A'}`}
                        size="md"
                        variant="sidebar"
                    >
                        <div className="kitchen-detail-modal">
                            <div className="kitchen-detail-meta">
                                {detailOrder.user && (
                                    <span
                                        className="kitchen-waiter-chip"
                                        style={{
                                            backgroundColor: `${detailWaiterAccent}25`,
                                            color: detailWaiterAccent,
                                            borderColor: detailWaiterAccent
                                        }}
                                    >
                                        <span
                                            className="kitchen-waiter-dot"
                                            style={{ backgroundColor: detailWaiterAccent }}
                                        />
                                        {detailOrder.user.name}
                                    </span>
                                )}
                                <span className={`kitchen-detail-status status-${detailOrder.status === 'READY' ? 'ready' : getTimeClass(detailWaitTime).replace('time-', '')}`}>
                                    {detailOrder.status === 'READY' ? 'Lista' : `${detailWaitTime} min`}
                                </span>
                            </div>

                            <div className="kitchen-timeline-grid">
                                <div className="kitchen-timeline-cell">
                                    <div className="kitchen-timeline-label">Estado</div>
                                    <div className="kitchen-timeline-value">{getOrderStatusLabel(detailOrder.status)}</div>
                                </div>
                                <div className="kitchen-timeline-cell">
                                    <div className="kitchen-timeline-label">Recibida</div>
                                    <div className="kitchen-timeline-value">
                                        {new Date(detailOrder.createdAt).toLocaleTimeString('es-ES', {
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </div>
                                </div>
                                <div className="kitchen-timeline-cell">
                                    <div className="kitchen-timeline-label">Inicio</div>
                                    <div className="kitchen-timeline-value">
                                        {detailTimeline.firstStartedAt ? new Date(detailTimeline.firstStartedAt).toLocaleTimeString('es-ES', {
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        }) : '--:--'}
                                    </div>
                                </div>
                                <div className="kitchen-timeline-cell">
                                    <div className="kitchen-timeline-label">Lista</div>
                                    <div className="kitchen-timeline-value">
                                        {detailTimeline.readyAt ? new Date(detailTimeline.readyAt).toLocaleTimeString('es-ES', {
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        }) : '--:--'}
                                    </div>
                                </div>
                            </div>

                            <h4 className="kitchen-detail-section-title">Productos de la orden</h4>
                            <div className="kitchen-items-list kitchen-items-list-modal">
                                {detailOrder.items?.map((item) => {
                                    const prepTime = getItemTimeDiff(item.startedAt);
                                    const itemStatusClass = item.status === 'DONE' ? 'item-done' : item.status === 'IN_PROGRESS' ? 'item-progress' : 'item-pending';
                                    return (
                                        <div key={item.id || item.menuItemId} className={`kitchen-item ${itemStatusClass}`}>
                                            <span className="item-qty-kitchen">{item.quantity}x</span>
                                            <span className="item-name-kitchen">
                                                {item.menuItem?.name}
                                                {item.notes && <small className="item-note-kitchen">{item.notes}</small>}
                                            </span>
                                            {item.status === 'IN_PROGRESS' && prepTime !== null && (
                                                <span className="item-prep-time">
                                                    {prepTime}m
                                                </span>
                                            )}
                                            {detailOrder.status !== 'READY' && (
                                                <>
                                                    {canKitchenLineOps && item.status === 'PENDING' && (
                                                        <button
                                                            onClick={() => handleStartItem(detailOrder.id, item.id)}
                                                            title="Proceder"
                                                            className="item-action-btn item-action-start"
                                                        >
                                                            <Play size={12} /> Iniciar
                                                        </button>
                                                    )}
                                                    {canKitchenLineOps && item.status === 'IN_PROGRESS' && (
                                                        <button
                                                            onClick={() => handleFinishItem(detailOrder.id, item.id)}
                                                            title="Listo"
                                                            className="item-action-btn item-action-finish"
                                                        >
                                                            <Check size={12} /> Listo
                                                        </button>
                                                    )}
                                                    {item.status === 'DONE' && (
                                                        <CheckCircle size={16} color="var(--color-success, #22c55e)" />
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {detailOrder.status !== 'READY' && (
                                <div className="kitchen-detail-actions">
                                    {canKitchenLineOps && (
                                        <button
                                            className="btn btn-danger-ghost"
                                            onClick={() => {
                                                setDetailOrderId(null);
                                                handleReportProblem(detailOrder.id);
                                            }}
                                        >
                                            <AlertTriangle size={16} />
                                            Reportar problema
                                        </button>
                                    )}
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => {
                                            handleMarkReady(detailOrder.id);
                                            setDetailOrderId(null);
                                        }}
                                    >
                                        <CheckCircle size={16} />
                                        Marcar todo listo
                                    </button>
                                </div>
                            )}
                        </div>
                    </Modal>
                );
            })()}

            {/* Problem Report Modal */}
            {showProblemModal && (
                <div className="modal-overlay-problem" onClick={() => setShowProblemModal(false)}>
                    <div className="problem-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Reportar Problema</h3>
                        <p>Orden #{selectedOrderId}</p>
                        <textarea
                            className="problem-textarea"
                            value={problemDescription}
                            onChange={(e) => setProblemDescription(e.target.value)}
                            placeholder="Describe el problema con esta orden..."
                            autoFocus
                        />
                        <div className="problem-modal-actions">
                            <button
                                className="btn-cancel-problem"
                                onClick={() => {
                                    setShowProblemModal(false);
                                    setProblemDescription('');
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn-submit-problem"
                                onClick={submitProblemReport}
                            >
                                Reportar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
