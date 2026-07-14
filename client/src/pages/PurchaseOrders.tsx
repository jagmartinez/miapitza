import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { purchaseOrdersAPI, autoPurchaseOrdersAPI, branchesAPI, suppliersAPI } from '../services/api';
import api from '../services/api';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import Sidebar from '../components/Sidebar';
import Select from '../components/Select';
import Input from '../components/Input';
import PurchaseOrderForm from './PurchaseOrderForm';
import PurchaseOrderImport from '../components/PurchaseOrderImport';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import { Plus, Eye, Zap, X, ShoppingCart, FileDown, FileText, CreditCard, DollarSign, Info, Save, AlertTriangle, History, Undo2 } from 'lucide-react';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import { BANK_OPTIONS, type StrOption } from '../constants/purchaseOrderOptions';
import type { SingleValue } from 'react-select';
import type { AutoPurchaseSuggestion, Branch, PurchaseOrder, PurchaseOrderPayment, Supplier } from '../types';
import './Inventory.css';
import './PurchaseOrders.css';

type PoSuggestionRow = AutoPurchaseSuggestion & { unit?: string };

interface PoSuggestionsData {
    summary: {
        urgentProducts: number;
        totalProducts?: number;
        totalEstimatedCost?: number | string;
    };
    suggestions: PoSuggestionRow[];
}

function errMsg(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return fallback;
}

