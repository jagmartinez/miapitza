import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { tablesAPI, ordersAPI, branchesAPI, invoicesAPI, cashShiftsAPI } from '../services/api';
import {
    AppSelect, Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton,
    Input, NumberInput, PageContent, PageHeader, SegmentedControl, formatMoney, formatNumber,
    type Column, type Opt, type Tone,
} from '@/ui';
import SalonCards from '../components/SalonCards';
import TableDetailPanel from '../components/TableDetailPanel';
import LegacyConsolidationReview from '../components/LegacyConsolidationReview';
import PaymentModal from '../components/PaymentModal';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { canCreatePayment, canVoidKitchenLine } from '../utils/authz';
import KitchenLineVoidModal from '../components/KitchenLineVoidModal';
import { getTableAccess } from '../utils/tableAccess';
import { Grid3x3, Plus, Pencil, Trash2, Eye, MapPin, MapPinned, History, Link2, ShoppingBag } from 'lucide-react';
import type {
    ActiveTableConsolidation,
    LegacyTableConsolidationCandidate,
    LegacyTableConsolidationInventory,
    Table,
    Order,
    Branch,
    TableFloorPlan,
} from '../types';
import './Tables.css';
import TableMap, { type FloorPlanDraft } from '../components/TableMap';
import { resolveTablePresentationState } from '../utils/tablePresentation';
import { TABLE_TILE_LEGEND, tableTileState } from '../utils/tableTileState';
import {
    getIdempotentAttempt,
    newIdempotencyKey,
    type IdempotentAttempt,
} from '../utils/idempotency';
import TableOperationModal from '../components/TableOperationModal';
import TableGroupModal, { type TableGroupFormData } from '../components/TableGroupModal';
import POS from './POS';
import { hasUsableCashShift, type CashShiftScope } from '../utils/paymentAccess';
import { initializeWebSocket, subscribeWebSocket, WS_EVENTS } from '../utils/websocket';
import { useCurrency } from '../hooks/useCurrency';
import { openMinutesByTable, openAmountByTable, openTableOrders } from '../utils/salonInsights';
import KitchenNotificationBell from '../components/KitchenNotificationBell';
import { doesOrderRemainVisibleAtTable } from '../utils/posOrderBucket';
import {
    renderInvoiceHtml,
    renderInvoiceLoadingHtml,
    renderPreInvoiceHtml,
    renderPreInvoiceLoadingHtml,
    type PrintableInvoiceSnapshot,
} from '../utils/invoicePrint';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage } from '../utils/apiError';
import { markErrorHandled, notifyError } from '../services/notify';

type TablesView = 'tiles' | 'plan' | 'list';
const TABLES_VIEW_KEY = 'tables.view';

interface ApiValidationError { field?: string; message?: string }
function extractApiError(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { message?: string; errors?: ApiValidationError[] } | undefined;
        if (data?.errors && data.errors.length > 0) {
            const details = data.errors
                .map(e => e.field ? `${e.field}: ${e.message}` : e.message)
                .filter(Boolean)
                .join('\n');
            return `${data.message || fallback}\n\n${details}`;
        }
        if (data?.message) return data.message;
    }
    return fallback;
}

