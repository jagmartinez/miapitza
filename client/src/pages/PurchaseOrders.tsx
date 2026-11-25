import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { purchaseOrdersAPI, autoPurchaseOrdersAPI, branchesAPI, suppliersAPI } from '../services/api';
import api from '../services/api';
import {
    AppSelect, Badge, Button, Checkbox, DataTable, DateInput, Field, FormGrid, FormSection, FullScreenModal,
    IconButton, Input, NumberInput, PageContent, PageHeader, SegmentedControl, StatCard, TableToolbar, Textarea,
    formatMoney, formatNumber,
    type Column,
} from '@/ui';
import PurchaseOrderForm from './PurchaseOrderForm';
import PurchaseOrderImport from '../components/PurchaseOrderImport';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import { Plus, Eye, Zap, X, FileDown, FileText, DollarSign, Undo2, Pencil } from 'lucide-react';
import type { CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import { BANK_OPTIONS } from '../constants/purchaseOrderOptions';
import type { AutoPurchaseSuggestion, Branch, PurchaseOrder, PurchaseOrderPayment, Supplier } from '../types';
import styles from './compras.module.css';
import './purchase-legacy.css';

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

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Borrador', ISSUED: 'Emitida', RECEIVED: 'Recibida', CANCELLED: 'Cancelada' };
const STATUS_TONE = { DRAFT: 'neutral', ISSUED: 'primary', RECEIVED: 'success', CANCELLED: 'danger' } as const;
const STATUS_OPTIONS = [
    { value: 'all', label: 'Todas' },
    { value: 'DRAFT', label: 'Borrador' },
    { value: 'ISSUED', label: 'Emitida' },
    { value: 'RECEIVED', label: 'Recibida' },
    { value: 'CANCELLED', label: 'Cancelada' },
];

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
    const [ordersLoadError, setOrdersLoadError] = useState<string | null>(null);
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
            setOrdersLoadError(null);
        } catch (error) {
            console.error('Error loading purchase orders:', error);
            setOrdersLoadError('No se pudieron cargar las órdenes de compra; la lista puede estar incompleta o desactualizada.');
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
            `¿Revertir el abono de ${formatMoney(Number(payment.amount), settings.currency_symbol || 'C$')}?`,
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


    const symbol = settings.currency_symbol || 'C$';
    const money = (value: unknown) => formatMoney(value, symbol);

    const pendingPaymentOrders = orders.filter(o =>
        o.status === 'RECEIVED' && o.invoiceType === 'CREDIT' && o.paymentStatus !== 'PAID'
    );
    const overduePayments = pendingPaymentOrders.filter(o => {
        const days = getDaysRemaining(o.paymentDueDate);
        return days !== null && days < 0;
    });
    const payableBalance = pendingPaymentOrders.reduce(
        (sum, o) => sum + Math.max(0, (Number(o.total) || 0) - (Number(o.paidAmount) || 0)), 0);
    const mostOverdueOrder = [...overduePayments].sort(
        (a, b) => (getDaysRemaining(a.paymentDueDate) ?? 0) - (getDaysRemaining(b.paymentDueDate) ?? 0))[0]
        ?? pendingPaymentOrders[0];

    const issuedOrders = orders.filter(o => o.status === 'ISSUED');
    const committedAmount = issuedOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const issuedOverdue = issuedOrders.filter(o => {
        const days = getDaysRemaining(o.paymentDueDate);
        return days !== null && days < 0;
    });

    const renderPaymentCell = (order: PurchaseOrder) => {
        if (order.invoiceType !== 'CREDIT') return <Badge tone="success">Pagado</Badge>;
        const days = order.paymentStatus !== 'PAID' && order.paymentDueDate ? getDaysRemaining(order.paymentDueDate) : null;
        const tone = order.paymentStatus === 'PAID' ? 'success' : order.paymentStatus === 'PARTIAL' ? 'warning' : 'neutral';
        return (
            <span className={styles.inline}>
                <Badge tone={tone}>{order.paymentStatus === 'PAID' ? 'Pagado' : order.paymentStatus === 'PARTIAL' ? 'Parcial' : 'Pendiente'}</Badge>
                {days !== null && (
                    <span className={styles.muted}>
                        {days < 0 ? `Vencido ${Math.abs(days)}d` : days === 0 ? 'Hoy' : `${days}d restantes`}
                    </span>
                )}
            </span>
        );
    };

    const orderColumns: Column<PurchaseOrder>[] = [
        { key: 'id', header: 'Orden', width: '0.7fr', render: (o) => `#${o.id}` },
        { key: 'supplier', header: 'Proveedor', width: '1.8fr', render: (o) => o.supplier?.name ?? 'N/D' },
        { key: 'invoiceNumber', header: 'Nº Factura', width: '1fr', hideBelow: 'md', render: (o) => o.invoiceNumber || '-' },
        { key: 'date', header: 'Fecha', width: '1fr', type: 'date' },
        {
            key: 'invoiceType', header: 'Tipo', width: '0.8fr', hideBelow: 'lg',
            render: (o) => <Badge tone={o.invoiceType === 'CREDIT' ? 'warning' : 'neutral'}>{o.invoiceType === 'CREDIT' ? 'Crédito' : 'Contado'}</Badge>,
        },
        { key: 'total', header: `Total (${symbol})`, width: '1fr', type: 'money', accessor: (o) => Number(o.total) || 0 },
        { key: 'payment', header: 'Pago', width: '1.4fr', hideBelow: 'lg', render: renderPaymentCell },
        {
            key: 'status', header: 'Estado', width: '0.9fr',
            render: (o) => <Badge tone={STATUS_TONE[o.status] ?? 'neutral'} dot>{STATUS_LABEL[o.status] ?? o.status}</Badge>,
        },
        {
            key: 'actions', header: 'Acciones', width: '10rem', type: 'actions',
            render: (order) => (
                <span className={styles.rowActions}>
                    {canManagePurchaseOrders && order.invoiceType === 'CREDIT' && order.status === 'RECEIVED' && (
                        <IconButton
                            icon={DollarSign} size="sm"
                            label={order.paymentStatus === 'PAID' ? 'Ver historial de abonos' : 'Registrar pago / abono'}
                            onClick={() => handleOpenPayment(order)}
                        />
                    )}
                    {canManagePurchaseOrders && (
                        <IconButton
                            icon={order.status === 'RECEIVED' ? Eye : Pencil} size="sm"
                            label={order.status === 'RECEIVED' ? 'Ver detalles' : 'Editar'}
                            onClick={() => handleOpenForm(order.id)}
                        />
                    )}
                    {order.invoicePdf && (
                        <IconButton icon={FileText} size="sm" label="Ver Factura PDF" onClick={() => void handleDownloadInvoice(order)} />
                    )}
                    {canDeletePurchaseOrders && order.status === 'DRAFT' && (
                        <IconButton icon={X} size="sm" label="Eliminar borrador" onClick={() => void handleDeleteOrder(order.id)} />
                    )}
                    {canDeletePurchaseOrders && order.status === 'RECEIVED' && (
                        <IconButton icon={Undo2} size="sm" label="Revertir recepción" onClick={() => void handleReverseReceipt(order)} />
                    )}
                </span>
            ),
        },
    ];

    const suggestionColumns: Column<PoSuggestionRow>[] = [
        {
            key: 'select', header: '', width: '3rem',
            render: (s) => (
                <Checkbox
                    aria-label={`Seleccionar ${s.productName?.trim() || `Producto #${s.productId}`}`}
                    checked={Boolean(selectedSuggestionKeys[getSuggestionKey(s)])}
                    onChange={() => handleToggleSuggestion(s)}
                    label=""
                />
            ),
        },
        { key: 'product', header: 'Producto', width: '2fr', render: (s) => s.productName?.trim() || `Producto #${s.productId}` },
        { key: 'warehouse', header: 'Bodega', width: '1.2fr', hideBelow: 'md', render: (s) => s.warehouseName || 'Sin bodega' },
        {
            key: 'priority', header: 'Prioridad', width: '0.9fr',
            render: (s) => <Badge tone={s.priority === 'URGENT' ? 'danger' : 'neutral'}>{s.priority === 'URGENT' ? 'Urgente' : 'Normal'}</Badge>,
        },
        { key: 'current', header: 'Actual', width: '1fr', type: 'qty', hideBelow: 'md', render: (s) => `${formatNumber(s.currentStock || 0)} ${s.unit || ''}`.trim() },
        { key: 'min', header: 'Mín', width: '1fr', type: 'qty', hideBelow: 'lg', render: (s) => `${formatNumber(s.minStock || 0)} ${s.unit || ''}`.trim() },
        { key: 'suggested', header: 'Sugerido', width: '1fr', type: 'qty', render: (s) => `${formatNumber(s.suggestedQuantity)} ${s.unit || ''}`.trim() },
        { key: 'cost', header: `Estimado (${symbol})`, width: '1fr', type: 'money', accessor: (s) => Number(s.estimatedCost) || 0 },
    ];

    if (loading) return <div role="status">Cargando órdenes de compra...</div>;

    const balance = paymentModalOrder ? Number(paymentModalOrder.total) - Number(paymentModalOrder.paidAmount || 0) : 0;
    const paymentFormAmount = paymentForm.amount === '' ? null : Number(paymentForm.amount);

    return (
        <PageContent>
            <PageHeader
                title="Órdenes de Compra"
                description="Compras a proveedores, recepción y pagos."
                actions={(
                    <>
                        <Button icon={Zap} onClick={loadAutoSuggestions} disabled={loadingSuggestions || !canManagePurchaseOrders}>
                            {loadingSuggestions ? 'Cargando...' : 'Auto-Generar'}
                        </Button>
                        <Button icon={FileDown} onClick={() => setIsImportSidebarOpen(true)} disabled={!canManagePurchaseOrders}>
                            Carga Masiva
                        </Button>
                        <Button variant="primary" icon={Plus} onClick={() => handleOpenForm()} disabled={!canManagePurchaseOrders}>
                            Nueva orden
                        </Button>
                    </>
                )}
            />

            {ordersLoadError && (
                <div className={styles.alert} role="alert">
                    <span className={styles.inline}>
                        {ordersLoadError}
                        <Button size="sm" onClick={() => { void loadOrders(); }}>Reintentar</Button>
                    </span>
                </div>
            )}

            {(orders.length > 0 || !ordersLoadError) && (
                <div className={styles.kpiGrid}>
                    <StatCard
                        label="Comprometido sin recibir"
                        value={money(committedAmount)}
                        tone={issuedOverdue.length > 0 ? 'warning' : 'neutral'}
                        context={`${issuedOrders.length} órdenes emitidas · ${issuedOverdue.length} con fecha de vencimiento ya pasada`}
                        action={issuedOrders.length > 0 ? { label: 'Ver emitidas', onClick: () => setStatusFilter('ISSUED') } : undefined}
                    />
                    <StatCard
                        label="Por pagar a proveedores"
                        value={money(payableBalance)}
                        tone={overduePayments.length > 0 ? 'danger' : 'neutral'}
                        context={pendingPaymentOrders.length === 0
                            ? 'Sin facturas a crédito pendientes de pago'
                            : `${overduePayments.length} vencidas de ${pendingPaymentOrders.length} facturas a crédito recibidas`}
                        action={canManagePurchaseOrders && mostOverdueOrder
                            ? { label: `Registrar pago OC #${mostOverdueOrder.id}`, onClick: () => { void handleOpenPayment(mostOverdueOrder); } }
                            : undefined}
                    />
                </div>
            )}

            <DataTable
                ariaLabel="Órdenes de compra"
                columns={orderColumns}
                rows={filteredOrders}
                rowKey={(o) => o.id}
                resetKey={`${statusFilter}|${searchQuery}|${startDate}|${endDate}`}
                onRowClick={canManagePurchaseOrders ? (o) => handleOpenForm(o.id) : undefined}
                empty="No se encontraron órdenes de compra"
                toolbar={(
                    <TableToolbar>
                        <div className={styles.filters}>
                            <SegmentedControl
                                ariaLabel="Estado de la orden"
                                options={STATUS_OPTIONS}
                                value={statusFilter}
                                onChange={setStatusFilter}
                            />
                            <div className={styles.filterField}>
                                <label htmlFor="po-from">Desde</label>
                                <DateInput id="po-from" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                            </div>
                            <div className={styles.filterField}>
                                <label htmlFor="po-to">Hasta</label>
                                <DateInput id="po-to" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                            </div>
                            {(startDate || endDate) && (
                                <Button variant="ghost" size="sm" onClick={() => { setStartDate(''); setEndDate(''); }}>
                                    Quitar fechas
                                </Button>
                            )}
                            <div className={`${styles.filterField} ${styles.search}`}>
                                <label htmlFor="po-search">Buscar</label>
                                <Input
                                    id="po-search"
                                    type="search"
                                    placeholder="Buscar por ID, proveedor o factura..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </TableToolbar>
                )}
            />

            <FullScreenModal
                isOpen={showSuggestionsSidebar && !!suggestions}
                onClose={() => setShowSuggestionsSidebar(false)}
                title="Sugerencias de Órdenes de Compra"
                subtitle={suggestions
                    ? `${suggestions.summary.totalProducts ?? suggestionRows.length} productos · ${suggestions.summary.urgentProducts} urgentes · costo estimado ${money(Number(suggestions.summary.totalEstimatedCost) || 0)}`
                    : undefined}
                dirty={selectedSuggestions.length > 0}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cerrar</Button>
                        <Button
                            variant="primary"
                            type="submit"
                            form="po-suggestions-form"
                            disabled={creatingAutoPurchaseOrder || selectedSuggestions.length === 0}
                        >
                            {creatingAutoPurchaseOrder ? 'Creando...' : 'Crear borrador'}
                        </Button>
                    </>
                )}
            >
                {suggestions && (
                    <form id="po-suggestions-form" onSubmit={handleCreateAutoPurchaseOrder} className={styles.stack}>
                        <FormSection step={1} title="Configurar borrador">
                            <FormGrid>
                                <Field label="Sucursal" htmlFor="auto-po-branch" required>
                                    <AppSelect
                                        inputId="auto-po-branch"
                                        options={branches.map((branch) => ({ value: branch.id.toString(), label: branch.name }))}
                                        value={autoPurchaseForm.branchId || null}
                                        onChange={(v) => setAutoPurchaseForm((prev) => ({ ...prev, branchId: v || '' }))}
                                        placeholder="Seleccionar sucursal..."
                                    />
                                </Field>
                                <Field label="Proveedor" htmlFor="auto-po-supplier" required>
                                    <AppSelect
                                        inputId="auto-po-supplier"
                                        options={suppliers.map((supplier) => ({ value: supplier.id.toString(), label: supplier.name }))}
                                        value={autoPurchaseForm.supplierId || null}
                                        onChange={(v) => setAutoPurchaseForm((prev) => ({ ...prev, supplierId: v || '' }))}
                                        placeholder="Seleccionar proveedor..."
                                    />
                                </Field>
                            </FormGrid>
                        </FormSection>
                        <FormSection step={2} title="Productos sugeridos" description={`${selectedSuggestions.length} seleccionados de ${suggestionRows.length} sugerencias`}>
                            <DataTable
                                ariaLabel="Productos sugeridos"
                                columns={suggestionColumns}
                                rows={filteredSuggestionRows}
                                rowKey={getSuggestionKey}
                                resetKey={suggestionSearch}
                                empty="No hay sugerencias que coincidan con la búsqueda."
                                toolbar={(
                                    <TableToolbar>
                                        <div className={styles.filters}>
                                            <div className={`${styles.filterField} ${styles.search}`}>
                                                <label htmlFor="po-suggestion-search">Buscar</label>
                                                <Input
                                                    id="po-suggestion-search"
                                                    type="search"
                                                    placeholder="Buscar producto o almacén..."
                                                    value={suggestionSearch}
                                                    onChange={(e) => setSuggestionSearch(e.target.value)}
                                                />
                                            </div>
                                            <Button variant="ghost" onClick={handleSelectUrgentSuggestions}>Seleccionar urgentes</Button>
                                            <Button variant="ghost" onClick={() => setSelectedSuggestionKeys({})}>Limpiar</Button>
                                        </div>
                                    </TableToolbar>
                                )}
                            />
                        </FormSection>
                    </form>
                )}
            </FullScreenModal>

            {isSidebarOpen && (
                <PurchaseOrderForm
                    sidebarId={editingOrderId}
                    onClose={handleFormClose}
                    onSaved={handleFormSaved}
                />
            )}

            {isImportSidebarOpen && (
                <PurchaseOrderImport
                    onClose={() => setIsImportSidebarOpen(false)}
                    onSaved={() => {
                        setIsImportSidebarOpen(false);
                        loadOrders();
                    }}
                    settings={settings}
                />
            )}

            <FullScreenModal
                isOpen={!!paymentModalOrder}
                onClose={() => setPaymentModalOrder(null)}
                title={paymentModalOrder ? `Registrar Pago - OC #${paymentModalOrder.id}` : 'Registrar Pago'}
                subtitle={paymentModalOrder?.supplier?.name}
                tabs={[
                    { id: 'register', label: 'Registrar abono' },
                    { id: 'history', label: 'Historial de abonos', badge: paymentHistory.length > 0 ? paymentHistory.length : undefined },
                ]}
                activeTab={paymentTab}
                onTabChange={(id) => setPaymentTab(id as 'register' | 'history')}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        {paymentTab === 'register' && paymentModalOrder && (
                            <Button
                                variant="primary"
                                loading={savingPayment}
                                disabled={savingPayment || balance <= 0}
                                onClick={handleSubmitPayment}
                            >
                                {savingPayment ? 'Registrando...' : 'Registrar Pago'}
                            </Button>
                        )}
                    </>
                )}
            >
                {paymentModalOrder && (
                    <div className={styles.stack}>
                        {paymentTab === 'register' ? (
                            <>
                                <FormSection step={1} title="Resumen de la factura">
                                    <div className={styles.summary}>
                                        <div className={styles.summaryRow}><span>Total factura</span><strong>{money(Number(paymentModalOrder.total))}</strong></div>
                                        <div className={styles.summaryRow}><span>Abonado</span><strong>{money(Number(paymentModalOrder.paidAmount || 0))}</strong></div>
                                        <div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span>Saldo pendiente</span><strong>{money(balance)}</strong></div>
                                        {paymentModalOrder.paymentDueDate && (
                                            <div className={styles.summaryRow}>
                                                <span>Fecha vencimiento</span>
                                                <strong>{new Date(paymentModalOrder.paymentDueDate).toLocaleDateString('es-ES')}</strong>
                                            </div>
                                        )}
                                    </div>
                                </FormSection>

                                {balance > 0 ? (
                                    <FormSection step={2} title="Datos del pago">
                                        <FormGrid>
                                            <Field label="Monto del pago" htmlFor="payment-amount" required>
                                                <NumberInput
                                                    id="payment-amount"
                                                    value={paymentFormAmount}
                                                    onChange={(v) => setPaymentForm({ ...paymentForm, amount: v === null ? '' : String(v) })}
                                                    min={0.01}
                                                    prefix={symbol}
                                                />
                                            </Field>
                                            <Field label="Fecha de pago" htmlFor="payment-date" required>
                                                <DateInput
                                                    id="payment-date"
                                                    value={paymentForm.date}
                                                    onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })}
                                                />
                                            </Field>
                                            <Field label="Banco" htmlFor="payment-bank">
                                                <AppSelect
                                                    inputId="payment-bank"
                                                    options={BANK_OPTIONS}
                                                    value={paymentForm.bank || null}
                                                    onChange={(v) => setPaymentForm({ ...paymentForm, bank: v ?? '' })}
                                                    isClearable
                                                    placeholder="Seleccionar banco..."
                                                />
                                            </Field>
                                            <Field label="Nº Transferencia" htmlFor="payment-reference">
                                                <Input
                                                    id="payment-reference"
                                                    value={paymentForm.referenceNumber}
                                                    onChange={e => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })}
                                                    placeholder="Nº transferencia o comprobante"
                                                />
                                            </Field>
                                        </FormGrid>
                                        <Field label="Observaciones" htmlFor="payment-observations">
                                            <Textarea
                                                id="payment-observations"
                                                value={paymentForm.observations}
                                                onChange={e => setPaymentForm({ ...paymentForm, observations: e.target.value })}
                                                placeholder="Notas adicionales..."
                                            />
                                        </Field>
                                    </FormSection>
                                ) : (
                                    <p className={styles.muted}>Esta orden ya está pagada en su totalidad.</p>
                                )}
                            </>
                        ) : (
                            <FormSection title="Abonos registrados">
                                {loadingPaymentHistory ? (
                                    <p className={styles.muted}>Cargando abonos...</p>
                                ) : paymentHistory.length === 0 ? (
                                    <p className={styles.muted}>Sin abonos registrados para esta orden.</p>
                                ) : (
                                    <div>
                                        {paymentHistory.map((payment) => (
                                            <div key={payment.id} className={`${styles.paymentCard} ${payment.status === 'REVERSED' ? styles.reversed : ''}`}>
                                                <div className={styles.summaryRow}>
                                                    <strong>{money(Number(payment.amount))}</strong>
                                                    <span className={styles.inline}>
                                                        {payment.status === 'REVERSED' && <Badge tone="danger">Revertido</Badge>}
                                                        {new Date(payment.date).toLocaleDateString('es-ES')}
                                                    </span>
                                                </div>
                                                <div className={styles.inline}>
                                                    {payment.bank && <span className={styles.muted}>{payment.bank}</span>}
                                                    {payment.referenceNumber && <span className={styles.muted}>Ref: {payment.referenceNumber}</span>}
                                                    {payment.observations && <span className={styles.muted}>{payment.observations}</span>}
                                                    {payment.status === 'REVERSED' && payment.reversalReason && (
                                                        <span className={styles.muted}>Motivo: {payment.reversalReason}</span>
                                                    )}
                                                </div>
                                                {canDeletePurchaseOrders && payment.status !== 'REVERSED' && reversalPaymentId !== payment.id && (
                                                    <div>
                                                        <Button
                                                            size="sm" icon={Undo2}
                                                            onClick={() => { setReversalPaymentId(payment.id); setReversalReason(''); }}
                                                        >
                                                            Revertir abono
                                                        </Button>
                                                    </div>
                                                )}
                                                {reversalPaymentId === payment.id && (
                                                    <div className={styles.stack}>
                                                        <Textarea
                                                            aria-label="Motivo del reverso"
                                                            rows={2}
                                                            value={reversalReason}
                                                            onChange={(event) => setReversalReason(event.target.value)}
                                                            placeholder="Motivo obligatorio del reverso"
                                                            disabled={reversingPayment}
                                                        />
                                                        <div className={styles.inline}>
                                                            <Button variant="ghost" onClick={() => setReversalPaymentId(null)} disabled={reversingPayment}>
                                                                Cancelar
                                                            </Button>
                                                            <Button variant="danger" onClick={() => handleReversePayment(payment)} disabled={reversingPayment || !reversalReason.trim()}>
                                                                {reversingPayment ? 'Revirtiendo...' : 'Confirmar reverso'}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </FormSection>
                        )}
                    </div>
                )}
            </FullScreenModal>
        </PageContent>
    );
}
