import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ordersAPI, invoicesAPI, cashShiftsAPI, warehousesAPI } from '../services/api';
import { canSendOrderToKitchen, canCancelOrder, canCreatePayment, canOperateKitchenLineItems } from '../utils/authz';
import { useDebounce } from '../utils/useDebounce';
import PaymentModal from '../components/PaymentModal';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, FormSection, FullScreenModal, Input,
    PageContent, PageHeader, SegmentedControl, Tabs, Textarea,
    type Column, type Opt, type Tone,
} from '@/ui';
import {
    Send, CheckCircle, XCircle, CreditCard,
    Printer, Package,
} from 'lucide-react';
import type { Order, Warehouse } from '../types';
import { useCurrency } from '../hooks/useCurrency';
import { hasUsableCashShift } from '../utils/paymentAccess';
import { getOrderStatusLabel } from '../utils/orderStatus';
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
    const [loadError, setLoadError] = useState(false);
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
            setLoadError(false);
        } catch (error) {
            console.error('Error loading orders:', error);
            setLoadError(true);
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

    const getStatusText = (status: string) => {
        return getOrderStatusLabel(status as Order['status']);
    };

    const getStatusTone = (status: string): Tone => {
        switch (status) {
            case 'OPEN': return 'primary';
            case 'SENT_TO_KITCHEN':
            case 'IN_PREPARATION': return 'warning';
            case 'READY':
            case 'DELIVERED': return 'success';
            default: return 'neutral';
        }
    };

    const financialLabel = (order: Order) => (
        order.financialStatus === 'PAID' ? 'Pagada' : order.financialStatus === 'PARTIAL' ? 'Pago parcial' : 'Pendiente de pago'
    );
    const financialTone = (order: Order): Tone => (
        order.financialStatus === 'PAID' ? 'success' : order.financialStatus === 'PARTIAL' ? 'warning' : 'neutral'
    );

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
                <Button key="cancel" variant="danger" onClick={() => void openCancelModal(order)}>
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

    const statusOptions: { value: string; label: string }[] = [
        { value: 'all', label: 'Todas' },
        { value: 'OPEN', label: 'Abierta' },
        { value: 'SENT_TO_KITCHEN', label: 'En cocina' },
        { value: 'READY', label: 'Lista' },
        { value: 'DELIVERED', label: 'Entregada' },
        { value: 'PAID', label: 'Pagada' },
        { value: 'CANCELLED', label: 'Cancelada' },
    ];
    const dateOptions: Opt<'24h' | '7d' | '30d' | 'custom'>[] = [
        { value: '24h', label: 'Últimas 24 horas' },
        { value: '7d', label: 'Últimos 7 días' },
        { value: '30d', label: 'Últimos 30 días' },
        { value: 'custom', label: 'Rango personalizado' },
    ];
    const rangeLabel = dateOptions.find((o) => o.value === dateRange)?.label ?? '';

    const columns: Column<Order>[] = [
        { key: 'id', header: '#', width: '5rem', render: (o) => `#${o.id}` },
        { key: 'time', header: 'Hora', width: '6rem', render: (o) => new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
        { key: 'status', header: 'Estado', width: '9rem', type: 'status', render: (o) => <Badge tone={getStatusTone(o.status)} dot>{getStatusText(o.status)}</Badge> },
        { key: 'financial', header: 'Pago', width: '10rem', type: 'status', render: (o) => <Badge tone={financialTone(o)}>{financialLabel(o)}</Badge> },
        { key: 'table', header: 'Mesa', width: '8rem', render: (o) => (o.table ? `Mesa ${o.table.number}` : 'Para llevar') },
        { key: 'waiter', header: 'Mesero', width: '1fr', render: (o) => o.user?.name || 'N/D' },
        { key: 'customer', header: 'Cliente', width: '1fr', hideBelow: 'lg', render: (o) => o.customerName || '' },
        { key: 'items', header: 'Items', width: '5rem', type: 'number', decimals: 0, accessor: (o) => o.items?.length ?? 0 },
        { key: 'total', header: `Total (${currencySymbol})`, width: '8rem', type: 'money', accessor: (o) => Number(o.total) },
    ];

    return (
        <PageContent>
            <PageHeader
                title="Gestión de órdenes"
                description={`Control operativo de sala y cocina · ${rangeLabel}`}
            />

            <div className="orders-filters">
                <SegmentedControl ariaLabel="Estado de la orden" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
                <div className="orders-filters__field">
                    <AppSelect<'24h' | '7d' | '30d' | 'custom'>
                        aria-label="Filtrar por fecha"
                        options={dateOptions}
                        value={dateRange}
                        onChange={(v) => { if (v) setDateRange(v); }}
                        isClearable={false}
                        placeholder="Filtrar por fecha"
                    />
                </div>
                <div className="orders-filters__field">
                    <Input
                        aria-label="Buscar orden"
                        placeholder="Buscar por #, mesa, mesero..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                {dateRange === 'custom' && (
                    <div className="orders-filters__dates">
                        <DateInput aria-label="Desde" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} />
                        <span aria-hidden="true">-</span>
                        <DateInput aria-label="Hasta" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} />
                    </div>
                )}
            </div>

            {loadError && (
                <div className="orders-warning" role="alert">
                    <span>No se pudieron cargar las órdenes. Los datos mostrados pueden estar desactualizados.</span>
                    <Button size="sm" onClick={() => void loadOrders()}>Reintentar</Button>
                </div>
            )}

            <DataTable
                ariaLabel="Órdenes"
                columns={columns}
                rows={filteredOrders}
                rowKey={(o) => o.id}
                loading={loading}
                resetKey={`${statusFilter}|${debouncedSearch}|${dateRange}`}
                onRowClick={handleViewDetails}
                empty={<EmptyState title="Sin órdenes" description="No hay órdenes con los filtros seleccionados." />}
            />

            {/* Sidebar Details */}
            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={`Orden #${selectedOrder?.id ?? ''}`}
            >
                {selectedOrder && (
                    <div className="order-detail-content">
                        {/* Tabs */}
                        <Tabs
                            ariaLabel="Detalle de la orden"
                            active={activeTab}
                            onChange={(id) => setActiveTab(id as 'info' | 'items')}
                            tabs={[
                                { id: 'info', label: 'Información' },
                                { id: 'items', label: 'Productos', badge: selectedOrder.items?.length || 0 },
                            ]}
                        />

                        <div className="tab-content-scroll">
                            {activeTab === 'info' ? (
                                <div className="tab-pane animate-fade-in">
                                    {/* Info Grid */}
                                    <div className="detail-info-grid">
                                        <div className="detail-info-item">
                                            <span className="detail-label">Estado</span>
                                            <span className="detail-value"><Badge tone={getStatusTone(selectedOrder.status)} dot>{getStatusText(selectedOrder.status)}</Badge></span>
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
            </FullScreenModal>

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

            <FullScreenModal
                isOpen={showDeliveryModal}
                onClose={() => { setShowDeliveryModal(false); setDeliveryOrder(null); setDeliveryWarehouseId(null); }}
                title={`Entregar orden #${deliveryOrder?.id ?? ''}`}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="secondary" onClick={requestClose}>Volver</Button>
                        <Button
                            variant="primary"
                            onClick={() => void handleCompleteDelivery()}
                            disabled={!deliveryWarehouseId || loadingWarehouses}
                        >
                            Confirmar entrega
                        </Button>
                    </>
                )}
            >
                <FormSection title="Bodega de descuento" description="Selecciona la bodega de la sucursal de la que se descontará el inventario.">
                    <Field label="Bodega" htmlFor="delivery-warehouse" required>
                        <AppSelect<number>
                            inputId="delivery-warehouse"
                            options={deliveryWarehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))}
                            value={deliveryWarehouseId}
                            onChange={setDeliveryWarehouseId}
                            placeholder={loadingWarehouses ? 'Cargando bodegas...' : deliveryWarehouses.length === 0 ? 'No hay bodegas de sucursal disponibles' : 'Seleccionar bodega...'}
                            noOptionsText="No hay bodegas de sucursal disponibles"
                        />
                    </Field>
                </FormSection>
            </FullScreenModal>

            <FullScreenModal
                isOpen={showCancelModal}
                onClose={() => { setShowCancelModal(false); setCancelOrder(null); setCancelReason(''); setCancelWarehouseId(null); }}
                title={`Cancelar orden #${cancelOrder?.id ?? ''}`}
                dirty={cancelReason.trim().length > 0}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="secondary" onClick={requestClose}>Volver</Button>
                        <Button
                            variant="danger"
                            onClick={() => void handleCancelOrder()}
                            disabled={!cancelReason.trim() || (cancelOrder?.status !== 'OPEN' && !cancelWarehouseId)}
                        >
                            Confirmar cancelación
                        </Button>
                    </>
                )}
            >
                <FormSection title="Motivo" description="Esta acción quedará registrada en el historial de auditoría.">
                    <Field label="Motivo de cancelación" htmlFor="cancel-reason" required>
                        <Textarea
                            id="cancel-reason"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Motivo de cancelación (requerido)..."
                            autoFocus
                        />
                    </Field>
                    {cancelOrder?.status !== 'OPEN' && (
                        <Field label="Bodega para registrar la merma" htmlFor="cancel-warehouse" required>
                            <AppSelect<number>
                                inputId="cancel-warehouse"
                                options={cancelWarehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))}
                                value={cancelWarehouseId}
                                onChange={setCancelWarehouseId}
                                placeholder={loadingWarehouses ? 'Cargando bodegas...' : cancelWarehouses.length === 0 ? 'No hay bodegas de sucursal disponibles' : 'Bodega para registrar la merma...'}
                                noOptionsText="No hay bodegas de sucursal disponibles"
                            />
                        </Field>
                    )}
                </FormSection>
            </FullScreenModal>
        </PageContent>
    );
}
