import { useState, useEffect, useMemo, useRef } from 'react';
import { notifyError } from '../services/notify';
import { useNavigate } from 'react-router-dom';
import { purchaseOrdersAPI, autoPurchaseOrdersAPI, branchesAPI, suppliersAPI } from '../services/api';
import api from '../services/api';
import {
    AppSelect, Badge, Button, Checkbox, DataTable, DateInput, EmptyState, Field, FormGrid, FormSection, FullScreenModal, Skeleton,
    IconButton, Input, NumberInput, PageContent, PageHeader, TableToolbar, Tabs, Textarea, Tooltip,
    formatMoney, formatNumber,
    type Column, LoadErrorState,
} from '@/ui';
import PurchaseOrderForm from './PurchaseOrderForm';
import PurchaseOrderImport from '../components/PurchaseOrderImport';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import { Plus, Eye, Zap, FileDown, Download, DollarSign, RotateCcw, Trash2, Undo2, Pencil, PackageCheck, Search } from 'lucide-react';
import type { CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import { getIdempotentAttempt, type IdempotentAttempt } from '../utils/idempotency';
import { PURCHASE_ORDER_STATUS_LABELS, purchaseOrderDateVisibility, purchaseOrderPayable } from '../utils/purchaseOrderReceipt';
import { getApiErrorMessage } from '../utils/apiError';
import { BANK_OPTIONS } from '../constants/purchaseOrderOptions';
import type { AutoPurchaseSuggestion, Branch, PurchaseOrder, PurchaseOrderPayment, Supplier } from '../types';
import styles from './compras.module.css';

type PoSuggestionRow = AutoPurchaseSuggestion & {
    unit?: string;
    purchaseUnit?: string;
    purchaseQuantity?: number;
    purchaseUnitCost?: number;
};

// The suggestion line is expressed in the product's default purchase unit and
// its unit cost is sent unrounded (a per-gram cost like 0.004 must not become
// 0.00). Without a purchase unit, cost is omitted and derived by the server.
function toAutoPurchaseLine(suggestion: PoSuggestionRow) {
    const purchaseQuantity = Number(suggestion.purchaseQuantity);
    const usePurchaseUnit = Number.isFinite(purchaseQuantity) && purchaseQuantity > 0 && !!suggestion.purchaseUnit;
    const purchaseUnitCost = Number(suggestion.purchaseUnitCost);
    return {
        productId: suggestion.productId,
        quantity: usePurchaseUnit ? purchaseQuantity : Number(suggestion.suggestedQuantity),
        ...(usePurchaseUnit ? { unit: suggestion.purchaseUnit } : {}),
        ...(usePurchaseUnit && Number.isFinite(purchaseUnitCost) && purchaseUnitCost >= 0
            ? { cost: purchaseUnitCost }
            : {}),
    };
}

function formatSuggestionQuantity(suggestion: PoSuggestionRow) {
    const purchaseQuantity = Number(suggestion.purchaseQuantity);
    if (Number.isFinite(purchaseQuantity) && purchaseQuantity > 0 && suggestion.purchaseUnit) {
        return `${formatNumber(purchaseQuantity)} ${suggestion.purchaseUnit}`;
    }
    return `${formatNumber(suggestion.suggestedQuantity)}${suggestion.unit ? ` ${suggestion.unit}` : ''}`;
}

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

const STATUS_LABEL = PURCHASE_ORDER_STATUS_LABELS;
const STATUS_TONE = { DRAFT: 'neutral', ISSUED: 'primary', PARTIALLY_RECEIVED: 'warning', RECEIVED: 'success', CANCELLED: 'danger' } as const;
const STATUS_OPTIONS = [
    { value: 'all', label: 'Todas' },
    { value: 'DRAFT', label: 'Borrador' },
    { value: 'ISSUED', label: 'Emitida' },
    { value: 'PARTIALLY_RECEIVED', label: PURCHASE_ORDER_STATUS_LABELS.PARTIALLY_RECEIVED },
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
    const [paymentFilter, setPaymentFilter] = useState<'all' | 'due' | 'overdue'>('all');
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
    const reverseReceiptAttemptRef = useRef<IdempotentAttempt | null>(null);
    const closeRemainingAttemptRef = useRef<IdempotentAttempt | null>(null);
    const addPaymentAttemptRef = useRef<IdempotentAttempt | null>(null);
    const reversePaymentAttemptRef = useRef<IdempotentAttempt | null>(null);

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
            notifyError(error, 'No se pudo cargar la configuración; los montos usan el formato predeterminado', { type: 'warning' });
        }
    };

    const loadOrders = async () => {
        setLoading(true);
        try {
            const res = await purchaseOrdersAPI.getAll();
            setOrders(Array.isArray(res.data.data) ? res.data.data : []);
            setOrdersLoadError(null);
        } catch (error) {
            console.error('Error loading purchase orders:', error);
            setOrdersLoadError(getApiErrorMessage(error, 'No se pudieron cargar las órdenes de compra (la lista puede estar incompleta o desactualizada)'));
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
                items: selectedSuggestions.map(toAutoPurchaseLine),
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

        // Date range (local YYYY-MM-DD). Partially received orders with a pending
        // balance stay visible outside the range; see purchaseOrderDateVisibility.
        const matchesDate = purchaseOrderDateVisibility(order, { startDate, endDate, statusFilter }).visible;

        const owesSupplier = order.invoiceType === 'CREDIT' && order.paymentStatus !== 'PAID'
            && order.status !== 'CANCELLED' && order.status !== 'DRAFT';
        const matchesPayment = paymentFilter === 'all'
            || (owesSupplier && (paymentFilter === 'due' || (!!order.paymentDueDate && new Date(order.paymentDueDate).getTime() < Date.now())));

        return matchesStatus && matchesSearch && matchesDate && matchesPayment;
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
        // Partially received CREDIT orders owe only what arrived (server caps there).
        const balance = purchaseOrderPayable(order) - Number(order.paidAmount || 0);
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
        } catch (error) {
            setPaymentHistory(order.payments || []);
            notifyError(error, 'No se pudo actualizar el historial de pagos (se muestra la última información disponible)', { type: 'warning' });
        } finally {
            setLoadingPaymentHistory(false);
        }
    };

    const handleReverseReceipt = async (order: PurchaseOrder) => {
        if (!canDeletePurchaseOrders || (order.status !== 'RECEIVED' && order.status !== 'PARTIALLY_RECEIVED')) return;
        const reason = window.prompt('Motivo obligatorio del reverso de recepción:')?.trim();
        if (!reason) return;
        const accepted = await confirm(
            `¿Revertir la recepción de la orden #${order.id}? La operación fallará si el inventario recibido ya fue consumido.`,
            { title: 'Confirmar reverso de recepción' }
        );
        if (!accepted) return;
        try {
            const attempt = getIdempotentAttempt(reverseReceiptAttemptRef.current, `reverse-receipt:${order.id}:${reason}`);
            reverseReceiptAttemptRef.current = attempt;
            await purchaseOrdersAPI.reverseReceipt(order.id, reason, attempt.key);
            reverseReceiptAttemptRef.current = null;
            showSuccess('Recepción revertida correctamente');
            loadOrders();
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo revertir la recepción'));
        }
    };

    /** "Cerrar saldo": finish a partially received order without receiving the rest. */
    const handleCloseRemaining = async (order: PurchaseOrder) => {
        if (!canManagePurchaseOrders || order.status !== 'PARTIALLY_RECEIVED') return;
        const reason = window.prompt('Motivo obligatorio para cerrar el saldo pendiente:')?.trim();
        if (!reason) return;
        const accepted = await confirm(
            `¿Cerrar el saldo de la orden #${order.id}? Lo pendiente se abandona sin afectar inventario y el total de la orden pasa a ${money(Number(order.receivedTotal || 0))} (valor recibido).`,
            { title: 'Confirmar cierre de saldo' }
        );
        if (!accepted) return;
        try {
            const attempt = getIdempotentAttempt(closeRemainingAttemptRef.current, `close-remaining:${order.id}:${reason}`);
            closeRemainingAttemptRef.current = attempt;
            await purchaseOrdersAPI.closeRemaining(order.id, reason, attempt.key);
            closeRemainingAttemptRef.current = null;
            showSuccess('Saldo cerrado. La orden queda como recibida.');
            loadOrders();
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo cerrar el saldo de la orden'));
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
        if (amount > purchaseOrderPayable(paymentModalOrder) - Number(paymentModalOrder.paidAmount || 0) + 0.005) {
            showError('El monto no puede superar el saldo pendiente');
            return;
        }
        const paymentData = {
            amount,
            date: paymentForm.date,
            bank: paymentForm.bank || undefined,
            referenceNumber: paymentForm.referenceNumber || undefined,
            observations: paymentForm.observations || undefined
        };
        const fingerprint = `add-payment:${paymentModalOrder.id}:${JSON.stringify(paymentData)}`;
        const attempt = getIdempotentAttempt(addPaymentAttemptRef.current, fingerprint);
        addPaymentAttemptRef.current = attempt;
        setSavingPayment(true);
        try {
            await purchaseOrdersAPI.addPayment(paymentModalOrder.id, paymentData, attempt.key);
            addPaymentAttemptRef.current = null;
            showSuccess('Pago registrado correctamente.');
            try {
                const [paymentsRes, orderRes] = await Promise.all([
                    purchaseOrdersAPI.getPayments(paymentModalOrder.id),
                    purchaseOrdersAPI.getById(paymentModalOrder.id),
                ]);
                const updatedOrder = orderRes.data.data as PurchaseOrder;
                setPaymentModalOrder(updatedOrder);
                setPaymentHistory(Array.isArray(paymentsRes.data.data) ? paymentsRes.data.data : []);
                const balance = purchaseOrderPayable(updatedOrder) - Number(updatedOrder.paidAmount || 0);
                setPaymentForm((prev) => ({
                    ...prev,
                    amount: balance > 0 ? balance.toFixed(2) : '',
                    bank: '',
                    referenceNumber: '',
                    observations: '',
                }));
            } catch (error) {
                notifyError(error, 'El pago fue registrado, pero no se pudo actualizar el detalle (recarga antes de registrar otro abono)', { type: 'warning' });
            }
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
            const attempt = getIdempotentAttempt(
                reversePaymentAttemptRef.current,
                `reverse-payment:${paymentModalOrder.id}:${payment.id}:${reason}`,
            );
            reversePaymentAttemptRef.current = attempt;
            await purchaseOrdersAPI.reversePayment(paymentModalOrder.id, payment.id, reason, attempt.key);
            reversePaymentAttemptRef.current = null;
            try {
                const [paymentsRes, orderRes] = await Promise.all([
                    purchaseOrdersAPI.getPayments(paymentModalOrder.id),
                    purchaseOrdersAPI.getById(paymentModalOrder.id),
                ]);
                setPaymentModalOrder(orderRes.data.data as PurchaseOrder);
                setPaymentHistory(Array.isArray(paymentsRes.data.data) ? paymentsRes.data.data : []);
            } catch (error) {
                notifyError(error, 'El reverso fue aplicado, pero no se pudo actualizar el historial (recarga la orden para conciliarlo)', { type: 'warning' });
            }
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

    const renderPaymentCell = (order: PurchaseOrder) => {
        // CASH is paid on delivery: nothing is settled before a receipt.
        if (order.invoiceType !== 'CREDIT') {
            return order.paymentStatus === 'PAID' ? <Badge tone="success">Pagado</Badge> : <Badge tone="neutral">Contra entrega</Badge>;
        }
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
        { key: 'id', header: 'Orden', render: (o) => `#${o.id}` },
        { key: 'supplier', header: 'Proveedor', render: (o) => o.supplier?.name ?? 'N/D' },
        { key: 'invoiceNumber', header: 'Nº Factura', hideBelow: 'md', render: (o) => o.invoiceNumber || '-' },
        { key: 'date', header: 'Fecha', type: 'date' },
        {
            key: 'invoiceType', header: 'Tipo', type: 'status', hideBelow: 'lg',
            render: (o) => <Badge tone={o.invoiceType === 'CREDIT' ? 'warning' : 'neutral'}>{o.invoiceType === 'CREDIT' ? 'Crédito' : 'Contado'}</Badge>,
        },
        {
            key: 'total', header: `Total (${symbol})`, type: 'money', accessor: (o) => Number(o.total) || 0,
            render: (o) => (o.status === 'PARTIALLY_RECEIVED' ? (
                <span className={styles.cellStack}>
                    <span>{formatNumber(Number(o.total) || 0)}</span>
                    <span className={styles.muted}>Recibido {money(Number(o.receivedTotal) || 0)}</span>
                </span>
            ) : formatNumber(Number(o.total) || 0)),
        },
        { key: 'payment', header: 'Pago', type: 'status', hideBelow: 'lg', render: renderPaymentCell },
        {
            key: 'status', header: 'Estado', type: 'status',
            render: (o) => (
                <span className={styles.cellStack}>
                    <Badge tone={STATUS_TONE[o.status] ?? 'neutral'} dot>{STATUS_LABEL[o.status] ?? o.status}</Badge>
                    {purchaseOrderDateVisibility(o, { startDate, endDate, statusFilter }).outOfRange && (
                        <Tooltip label="Fuera del rango de fechas: se muestra porque tiene saldo pendiente de recibir">
                            <span className={styles.muted} tabIndex={0}>Saldo pendiente · fuera del rango</span>
                        </Tooltip>
                    )}
                </span>
            ),
        },
        {
            key: 'actions', header: 'Acciones', width: '208px', type: 'actions',
            render: (order) => (
                <span className={styles.rowActions}>
                    {canManagePurchaseOrders && (
                        <IconButton
                            icon={order.status === 'RECEIVED' || order.status === 'PARTIALLY_RECEIVED' ? Eye : Pencil} size="sm"
                            tooltip={order.status === 'RECEIVED' || order.status === 'PARTIALLY_RECEIVED' ? 'Ver detalle' : 'Editar'}
                            label={order.status === 'RECEIVED' ? 'Ver detalles' : order.status === 'PARTIALLY_RECEIVED' ? 'Ver / recibir saldo' : 'Editar'}
                            onClick={() => handleOpenForm(order.id)}
                        />
                    )}
                    {canManagePurchaseOrders && order.invoiceType === 'CREDIT' && (order.status === 'RECEIVED' || order.status === 'PARTIALLY_RECEIVED') && (
                        <IconButton
                            icon={DollarSign} size="sm"
                            tooltip={order.paymentStatus === 'PAID' ? 'Historial' : 'Registrar pago'}
                            label={order.paymentStatus === 'PAID' ? 'Ver historial de abonos' : 'Registrar pago / abono'}
                            onClick={() => handleOpenPayment(order)}
                        />
                    )}
                    {canManagePurchaseOrders && order.status === 'PARTIALLY_RECEIVED' && (
                        <IconButton
                            icon={PackageCheck} size="sm" tooltip="Cerrar saldo"
                            label={`Cerrar saldo de la orden ${order.id} (abandonar lo pendiente)`}
                            onClick={() => void handleCloseRemaining(order)}
                        />
                    )}
                    {order.invoicePdf && (
                        <IconButton icon={Download} size="sm" tooltip="Descargar factura" label="Ver Factura PDF" onClick={() => void handleDownloadInvoice(order)} />
                    )}
                    {canDeletePurchaseOrders && (order.status === 'RECEIVED' || order.status === 'PARTIALLY_RECEIVED') && (
                        <IconButton icon={RotateCcw} size="sm" tone="danger" tooltip="Revertir" label="Revertir recepción" onClick={() => void handleReverseReceipt(order)} />
                    )}
                    {canDeletePurchaseOrders && order.status === 'DRAFT' && (
                        <IconButton icon={Trash2} size="sm" tone="danger" tooltip="Eliminar" label="Eliminar borrador" onClick={() => void handleDeleteOrder(order.id)} />
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
        { key: 'product', header: 'Producto', render: (s) => s.productName?.trim() || `Producto #${s.productId}` },
        { key: 'warehouse', header: 'Bodega', hideBelow: 'md', render: (s) => s.warehouseName || 'Sin bodega' },
        {
            key: 'priority', header: 'Prioridad', type: 'status',
            render: (s) => <Badge tone={s.priority === 'URGENT' ? 'danger' : 'neutral'}>{s.priority === 'URGENT' ? 'Urgente' : 'Normal'}</Badge>,
        },
        { key: 'current', header: 'Actual', type: 'qty', hideBelow: 'md', render: (s) => `${formatNumber(s.currentStock || 0)} ${s.unit || ''}`.trim() },
        { key: 'min', header: 'Mín', type: 'qty', hideBelow: 'lg', render: (s) => `${formatNumber(s.minStock || 0)} ${s.unit || ''}`.trim() },
        { key: 'suggested', header: 'Sugerido', type: 'qty', render: (s) => formatSuggestionQuantity(s) },
        { key: 'cost', header: `Estimado (${symbol})`, type: 'money', accessor: (s) => Number(s.estimatedCost) || 0 },
    ];


    const balance = paymentModalOrder ? purchaseOrderPayable(paymentModalOrder) - Number(paymentModalOrder.paidAmount || 0) : 0;
    const paymentFormAmount = paymentForm.amount === '' ? null : Number(paymentForm.amount);

    return (
        <PageContent>
            <PageHeader
                title="Órdenes de Compra"
                description="Compras a proveedores, recepción y pagos."
                actions={(
                    <Button variant="primary" icon={Plus} onClick={() => handleOpenForm()} disabled={!canManagePurchaseOrders}>
                        Nueva orden
                    </Button>
                )}
            />

            {ordersLoadError && <LoadErrorState message={ordersLoadError} onRetry={() => { void loadOrders(); }} />}

            <Tabs
                ariaLabel="Filtrar por estado de la orden"
                active={statusFilter}
                onChange={setStatusFilter}
                tabs={STATUS_OPTIONS.map(({ value, label }) => ({
                    id: value,
                    label,
                    badge: ordersLoadError ? undefined : value === 'all' ? orders.length : orders.filter((order) => order.status === value).length,
                }))}
            />

            <TableToolbar
                actions={(
                    <>
                        {(startDate || endDate) && (
                            <Button variant="ghost" onClick={() => { setStartDate(''); setEndDate(''); }}>
                                Quitar fechas
                            </Button>
                        )}
                        <Button icon={Zap} onClick={loadAutoSuggestions} loading={loadingSuggestions} disabled={!canManagePurchaseOrders}>
                            Auto-Generar
                        </Button>
                        <Button icon={FileDown} onClick={() => setIsImportSidebarOpen(true)} disabled={!canManagePurchaseOrders}>
                            Carga Masiva
                        </Button>
                    </>
                )}
            >
                <Input
                    id="po-search"
                    type="search"
                    aria-label="Buscar orden"
                    placeholder="Buscar por ID, proveedor o factura..."
                    prefix={<Search size={14} aria-hidden="true" />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                <AppSelect
                    inputId="po-payment-filter"
                    aria-label="Filtrar por pago a proveedor"
                    options={[
                        { value: 'all', label: 'Pago: todos' },
                        { value: 'due', label: 'Por pagar (crédito)' },
                        { value: 'overdue', label: 'Vencidas' },
                    ]}
                    value={paymentFilter}
                    onChange={(v) => setPaymentFilter((v || 'all') as 'all' | 'due' | 'overdue')}
                />
                <DateInput id="po-from" aria-label="Desde" title="Desde" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <DateInput id="po-to" aria-label="Hasta" title="Hasta" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </TableToolbar>

            <DataTable
                ariaLabel="Órdenes de compra"
                columns={orderColumns}
                rows={filteredOrders}
                rowKey={(o) => o.id}
                loading={loading}
                resetKey={`${statusFilter}|${paymentFilter}|${searchQuery}|${startDate}|${endDate}`}
                onRowClick={canManagePurchaseOrders ? (o) => handleOpenForm(o.id) : undefined}
                empty="No se encontraron órdenes de compra"
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
                            loading={creatingAutoPurchaseOrder}
                            disabled={selectedSuggestions.length === 0}
                        >
                            Crear borrador
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
                                    <TableToolbar
                                        actions={(
                                            <>
                                                <Button variant="ghost" onClick={handleSelectUrgentSuggestions}>Seleccionar urgentes</Button>
                                                <Button variant="ghost" onClick={() => setSelectedSuggestionKeys({})}>Limpiar</Button>
                                            </>
                                        )}
                                    >
                                        <Input
                                            id="po-suggestion-search"
                                            type="search"
                                            aria-label="Buscar sugerencia"
                                            placeholder="Buscar producto o almacén..."
                                            prefix={<Search size={14} aria-hidden="true" />}
                                            value={suggestionSearch}
                                            onChange={(e) => setSuggestionSearch(e.target.value)}
                                        />
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
                footer={({ requestClose }) => {
                    const reversalPayment = paymentTab === 'history' && reversalPaymentId !== null
                        ? paymentHistory.find((p) => p.id === reversalPaymentId) ?? null
                        : null;
                    return (
                        <>
                            {reversalPayment ? (
                                <Button onClick={() => setReversalPaymentId(null)} disabled={reversingPayment}>Cancelar reverso</Button>
                            ) : (
                                <Button onClick={requestClose}>Cancelar</Button>
                            )}
                            {paymentTab === 'register' && paymentModalOrder && (
                                <Button
                                    variant="primary"
                                    loading={savingPayment}
                                    disabled={balance <= 0}
                                    onClick={handleSubmitPayment}
                                >
                                    Registrar Pago
                                </Button>
                            )}
                            {reversalPayment && (
                                <Button
                                    variant="danger"
                                    loading={reversingPayment}
                                    disabled={!reversalReason.trim()}
                                    onClick={() => handleReversePayment(reversalPayment)}
                                >
                                    Confirmar reverso
                                </Button>
                            )}
                        </>
                    );
                }}
            >
                {paymentModalOrder && (
                    <div className={styles.stack}>
                        {paymentTab === 'register' ? (
                            <>
                                <FormSection step={1} title="Resumen de la factura">
                                    <div className={styles.summary}>
                                        <div className={styles.summaryRow}><span>Total factura</span><strong>{money(Number(paymentModalOrder.total))}</strong></div>
                                        {paymentModalOrder.status === 'PARTIALLY_RECEIVED' && (
                                            <div className={styles.summaryRow}><span>Valor recibido (exigible)</span><strong>{money(Number(paymentModalOrder.receivedTotal || 0))}</strong></div>
                                        )}
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
                                    <div className={styles.stack} role="status" aria-label="Cargando abonos...">
                                        <Skeleton height={56} />
                                        <Skeleton height={56} />
                                    </div>
                                ) : paymentHistory.length === 0 ? (
                                    <EmptyState title="Sin abonos registrados para esta orden." />
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
                                                            variant="ghost" icon={Undo2}
                                                            onClick={() => { setReversalPaymentId(payment.id); setReversalReason(''); }}
                                                        >
                                                            Revertir abono
                                                        </Button>
                                                    </div>
                                                )}
                                                {reversalPaymentId === payment.id && (
                                                    <Field
                                                        label="Motivo del reverso"
                                                        htmlFor={`payment-reversal-reason-${payment.id}`}
                                                        hint="Obligatorio. Confirma el reverso con el botón del pie."
                                                        required
                                                    >
                                                        <Textarea
                                                            id={`payment-reversal-reason-${payment.id}`}
                                                            rows={2}
                                                            value={reversalReason}
                                                            onChange={(event) => setReversalReason(event.target.value)}
                                                            placeholder="Motivo obligatorio del reverso"
                                                            disabled={reversingPayment}
                                                        />
                                                    </Field>
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