export default function Tables() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { symbol: currencySymbol } = useCurrency();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning, success: showSuccess } = useAppToast();
    const {
        canCreateTable,
        canEditTable,
        canDeleteTable,
        canEditMap,
        canTransfer,
        canConsolidate,
        canGroup,
        canIssueInvoice,
        canOperatePOS,
        canChooseBranch,
    } = getTableAccess(user);
    const canPay = canCreatePayment(user);
    const [tables, setTables] = useState<Table[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchFilter, setBranchFilter] = useState<number | null>(() => user?.branchId ?? null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string | null>(null);

    // CRUD State
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingTable, setEditingTable] = useState<Table | null>(null);
    const [formData, setFormData] = useState({
        number: '',
        capacity: '4',
        location: '',
        status: 'AVAILABLE' as 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'OUT_OF_SERVICE',
        branchId: ''
    });
    const [activeTab, setActiveTab] = useState<'general' | 'ubicacion'>('general');
    const [formDirty, setFormDirty] = useState(false);

    // Detalle de mesa (panel lateral)
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const detailPanelRef = useRef<HTMLDivElement>(null);
    const [tableOrders, setTableOrders] = useState<Order[]>([]);
    const canVoidLines = canVoidKitchenLine(user);
    const [voidLineTarget, setVoidLineTarget] = useState<{ order: Order; itemId: number } | null>(null);
    const [loadingTableOrders, setLoadingTableOrders] = useState(false);
    const tableOrderRequestRef = useRef(0);
    const consolidationLookupRequestRef = useRef(0);
    const tablesRequestRef = useRef(0);
    const tablesLoadedScopeRef = useRef<number | null | undefined>(undefined);
    const reversalAttemptRef = useRef<IdempotentAttempt | null>(null);
    const [activeConsolidation, setActiveConsolidation] = useState<ActiveTableConsolidation | null>(null);
    const [loadingConsolidation, setLoadingConsolidation] = useState(false);
    const [consolidationLookupError, setConsolidationLookupError] = useState<string | null>(null);
    const [consolidationReversalError, setConsolidationReversalError] = useState<string | null>(null);
    const [reversingConsolidation, setReversingConsolidation] = useState(false);
    const legacyReviewAttemptRef = useRef<IdempotentAttempt | null>(null);
    const [isLegacyReviewOpen, setIsLegacyReviewOpen] = useState(false);
    const [legacyInventory, setLegacyInventory] = useState<LegacyTableConsolidationInventory | null>(null);
    const [loadingLegacyInventory, setLoadingLegacyInventory] = useState(false);
    const [legacyInventoryError, setLegacyInventoryError] = useState<string | null>(null);
    const [legacyReviewActionError, setLegacyReviewActionError] = useState<string | null>(null);
    const [markingLegacyCandidateKey, setMarkingLegacyCandidateKey] = useState<string | null>(null);
    // Vista operativa: mesas (mosaico del mockup), plano editable o lista administrativa.
    const [view, setView] = useState<TablesView>(() => {
        try {
            const saved = localStorage.getItem(TABLES_VIEW_KEY);
            return saved === 'plan' || saved === 'list' ? saved : 'tiles';
        } catch { return 'tiles'; }
    });
    const showMap = view !== 'list';
    const [zoneFilter, setZoneFilter] = useState<string>('ALL');
    const [openOrders, setOpenOrders] = useState<Order[] | null>(null);
    const [openOrdersFailed, setOpenOrdersFailed] = useState(false);
    const [metaNow, setMetaNow] = useState(() => Date.now());
    const [savingLayout, setSavingLayout] = useState(false);
    const [operation, setOperation] = useState<'TRANSFER' | 'CONSOLIDATE' | null>(null);
    const [operationTableId, setOperationTableId] = useState<number | null>(null);
    const [submittingOperation, setSubmittingOperation] = useState(false);
    const [groupTableId, setGroupTableId] = useState<number | null>(null);
    const [submittingGroup, setSubmittingGroup] = useState(false);
    const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
    const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
    const [paymentMode, setPaymentMode] = useState<'single' | 'split'>('single');
    const [cashShiftStatus, setCashShiftStatus] = useState<CashShiftScope | null>(null);
    // Espacio del POS: con mesa (desde el detalle) o sin mesa para una orden para llevar.
    const [posTarget, setPosTarget] = useState<{ table: Table | null } | null>(null);
    const [floorPlan, setFloorPlan] = useState<TableFloorPlan | null>(null);

    const loadedBranchIds = Array.from(new Set(tables.map((table) => table.branchId)));
    const mapBranchId = branchFilter ?? (loadedBranchIds.length === 1 ? loadedBranchIds[0] : undefined);
    const mapBranchName = user?.branch?.name
        || tables.find((table) => table.branchId === mapBranchId)?.branch?.name
        || 'Sucursal asignada';

    useEffect(() => {
        if (canChooseBranch) return;
        setBranchFilter(user?.branchId ?? null);
    }, [canChooseBranch, user?.branchId]);

    const loadTables = useCallback(async () => {
        // Full-page loader only for the first load of a branch scope. Background refreshes
        // (websocket events, post-action reloads) must not unmount the embedded POS or an
        // in-flight PaymentModal (mixed payments keep idempotency refs in component state).
        const scopeKey = branchFilter ?? null;
        const isBackgroundRefresh = tablesLoadedScopeRef.current === scopeKey;
        const requestId = ++tablesRequestRef.current;
        if (!isBackgroundRefresh) setLoading(true);
        try {
            const response = await tablesAPI.getAll(branchFilter ?? undefined);
            if (requestId !== tablesRequestRef.current) return;
            setTables(response.data.data);
            tablesLoadedScopeRef.current = scopeKey;
        } catch (error) {
            if (requestId !== tablesRequestRef.current) return;
            console.error('Error loading tables:', error);
            if (!isBackgroundRefresh) setTables([]);
            showError(extractApiError(error, 'No se pudieron cargar las mesas. No se mostrará un salón vacío como si fuera real.'));
        } finally {
            if (requestId === tablesRequestRef.current) setLoading(false);
        }
    }, [branchFilter, showError]);

    useEffect(() => {
        loadTables();
    }, [loadTables]);

    const loadFloorPlan = useCallback(async () => {
        if (!mapBranchId) {
            setFloorPlan(null);
            return;
        }
        try {
            const response = await tablesAPI.getFloorPlan(mapBranchId);
            setFloorPlan(response.data.data as TableFloorPlan);
        } catch (error) {
            console.error('Error loading table floor plan:', error);
            showError(extractApiError(error, 'No se pudo cargar el plano de la sucursal.'));
        }
    }, [mapBranchId, showError]);

    useEffect(() => {
        void loadFloorPlan();
    }, [loadFloorPlan]);

    useEffect(() => {
        if (!canChooseBranch) return;
        branchesAPI.getAll()
            .then((res) => setBranches(res.data.data || []))
            .catch((error) => {
                console.error('Error loading branches:', error);
                setBranches([]);
                showError(extractApiError(error, 'No se pudieron cargar las sucursales para filtrar las mesas.'));
            });
    }, [canChooseBranch, showError]);

    useEffect(() => {
        if (!showMap || !canChooseBranch || branchFilter || branches.length === 0) return;
        setBranchFilter(branches[0].id);
    }, [showMap, canChooseBranch, branchFilter, branches]);

    const handleOpenSidebar = (table?: Table) => {
        if (table && !canEditTable) {
            showWarning('No tienes permisos para editar mesas');
            return;
        }
        if (!table && !canCreateTable) {
            showWarning('No tienes permisos para crear mesas');
            return;
        }

        if (table) {
            setEditingTable(table);
            setFormData({
                number: table.number,
                capacity: table.capacity.toString(),
                location: table.location || '',
                status: table.status,
                branchId: table.branchId?.toString() || ''
            });
        } else {
            setEditingTable(null);
            const defaultBranchId = branchFilter?.toString()
                || user?.branchId?.toString()
                || (branches.length === 1 ? branches[0].id.toString() : '');
            setFormData({
                number: '',
                capacity: '4',
                location: '',
                status: 'AVAILABLE',
                branchId: defaultBranchId
            });
        }
        setActiveTab('general');
        setFormDirty(false);
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (editingTable && !canEditTable) {
            showWarning('No tienes permisos para editar mesas');
            return;
        }
        if (!editingTable && !canCreateTable) {
            showWarning('No tienes permisos para crear mesas');
            return;
        }
        if (!editingTable && canChooseBranch && !formData.branchId) {
            showWarning('Selecciona la sucursal a la que pertenece la mesa.');
            return;
        }
        const capacity = parseInt(formData.capacity);
        if (!Number.isFinite(capacity) || capacity < 1) {
            setActiveTab('general');
            showWarning('Indica la capacidad (mínimo 1 persona).');
            return;
        }

        try {
            if (editingTable) {
                // La sucursal de una mesa no se reasigna desde la edición.
                await tablesAPI.update(editingTable.id, {
                    number: formData.number,
                    capacity,
                    location: formData.location,
                    status: formData.status
                });
            } else {
                await tablesAPI.create({
                    number: formData.number,
                    capacity,
                    location: formData.location,
                    ...(formData.branchId ? { branchId: parseInt(formData.branchId) } : {})
                });
            }

            setIsSidebarOpen(false);
            await loadTables();
            await loadFloorPlan();
        } catch (error) {
            console.error('Error saving table:', error);
            showError(extractApiError(error, 'Error al guardar la mesa'));
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteTable) {
            showWarning('No tienes permisos para eliminar mesas');
            return;
        }
        if (!(await confirm('¿Estás seguro de eliminar esta mesa?', { title: 'Confirmar acción' }))) return;
        try {
            await tablesAPI.delete(id);
            await loadTables();
            await loadFloorPlan();
        } catch (error) {
            console.error('Error deleting table:', error);
            showError(extractApiError(error, 'Error al eliminar la mesa'));
        }
    };

    const loadTableOrders = useCallback(async (table: Table) => {
        const requestId = ++tableOrderRequestRef.current;
        setLoadingTableOrders(true);
        try {
            const response = await ordersAPI.getAll({
                tableId: table.id,
            });
            const active = response.data.data.filter((order: Order) =>
                doesOrderRemainVisibleAtTable(order)
            );
            if (requestId === tableOrderRequestRef.current) setTableOrders(active);
        } catch (error) {
            console.error('Error loading table orders:', error);
            if (requestId === tableOrderRequestRef.current) {
                showError(getApiErrorMessage(error, 'No se pudieron cargar las órdenes de esta mesa'));
            }
        } finally {
            if (requestId === tableOrderRequestRef.current) setLoadingTableOrders(false);
        }
    }, [showError]);

    const loadActiveConsolidation = useCallback(async (
        tableId: number,
    ): Promise<ActiveTableConsolidation | null | undefined> => {
        const requestId = ++consolidationLookupRequestRef.current;
        if (!canConsolidate) {
            setActiveConsolidation(null);
            setConsolidationLookupError(null);
            setLoadingConsolidation(false);
            return null;
        }

        setLoadingConsolidation(true);
        setConsolidationLookupError(null);
        try {
            const response = await tablesAPI.getActiveConsolidation({ tableId });
            const discovered = response.data.data as ActiveTableConsolidation | null;
            const active = discovered?.status === 'ACTIVE' ? discovered : null;
            if (requestId === consolidationLookupRequestRef.current) {
                setActiveConsolidation(active);
            }
            return active;
        } catch (error) {
            console.error('Error loading active table consolidation:', error);
            if (requestId === consolidationLookupRequestRef.current) {
                setActiveConsolidation(null);
                setConsolidationLookupError(extractApiError(
                    error,
                    'No se pudo verificar si esta cuenta proviene de una consolidación.',
                ));
            }
            return undefined;
        } finally {
            if (requestId === consolidationLookupRequestRef.current) {
                setLoadingConsolidation(false);
            }
        }
    }, [canConsolidate]);

    const handleViewOrders = async (table: Table) => {
        setSelectedTable(table);
        setTableOrders([]);
        setActiveConsolidation(null);
        setConsolidationLookupError(null);
        setConsolidationReversalError(null);
        // En pantallas angostas el detalle queda debajo del plano: llevarlo a la vista.
        if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023px)').matches) {
            window.setTimeout(() => detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
        }
        await Promise.all([
            loadTableOrders(table),
            loadActiveConsolidation(table.id),
        ]);
    };

    const loadLegacyInventory = useCallback(async () => {
        if (!canConsolidate) {
            setLegacyInventory(null);
            return;
        }
        setLoadingLegacyInventory(true);
        setLegacyInventoryError(null);
        try {
            const response = await tablesAPI.getLegacyConsolidationInventory(
                branchFilter ?? undefined,
            );
            setLegacyInventory(response.data.data as LegacyTableConsolidationInventory);
        } catch (error) {
            console.error('Error loading legacy table consolidations:', error);
            setLegacyInventory(null);
            setLegacyInventoryError(extractApiError(
                error,
                'No se pudo cargar el inventario de consolidaciones históricas.',
            ));
        } finally {
            setLoadingLegacyInventory(false);
        }
    }, [branchFilter, canConsolidate]);

    const openLegacyReview = () => {
        if (!canConsolidate) return;
        setIsLegacyReviewOpen(true);
        setLegacyReviewActionError(null);
        void loadLegacyInventory();
    };

    const markLegacyConsolidation = async (
        candidate: LegacyTableConsolidationCandidate,
        note: string,
    ): Promise<boolean> => {
        if (
            !canConsolidate
            || candidate.reversible !== false
            || candidate.currentEvidenceReviewed
        ) return false;
        const outcome = candidate.classification === 'NOT_REVERSIBLE'
            ? 'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL' as const
            : 'EXTERNAL_EVIDENCE_REQUIRED' as const;
        const fingerprint = [
            'review-legacy-table-consolidation',
            candidate.candidateKey,
            candidate.evidenceHash,
            outcome,
            note,
        ].join(':');
        const attempt = getIdempotentAttempt(legacyReviewAttemptRef.current, fingerprint);
        legacyReviewAttemptRef.current = attempt;
        setLegacyReviewActionError(null);
        setMarkingLegacyCandidateKey(candidate.candidateKey);
        try {
            const response = await tablesAPI.markLegacyConsolidation(candidate.candidateKey, {
                expectedEvidenceHash: candidate.evidenceHash,
                resolutionKey: attempt.key,
                outcome,
                note,
            });
            legacyReviewAttemptRef.current = null;
            showSuccess(
                response.data.message
                || 'Revisión histórica registrada sin modificar órdenes ni productos.',
            );
            void loadLegacyInventory();
            return true;
        } catch (error) {
            const message = extractApiError(
                error,
                'No se pudo registrar la revisión histórica.',
            );
            setLegacyReviewActionError(message);
            showError(message);
            return false;
        } finally {
            setMarkingLegacyCandidateKey(null);
        }
    };

    const handleOpenPOS = (table: Table) => {
        if (!canOperatePOS) {
            showWarning('Tu rol puede consultar la mesa, pero no crear ni modificar pedidos.');
            return;
        }
        setPosTarget({ table });
    };

    const handleOpenTakeout = () => {
        if (!canOperatePOS) {
            showWarning('Tu rol no puede crear pedidos.');
            return;
        }
        setPosTarget({ table: null });
    };

    const changeView = (next: TablesView) => {
        setView(next);
        try { localStorage.setItem(TABLES_VIEW_KEY, next); } catch { /* storage unavailable */ }
    };

    const refreshOperationalTable = useCallback(async () => {
        await loadTables();
        await loadFloorPlan();
        if (selectedTable) await loadTableOrders(selectedTable);
    }, [loadFloorPlan, loadTableOrders, loadTables, selectedTable]);

    const handleIssueInvoice = async (order: Order) => {
        if (!canIssueInvoice) {
            showWarning('Tu rol no puede emitir facturas.');
            return;
        }
        // Mobile browsers only allow popups inside the original user gesture.
        // Reserve the window before awaiting fiscal issuance; never issue and
        // then silently lose the printable document to a popup blocker.
        const isFiscalReprint = Boolean(order.invoiceNumber);
        const invoiceWindow = window.open('', '_blank');
        if (!invoiceWindow) {
            showError('No se pudo abrir la factura. Permite ventanas emergentes e inténtalo de nuevo; no se emitió ningún documento.');
            return;
        }
        try {
            invoiceWindow.document.write(
                isFiscalReprint
                    ? renderInvoiceLoadingHtml(order.id)
                    : renderPreInvoiceLoadingHtml(order.id),
            );
            invoiceWindow.document.close();
        } catch (popupError) {
            console.error('Invoice popup could not be prepared:', popupError);
            if (!invoiceWindow.closed) invoiceWindow.close();
            showError('No se pudo preparar la ventana de factura; no se emitió ningún documento.');
            return;
        }

        setBusyOrderId(order.id);
        let invoice: PrintableInvoiceSnapshot;
        try {
            const response = isFiscalReprint
                ? await invoicesAPI.getData(order.id)
                : await invoicesAPI.issuePreInvoice(order.id);
            invoice = response.data?.data as PrintableInvoiceSnapshot;
            const invoiceNumber = invoice?.invoiceNumber;
            if (!invoiceNumber) {
                throw new Error('El documento no devolvió una referencia imprimible.');
            }
        } catch (error) {
            invoiceWindow.close();
            showError(extractApiError(
                error,
                isFiscalReprint
                    ? 'No se pudo recuperar la factura.'
                    : 'No se pudo emitir la prefactura.',
            ));
            setBusyOrderId(null);
            return;
        }

        const invoiceNumber = invoice.invoiceNumber;
        try {
            const invoiceHtml = isFiscalReprint
                ? renderInvoiceHtml(invoice)
                : renderPreInvoiceHtml(invoice);
            invoiceWindow.document.open();
            invoiceWindow.document.write(invoiceHtml);
            invoiceWindow.document.close();
            invoiceWindow.focus();
            window.setTimeout(() => {
                if (!invoiceWindow.closed) invoiceWindow.print();
            }, 250);
        } catch (printError) {
            console.error('Invoice issued but printable snapshot could not be shown:', printError);
            if (!invoiceWindow.closed) invoiceWindow.close();
            showWarning(isFiscalReprint
                ? `La factura ${invoiceNumber} existe, pero no se pudo mostrar para imprimir.`
                : 'La prefactura fue emitida, pero no se pudo mostrar. Usa Reimprimir prefactura.');
        }

        try {
            let nextOrder: Order = isFiscalReprint
                ? {
                    ...order,
                    invoiceNumber,
                    invoicedAt: invoice.date || order.invoicedAt,
                    invoiceFiscalStatus: 'ISSUED',
                }
                : {
                    ...order,
                    preInvoicedAt: invoice.date || order.preInvoicedAt,
                };
            try {
                const refreshed = await ordersAPI.getById(order.id);
                nextOrder = refreshed.data.data as Order;
            } catch (refreshError) {
                console.error('Invoice issued but table order refresh failed:', refreshError);
                notifyError(refreshError, isFiscalReprint
                    ? 'La factura existe, pero el detalle de la orden no pudo actualizarse'
                    : 'La prefactura fue emitida, pero el detalle no pudo actualizarse (recarga antes de cobrar)', { type: 'warning' });
            }
            setTableOrders((current) => current.map((item) => item.id === nextOrder.id ? nextOrder : item));
            await refreshOperationalTable();
            showSuccess(isFiscalReprint
                ? `Factura ${invoiceNumber} lista para reimpresión.`
                : 'Prefactura emitida. La cuenta quedó habilitada para cobrar.');
        } catch (error) {
            console.error('Invoice issued but table refresh failed:', error);
            notifyError(error, isFiscalReprint
                ? `La factura ${invoiceNumber} está disponible, pero la mesa no pudo refrescarse`
                : 'La prefactura fue emitida, pero la mesa no pudo refrescarse (recarga antes de cobrar)', { type: 'warning' });
        } finally {
            setBusyOrderId(null);
        }
    };

    const handleReversePreInvoice = async (order: Order, reason: string): Promise<boolean> => {
        if (!canIssueInvoice) {
            showWarning('Tu rol no puede revertir prefacturas.');
            return false;
        }
        setBusyOrderId(order.id);
        try {
            await invoicesAPI.reversePreInvoice(order.id, reason);
            const refreshed = await ordersAPI.getById(order.id);
            const nextOrder = refreshed.data.data as Order;
            setTableOrders((current) =>
                current.map((item) => item.id === nextOrder.id ? nextOrder : item)
            );
            await refreshOperationalTable();
            showSuccess('Prefactura revertida. Ya puedes agregar productos a la misma cuenta.');
            return true;
        } catch (error) {
            showError(extractApiError(error, 'No se pudo revertir la prefactura.'));
            return false;
        } finally {
            setBusyOrderId(null);
        }
    };

    const openPayment = async (order: Order, mode: 'single' | 'split') => {
        if (!canPay) {
            showWarning('Tu rol no puede procesar pagos.');
            return;
        }
        if (!order.preInvoicedAt && !order.invoiceNumber) {
            showWarning('Primero debes emitir la prefactura de esta orden.');
            return;
        }
        try {
            const response = await cashShiftsAPI.getActiveStatus();
            setCashShiftStatus(response.data.data as CashShiftScope);
        } catch (error) {
            setCashShiftStatus(null);
            notifyError(error, 'No se pudo validar el turno de caja (el efectivo permanecerá bloqueado)', { type: 'warning' });
        }
        setPaymentMode(mode);
        setPaymentOrder(order);
    };

    useEffect(() => {
        initializeWebSocket();
        return subscribeWebSocket((message) => {
            if (!message?.type || ![
                WS_EVENTS.TABLE_STATUS_CHANGED,
                WS_EVENTS.ORDER_UPDATE,
                WS_EVENTS.ORDER_READY,
                WS_EVENTS.ORDER_IN_PREPARATION
            ].includes(message.type)) return;
            void loadTables();
            void loadFloorPlan();
            if (selectedTable) {
                void loadTableOrders(selectedTable);
                void loadActiveConsolidation(selectedTable.id);
            }
        });
    }, [loadActiveConsolidation, loadFloorPlan, loadTableOrders, loadTables, selectedTable]);

    const filteredTables = statusFilter
        ? tables.filter((table) =>
            ['AVAILABLE', 'OCCUPIED', 'PENDING_PAYMENT'].includes(statusFilter)
                ? resolveTablePresentationState(table) === statusFilter
                : table.status === statusFilter
        )
        : tables;

    const handleSaveLayout = async (draft: FloorPlanDraft) => {
        if (!mapBranchId) {
            showWarning('Selecciona una sucursal antes de editar su plano.');
            return;
        }
        setSavingLayout(true);
        try {
            const response = await tablesAPI.updateFloorPlan(
                mapBranchId,
                {
                    expectedVersion: draft.expectedVersion,
                    canvas: { width: draft.canvasWidth, height: draft.canvasHeight },
                    areas: draft.areas.map((area) => ({
                        ...(area.id ? { id: area.id } : { clientKey: area.clientKey }),
                        name: area.name,
                        kind: area.kind,
                        x: area.mapX,
                        y: area.mapY,
                        width: area.mapWidth,
                        height: area.mapHeight,
                        rotation: area.mapRotation,
                        shape: area.mapShape,
                        color: area.color,
                        expectedVersion: area.mapVersion
                    })),
                    deletedAreaIds: draft.deletedAreaIds,
                    tables: draft.tables.map((table) => ({
                        id: table.id,
                        ...(table.floorAreaId ? { areaId: table.floorAreaId } : {}),
                        ...(!table.floorAreaId && table.floorAreaClientKey ? { areaClientKey: table.floorAreaClientKey } : {}),
                        x: table.mapX,
                        y: table.mapY,
                        width: table.mapWidth,
                        height: table.mapHeight,
                        rotation: table.mapRotation,
                        shape: table.mapShape,
                        expectedVersion: table.mapVersion
                    }))
                },
                newIdempotencyKey()
            );
            const savedPlan = response.data.data as TableFloorPlan;
            setFloorPlan(savedPlan);
            setTables(savedPlan.tables);
            showSuccess('Plano guardado. Las posiciones, formas y salones ya quedaron persistidos.');
        } catch (error) {
            showError(extractApiError(error, 'No se pudo guardar el plano de mesas'));
            // Already toasted: keep the global unhandledrejection handler from repeating it.
            markErrorHandled(error);
            throw error;
        } finally {
            setSavingLayout(false);
        }
    };

    const handleTransfer = async (data: {
        sourceTableId: number;
        destinationTableId: number;
        orderId: number;
        items?: Array<{ orderItemId: number; quantity: number }>;
        reason?: string;
    }) => {
        setSubmittingOperation(true);
        try {
            await tablesAPI.transfer(data, newIdempotencyKey());
            setOperation(null);
            setOperationTableId(null);
            await loadTables();
            await loadFloorPlan();
            showSuccess('El consumo fue trasladado a la mesa destino.');
        } catch (error) {
            showError(extractApiError(error, 'No se pudo cambiar la mesa'));
        } finally {
            setSubmittingOperation(false);
        }
    };

    const handleConsolidate = async (data: { destinationTableId: number; sourceTableIds: number[]; reason?: string }) => {
        setSubmittingOperation(true);
        try {
            const response = await tablesAPI.consolidate(data, newIdempotencyKey());
            const consolidatedOrder = response.data.data as Order;
            setOperation(null);
            setOperationTableId(null);
            await loadTables();
            await loadFloorPlan();
            showSuccess(`Las cuentas fueron consolidadas en la mesa principal (orden #${consolidatedOrder.id}). Emite la factura para continuar al cobro.`);
        } catch (error) {
            showError(extractApiError(error, 'No se pudieron consolidar las cuentas'));
        } finally {
            setSubmittingOperation(false);
        }
    };

    const handleReverseConsolidation = async (reason: string): Promise<boolean> => {
        if (!canConsolidate || !activeConsolidation || activeConsolidation.status !== 'ACTIVE') {
            showWarning('No existe una consolidación activa y autorizada para revertir.');
            return false;
        }

        const fingerprint = [
            'reverse-table-consolidation',
            activeConsolidation.id,
            activeConsolidation.version,
            reason.trim(),
        ].join(':');
        const attempt = getIdempotentAttempt(reversalAttemptRef.current, fingerprint);
        reversalAttemptRef.current = attempt;
        setConsolidationReversalError(null);
        setReversingConsolidation(true);

        try {
            await tablesAPI.reverseConsolidation(activeConsolidation.id, {
                expectedVersion: activeConsolidation.version,
                reversalKey: attempt.key,
                reason: reason.trim(),
            });
            reversalAttemptRef.current = null;

            const selected = selectedTable;
            await Promise.all([
                loadTables(),
                loadFloorPlan(),
                selected ? loadTableOrders(selected) : Promise.resolve(),
                selected ? loadActiveConsolidation(selected.id) : Promise.resolve(null),
            ]);
            setConsolidationReversalError(null);
            showSuccess('Consolidación revertida. Las cuentas regresaron a sus mesas originales.');
            return true;
        } catch (error) {
            const message = extractApiError(
                error,
                'No se pudo revertir la consolidación. Verifica que no existan pagos, factura, entrega, cambios u otra ocupación.',
            );
            setConsolidationReversalError(message);
            showError(message);
            if (selectedTable) await loadActiveConsolidation(selectedTable.id);
            return false;
        } finally {
            setReversingConsolidation(false);
        }
    };

    const handleSaveGroup = async (data: TableGroupFormData) => {
        setSubmittingGroup(true);
        try {
            if (data.mode === 'EDIT') {
                await tablesAPI.updateGroup(data.groupId, {
                    primaryTableId: data.primaryTableId,
                    expectedPrimaryTableId: data.expectedPrimaryTableId,
                    memberTableIds: data.memberTableIds,
                    expectedMemberTableIds: data.expectedMemberTableIds,
                    reason: data.reason
                }, newIdempotencyKey());
            } else {
                await tablesAPI.createGroup({
                    primaryTableId: data.primaryTableId,
                    memberTableIds: data.memberTableIds,
                    reason: data.reason
                }, newIdempotencyKey());
            }
            setGroupTableId(null);
            await loadTables();
            await loadFloorPlan();
            const tableCount = data.mode === 'EDIT' ? data.memberTableIds.length : data.memberTableIds.length + 1;
            showSuccess(data.mode === 'EDIT'
                ? `Grupo actualizado: permanecen ${tableCount} mesas. Las cuentas conservaron su mesa.`
                : `Se unieron ${tableCount} mesas. Cada silla sigue representando un comensal.`);
        } catch (error) {
            showError(extractApiError(error, data.mode === 'EDIT' ? 'No se pudo actualizar el grupo de mesas' : 'No se pudieron unir las mesas'));
        } finally {
            setSubmittingGroup(false);
        }
    };

    const handleCloseGroup = async (table: Table) => {
        const group = table.activeTableGroup;
        if (!group) return;
        const accepted = await confirm(
            'Las mesas se separarán físicamente. Las cuentas y productos no se moverán; cada cuenta permanecerá en su mesa actual.',
            { title: 'Separar mesas' }
        );
        if (!accepted) return;
        setSubmittingGroup(true);
        try {
            await tablesAPI.closeGroup(group.id, { reason: 'Separación manual desde el mapa operativo' }, newIdempotencyKey());
            await loadTables();
            await loadFloorPlan();
            showSuccess('Las mesas se separaron. Las que conservan una orden siguen ocupadas.');
        } catch (error) {
            showError(extractApiError(error, 'No se pudieron separar las mesas'));
        } finally {
            setSubmittingGroup(false);
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'AVAILABLE': return 'Disponible';
            case 'OCCUPIED': return 'Ocupada';
            case 'RESERVED': return 'Reservada';
            default: return 'Fuera de servicio';
        }
    };

    const getStatusTone = (status: string): Tone => {
        switch (status) {
            case 'AVAILABLE': return 'success';
            case 'OCCUPIED': return 'warning';
            case 'RESERVED': return 'primary';
            default: return 'neutral';
        }
    };

    const setField = (patch: Partial<typeof formData>) => {
        setFormData((current) => ({ ...current, ...patch }));
        setFormDirty(true);
    };

    const branchOptions: Opt<number>[] = branches.map((b) => ({ value: b.id, label: b.name }));
    const statusSegments: { value: string; label: string }[] = [
        { value: 'ALL', label: 'Todas' },
        { value: 'AVAILABLE', label: 'Disponibles' },
        { value: 'OCCUPIED', label: 'Ocupadas' },
        { value: 'RESERVED', label: 'Reservadas' },
    ];
    const operationalStatusOptions: Opt<Table['status']>[] = [
        { value: 'AVAILABLE', label: 'Disponible' },
        { value: 'RESERVED', label: 'Reservada' },
        { value: 'OUT_OF_SERVICE', label: 'Fuera de servicio' },
    ];

    const tableColumns: Column<Table>[] = [
        { key: 'number', header: 'Mesa', width: '8rem', render: (table) => `Mesa ${table.number}` },
        ...(canChooseBranch ? [{ key: 'branch', header: 'Sucursal', width: '1fr', render: (table: Table) => table.branch?.name || '-' }] : []),
        { key: 'capacity', header: 'Sillas / comensales', width: '12rem', type: 'number' as const, decimals: 0, accessor: (table) => table.capacity, render: (table) => `${table.capacity} ${table.capacity === 1 ? 'silla' : 'sillas'} / ${table.capacity} ${table.capacity === 1 ? 'comensal' : 'comensales'}` },
        { key: 'location', header: 'Ubicación', width: '1fr', hideBelow: 'md' as const, render: (table) => table.location || '-' },
        { key: 'status', header: 'Estado', width: '10rem', type: 'status' as const, render: (table) => <Badge tone={getStatusTone(table.status)} dot>{getStatusText(table.status)}</Badge> },
        {
            key: 'actions',
            header: 'Acciones',
            width: '136px',
            type: 'actions' as const,
            render: (table) => (
                <>
                    <IconButton size="sm" icon={Eye} tooltip="Ver detalle" label={`Ver órdenes de la mesa ${table.number}`} onClick={() => void handleViewOrders(table)} />
                    {canEditTable && <IconButton size="sm" icon={Pencil} tooltip="Editar" label={`Editar mesa ${table.number}`} onClick={() => handleOpenSidebar(table)} />}
                    {canDeleteTable && <IconButton size="sm" icon={Trash2} tone="danger" tooltip="Eliminar" label={`Eliminar mesa ${table.number}`} onClick={() => void handleDelete(table.id)} />}
                </>
            ),
        },
    ];

    const mapBranchForMeta = mapBranchId;
    useEffect(() => {
        let cancelled = false;
        const loadOpenOrders = async () => {
            try {
                const res = await ordersAPI.getActive(mapBranchForMeta, true);
                if (cancelled) return;
                setOpenOrders((res.data.data ?? []) as Order[]);
                setOpenOrdersFailed(false);
            } catch {
                if (!cancelled) setOpenOrdersFailed(true);
            }
            if (!cancelled) setMetaNow(Date.now());
        };
        void loadOpenOrders();
        const timer = window.setInterval(() => { void loadOpenOrders(); }, 60000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [mapBranchForMeta]);

    const tableMeta = useMemo(() => {
        if (!openOrders) return undefined;
        const minutes = openMinutesByTable(openOrders, metaNow);
        const amounts = openAmountByTable(openOrders);
        const meta = new Map<number, { minutes: number; amount: number | null }>();
        for (const order of openTableOrders(openOrders)) {
            if (order.tableId == null) continue;
            meta.set(order.tableId, { minutes: minutes.get(order.tableId) ?? 0, amount: amounts.get(order.tableId) ?? null });
        }
        return meta;
    }, [openOrders, metaNow]);

    if (loading) return <div className="tables-loading">Cargando...</div>;

    const areaNames = new Map((floorPlan?.areas ?? []).map((area) => [area.id, area.name]));
    const zoneOf = (table: Table) => (table.floorAreaId != null ? areaNames.get(table.floorAreaId) : undefined)
        || table.location?.trim()
        || 'Salón';
    const scopedTables = mapBranchId ? tables.filter((table) => table.branchId === mapBranchId) : tables;
    const zones = Array.from(new Set(scopedTables.map(zoneOf))).sort((a, b) => a.localeCompare(b, 'es'));
    const activeZone = zoneFilter !== 'ALL' && zones.includes(zoneFilter) ? zoneFilter : 'ALL';
    const tileTables = scopedTables
        .filter((table) => activeZone === 'ALL' || zoneOf(table) === activeZone)
        .sort((a, b) => a.number.localeCompare(b.number, 'es', { numeric: true }));
    const liveSelectedTable = selectedTable
        ? tables.find((table) => table.id === selectedTable.id) ?? selectedTable
        : null;
    const selectedMeta = liveSelectedTable ? tableMeta?.get(liveSelectedTable.id) : undefined;
    const viewOptions: { value: TablesView; label: string }[] = [
        { value: 'tiles', label: 'Mesas' },
        { value: 'plan', label: 'Plano' },
        ...(canCreateTable || canEditTable || canDeleteTable ? [{ value: 'list' as const, label: 'Lista' }] : []),
    ];

    const branchControl = canChooseBranch && branches.length > 1 ? (
        <div className="table-map-branch-control">
            <AppSelect<number>
                aria-label="Sucursal"
                placeholder="Sucursal"
                options={branchOptions}
                value={branchFilter}
                onChange={setBranchFilter}
                isClearable={false}
            />
        </div>
    ) : !canChooseBranch ? (
        <div className="table-map-fixed-branch" aria-label={`Sucursal activa: ${mapBranchName}`}>
            <MapPin size={16} aria-hidden="true" />
            <span><small>Sucursal activa</small><strong>{mapBranchName}</strong></span>
        </div>
    ) : null;

    const renderTile = (table: Table) => {
        const state = tableTileState(table);
        const meta = tableMeta?.get(table.id);
        const busy = meta !== undefined;
        const selected = liveSelectedTable?.id === table.id;
        const slow = (meta?.minutes ?? 0) > 90;
        const timeLabel = busy
            ? `${formatNumber(meta.minutes, 0)} min`
            : state.key === 'RESERVED' ? 'Reservada' : '—';
        return (
            <button
                key={table.id}
                type="button"
                className="tables-tile"
                data-state={state.key}
                aria-pressed={selected}
                aria-label={`Mesa ${table.number}, ${state.label}`}
                onClick={() => void handleViewOrders(table)}
            >
                <span className="tables-tile__top">
                    <strong className="tables-tile__id" title={String(table.number)}>{table.number}</strong>
                    <span className="tables-tile__seats">{formatNumber(table.capacity, 0)} pax</span>
                </span>
                <span className="tables-tile__state"><span aria-hidden="true" />{state.label}</span>
                {table.activeTableGroup && (
                    <span className="tables-tile__group">
                        <Link2 size={12} aria-hidden="true" />
                        {table.activeTableGroup.primaryTableId === table.id ? 'Principal del grupo' : `Unida a ${table.activeTableGroup.primaryTable.number}`}
                    </span>
                )}
                <span className="tables-tile__spacer" />
                <span className="tables-tile__foot">
                    <span className={slow ? 'is-slow' : undefined}>{timeLabel}</span>
                    <span className="tables-tile__amount">
                        {busy ? (meta.amount === null ? 'N/D' : formatMoney(meta.amount, currencySymbol)) : ''}
                    </span>
                </span>
            </button>
        );
    };

    return (
        <div className={`tables-page ${showMap ? (view === 'plan' ? 'tables-page--map' : 'tables-page--ops') : 'tables-page--list'}`}>
            {!showMap && (
                <PageContent>
                    <PageHeader
                        title="Gestión de mesas"
                        description="Alta, edición y estado administrativo de las mesas"
                        actions={(
                            <>
                                <SegmentedControl<TablesView> ariaLabel="Vista de mesas" options={viewOptions} value={view} onChange={changeView} />
                                {canConsolidate && (
                                    <Button icon={History} onClick={openLegacyReview}>Históricos</Button>
                                )}
                                {canCreateTable && (
                                    <Button variant="primary" icon={Plus} onClick={() => handleOpenSidebar()}>Nueva mesa</Button>
                                )}
                            </>
                        )}
                    />

                    <div className="tables-filters-row">
                        <SegmentedControl
                            ariaLabel="Estado de la mesa"
                            options={statusSegments}
                            value={statusFilter ?? 'ALL'}
                            onChange={(value) => setStatusFilter(value === 'ALL' ? null : value)}
                        />
                        {canChooseBranch && branches.length > 1 && (
                            <div className="tables-branch-filter">
                                <AppSelect<number>
                                    aria-label="Filtrar por sucursal"
                                    placeholder="Todas las sucursales"
                                    options={branchOptions}
                                    value={branchFilter}
                                    onChange={setBranchFilter}
                                />
                            </div>
                        )}
                    </div>

                    <DataTable
                        ariaLabel="Mesas"
                        columns={tableColumns}
                        rows={filteredTables}
                        rowKey={(table) => table.id}
                        resetKey={`${statusFilter}-${branchFilter}`}
                        empty={(
                            <EmptyState
                                icon={Grid3x3}
                                title={`No hay mesas ${statusFilter ? 'con este estado' : 'registradas'}`}
                                action={(
                                    <Button
                                        onClick={() => (statusFilter ? setStatusFilter(null) : handleOpenSidebar())}
                                        disabled={!statusFilter && !canCreateTable}
                                    >
                                        {statusFilter ? 'Ver todas' : 'Crear primera mesa'}
                                    </Button>
                                )}
                            />
                        )}
                    />
                </PageContent>
            )}

            {showMap && (
                <div className="tables-ops">
                    <header className="tables-ops__header">
                        <div className="tables-ops__title">
                            <h1>Mesas</h1>
                            <p>{mapBranchName}{activeZone !== 'ALL' ? ` · ${activeZone}` : ''}</p>
                        </div>
                        {view === 'tiles' && zones.length > 1 && (
                            <SegmentedControl
                                ariaLabel="Zona"
                                options={[{ value: 'ALL', label: 'Todas' }, ...zones.map((zone) => ({ value: zone, label: zone }))]}
                                value={activeZone}
                                onChange={setZoneFilter}
                            />
                        )}
                        <SegmentedControl<TablesView> ariaLabel="Vista de mesas" options={viewOptions} value={view} onChange={changeView} />
                        {branchControl}
                        <div className="table-map-utility-controls">
                            {canConsolidate && (
                                <Button icon={History} onClick={openLegacyReview}>Históricos</Button>
                            )}
                            <KitchenNotificationBell inline />
                        </div>
                        {canOperatePOS && (
                            <Button variant="primary" icon={ShoppingBag} onClick={handleOpenTakeout}>Orden para llevar</Button>
                        )}
                    </header>

                    {view !== 'plan' && <SalonCards branchId={mapBranchId} tables={tables} onReviewOrders={() => navigate('/orders')} />}

                    <div className="tables-ops__body">
                        <section className="tables-ops__floor" aria-label="Plano de mesas">
                            {!mapBranchId ? (
                                <div className="table-map-branch-required">
                                    <MapPinned size={24} />
                                    Selecciona una sucursal para visualizar y operar sus mesas.
                                </div>
                            ) : view === 'tiles' ? (
                                <>
                                    <ul className="tables-legend" aria-label="Estados de mesa">
                                        {TABLE_TILE_LEGEND.map((state) => (
                                            <li key={state.key} data-state={state.key}><span aria-hidden="true" />{state.label}</li>
                                        ))}
                                    </ul>
                                    {openOrdersFailed && !openOrders && (
                                        <p className="tables-meta-warning" role="status">Tiempo y consumo por mesa no disponibles (N/D): no se pudieron cargar las órdenes activas.</p>
                                    )}
                                    {tileTables.length === 0 ? (
                                        <EmptyState
                                            icon={Grid3x3}
                                            title="No hay mesas en esta zona"
                                            action={canCreateTable ? <Button onClick={() => handleOpenSidebar()}>Crear mesa</Button> : undefined}
                                        />
                                    ) : (
                                        <div className="tables-tiles">
                                            {tileTables.map(renderTile)}
                                        </div>
                                    )}
                                </>
                            ) : floorPlan ? (
                                <TableMap
                                    plan={floorPlan}
                                    statusFilter={statusFilter}
                                    tableMeta={tableMeta}
                                    tableMetaUnavailable={openOrdersFailed && !openOrders}
                                    currencySymbol={currencySymbol}
                                    onStatusFilterChange={setStatusFilter}
                                    canEdit={canEditMap}
                                    saving={savingLayout}
                                    onSelect={handleViewOrders}
                                    onSave={handleSaveLayout}
                                    onCreateTable={canCreateTable ? () => handleOpenSidebar() : undefined}
                                    branchControl={undefined}
                                />
                            ) : (
                                <p className="tables-meta-warning" role="status">Cargando plano…</p>
                            )}
                        </section>

                        <div ref={detailPanelRef} className={`tables-ops__detail ${view === 'plan' && !liveSelectedTable ? 'is-idle' : ''}`}>
                            <TableDetailPanel
                                table={liveSelectedTable}
                                orders={tableOrders}
                                zoneLabel={liveSelectedTable ? zoneOf(liveSelectedTable) : undefined}
                                openMinutes={selectedMeta?.minutes ?? null}
                                onClose={() => setSelectedTable(null)}
                                loading={loadingTableOrders}
                                busyOrderId={busyOrderId}
                                canIssueInvoice={canIssueInvoice}
                                canPay={canPay}
                                canOperatePOS={canOperatePOS}
                                canTransfer={canTransfer}
                                canConsolidate={canConsolidate}
                                canGroup={canGroup}
                                canVoidLines={canVoidLines}
                                onVoidLine={(order, itemId) => setVoidLineTarget({ order, itemId })}
                                activeConsolidation={activeConsolidation}
                                loadingConsolidation={loadingConsolidation}
                                consolidationLookupError={consolidationLookupError}
                                consolidationReversalError={consolidationReversalError}
                                reversingConsolidation={reversingConsolidation}
                                groupTotalCapacity={liveSelectedTable?.activeTableGroup
                                    ? tables.filter((table) => table.activeTableGroupId === liveSelectedTable.activeTableGroupId).reduce((sum, table) => sum + table.capacity, 0)
                                    : undefined}
                                onOpenPOS={handleOpenPOS}
                                onIssueInvoice={(order) => void handleIssueInvoice(order)}
                                onReversePreInvoice={handleReversePreInvoice}
                                onPay={(order) => void openPayment(order, 'single')}
                                onSplit={(order) => void openPayment(order, 'split')}
                                onTransfer={(table) => {
                                    setOperationTableId(table.id);
                                    setOperation('TRANSFER');
                                }}
                                onConsolidate={(table) => {
                                    setOperationTableId(table.id);
                                    setOperation('CONSOLIDATE');
                                }}
                                onGroup={(table) => setGroupTableId(table.id)}
                                onEditGroup={(table) => setGroupTableId(table.id)}
                                onUngroup={(table) => void handleCloseGroup(table)}
                                onRetryConsolidationLookup={() => {
                                    setConsolidationReversalError(null);
                                    if (selectedTable) void loadActiveConsolidation(selectedTable.id);
                                }}
                                onReverseConsolidation={handleReverseConsolidation}
                                extraActions={liveSelectedTable && canEditTable ? (
                                    <Button variant="ghost" icon={Pencil} onClick={() => handleOpenSidebar(liveSelectedTable)}>Editar mesa</Button>
                                ) : undefined}
                            />
                        </div>
                    </div>
                </div>
            )}

            <FullScreenModal
                isOpen={isLegacyReviewOpen}
                onClose={() => setIsLegacyReviewOpen(false)}
                title="Consolidaciones históricas"
                subtitle="Inventario de operaciones anteriores al registro transaccional reversible."
            >
                <LegacyConsolidationReview
                    inventory={legacyInventory}
                    loading={loadingLegacyInventory}
                    error={legacyInventoryError}
                    actionError={legacyReviewActionError}
                    markingCandidateKey={markingLegacyCandidateKey}
                    onRetry={() => void loadLegacyInventory()}
                    onMark={markLegacyConsolidation}
                />
            </FullScreenModal>
            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingTable ? 'Editar mesa' : 'Nueva mesa'}
                dirty={formDirty}
                tabs={[{ id: 'general', label: 'General' }, { id: 'ubicacion', label: 'Ubicación' }]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as 'general' | 'ubicacion')}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="secondary" onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="table-form" variant="primary">
                            {editingTable ? 'Actualizar mesa' : 'Guardar mesa'}
                        </Button>
                    </>
                )}
            >
                <form id="table-form" onSubmit={handleSubmit}>
                    {activeTab === 'general' && (
                        <FormSection title="Información de la mesa">
                            <FormGrid>
                                {editingTable ? (
                                    <Field label="Sucursal" htmlFor="table-branch-static">
                                        <Input id="table-branch-static" readOnly value={editingTable.branch?.name || `Sucursal #${editingTable.branchId}`} />
                                    </Field>
                                ) : canChooseBranch && (
                                    <Field label="Sucursal" htmlFor="table-branch" required>
                                        <AppSelect<number>
                                            inputId="table-branch"
                                            placeholder="Selecciona la sucursal..."
                                            options={branchOptions}
                                            value={formData.branchId ? Number(formData.branchId) : null}
                                            onChange={(value) => setField({ branchId: value ? String(value) : '' })}
                                        />
                                    </Field>
                                )}
                                <Field label="Número/Nombre" htmlFor="table-number" required>
                                    <Input
                                        id="table-number"
                                        value={formData.number}
                                        onChange={(e) => setField({ number: e.target.value })}
                                        required
                                        placeholder="Ej: 01, A2..."
                                    />
                                </Field>
                                <Field label="Sillas / comensales (relación 1:1)" htmlFor="table-capacity" hint="Cada silla representa un comensal y aparecerá automáticamente en el plano." required>
                                    <NumberInput
                                        id="table-capacity"
                                        decimals={0}
                                        min={1}
                                        value={formData.capacity === '' ? null : Number(formData.capacity)}
                                        onChange={(value) => setField({ capacity: value === null ? '' : String(value) })}
                                    />
                                </Field>
                            </FormGrid>
                        </FormSection>
                    )}

                    {activeTab === 'ubicacion' && (
                        <FormSection title="Localización y estado">
                            <FormGrid>
                                <Field label="Área / Ubicación" htmlFor="table-location">
                                    <Input
                                        id="table-location"
                                        value={formData.location}
                                        onChange={(e) => setField({ location: e.target.value })}
                                        placeholder="Ej: Terraza, Salón Principal, VIP..."
                                    />
                                </Field>
                                {editingTable && (
                                    <Field label="Estado operativo" htmlFor="table-status">
                                        <AppSelect<Table['status']>
                                            inputId="table-status"
                                            options={operationalStatusOptions}
                                            value={formData.status}
                                            onChange={(value) => value && setField({ status: value })}
                                            isDisabled={editingTable.status === 'OCCUPIED'}
                                            isClearable={false}
                                        />
                                    </Field>
                                )}
                            </FormGrid>
                        </FormSection>
                    )}
                </form>
            </FullScreenModal>

            <KitchenLineVoidModal
                isOpen={voidLineTarget !== null}
                order={voidLineTarget?.order ?? null}
                initialItemId={voidLineTarget?.itemId ?? null}
                onClose={() => setVoidLineTarget(null)}
                onVoided={() => {
                    if (selectedTable) void loadTableOrders(selectedTable);
                    void loadTables();
                }}
            />

            {paymentOrder && (
                <PaymentModal
                    isOpen
                    onClose={() => setPaymentOrder(null)}
                    orderId={paymentOrder.id}
                    orderTotal={Number(paymentOrder.total)}
                    order={paymentOrder}
                    currencySymbol={currencySymbol}
                    initialMode={paymentMode}
                    hasUsableCashShift={hasUsableCashShift(cashShiftStatus, paymentOrder.branchId)}
                    onPaymentSuccess={(result) => {
                        setPaymentOrder(null);
                        void refreshOperationalTable();
                        if (result?.fiscalInvoiceError) {
                            showWarning(`El pago fue confirmado, pero la factura fiscal debe reintentarse: ${result.fiscalInvoiceError}`);
                        } else if (result?.fiscalInvoice && !result.invoicePrinted) {
                            showWarning('El pago y la factura fiscal fueron confirmados. Usa Reimprimir factura porque el navegador bloqueó la ventana de impresión.');
                        } else if (result?.fiscalInvoice) {
                            showSuccess(`Pago confirmado y factura ${result.fiscalInvoice.invoiceNumber} emitida.`);
                        }
                    }}
                />
            )}
            <TableOperationModal
                isOpen={operation !== null}
                operation={operation ?? 'TRANSFER'}
                tables={mapBranchId ? tables.filter((table) => table.branchId === mapBranchId) : tables}
                initialTableId={operationTableId}
                submitting={submittingOperation}
                onClose={() => { setOperation(null); setOperationTableId(null); }}
                onTransfer={handleTransfer}
                onConsolidate={handleConsolidate}
            />
            <TableGroupModal
                isOpen={groupTableId !== null}
                tables={mapBranchId ? tables.filter((table) => table.branchId === mapBranchId) : tables}
                initialTableId={groupTableId}
                submitting={submittingGroup}
                onClose={() => setGroupTableId(null)}
                onSubmit={handleSaveGroup}
            />
            {posTarget && (
                <div
                    className="table-pos-workspace"
                    role="dialog"
                    aria-modal="true"
                    aria-label={posTarget.table ? `Pedido de mesa ${posTarget.table.number}` : 'Orden para llevar'}
                >
                    <POS
                        key={posTarget.table?.id ?? 'takeout'}
                        initialTableId={posTarget.table?.id}
                        initialOrderType={posTarget.table ? undefined : 'TAKEOUT'}
                        branchId={mapBranchId}
                        embedded
                        onExit={() => setPosTarget(null)}
                        onOperationalChange={refreshOperationalTable}
                    />
                </div>
            )}
        </div>
    );
}
