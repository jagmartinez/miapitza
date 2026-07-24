import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ordersAPI, invoicesAPI, cashShiftsAPI, warehousesAPI } from '../services/api';
import { canSendOrderToKitchen, canCancelOrder, canCreatePayment, canOperateKitchenLineItems } from '../utils/authz';
import { useDebounce } from '../utils/useDebounce';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PaymentModal from '../components/PaymentModal';
import Modal from '../components/Modal';
import Select from '../components/Select';
import { NoResultsEmptyState } from '../components/EmptyState';
import { LoadingOverlay } from '../components/LoadingSpinner';
import {
    Send, CheckCircle, XCircle, CreditCard,
    Clock, User, Printer, Package, Info, ClipboardList
} from 'lucide-react';
import type { Order, Warehouse } from '../types';
import { useCurrency } from '../hooks/useCurrency';
import { hasUsableCashShift } from '../utils/paymentAccess';
import type { SingleValue } from 'react-select';
import { getOrderStatusClassName, getOrderStatusLabel } from '../utils/orderStatus';
import { activateOnKeyboard } from '../utils/keyboardActivation';
import { useAppToast } from '../context/ToastContext';
import { initializeWebSocket, subscribeWebSocket, WS_EVENTS } from '../utils/websocket';
import './Orders.css';

interface ActiveShiftStatus {
    hasActiveShift: boolean;
    requiresClose: boolean;
    shift?: { cashRegister?: { branch?: { id: number } } } | null;
}

