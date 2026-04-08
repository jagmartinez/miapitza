import { useState, useEffect, useCallback } from 'react';
import { ordersAPI, settingsAPI } from '../services/api';
import { useDebounce } from '../utils/useDebounce';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PaymentModal from '../components/PaymentModal';
import Select from '../components/Select';
import { escapeHtml } from '../utils/escapeHtml';
import {
    Send, CheckCircle, XCircle, CreditCard,
    Search, Clock, User, Printer, Package, Info, ClipboardList
} from 'lucide-react';
import type { Order } from '../types';
import type { CurrencySettings } from '../utils/currency';
import type { SingleValue } from 'react-select';
import { getOrderStatusClassName, getOrderStatusLabel } from '../utils/orderStatus';
import './Orders.css';

type CompanyDisplaySettings = CurrencySettings & {
    logoUrl?: string;
    companyName?: string;
    nif?: string;
    address?: string;
    phone?: string;
};

export default function Orders() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [activeTab, setActiveTab] = useState<'info' | 'items'>('info');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearch = useDebounce(searchQuery, 300);

    // Date Range Filter State
    const [dateRange, setDateRange] = useState<'24h' | '7d' | '30d' | 'custom'>('24h');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    // Payment Modal State
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
    const [settings, setSettings] = useState<CompanyDisplaySettings>({});

    // Cancel modal state
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelOrderId, setCancelOrderId] = useState<number | null>(null);
    const [cancelReason, setCancelReason] = useState('');

    const loadSettings = useCallback(async () => {
        try {
            const res = await settingsAPI.getAll();
            setSettings(res.data.data);
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }, []);

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

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    const handleViewDetails = (order: Order) => {
        setSelectedOrder(order);
        setActiveTab('info');
        setIsSidebarOpen(true);
    };

    const handleUpdateStatus = async (orderId: number, newStatus: string) => {
        try {
            await ordersAPI.updateStatus(orderId, newStatus);
            loadOrders();
            setIsSidebarOpen(false);
        } catch (error) {
            console.error('Error updating order status:', error);
            alert('Error al actualizar el estado de la orden');
        }
    };

    const handlePaymentClick = (order: Order) => {
        setPaymentOrder(order);
        setShowPaymentModal(true);
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

    const openCancelModal = (orderId: number) => {
        setCancelOrderId(orderId);
        setCancelReason('');
        setShowCancelModal(true);
    };

    const handleCancelOrder = async () => {
        if (!cancelOrderId) return;
        try {
            await ordersAPI.cancel(cancelOrderId, cancelReason);
            loadOrders();
            setIsSidebarOpen(false);
            setShowCancelModal(false);
            setCancelOrderId(null);
            setCancelReason('');
        } catch (error) {
            console.error('Error cancelling order:', error);
            alert('Error al cancelar la orden');
        }
    };

    const handleReprintInvoice = (order: Order) => {
        // Open print dialog with order details
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Por favor permite ventanas emergentes para imprimir');
            return;
        }

        const currencySymbol = settings.currency_symbol || '$';
        const e = escapeHtml;
        const invoiceHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Factura #${e(order.id)}</title>
                <style>
                    body {
                        font-family: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                        font-size: 13px;
                        line-height: 1.5;
                        padding: 10px;
                        max-width: 80mm;
                        color: #333;
                        background-color: #fff;
                        margin: 0 auto;
                    }
                    .center { text-align: center; }
                    .bold { font-weight: bold; }
                    .header-logo { max-width: 60%; margin: 0 auto 10px; display: block; }
                    .business-name { font-size: 18px; font-weight: 800; color: #000; margin-bottom: 5px; }
                    .separator { border-top: 1px dashed #ccc; margin: 10px 0; }
                    .line { display: flex; justify-content: space-between; margin: 4px 0; }
                    .item-line { display: flex; align-items: flex-start; margin-bottom: 6px; }
                    .item-qty { font-weight: bold; width: 30px; }
                    .item-desc { flex: 1; }
                    .item-price { text-align: right; font-weight: bold; }
                    .total { font-size: 18px; font-weight: 900; margin-top: 5px; border-top: 2px solid #000; padding-top: 10px; }
                    .footer { font-size: 11px; margin-top: 15px; color: #666; font-style: italic; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body>
                ${settings.logoUrl ? `<img src="${e(settings.logoUrl)}" class="header-logo" />` : ''}
                <div class="center business-name">${e(settings.companyName || 'Restaurante')}</div>
                ${settings.nif ? `<div class="center">RUC: ${e(settings.nif)}</div>` : ''}
                ${settings.address ? `<div class="center">${e(settings.address)}</div>` : ''}
                ${settings.phone ? `<div class="center">Tel: ${e(settings.phone)}</div>` : ''}
                <div class="separator"></div>

                <div class="line">
                    <span>FACTURA #:</span>
                    <span class="bold">${e(String(order.id).padStart(6, '0'))}</span>
                </div>
                <div class="line">
                    <span>Fecha:</span>
                    <span>${e(new Date(order.createdAt).toLocaleString())}</span>
                </div>
                <div class="line">
                    <span>Mesa / Mesero:</span>
                    <span>${order.table ? `Mesa ${e(order.table.number)}` : 'Para Llevar'} / ${e(order.user?.name || 'N/A')}</span>
                </div>
                ${order.customerName ? `<div class="line"><span>Cliente:</span><span class="bold">${e(order.customerName)}</span></div>` : ''}
                <div class="separator"></div>

                <div class="bold" style="margin-bottom: 10px;">Productos:</div>
                ${order.items?.map(item => `
                    <div class="item-line">
                        <span class="item-qty">${e(item.quantity)}x</span>
                        <div class="item-desc">
                            <span class="bold">${e(item.menuItem?.name || 'Item')}</span>
                            <div style="font-size: 10px; color: #666;">Precio: ${e(currencySymbol)}${Number(item.price || (Number(item.subtotal) / item.quantity)).toFixed(2)}</div>
                        </div>
                        <span class="item-price">${e(currencySymbol)}${Number(item.subtotal).toFixed(2)}</span>
                    </div>
                `).join('')}

                <div class="separator"></div>
                <div class="line">
                    <span>Subtotal:</span>
                    <span>${e(currencySymbol)}${Number(order.items?.reduce((sum, i) => sum + Number(i.subtotal), 0) || order.total).toFixed(2)}</span>
                </div>
                <div class="line">
                    <span>IVA:</span>
                    <span>${e(currencySymbol)}${Number(order.tax || 0).toFixed(2)}</span>
                </div>
                ${order.discount ? `
                    <div class="line" style="color: #d32f2f;">
                        <span>Descuento:</span>
                        <span>-${e(currencySymbol)}${Number(order.discount).toFixed(2)}</span>
                    </div>
                ` : ''}
                ${order.tipAmount ? `
                    <div class="line">
                        <span>Propina:</span>
                        <span>${e(currencySymbol)}${Number(order.tipAmount).toFixed(2)}</span>
                    </div>
                ` : ''}
                <div class="line total">
                    <span>TOTAL:</span>
                    <span>${e(currencySymbol)}${Number(order.total).toFixed(2)}</span>
                </div>

                <div class="footer center">
                    <p style="margin-bottom: 5px;">¡Gracias por su preferencia!</p>
                    <p>Factura reimpresa el ${new Date().toLocaleString()}</p>
                </div>
            </body>
            </html>
        `;

        printWindow.document.write(invoiceHTML);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
        }, 250);
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

        if (order.status === 'OPEN') {
            buttons.push(
                <Button key="send" variant="primary" onClick={() => handleUpdateStatus(order.id, 'SENT_TO_KITCHEN')}>
                    <Send size={16} /> Enviar a Cocina
                </Button>
            );
        }

        if (order.status === 'SENT_TO_KITCHEN' || order.status === 'IN_PREPARATION') {
            buttons.push(
                <Button key="ready" variant="primary" onClick={() => handleUpdateStatus(order.id, 'READY')}>
                    <CheckCircle size={16} /> Marcar Lista
                </Button>
            );
        }

        if (order.status === 'READY') {
            buttons.push(
                <Button key="delivered" variant="secondary" onClick={() => handleUpdateStatus(order.id, 'DELIVERED')}>
                    <Package size={16} /> Marcar Entregada
                </Button>
            );
        }

        if (order.status === 'READY') {
            buttons.push(
                <Button key="deliver" variant="primary" onClick={() => handleUpdateStatus(order.id, 'DELIVERED')}>
                    <CheckCircle size={16} /> Entregar
                </Button>
            );
        }

        if (order.status === 'DELIVERED') {
            buttons.push(
                <Button key="pay" variant="primary" onClick={() => handlePaymentClick(order)}>
                    <CreditCard size={16} /> Cobrar
                </Button>
            );
        }

        if (order.status !== 'PAID' && order.status !== 'CANCELLED') {
            buttons.push(
                <Button key="cancel" variant="ghost" className="text-danger" onClick={() => openCancelModal(order.id)}>
                    <XCircle size={16} /> Cancelar
                </Button>
            );
        }

        // Add reprint invoice button for paid orders
        if (order.status === 'PAID') {
            buttons.push(
                <Button key="reprint" variant="secondary" onClick={() => handleReprintInvoice(order)}>
                    <Printer size={16} /> Reimprimir Factura
                </Button>
            );
        }

        return buttons;
    };

    const filteredOrders = orders.filter(o => {
        const matchStatus = statusFilter === 'all' || o.status === statusFilter;
        const searchLower = debouncedSearch.toLowerCase();
        const matchSearch = !debouncedSearch || String(o.id).includes(searchLower) ||
            o.customerName?.toLowerCase().includes(searchLower) ||
            o.user?.name.toLowerCase().includes(searchLower) ||
            (o.table && String(o.table.number).includes(debouncedSearch));

        return matchStatus && matchSearch;
    });

    if (loading) return <div className="loading-state">Sincronizando Órdenes...</div>;

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
                        <div key={order.id} className={`modern-order-card ${getStatusClass(order.status)}`} onClick={() => handleViewDetails(order)}>
                            <div className="card-header">
                                <div className="order-meta">
                                    <span className="order-hashtag">#{order.id}</span>
                                    <span className={`status-badge ${getStatusColor(order.status)}`}>
                                        {getStatusText(order.status)}
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
                                    <span className="amount">{settings.currency_symbol || '$'}{Number(order.total).toFixed(2)}</span>
                                </div>
                            </div>

                            <div className="card-footer-preview">
                                <span>{order.items?.length || 0} items</span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="no-results">
                        <div className="icon-circle">
                            <Search size={32} />
                        </div>
                        <h3>No se encontraron órdenes</h3>
                        <p>Intenta ajustar los filtros de búsqueda</p>
                    </div>
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
                        <div className="modal-tabs">
                            <div
                                className={`modal-tab ${activeTab === 'info' ? 'active' : ''}`}
                                onClick={() => setActiveTab('info')}
                            >
                                <Info size={18} />
                                <span>Información</span>
                            </div>
                            <div
                                className={`modal-tab ${activeTab === 'items' ? 'active' : ''}`}
                                onClick={() => setActiveTab('items')}
                            >
                                <Package size={18} />
                                <span>Productos <span className="tab-badge">{selectedOrder.items?.length || 0}</span></span>
                            </div>
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
                                            <span>{settings.currency_symbol || '$'}{Number(selectedOrder.total).toFixed(2)}</span>
                                        </div>
                                        <div className="fin-row total">
                                            <span>Total a Pagar</span>
                                            <span>{settings.currency_symbol || '$'}{Number(selectedOrder.total).toFixed(2)}</span>
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
                                                <span className="item-price">{settings.currency_symbol || '$'}{Number(item.subtotal).toFixed(2)}</span>
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
                    />
                )
            }

            {/* Cancel Order Modal */}
            {showCancelModal && (
                <div className="modal-overlay-problem" onClick={() => setShowCancelModal(false)}>
                    <div className="problem-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
                        <h3 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <XCircle size={20} color="var(--color-error)" />
                            Cancelar Orden #{cancelOrderId}
                        </h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--color-neutral-500)', margin: '0 0 16px' }}>
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
                        <div className="problem-modal-actions">
                            <button className="btn-cancel-problem" onClick={() => { setShowCancelModal(false); setCancelReason(''); }}>
                                Volver
                            </button>
                            <button
                                className="btn-submit-problem"
                                onClick={handleCancelOrder}
                                disabled={!cancelReason.trim()}
                                style={{ background: 'var(--color-error)', opacity: cancelReason.trim() ? 1 : 0.5 }}
                            >
                                Confirmar Cancelación
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}