export default function PurchaseOrders() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning, success: showSuccess } = useAppToast();
    const userRoleNames = getUserRoleNames(user);
    const canManagePurchaseOrders = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'BODEGA'].includes(role));
    const canDeletePurchaseOrders = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const navigate = useNavigate();
    const [orders, setOrders] = useState<PurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [showSuggestionsSidebar, setShowSuggestionsSidebar] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingOrderId, setEditingOrderId] = useState<number | undefined>(undefined);
    const [suggestions, setSuggestions] = useState<PoSuggestionsData | null>(null);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [isImportSidebarOpen, setIsImportSidebarOpen] = useState(false);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [paymentModalOrder, setPaymentModalOrder] = useState<PurchaseOrder | null>(null);
    const [paymentForm, setPaymentForm] = useState({ amount: '', date: formatLocalDateInput(), bank: '', referenceNumber: '', observations: '' });
    const [paymentHistory, setPaymentHistory] = useState<PurchaseOrderPayment[]>([]);
    const [loadingPaymentHistory, setLoadingPaymentHistory] = useState(false);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [selectedSuggestionKeys, setSelectedSuggestionKeys] = useState<Record<string, boolean>>({});
    const [autoPurchaseForm, setAutoPurchaseForm] = useState({ branchId: '', supplierId: '' });
    const [creatingAutoPurchaseOrder, setCreatingAutoPurchaseOrder] = useState(false);
    const [suggestionSearch, setSuggestionSearch] = useState('');
    const [savingPayment, setSavingPayment] = useState(false);
    const [paymentTab, setPaymentTab] = useState<'register' | 'history'>('register');
    const [reversalPaymentId, setReversalPaymentId] = useState<number | null>(null);
    const [reversalReason, setReversalReason] = useState('');
    const [reversingPayment, setReversingPayment] = useState(false);
    // Pagination and Filters state
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Default to last month
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return formatLocalDateInput(d);
    });
    const [endDate, setEndDate] = useState(() => formatLocalDateInput());

    useEffect(() => {
        loadOrders();
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const response = await api.get('/settings');
            setSettings(response.data.data || {});
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    };

    const loadOrders = async () => {
        try {
            const res = await purchaseOrdersAPI.getAll();
            setOrders(Array.isArray(res.data.data) ? res.data.data : []);
        } catch (error) {
            console.error('Error loading purchase orders:', error);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    };

    const loadAutoSuggestions = async () => {
        if (!canManagePurchaseOrders) {
            showWarning('No tienes permisos para generar órdenes automáticamente');
            return;
        }
        setLoadingSuggestions(true);
        try {
            const [suggestionsRes, branchesRes, suppliersRes] = await Promise.all([
                api.get('/advanced/auto-po/suggestions'),
                branchesAPI.getAll(),
                suppliersAPI.getAll(),
            ]);
            setSuggestions(suggestionsRes.data.data);
            setBranches(branchesRes.data.data || []);
            setSuppliers(suppliersRes.data.data || []);
            setSelectedSuggestionKeys({});
            setSuggestionSearch('');
            setShowSuggestionsSidebar(true);
        } catch (error: unknown) {
            showError('Error al cargar sugerencias: ' + errMsg(error, 'Error'));
        } finally {
            setLoadingSuggestions(false);
        }
    };

    const getSuggestionKey = (suggestion: PoSuggestionRow) => `${suggestion.productId}-${suggestion.warehouseId}`;

    const suggestionRows = useMemo(() => suggestions?.suggestions ?? [], [suggestions]);

    const selectedSuggestions = useMemo(
        () => suggestionRows.filter((suggestion) => selectedSuggestionKeys[getSuggestionKey(suggestion)]),
        [suggestionRows, selectedSuggestionKeys]
    );

    const filteredSuggestionRows = useMemo(() => {
        const query = suggestionSearch.trim().toLowerCase();
        if (!query) return suggestionRows;
        return suggestionRows.filter((item) =>
            item.productName?.toLowerCase().includes(query) ||
            item.warehouseName?.toLowerCase().includes(query)
        );
    }, [suggestionRows, suggestionSearch]);

    const handleToggleSuggestion = (suggestion: PoSuggestionRow) => {
        const key = getSuggestionKey(suggestion);
        setSelectedSuggestionKeys((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSelectUrgentSuggestions = () => {
        setSelectedSuggestionKeys((prev) => {
            const next = { ...prev };
            suggestionRows
                .filter((suggestion) => suggestion.priority === 'URGENT')
                .forEach((suggestion) => { next[getSuggestionKey(suggestion)] = true; });
            return next;
        });
    };

    const handleCreateAutoPurchaseOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canManagePurchaseOrders) return;
        if (selectedSuggestions.length === 0) {
            showWarning('Selecciona al menos una sugerencia para crear la orden.');
            return;
        }
        if (!autoPurchaseForm.branchId || !autoPurchaseForm.supplierId) {
            showWarning('Selecciona sucursal y proveedor para generar el borrador.');
            return;
        }
        try {
            setCreatingAutoPurchaseOrder(true);
            const response = await autoPurchaseOrdersAPI.createFromSuggestions({
                branchId: Number(autoPurchaseForm.branchId),
                supplierId: Number(autoPurchaseForm.supplierId),
                items: selectedSuggestions.map((suggestion) => ({
                    productId: suggestion.productId,
                    quantity: Number(suggestion.suggestedQuantity),
                    cost: suggestion.suggestedQuantity > 0
                        ? Number(((Number(suggestion.estimatedCost) || 0) / suggestion.suggestedQuantity).toFixed(2))
                        : 0,
                })),
            });
            showSuccess('Borrador de orden de compra creado correctamente.');
            setShowSuggestionsSidebar(false);
            setSelectedSuggestionKeys({});
            setAutoPurchaseForm({ branchId: '', supplierId: '' });
            await loadOrders();
            navigate(`/purchase-orders/${response.data.data.id}`);
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo crear el borrador de compra.'));
        } finally {
            setCreatingAutoPurchaseOrder(false);
        }
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            DRAFT: 'status-borrador',
            ISSUED: 'status-emitida',
            RECEIVED: 'status-recibida',
            CANCELLED: 'status-cancelada'
        };
        const labels: Record<string, string> = {
            DRAFT: 'Borrador',
            ISSUED: 'Emitida',
            RECEIVED: 'Recibida',
            CANCELLED: 'Cancelada'
        };
        return (
            <span className={`modern-status-badge ${styles[status] || ''}`}>
                {labels[status] ?? status}
            </span>
        );
    };

    const filteredOrders = orders.filter(order => {
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

        const searchLower = searchQuery.toLowerCase();
        const matchesSearch =
            String(order.id).includes(searchLower) ||
            order.supplier?.name.toLowerCase().includes(searchLower) ||
            (order.invoiceNumber && order.invoiceNumber.toLowerCase().includes(searchLower));

        // Date range filter (compare local YYYY-MM-DD strings to avoid timezone issues)
        let matchesDate = true;
        if (startDate || endDate) {
            const od = new Date(order.date);
            const orderDateStr = od.getFullYear() + '-' +
                String(od.getMonth() + 1).padStart(2, '0') + '-' +
                String(od.getDate()).padStart(2, '0');

            if (startDate && orderDateStr < startDate) matchesDate = false;
            if (endDate && orderDateStr > endDate) matchesDate = false;
        }

        return matchesStatus && matchesSearch && matchesDate;
    });

    // Pagination logic
    const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
    const paginatedOrders = filteredOrders.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, searchQuery, startDate, endDate]);

    const handleOpenForm = (id?: number) => {
        if (!canManagePurchaseOrders) {
            showWarning('No tienes permisos para gestionar órdenes de compra');
            return;
        }
        setEditingOrderId(id);
        setIsSidebarOpen(true);
    };

    const handleFormClose = () => {
        setIsSidebarOpen(false);
        setEditingOrderId(undefined);
    };

    const handleFormSaved = () => {
        loadOrders();
        handleFormClose();
    };

    const handleDeleteOrder = async (id: number) => {
        if (!canDeletePurchaseOrders) {
            showWarning('No tienes permisos para eliminar órdenes');
            return;
        }
        const order = orders.find(o => o.id === id);
        if (order?.status !== 'DRAFT') {
            showWarning('Solo se pueden eliminar órdenes en borrador.');
            return;
        }

        if (!(await confirm('¿Está seguro de que desea eliminar esta orden de compra?', { title: 'Confirmar acción' }))) return;

        try {
            await purchaseOrdersAPI.delete(id);
            loadOrders();
        } catch (error: unknown) {
            showError('Error al eliminar orden: ' + errMsg(error, 'Error'));
        }
    };

    const handleOpenPayment = async (order: PurchaseOrder) => {
        setPaymentModalOrder(order);
        setPaymentTab('register');
        setReversalPaymentId(null);
        setReversalReason('');
        const balance = Number(order.total) - Number(order.paidAmount || 0);
        setPaymentForm({
            amount: balance > 0 ? balance.toFixed(2) : '',
            date: formatLocalDateInput(),
            bank: '',
            referenceNumber: '',
            observations: '',
        });
        setLoadingPaymentHistory(true);
        try {
            const res = await purchaseOrdersAPI.getPayments(order.id);
            setPaymentHistory(Array.isArray(res.data.data) ? res.data.data : []);
        } catch {
            setPaymentHistory(order.payments || []);
            showWarning('No se pudo actualizar el historial de pagos; se muestra la última información disponible.');
        } finally {
            setLoadingPaymentHistory(false);
        }
    };

    const handleReverseReceipt = async (order: PurchaseOrder) => {
        if (!canDeletePurchaseOrders || order.status !== 'RECEIVED') return;
        const reason = window.prompt('Motivo obligatorio del reverso de recepción:')?.trim();
        if (!reason) return;
        const accepted = await confirm(
            `¿Revertir la recepción de la orden #${order.id}? La operación fallará si el inventario recibido ya fue consumido.`,
            { title: 'Confirmar reverso de recepción' }
        );
        if (!accepted) return;
        try {
            await purchaseOrdersAPI.reverseReceipt(order.id, reason);
            showSuccess('Recepción revertida correctamente');
            loadOrders();
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo revertir la recepción'));
        }
    };

    const handleDownloadInvoice = async (order: PurchaseOrder) => {
        try {
            const response = await purchaseOrdersAPI.getInvoice(order.id);
            const url = window.URL.createObjectURL(response.data as Blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = order.invoiceNumber ? `Factura-${order.invoiceNumber}` : `Factura-OC-${order.id}`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo descargar la factura adjunta'));
        }
    };

    const handleSubmitPayment = async () => {
        if (!paymentModalOrder) return;
        const amount = parseFloat(paymentForm.amount);
        if (!amount || amount <= 0) { showError('El monto debe ser mayor a 0'); return; }
        setSavingPayment(true);
        try {
            await purchaseOrdersAPI.addPayment(paymentModalOrder.id, {
                amount,
                date: paymentForm.date,
                bank: paymentForm.bank || undefined,
                referenceNumber: paymentForm.referenceNumber || undefined,
                observations: paymentForm.observations || undefined
            });
            showSuccess('Pago registrado correctamente.');
            const [paymentsRes, orderRes] = await Promise.all([
                purchaseOrdersAPI.getPayments(paymentModalOrder.id),
                purchaseOrdersAPI.getById(paymentModalOrder.id),
            ]);
            const updatedOrder = orderRes.data.data as PurchaseOrder;
            setPaymentModalOrder(updatedOrder);
            setPaymentHistory(Array.isArray(paymentsRes.data.data) ? paymentsRes.data.data : []);
            const balance = Number(updatedOrder.total) - Number(updatedOrder.paidAmount || 0);
            setPaymentForm((prev) => ({
                ...prev,
                amount: balance > 0 ? balance.toFixed(2) : '',
                bank: '',
                referenceNumber: '',
                observations: '',
            }));
            loadOrders();
        } catch (error: unknown) {
            showError(errMsg(error, 'Error al registrar pago'));
        } finally {
            setSavingPayment(false);
        }
    };

    const handleReversePayment = async (payment: PurchaseOrderPayment) => {
        if (!paymentModalOrder || !canDeletePurchaseOrders || payment.status === 'REVERSED') return;
        const reason = reversalReason.trim();
        if (!reason) {
            showWarning('Indica el motivo del reverso');
            return;
        }
        const accepted = await confirm(
            `¿Revertir el abono de ${formatCurrency(Number(payment.amount), settings)}?`,
            { title: 'Confirmar reverso de pago' }
        );
        if (!accepted) return;

        setReversingPayment(true);
        try {
            await purchaseOrdersAPI.reversePayment(paymentModalOrder.id, payment.id, reason);
            const [paymentsRes, orderRes] = await Promise.all([
                purchaseOrdersAPI.getPayments(paymentModalOrder.id),
                purchaseOrdersAPI.getById(paymentModalOrder.id),
            ]);
            setPaymentModalOrder(orderRes.data.data as PurchaseOrder);
            setPaymentHistory(Array.isArray(paymentsRes.data.data) ? paymentsRes.data.data : []);
            setReversalPaymentId(null);
            setReversalReason('');
            showSuccess('Pago revertido correctamente');
            loadOrders();
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo revertir el pago'));
        } finally {
            setReversingPayment(false);
        }
    };

    const getDaysRemaining = (dueDate?: string) => {
        if (!dueDate) return null;
        const due = new Date(dueDate);
        const today = new Date();
        const diff = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diff;
    };

    const draftCount = orders.filter(o => o.status === 'DRAFT').length;
    const issuedCount = orders.filter(o => o.status === 'ISSUED').length;
    const receivedCount = orders.filter(o => o.status === 'RECEIVED').length;
    const pendingPaymentOrders = orders.filter(o =>
        o.status === 'RECEIVED' && o.invoiceType === 'CREDIT' && o.paymentStatus !== 'PAID'
    );
    const overduePayments = pendingPaymentOrders.filter(o => {
        const days = getDaysRemaining(o.paymentDueDate);
        return days !== null && days < 0;
    });

    if (loading) return <div className="inventory-loading">Cargando órdenes de compra...</div>;

    return (
        <div className="inventory-page purchase-orders-page">
            <div className="inventory-header-new">
                <div className="header-title-section">
                    <h1><ShoppingCart size={32} /> Órdenes de Compra</h1>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={loadAutoSuggestions} disabled={loadingSuggestions || !canManagePurchaseOrders}>
                        <Zap size={18} />
                        {loadingSuggestions ? 'Cargando...' : 'Auto-Generar'}
                    </Button>
                    <Button variant="secondary" onClick={() => setIsImportSidebarOpen(true)} disabled={!canManagePurchaseOrders}>
                        <FileDown size={18} />
                        Carga Masiva
                    </Button>
                    <Button onClick={() => handleOpenForm()} disabled={!canManagePurchaseOrders} title="Nueva orden" aria-label="Nueva orden">
                        <Plus size={20} />
                    </Button>
                </div>
            </div>

            <div className="inventory-grid-new" style={{ marginBottom: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                <div className="inventory-card-new">
                    <div className="inventory-card-body-new">
                        <div className="product-name-new">Resumen de órdenes</div>
                        <div className="product-details-new">
                            <div className="detail-item"><span>{orders.length} órdenes totales</span></div>
                            <div className="detail-item"><span>{draftCount} borradores</span></div>
                            <div className="detail-item"><span>{issuedCount} emitidas · {receivedCount} recibidas</span></div>
                        </div>
                    </div>
                </div>
                <div className="inventory-card-new">
                    <div className="inventory-card-body-new">
                        <div className="product-name-new">Pagos pendientes</div>
                        <div className="product-details-new">
                            {pendingPaymentOrders.slice(0, 3).map(order => (
                                <button
                                    key={order.id}
                                    type="button"
                                    className="detail-item po-pending-payment-link"
                                    onClick={() => handleOpenPayment(order)}
                                >
                                    <AlertTriangle size={14} />
                                    <span>#{order.id} {order.supplier?.name}</span>
                                </button>
                            ))}
                            {pendingPaymentOrders.length === 0 && (
                                <div className="detail-item"><span>Sin pagos pendientes</span></div>
                            )}
                            {overduePayments.length > 0 && (
                                <div className="detail-item"><span>{overduePayments.length} vencidos</span></div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="inventory-card-new">
                    <div className="inventory-card-body-new">
                        <div className="product-name-new">Reposición sugerida</div>
                        <div className="product-details-new">
                            <div className="detail-item"><span>Genera órdenes desde stock bajo</span></div>
                            {canManagePurchaseOrders && (
                                <div className="detail-item" style={{ marginTop: '8px' }}>
                                    <button
                                        type="button"
                                        onClick={loadAutoSuggestions}
                                        disabled={loadingSuggestions}
                                        style={{
                                            border: 'none',
                                            background: 'transparent',
                                            color: 'var(--color-primary)',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            padding: 0
                                        }}
                                    >
                                        {loadingSuggestions ? 'Cargando sugerencias...' : 'Revisar sugerencias y crear borrador'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="inventory-filters-row">
                <div className="inventory-status-filters">
                    {['all', 'DRAFT', 'ISSUED', 'RECEIVED', 'CANCELLED'].map(status => (
                        <button
                            key={status}
                            type="button"
                            className={`inventory-status-btn ${statusFilter === status ? 'active' : ''}`}
                            onClick={() => setStatusFilter(status)}
                        >
                            {status === 'all' ? 'Todas' :
                                status === 'DRAFT' ? 'Borrador' :
                                    status === 'ISSUED' ? 'Emitida' :
                                        status === 'RECEIVED' ? 'Recibida' : 'Cancelada'}
                        </button>
                    ))}

                    <div style={{ width: '1px', height: '24px', background: 'var(--color-border)', margin: '0 8px' }} />

                    <div className="po-date-filters">
                        <div className="date-input-group">
                            <label>Desde:</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                        </div>
                        <div className="date-input-group">
                            <label>Hasta:</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        </div>
                        {(startDate || endDate) && (
                            <button type="button" className="clear-dates" onClick={() => { setStartDate(''); setEndDate(''); }}>
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="filter-right-section">
                    <input
                        type="text"
                        placeholder="Buscar por ID, proveedor o factura..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="search-input inventory-search"
                    />
                </div>
            </div>

            <div className="inventory-table-wrapper">
                <table className="inventory-table">
                        <thead>
                            <tr>
                                <th>Orden</th>
                                <th>Proveedor</th>
                                <th>Nº Factura</th>
                                <th>Fecha</th>
                                <th>Tipo</th>
                                <th className="text-right">Total</th>
                                <th>Pago</th>
                                <th>Estado</th>
                                <th className="text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedOrders.map(order => (
                                <tr key={order.id} onClick={() => canManagePurchaseOrders && handleOpenForm(order.id)} className="clickable-row">
                                    <td data-label="Orden" className="cell-name">
                                        <span className="cell-name-title order-id">
                                            <span className="hashtag">#</span>
                                            {order.id}
                                        </span>
                                    </td>
                                    <td data-label="Proveedor">
                                        <div className="supplier-cell">
                                            <span className="supplier-name">{order.supplier?.name}</span>
                                        </div>
                                    </td>
                                    <td data-label="Nº Factura">
                                        <div className="invoice-cell">
                                            {order.invoiceNumber || <span className="text-muted">-</span>}
                                        </div>
                                    </td>
                                    <td data-label="Fecha">
                                        <div className="date-cell">
                                            {new Date(order.date).toLocaleDateString('es-ES', {
                                                day: '2-digit',
                                                month: 'short',
                                                year: 'numeric'
                                            })}
                                        </div>
                                    </td>
                                    <td data-label="Tipo">
                                        <span className={`po-type-badge ${order.invoiceType === 'CREDIT' ? 'credit' : 'cash'}`}>
                                            {order.invoiceType === 'CREDIT' ? 'Crédito' : 'Contado'}
                                        </span>
                                    </td>
                                    <td data-label="Total" className="text-right">
                                        <div className="total-cell">
                                            {formatCurrency(Number(order.total) || 0, settings)}
                                        </div>
                                    </td>
                                    <td data-label="Pago" onClick={(e) => e.stopPropagation()}>
                                        {order.invoiceType === 'CREDIT' ? (
                                            <div className="payment-info-cell">
                                                <span className={`payment-status-badge ${order.paymentStatus?.toLowerCase() || 'pending'}`}>
                                                    {order.paymentStatus === 'PAID' ? 'Pagado' : order.paymentStatus === 'PARTIAL' ? 'Parcial' : 'Pendiente'}
                                                </span>
                                                {order.paymentStatus !== 'PAID' && order.paymentDueDate && (
                                                    <span className={`days-remaining ${(getDaysRemaining(order.paymentDueDate) ?? 0) < 0 ? 'overdue' : (getDaysRemaining(order.paymentDueDate) ?? 0) <= 3 ? 'urgent' : ''}`}>
                                                        {(() => {
                                                            const days = getDaysRemaining(order.paymentDueDate);
                                                            if (days === null) return '';
                                                            if (days < 0) return `Vencido ${Math.abs(days)}d`;
                                                            if (days === 0) return 'Hoy';
                                                            return `${days}d restantes`;
                                                        })()}
                                                    </span>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="payment-status-badge paid">Pagado</span>
                                        )}
                                    </td>
                                    <td data-label="Estado">{getStatusBadge(order.status)}</td>
                                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                                        <div className="table-actions">
                                            {canManagePurchaseOrders && order.invoiceType === 'CREDIT' && order.status === 'RECEIVED' && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn"
                                                    onClick={() => handleOpenPayment(order)}
                                                    title={order.paymentStatus === 'PAID' ? 'Ver historial de abonos' : 'Registrar pago / abono'}
                                                >
                                                    <DollarSign size={16} />
                                                </button>
                                            )}
                                            {canManagePurchaseOrders && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenForm(order.id);
                                                    }}
                                                    title={order.status === 'RECEIVED' ? 'Ver detalles' : 'Editar'}
                                                >
                                                    {order.status === 'RECEIVED' ? <Eye size={16} /> : <Zap size={16} />}
                                                </button>
                                            )}
                                            {order.invoicePdf && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleDownloadInvoice(order);
                                                    }}
                                                    title="Ver Factura PDF"
                                                >
                                                    <FileText size={16} />
                                                </button>
                                            )}
                                            {canDeletePurchaseOrders && order.status === 'DRAFT' && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn danger"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteOrder(order.id);
                                                    }}
                                                    title="Eliminar borrador"
                                                >
                                                    <X size={16} />
                                                </button>
                                            )}
                                            {canDeletePurchaseOrders && order.status === 'RECEIVED' && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn danger"
                                                    onClick={() => handleReverseReceipt(order)}
                                                    title="Revertir recepción"
                                                >
                                                    <Undo2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredOrders.length === 0 && (
                                <tr>
                                    <td colSpan={9}>
                                        <div className="empty-state">
                                            <ShoppingCart size={48} />
                                            <p>No se encontraron órdenes de compra</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                <Pagination
                    page={currentPage}
                    totalPages={totalPages}
                    totalItems={filteredOrders.length}
                    pageSize={itemsPerPage}
                    onPageChange={setCurrentPage}
                />
            </div>

            <Sidebar
                isOpen={showSuggestionsSidebar && !!suggestions}
                onClose={() => setShowSuggestionsSidebar(false)}
                title="Sugerencias de Órdenes de Compra"
                width="wide"
            >
                {suggestions && (
                    <div className="premium-modal-content product-modal-content">
                        <form onSubmit={handleCreateAutoPurchaseOrder} className="modal-form-new">
                            <div className="modal-tab-content">
                                <div className="import-summary-grid po-suggestions-summary">
                                    <div className="import-summary-card">
                                        <div className="import-summary-value">{suggestions.summary.totalProducts ?? suggestionRows.length}</div>
                                        <div className="import-summary-label">Productos</div>
                                    </div>
                                    <div className="import-summary-card import-summary-error">
                                        <div className="import-summary-value">{suggestions.summary.urgentProducts}</div>
                                        <div className="import-summary-label">Urgentes</div>
                                    </div>
                                    <div className="import-summary-card import-summary-new">
                                        <div className="import-summary-value">
                                            {formatCurrency(Number(suggestions.summary.totalEstimatedCost) || 0, settings)}
                                        </div>
                                        <div className="import-summary-label">Costo estimado</div>
                                    </div>
                                </div>

                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <FileText size={18} />
                                        <h3>Configurar borrador</h3>
                                    </div>
                                    <div className="modal-form-row">
                                        <Select
                                            variant="modal"
                                            label="Sucursal"
                                            options={branches.map((branch) => ({
                                                value: branch.id.toString(),
                                                label: branch.name,
                                            }))}
                                            value={autoPurchaseForm.branchId
                                                ? {
                                                    value: autoPurchaseForm.branchId,
                                                    label: branches.find((branch) => branch.id.toString() === autoPurchaseForm.branchId)?.name || 'Seleccionar sucursal',
                                                }
                                                : null}
                                            onChange={(option: SingleValue<StrOption>) => setAutoPurchaseForm((prev) => ({ ...prev, branchId: option?.value || '' }))}
                                            placeholder="Seleccionar sucursal..."
                                            isSearchable={false}
                                        />
                                        <Select
                                            variant="modal"
                                            label="Proveedor"
                                            options={suppliers.map((supplier) => ({
                                                value: supplier.id.toString(),
                                                label: supplier.name,
                                            }))}
                                            value={autoPurchaseForm.supplierId
                                                ? {
                                                    value: autoPurchaseForm.supplierId,
                                                    label: suppliers.find((supplier) => supplier.id.toString() === autoPurchaseForm.supplierId)?.name || 'Seleccionar proveedor',
                                                }
                                                : null}
                                            onChange={(option: SingleValue<StrOption>) => setAutoPurchaseForm((prev) => ({ ...prev, supplierId: option?.value || '' }))}
                                            placeholder="Seleccionar proveedor..."
                                        />
                                    </div>
                                </div>

                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <AlertTriangle size={18} />
                                        <h3>Productos sugeridos</h3>
                                    </div>

                                    <div className="po-suggestion-toolbar">
                                        <span className="po-suggestion-count">
                                            {selectedSuggestions.length} seleccionados de {suggestionRows.length} sugerencias
                                        </span>
                                        <div className="po-suggestion-toolbar-actions">
                                            <input
                                                type="text"
                                                className="search-input po-suggestion-search"
                                                placeholder="Buscar producto o almacén..."
                                                value={suggestionSearch}
                                                onChange={(e) => setSuggestionSearch(e.target.value)}
                                            />
                                            <Button type="button" variant="ghost" onClick={handleSelectUrgentSuggestions}>
                                                Seleccionar urgentes
                                            </Button>
                                            <Button type="button" variant="ghost" onClick={() => setSelectedSuggestionKeys({})}>
                                                Limpiar
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="po-suggestion-list">
                                        {filteredSuggestionRows.length === 0 ? (
                                            <div className="po-suggestion-empty">
                                                No hay sugerencias que coincidan con la búsqueda.
                                            </div>
                                        ) : (
                                            filteredSuggestionRows.map((suggestion) => {
                                                const key = getSuggestionKey(suggestion);
                                                const checked = Boolean(selectedSuggestionKeys[key]);
                                                const isUrgent = suggestion.priority === 'URGENT';
                                                const displayName = suggestion.productName?.trim() || `Producto #${suggestion.productId}`;
                                                return (
                                                    <label
                                                        key={key}
                                                        className={`po-suggestion-card${checked ? ' is-selected' : ''}${isUrgent ? ' is-urgent' : ''}`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            className="po-suggestion-checkbox"
                                                            checked={checked}
                                                            onChange={() => handleToggleSuggestion(suggestion)}
                                                        />
                                                        <div className="po-suggestion-body">
                                                            <div className="po-suggestion-header">
                                                                <span className="po-suggestion-name">{displayName}</span>
                                                                <span className={`po-priority-badge${isUrgent ? ' po-priority-badge--urgent' : ' po-priority-badge--normal'}`}>
                                                                    {isUrgent ? 'Urgente' : 'Normal'}
                                                                </span>
                                                            </div>
                                                            <div className="po-suggestion-tags">
                                                                <span className="sku-tag">{suggestion.warehouseName || 'Sin bodega'}</span>
                                                            </div>
                                                            <div className="po-suggestion-metrics">
                                                                <span><strong>Actual:</strong> {Number(suggestion.currentStock || 0).toFixed(2)} {suggestion.unit || ''}</span>
                                                                <span><strong>Mín:</strong> {Number(suggestion.minStock || 0).toFixed(2)} {suggestion.unit || ''}</span>
                                                                <span><strong>Sugerido:</strong> {Number(suggestion.suggestedQuantity).toFixed(2)} {suggestion.unit || ''}</span>
                                                            </div>
                                                        </div>
                                                        <div className="po-suggestion-cost">
                                                            <span className="po-suggestion-cost-value">
                                                                {formatCurrency(Number(suggestion.estimatedCost) || 0, settings)}
                                                            </span>
                                                            <span className="po-suggestion-cost-label">estimado</span>
                                                        </div>
                                                    </label>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <Button type="button" variant="ghost" onClick={() => setShowSuggestionsSidebar(false)}>
                                    Cerrar
                                </Button>
                                <Button type="submit" variant="primary" disabled={creatingAutoPurchaseOrder || selectedSuggestions.length === 0}>
                                    {creatingAutoPurchaseOrder ? 'Creando...' : 'Crear borrador'}
                                </Button>
                            </div>
                        </form>
                    </div>
                )}
            </Sidebar>
            {/* Purchase Order Form Sidebar */}
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={handleFormClose}
                title={editingOrderId ? `Editar Orden #${editingOrderId}` : 'Nueva Orden de Compra'}
            >
                <PurchaseOrderForm
                    sidebarId={editingOrderId}
                    onClose={handleFormClose}
                    onSaved={handleFormSaved}
                />
            </Sidebar>

            {/* Bulk Import Sidebar */}
            <Sidebar
                isOpen={isImportSidebarOpen}
                onClose={() => setIsImportSidebarOpen(false)}
                title="Carga Masiva desde Excel"
                width="wide"
            >
                <PurchaseOrderImport
                    onClose={() => setIsImportSidebarOpen(false)}
                    onSaved={() => {
                        setIsImportSidebarOpen(false);
                        loadOrders();
                    }}
                    settings={settings}
                />
            </Sidebar>

            {/* Payment Sidebar */}
            <Sidebar
                isOpen={!!paymentModalOrder}
                onClose={() => setPaymentModalOrder(null)}
                title={paymentModalOrder ? `Registrar Pago - OC #${paymentModalOrder.id}` : 'Registrar Pago'}
            >
                {paymentModalOrder && (
                    <div className="premium-modal-content po-sidebar-form payment-sidebar-form">
                        <div className="modal-tabs" role="tablist" aria-label="Secciones de pagos">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={paymentTab === 'register'}
                                className={`modal-tab ${paymentTab === 'register' ? 'active' : ''}`}
                                onClick={() => setPaymentTab('register')}
                            >
                                <CreditCard size={18} />
                                <span>Registrar abono</span>
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={paymentTab === 'history'}
                                className={`modal-tab ${paymentTab === 'history' ? 'active' : ''}`}
                                onClick={() => setPaymentTab('history')}
                            >
                                <History size={18} />
                                <span>Historial de abonos</span>
                                {paymentHistory.length > 0 && (
                                    <span className="payment-tab-count">{paymentHistory.length}</span>
                                )}
                            </button>
                        </div>

                        <div className="modal-tab-content">
                            {paymentTab === 'register' ? (
                                <>
                                    <div className="modal-section animate-slide-in">
                                        <div className="modal-section-header">
                                            <Info size={18} />
                                            <h3>Resumen de la factura</h3>
                                        </div>
                                        <div className="payment-summary">
                                            <div className="payment-summary-row">
                                                <span>Total factura</span>
                                                <strong>{formatCurrency(Number(paymentModalOrder.total), settings)}</strong>
                                            </div>
                                            <div className="payment-summary-row">
                                                <span>Abonado</span>
                                                <strong>{formatCurrency(Number(paymentModalOrder.paidAmount || 0), settings)}</strong>
                                            </div>
                                            <div className="payment-summary-row highlight">
                                                <span>Saldo pendiente</span>
                                                <strong>{formatCurrency(Number(paymentModalOrder.total) - Number(paymentModalOrder.paidAmount || 0), settings)}</strong>
                                            </div>
                                            {paymentModalOrder.paymentDueDate && (
                                                <div className="payment-summary-row">
                                                    <span>Fecha vencimiento</span>
                                                    <strong>{new Date(paymentModalOrder.paymentDueDate).toLocaleDateString('es-ES')}</strong>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {Number(paymentModalOrder.total) - Number(paymentModalOrder.paidAmount || 0) > 0 ? (
                                        <div className="modal-section animate-slide-in">
                                            <div className="modal-section-header">
                                                <DollarSign size={18} />
                                                <h3>Datos del pago</h3>
                                            </div>
                                            <div className="form-grid-modern">
                                                <div className="modal-input-group">
                                                    <label className="modal-input-label" htmlFor="payment-amount">Monto del pago *</label>
                                                    <Input
                                                        id="payment-amount"
                                                        type="number"
                                                        value={paymentForm.amount}
                                                        onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                                                        step="0.01"
                                                        min="0.01"
                                                        max={Number(paymentModalOrder.total) - Number(paymentModalOrder.paidAmount || 0)}
                                                        variant="modal"
                                                    />
                                                </div>
                                                <div className="modal-input-group">
                                                    <label className="modal-input-label" htmlFor="payment-date">Fecha de pago *</label>
                                                    <input
                                                        id="payment-date"
                                                        type="date"
                                                        className="modal-standard-input"
                                                        value={paymentForm.date}
                                                        onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })}
                                                    />
                                                </div>
                                                <div className="modal-form-row">
                                                    <div className="modal-input-group">
                                                        <label className="modal-input-label" htmlFor="payment-bank">Banco</label>
                                                        <Select
                                                            inputId="payment-bank"
                                                            options={BANK_OPTIONS}
                                                            value={BANK_OPTIONS.find(o => o.value === paymentForm.bank) ?? null}
                                                            onChange={(option: SingleValue<StrOption>) =>
                                                                setPaymentForm({ ...paymentForm, bank: option?.value ?? '' })
                                                            }
                                                            isClearable
                                                            placeholder="Seleccionar banco..."
                                                            variant="modal"
                                                        />
                                                    </div>
                                                    <div className="modal-input-group">
                                                        <label className="modal-input-label" htmlFor="payment-reference">Nº Transferencia</label>
                                                        <Input
                                                            id="payment-reference"
                                                            value={paymentForm.referenceNumber}
                                                            onChange={e => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })}
                                                            placeholder="Nº transferencia o comprobante"
                                                            variant="modal"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="modal-input-group full-width">
                                                    <label className="modal-input-label" htmlFor="payment-observations">Observaciones</label>
                                                    <textarea
                                                        id="payment-observations"
                                                        className="modal-textarea"
                                                        value={paymentForm.observations}
                                                        onChange={e => setPaymentForm({ ...paymentForm, observations: e.target.value })}
                                                        placeholder="Notas adicionales..."
                                                        rows={3}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="payment-history-empty payment-history-paid">
                                            Esta orden ya está pagada en su totalidad.
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <History size={18} />
                                        <h3>Abonos registrados</h3>
                                    </div>
                                    {loadingPaymentHistory ? (
                                        <p className="payment-history-empty">Cargando abonos...</p>
                                    ) : paymentHistory.length === 0 ? (
                                        <p className="payment-history-empty">Sin abonos registrados para esta orden.</p>
                                    ) : (
                                        <div className="payment-history-list">
                                            {paymentHistory.map((payment) => (
                                                <div key={payment.id} className={`payment-history-item${payment.status === 'REVERSED' ? ' is-reversed' : ''}`}>
                                                    <div className="payment-history-main">
                                                        <strong>{formatCurrency(Number(payment.amount), settings)}</strong>
                                                        <span>
                                                            {payment.status === 'REVERSED' && <em className="payment-reversed-badge">Revertido</em>}
                                                            {new Date(payment.date).toLocaleDateString('es-ES')}
                                                        </span>
                                                    </div>
                                                    <div className="payment-history-meta">
                                                        {payment.bank && <span>{payment.bank}</span>}
                                                        {payment.referenceNumber && <span>Ref: {payment.referenceNumber}</span>}
                                                        {payment.observations && <span>{payment.observations}</span>}
                                                        {payment.status === 'REVERSED' && payment.reversalReason && (
                                                            <span>Motivo: {payment.reversalReason}</span>
                                                        )}
                                                    </div>
                                                    {canDeletePurchaseOrders && payment.status !== 'REVERSED' && reversalPaymentId !== payment.id && (
                                                        <button
                                                            type="button"
                                                            className="payment-reverse-btn"
                                                            onClick={() => {
                                                                setReversalPaymentId(payment.id);
                                                                setReversalReason('');
                                                            }}
                                                        >
                                                            <Undo2 size={13} /> Revertir abono
                                                        </button>
                                                    )}
                                                    {reversalPaymentId === payment.id && (
                                                        <div className="payment-reversal-form">
                                                            <textarea
                                                                className="modal-textarea"
                                                                rows={2}
                                                                value={reversalReason}
                                                                onChange={(event) => setReversalReason(event.target.value)}
                                                                placeholder="Motivo obligatorio del reverso"
                                                                disabled={reversingPayment}
                                                            />
                                                            <div className="payment-reversal-actions">
                                                                <Button type="button" variant="ghost" onClick={() => setReversalPaymentId(null)} disabled={reversingPayment}>
                                                                    Cancelar
                                                                </Button>
                                                                <Button type="button" variant="danger" onClick={() => handleReversePayment(payment)} disabled={reversingPayment || !reversalReason.trim()}>
                                                                    {reversingPayment ? 'Revirtiendo...' : 'Confirmar reverso'}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <div className="action-buttons">
                                <Button variant="secondary" type="button" onClick={() => setPaymentModalOrder(null)}>
                                    Cancelar
                                </Button>
                                {paymentTab === 'register' && (
                                    <Button
                                        type="button"
                                        className="save-btn-premium"
                                        disabled={savingPayment || Number(paymentModalOrder.total) - Number(paymentModalOrder.paidAmount || 0) <= 0}
                                        onClick={handleSubmitPayment}
                                    >
                                        <Save size={20} />
                                        <span>{savingPayment ? 'Registrando...' : 'Registrar Pago'}</span>
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Sidebar>
        </div>
    );
}