export default function Orders() {
    const { user } = useAuth();
    const { formatMoney, symbol: currencySymbol } = useCurrency();
    const { error: showError, warning: showWarning } = useAppToast();
    const canSendKitchen = canSendOrderToKitchen(user);
    const canManageKitchen = canOperateKitchenLineItems(user);
    const canCancel = canCancelOrder(user);
    const canPayOrder = canCreatePayment(user);

    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [activeTab, setActiveTab] = useState<'info' | 'items'>('info');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearch = useDebounce(searchQuery, 300);

    // Date Range Filter State
    const [dateRange, setDateRange] = useState<'24h' | '7d' | '30d' | 'custom'>('7d');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    // Payment Modal State
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
    const [activeShiftStatus, setActiveShiftStatus] = useState<ActiveShiftStatus | null>(null);
    const [preparingPaymentOrderId, setPreparingPaymentOrderId] = useState<number | null>(null);

    // Cancel modal state
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelWarehouseId, setCancelWarehouseId] = useState<number | null>(null);
    const [cancelWarehouses, setCancelWarehouses] = useState<Warehouse[]>([]);

    const [showDeliveryModal, setShowDeliveryModal] = useState(false);
    const [deliveryOrder, setDeliveryOrder] = useState<Order | null>(null);
    const [deliveryWarehouseId, setDeliveryWarehouseId] = useState<number | null>(null);
    const [deliveryWarehouses, setDeliveryWarehouses] = useState<Warehouse[]>([]);
    const [loadingWarehouses, setLoadingWarehouses] = useState(false);

    const loadOrders = useCallback(async () => {
        try {
            const now = new Date();
            let startDate: string;
            let endDate: string = now.toISOString();

            // Calculate start date based on selected range
            switch (dateRange) {
                case '24h':
                    startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
                    break;
                case '7d':
                    startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString();
                    break;
                case '30d':
                    startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString();
                    break;
                case 'custom':
                    if (customStartDate && customEndDate) {
                        startDate = new Date(customStartDate).toISOString();
                        endDate = new Date(customEndDate + 'T23:59:59').toISOString();
                    } else {
                        // Default to last 24 hours if custom dates not set
                        startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
                    }
                    break;
                default:
                    startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString();
            }

            const response = await ordersAPI.getAll({
                startDate,
                endDate
            });
            setOrders(response.data.data);
        } catch (error) {
            console.error('Error loading orders:', error);
        } finally {
            setLoading(false);
        }
    }, [customEndDate, customStartDate, dateRange]);

    const loadShiftStatus = useCallback(async () => {
        try {
            const res = await cashShiftsAPI.getActiveStatus();
            setActiveShiftStatus(res.data.data as ActiveShiftStatus);
        } catch {
            setActiveShiftStatus({ hasActiveShift: false, requiresClose: false, shift: null });
        }
    }, []);

    useEffect(() => {
        void loadShiftStatus();
    }, [loadShiftStatus]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    useEffect(() => {
        initializeWebSocket();
        const unsubscribe = subscribeWebSocket((message) => {
            if (!message?.type) return;
            if (
                message.type === WS_EVENTS.ORDER_CREATED ||
                message.type === WS_EVENTS.ORDER_SENT_TO_KITCHEN ||
                message.type === WS_EVENTS.ORDER_IN_PREPARATION ||
                message.type === WS_EVENTS.ORDER_READY ||
                message.type === WS_EVENTS.ORDER_COMPLETED ||
                message.type === WS_EVENTS.ORDER_UPDATE
            ) {
                void loadOrders();
            }
        });
        return unsubscribe;
    }, [loadOrders]);

    const handleViewDetails = (order: Order) => {
        setSelectedOrder(order);
        setActiveTab('info');
        setIsSidebarOpen(true);
    };

    const handleUpdateStatus = async (orderId: number, newStatus: string) => {
        if (newStatus === 'SENT_TO_KITCHEN' && !canSendKitchen) {
            showWarning('Tu rol no puede enviar órdenes a cocina. Pide apoyo a un mesero o administrador.');
            return;
        }
        if (newStatus === 'READY' && !canManageKitchen) {
            showWarning('Solo cocina puede marcar una orden como lista.');
            return;
        }
        try {
            if (newStatus === 'SENT_TO_KITCHEN') {
                await ordersAPI.sendToKitchen(orderId);
            } else if (newStatus === 'READY') {
                await ordersAPI.markKitchenReady(orderId);
            } else {
                await ordersAPI.updateStatus(orderId, newStatus);
            }
            loadOrders();
            setIsSidebarOpen(false);
        } catch (error) {
            console.error('Error updating order status:', error);
            showError('Error al actualizar el estado de la orden');
        }
    };

    const handlePaymentClick = async (order: Order) => {
        if (!canPayOrder) {
            showWarning('Tu rol no puede registrar pagos. Pide apoyo a un cajero o administrador.');
            return;
        }
        setPreparingPaymentOrderId(order.id);
        try {
            // Keep the same fiscal invariant as POS and the table command center:
            // an official invoice must exist before PaymentModal can collect.
            await invoicesAPI.issue(order.id);
            const refreshed = await ordersAPI.getById(order.id);
            setPaymentOrder(refreshed.data.data as Order);
            setShowPaymentModal(true);
        } catch (error: unknown) {
            const message = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'No se pudo emitir la factura antes del cobro.');
        } finally {
            setPreparingPaymentOrderId(null);
        }
    };

    const handlePaymentComplete = () => {
        setShowPaymentModal(false);
        setPaymentOrder(null);
        loadOrders();
        // Close sidebar if the paid order was the one open
        if (selectedOrder && paymentOrder && selectedOrder.id === paymentOrder.id) {
            setIsSidebarOpen(false);
        }
    };

    const loadBranchWarehouses = async (branchId: number) => {
        const response = await warehousesAPI.getAll({ branchId });
        return (response.data.data as Warehouse[]).filter(
            (warehouse) => warehouse.type === 'BRANCH' && warehouse.branchId === branchId
        );
    };

    const openCancelModal = async (order: Order) => {
        if (!canCancel) {
            showWarning('Tu rol no puede cancelar órdenes. Pide apoyo a un mesero o administrador.');
            return;
        }
        setCancelOrder(order);
        setCancelReason('');
        setCancelWarehouseId(null);
        setCancelWarehouses([]);
        setShowCancelModal(true);
        if (order.status !== 'OPEN') {
            setLoadingWarehouses(true);
            try {
                const warehouses = await loadBranchWarehouses(order.branchId);
                setCancelWarehouses(warehouses);
                if (warehouses.length === 1) setCancelWarehouseId(warehouses[0].id);
            } catch {
                showError('No se pudieron cargar las bodegas de la sucursal.');
            } finally {
                setLoadingWarehouses(false);
            }
        }
    };

    const handleCancelOrder = async () => {
        if (!cancelOrder) return;
        if (!canCancel) {
            showWarning('Tu rol no puede cancelar órdenes. Pide apoyo a un mesero o administrador.');
            return;
        }
        if (cancelOrder.status !== 'OPEN' && !cancelWarehouseId) {
            showWarning('Selecciona la bodega que registrará el desperdicio de los productos ya enviados.');
            return;
        }
        try {
            await ordersAPI.cancel(cancelOrder.id, cancelReason, cancelWarehouseId ?? undefined);
            loadOrders();
            setIsSidebarOpen(false);
            setShowCancelModal(false);
            setCancelOrder(null);
            setCancelReason('');
            setCancelWarehouseId(null);
        } catch (error) {
            console.error('Error cancelling order:', error);
            showError('Error al cancelar la orden');
        }
    };

    const handleReprintInvoice = async (order: Order) => {
        try {
            const invoice = await invoicesAPI.getData(order.id);
            const invoiceNumber = invoice.data.data.invoiceNumber as string;
            const pdf = await invoicesAPI.downloadPdf(order.id);
            const url = URL.createObjectURL(new Blob([pdf.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${invoiceNumber}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error: unknown) {
            const message = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'No se pudo generar la factura oficial.');
        }
    };

    const downloadFiscalCounterDocument = async (order: Order, kind: 'CREDIT_NOTE' | 'CANCELLATION') => {
        try {
            const response = kind === 'CREDIT_NOTE'
                ? await invoicesAPI.downloadCreditNotePdf(order.id)
                : await invoicesAPI.downloadCancellationPdf(order.id);
            const fileName = kind === 'CREDIT_NOTE'
                ? (order.fiscalCreditNote?.number || `nota-credito-${order.id}`)
                : `anulacion-${order.invoiceNumber || order.id}`;
            const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${fileName}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
        } catch {
            showError('No se pudo descargar el contraflujo fiscal.');
        }
    };

    const openDeliveryModal = async (order: Order) => {
        setDeliveryOrder(order);
        setDeliveryWarehouseId(null);
        setDeliveryWarehouses([]);
        setShowDeliveryModal(true);
        setLoadingWarehouses(true);
        try {
            const warehouses = await loadBranchWarehouses(order.branchId);
            setDeliveryWarehouses(warehouses);
            if (warehouses.length === 1) setDeliveryWarehouseId(warehouses[0].id);
        } catch {
            showError('No se pudieron cargar las bodegas de la sucursal.');
        } finally {
            setLoadingWarehouses(false);
        }
    };

    const handleCompleteDelivery = async () => {
        if (!deliveryOrder || !deliveryWarehouseId) {
            showWarning('Selecciona la bodega de la que se descontará el inventario.');
            return;
        }
        try {
            await ordersAPI.complete(deliveryOrder.id, deliveryWarehouseId);
            await loadOrders();
            setIsSidebarOpen(false);
            setShowDeliveryModal(false);
            setDeliveryOrder(null);
            setDeliveryWarehouseId(null);
        } catch (error) {
            console.error('Error completing delivery:', error);
            showError('No se pudo entregar la orden ni descontar el inventario.');
        }
    };

    const getStatusColor = (status: string) => {
        return `status-badge-${getOrderStatusClassName(status as Order['status']).replace('status-', '')}`;
    };

    const getStatusClass = (status: string) => {
        return getOrderStatusClassName(status as Order['status']);
    };

    const getStatusText = (status: string) => {
        return getOrderStatusLabel(status as Order['status']);
    };

    const getActionButtons = (order: Order) => {
        const buttons = [];

        if (order.status === 'OPEN' && canSendKitchen) {
            buttons.push(
                <Button key="send" variant="primary" onClick={() => handleUpdateStatus(order.id, 'SENT_TO_KITCHEN')}>
                    <Send size={16} /> Enviar a Cocina
                </Button>
            );
        }

        if (canManageKitchen && (order.status === 'SENT_TO_KITCHEN' || order.status === 'IN_PREPARATION')) {
            buttons.push(
                <Button key="ready" variant="primary" onClick={() => handleUpdateStatus(order.id, 'READY')}>
                    <CheckCircle size={16} /> Marcar Lista
                </Button>
            );
        }

        if (order.status === 'READY' && (order.financialStatus === 'PAID' || Math.round(Number(order.total) * 100) === 0)) {
            buttons.push(
                <Button key="delivered" variant="primary" onClick={() => void openDeliveryModal(order)}>
                    <Package size={16} /> Entregar
                </Button>
            );
        }

        if (order.status !== 'CANCELLED' && order.financialStatus !== 'PAID' && canPayOrder) {
            buttons.push(
                <Button
                    key="pay"
                    variant="primary"
                    disabled={preparingPaymentOrderId === order.id}
                    onClick={() => void handlePaymentClick(order)}
                >
                    <CreditCard size={16} /> {preparingPaymentOrderId === order.id ? 'Facturando…' : 'Cobrar'}
                </Button>
            );
        }

        if (order.financialStatus === 'UNPAID' && order.status !== 'CANCELLED' && !order.invoiceNumber && canCancel) {
            buttons.push(
                <Button key="cancel" variant="ghost" className="text-danger" onClick={() => void openCancelModal(order)}>
                    <XCircle size={16} /> Cancelar
                </Button>
            );
        }

        if (order.invoiceNumber) {
            buttons.push(
                <Button key="reprint" variant="secondary" onClick={() => void handleReprintInvoice(order)}>
                    <Printer size={16} /> Descargar Factura
                </Button>
            );
        }
        if (order.fiscalCreditNote) {
            buttons.push(
                <Button key="credit-note" variant="secondary" onClick={() => void downloadFiscalCounterDocument(order, 'CREDIT_NOTE')}>
                    <Printer size={16} /> Nota de crédito
                </Button>
            );
        }
        if (order.fiscalInvoiceCancellation) {
            buttons.push(
                <Button key="invoice-cancellation" variant="secondary" onClick={() => void downloadFiscalCounterDocument(order, 'CANCELLATION')}>
                    <Printer size={16} /> Constancia de anulación
                </Button>
            );
        }

        return buttons;
    };

    const filteredOrders = orders.filter(o => {
        const matchStatus = statusFilter === 'all'
            || (statusFilter === 'PAID' ? o.financialStatus === 'PAID' : o.status === statusFilter);
        const searchLower = debouncedSearch.toLowerCase();
        const matchSearch = !debouncedSearch || String(o.id).includes(searchLower) ||
            o.customerName?.toLowerCase().includes(searchLower) ||
            o.user?.name.toLowerCase().includes(searchLower) ||
            (o.table && String(o.table.number).includes(debouncedSearch));

        return matchStatus && matchSearch;
    });

    if (loading) return <LoadingOverlay text="Sincronizando órdenes..." />;

    return (
        <div className="orders-page">
            {/* Header */}
            <header className="orders-header">
                <div>
                    <h1><ClipboardList size={32} /> Gestión de Órdenes</h1>
                    <p className="subtitle">
                        Control operativo de sala y cocina • {
                            dateRange === '24h' ? 'Últimas 24 horas' :
                                dateRange === '7d' ? 'Últimos 7 días' :
                                    dateRange === '30d' ? 'Últimos 30 días' :
                                        'Rango personalizado'
                        }
                    </p>
                </div>
            </header>

            {/* Filter Bar */}
            <div className="orders-controls">
                <div className="status-filters">
                    <button
                        className={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('all')}
                    >
                        Todas
                    </button>
                    <button
                        className={`filter-tab open ${statusFilter === 'OPEN' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('OPEN')}
                    >
                        Abierta
                    </button>
                    <button
                        className={`filter-tab kitchen ${statusFilter === 'SENT_TO_KITCHEN' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('SENT_TO_KITCHEN')}
                    >
                        En Cocina
                    </button>
                    <button
                        className={`filter-tab ready ${statusFilter === 'READY' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('READY')}
                    >
                        Lista
                    </button>
                    <button
                        className={`filter-tab delivered ${statusFilter === 'DELIVERED' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('DELIVERED')}
                    >
                        Entregada
                    </button>
                    <button
                        className={`filter-tab paid ${statusFilter === 'PAID' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('PAID')}
                    >
                        Pagada
                    </button>
                    <button
                        className={`filter-tab cancelled ${statusFilter === 'CANCELLED' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('CANCELLED')}
                    >
                        Cancelada
                    </button>
                </div>

                <div className="controls-right">
                    {/* Date Range Filter */}
                    <Select
                        value={(() => {
                            const option = [
                                { value: '24h', label: 'Últimas 24 horas' },
                                { value: '7d', label: 'Últimos 7 días' },
                                { value: '30d', label: 'Últimos 30 días' },
                                { value: 'custom', label: 'Rango personalizado' }
                            ].find(opt => opt.value === dateRange);
                            return option || null;
                        })()}
                        onChange={(option: SingleValue<{ value: string; label: string }>) => {
                            const v = option?.value;
                            if (v === '24h' || v === '7d' || v === '30d' || v === 'custom') setDateRange(v);
                        }}
                        options={[
                            { value: '24h', label: 'Últimas 24 horas' },
                            { value: '7d', label: 'Últimos 7 días' },
                            { value: '30d', label: 'Últimos 30 días' },
                            { value: 'custom', label: 'Rango personalizado' }
                        ]}
                        isSearchable={false}
                        placeholder="Filtrar por fecha"
                    />

                    <div className="search-box">
                        <input
                            type="text"
                            placeholder="Buscar por #, mesa, mesero..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Custom Date Inputs */}
            {dateRange === 'custom' && (
                <div className="custom-date-row">
                    <div className="custom-date-inputs">
                        <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            placeholder="Desde"
                        />
                        <span>-</span>
                        <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            placeholder="Hasta"
                        />
                    </div>
                </div>
            )}

            {/* Grid */}
            <div className={`orders-grid ${filteredOrders.length === 0 ? 'empty' : ''}`}>
                {filteredOrders.length > 0 ? (
                    filteredOrders.map(order => (
                        <div
                            key={order.id}
                            className={`modern-order-card ${getStatusClass(order.status)}`}
                            role="button"
                            tabIndex={0}
                            aria-label={`Ver detalle de la orden ${order.id}`}
                            onClick={() => handleViewDetails(order)}
                            onKeyDown={(event) => activateOnKeyboard(event, () => handleViewDetails(order))}
                        >
                            <div className="card-header">
                                <div className="order-meta">
                                    <span className="order-hashtag">#{order.id}</span>
                                    <span className={`status-badge ${getStatusColor(order.status)}`}>
                                        {getStatusText(order.status)}
                                    </span>
                                    <span className={`status-badge ${order.financialStatus === 'PAID' ? 'status-badge-paid' : ''}`}>
                                        {order.financialStatus === 'PAID' ? 'Pagada' : order.financialStatus === 'PARTIAL' ? 'Pago parcial' : 'Pendiente de pago'}
                                    </span>
                                </div>
                                <div className="order-time">
                                    <Clock size={14} />
                                    {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>

                            <div className="card-body">
                                <div className="info-row">
                                    {order.table ? (
                                        <div className="info-pill table-pill">
                                            <span>Mesa {order.table.number}</span>
                                        </div>
                                    ) : (
                                        <div className="info-pill takeout-pill">
                                            <span>Para Llevar</span>
                                        </div>
                                    )}
                                    <div className="info-pill waiter-pill">
                                        <User size={12} />
                                        <span>{order.user?.name || 'N/A'}</span>
                                    </div>
                                </div>

                                {order.customerName && (
                                    <p className="customer-name">{order.customerName}</p>
                                )}

                                <div className="card-total">
                                    <span className="label">Total</span>
                                    <span className="amount">{formatMoney(Number(order.total))}</span>
                                </div>
                            </div>

                            <div className="card-footer-preview">
                                <span>{order.items?.length || 0} items</span>
                            </div>
                        </div>
                    ))
                ) : (
                    <NoResultsEmptyState />
                )}
            </div>

            {/* Sidebar Details */}
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={`Orden #${selectedOrder?.id}`}
                width="normal"
            >
                {selectedOrder && (
                    <div className="order-detail-content">
                        {/* Tabs */}
                        <div className="modal-tabs" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeTab === 'info'}
                                className={`modal-tab ${activeTab === 'info' ? 'active' : ''}`}
                                onClick={() => setActiveTab('info')}
                            >
                                <Info size={18} />
                                <span>Información</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeTab === 'items'}
                                className={`modal-tab ${activeTab === 'items' ? 'active' : ''}`}
                                onClick={() => setActiveTab('items')}
                            >
                                <Package size={18} />
                                <span>Productos <span className="tab-badge">{selectedOrder.items?.length || 0}</span></span>
                            </button>
                        </div>

                        <div className="tab-content-scroll">
                            {activeTab === 'info' ? (
                                <div className="tab-pane animate-fade-in">
                                    {/* Info Grid */}
                                    <div className="detail-info-grid">
                                        <div className={`detail-info-item status-info-item ${getStatusColor(selectedOrder.status)}`}>
                                            <span className="detail-label">Estado</span>
                                            <span className="detail-value">{getStatusText(selectedOrder.status)}</span>
                                        </div>
                                        <div className="detail-info-item">
                                            <span className="detail-label">Estado financiero</span>
                                            <span className="detail-value">
                                                {selectedOrder.financialStatus === 'PAID' ? 'Pagada' : selectedOrder.financialStatus === 'PARTIAL' ? 'Pago parcial' : 'Pendiente de pago'}
                                            </span>
                                        </div>
                                        <div className="detail-info-item">
                                            <span className="detail-label">Fecha y Hora</span>
                                            <span className="detail-value">
                                                {new Date(selectedOrder.createdAt).toLocaleString('es-ES', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                        <div className="detail-info-item">
                                            <span className="detail-label">Mesa</span>
                                            <span className="detail-value">{selectedOrder.table ? `Mesa ${selectedOrder.table.number}` : 'Para Llevar'}</span>
                                        </div>
                                        <div className="detail-info-item">
                                            <span className="detail-label">Mesero</span>
                                            <span className="detail-value" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {selectedOrder.user?.color && (
                                                    <span style={{
                                                        width: '10px', height: '10px', borderRadius: '50%',
                                                        backgroundColor: selectedOrder.user.color, flexShrink: 0,
                                                        border: '1px solid var(--color-neutral-300)'
                                                    }} />
                                                )}
                                                {selectedOrder.user?.name || 'Sin asignar'}
                                            </span>
                                        </div>
                                        {selectedOrder.customerName && (
                                            <div className="detail-info-item customer-item">
                                                <span className="detail-label">Cliente</span>
                                                <span className="detail-value">{selectedOrder.customerName}</span>
                                            </div>
                                        )}
                                        {selectedOrder.invoiceNumber && (
                                            <div className="detail-info-item">
                                                <span className="detail-label">Estado fiscal</span>
                                                <span className="detail-value">
                                                    {selectedOrder.invoiceFiscalStatus === 'CREDITED'
                                                        ? `Acreditada · ${selectedOrder.fiscalCreditNote?.number || ''}`
                                                        : selectedOrder.invoiceFiscalStatus === 'CANCELLED'
                                                            ? 'Anulada'
                                                            : 'Emitida'}
                                                </span>
                                            </div>
                                        )}
                                        {selectedOrder.status === 'CANCELLED' && (
                                            <div style={{ marginTop: '8px', padding: '10px', background: 'var(--color-error, #ef4444)10', border: '1px solid var(--color-error, #ef4444)30', borderRadius: '8px' }}>
                                                {selectedOrder.cancelledBy && (
                                                    <div className="detail-info-item">
                                                        <span className="detail-label" style={{ color: 'var(--color-error)' }}>Cancelada por</span>
                                                        <span className="detail-value">{selectedOrder.cancelledBy.name}</span>
                                                    </div>
                                                )}
                                                {selectedOrder.cancelReason && (
                                                    <div className="detail-info-item">
                                                        <span className="detail-label" style={{ color: 'var(--color-error)' }}>Motivo</span>
                                                        <span className="detail-value">{selectedOrder.cancelReason}</span>
                                                    </div>
                                                )}
                                                {selectedOrder.cancelledAt && (
                                                    <div className="detail-info-item">
                                                        <span className="detail-label" style={{ color: 'var(--color-error)' }}>Fecha cancelación</span>
                                                        <span className="detail-value">{new Date(selectedOrder.cancelledAt).toLocaleString('es-ES')}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Financials Section */}
                                    <div className="financials-section">
                                        <div className="fin-row">
                                            <span>Subtotal</span>
                                            <span>{formatMoney(Number(selectedOrder.total))}</span>
                                        </div>
                                        <div className="fin-row total">
                                            <span>Total a Pagar</span>
                                            <span>{formatMoney(Number(selectedOrder.total))}</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="tab-pane animate-fade-in">
                                    {/* Items */}
                                    <div className="detail-items">
                                        {selectedOrder.items?.map((item) => (
                                            <div key={item.id || item.menuItemId} className="detail-item-row">
                                                <span className="item-qty">{item.quantity}x</span>
                                                <div className="item-info">
                                                    <div className="item-name">{item.menuItem?.name || 'Item eliminado'}</div>
                                                    {item.notes && <div className="item-notes">{item.notes}</div>}
                                                </div>
                                                <span className="item-price">{formatMoney(Number(item.subtotal))}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="action-bar-sticky">
                            {getActionButtons(selectedOrder)}
                        </div>
                    </div>
                )}
            </Sidebar >

            {/* Payment Modal */}
            {
                showPaymentModal && paymentOrder && (
                    <PaymentModal
                        isOpen={showPaymentModal}
                        onClose={() => setShowPaymentModal(false)}
                        orderId={paymentOrder.id}
                        orderTotal={Number(paymentOrder.total)}
                        order={paymentOrder}
                        onPaymentSuccess={handlePaymentComplete}
                        currencySymbol={currencySymbol}
                        hasUsableCashShift={hasUsableCashShift(activeShiftStatus, paymentOrder.branchId)}
                    />
                )
            }

            <Modal
                isOpen={showDeliveryModal}
                onClose={() => { setShowDeliveryModal(false); setDeliveryOrder(null); setDeliveryWarehouseId(null); }}
                title={`Entregar Orden #${deliveryOrder?.id ?? ''}`}
                size="sm"
            >
                <p>Selecciona la bodega de la sucursal de la que se descontará el inventario.</p>
                <Select
                    variant="modal"
                    isLoading={loadingWarehouses}
                    options={deliveryWarehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))}
                    value={deliveryWarehouses
                        .map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))
                        .find((option) => option.value === deliveryWarehouseId) ?? null}
                    onChange={(option: SingleValue<{ value: number; label: string }>) => setDeliveryWarehouseId(option?.value ?? null)}
                    placeholder={deliveryWarehouses.length === 0 ? 'No hay bodegas de sucursal disponibles' : 'Seleccionar bodega...'}
                    noOptionsMessage={() => 'No hay bodegas de sucursal disponibles'}
                />
                <div className="problem-modal-actions">
                    <button type="button" className="btn-cancel-problem" onClick={() => setShowDeliveryModal(false)}>
                        Volver
                    </button>
                    <button
                        type="button"
                        className="btn-submit-problem"
                        onClick={() => void handleCompleteDelivery()}
                        disabled={!deliveryWarehouseId || loadingWarehouses}
                    >
                        Confirmar Entrega
                    </button>
                </div>
            </Modal>

            <Modal
                isOpen={showCancelModal}
                onClose={() => { setShowCancelModal(false); setCancelOrder(null); setCancelReason(''); setCancelWarehouseId(null); }}
                title={`Cancelar Orden #${cancelOrder?.id ?? ''}`}
                size="sm"
            >
                <p style={{ fontSize: '0.9rem', color: 'var(--color-neutral-500)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <XCircle size={20} color="var(--color-error)" aria-hidden="true" />
                    Esta acción quedará registrada en el historial de auditoría.
                </p>
                <textarea
                    className="problem-textarea"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Motivo de cancelación (requerido)..."
                    autoFocus
                    style={{ minHeight: '80px' }}
                />
                {cancelOrder?.status !== 'OPEN' && (
                    <Select
                        variant="modal"
                        isLoading={loadingWarehouses}
                        options={cancelWarehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))}
                        value={cancelWarehouses
                            .map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))
                            .find((option) => option.value === cancelWarehouseId) ?? null}
                        onChange={(option: SingleValue<{ value: number; label: string }>) => setCancelWarehouseId(option?.value ?? null)}
                        placeholder={cancelWarehouses.length === 0 ? 'No hay bodegas de sucursal disponibles' : 'Bodega para registrar la merma...'}
                        noOptionsMessage={() => 'No hay bodegas de sucursal disponibles'}
                    />
                )}
                <div className="problem-modal-actions">
                    <button type="button" className="btn-cancel-problem" onClick={() => { setShowCancelModal(false); setCancelReason(''); }}>
                        Volver
                    </button>
                    <button
                        type="button"
                        className="btn-submit-problem"
                        onClick={handleCancelOrder}
                        disabled={!cancelReason.trim() || (cancelOrder?.status !== 'OPEN' && !cancelWarehouseId)}
                        style={{ background: 'var(--color-error)' }}
                    >
                        Confirmar Cancelación
                    </button>
                </div>
            </Modal>
        </div >
    );
}
