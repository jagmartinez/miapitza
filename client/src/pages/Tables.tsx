import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { tablesAPI, ordersAPI, branchesAPI, invoicesAPI, cashShiftsAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import TableOrdersModal from '../components/TableOrdersModal';
import LegacyConsolidationReview from '../components/LegacyConsolidationReview';
import PaymentModal from '../components/PaymentModal';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { canCreatePayment } from '../utils/authz';
import { getTableAccess } from '../utils/tableAccess';
import { Armchair, Grid3x3, Plus, Edit2, Trash2, Eye, Users, MapPin, Building2, MapPinned, History } from 'lucide-react';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import type {
    ActiveTableConsolidation,
    LegacyTableConsolidationCandidate,
    LegacyTableConsolidationInventory,
    Table,
    Order,
    Branch,
    TableFloorPlan,
} from '../types';
import type { SingleValue } from 'react-select';
import Select from '../components/Select';
import { ACTIVE_ORDER_STATUSES } from '../utils/orderStatus';
import './Tables.css';
import TableMap, { type FloorPlanDraft } from '../components/TableMap';
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
import ThemeToggle from '../components/ThemeToggle';
import KitchenNotificationBell from '../components/KitchenNotificationBell';
import { buildInvoiceStatusMessage, isEligibleForPosOrderBucket } from '../utils/posOrderBucket';
import { useNavigate } from 'react-router-dom';

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

    // Orders Modal State
    const [isOrdersModalOpen, setIsOrdersModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [tableOrders, setTableOrders] = useState<Order[]>([]);
    const [loadingTableOrders, setLoadingTableOrders] = useState(false);
    const tableOrderRequestRef = useRef(0);
    const consolidationLookupRequestRef = useRef(0);
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
    const { viewMode, setViewMode } = useViewMode('tables');
    const [showMap, setShowMap] = useState(true);
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
    const [posTable, setPosTable] = useState<Table | null>(null);
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
        setLoading(true);
        try {
            const response = await tablesAPI.getAll(branchFilter ?? undefined);
            setTables(response.data.data);
        } catch (error) {
            console.error('Error loading tables:', error);
            setTables([]);
            showError(extractApiError(error, 'No se pudieron cargar las mesas. No se mostrará un salón vacío como si fuera real.'));
        } finally {
            setLoading(false);
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
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
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

        try {
            if (editingTable) {
                // La sucursal de una mesa no se reasigna desde la edición.
                await tablesAPI.update(editingTable.id, {
                    number: formData.number,
                    capacity: parseInt(formData.capacity),
                    location: formData.location,
                    status: formData.status
                });
            } else {
                await tablesAPI.create({
                    number: formData.number,
                    capacity: parseInt(formData.capacity),
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
            const active = response.data.data.filter((o: Order) =>
                isEligibleForPosOrderBucket(o)
                && (
                    ACTIVE_ORDER_STATUSES.includes(o.status)
                    || (o.status === 'DELIVERED' && o.financialStatus !== 'PAID')
                )
            );
            if (requestId === tableOrderRequestRef.current) setTableOrders(active);
        } catch (error) {
            console.error('Error loading table orders:', error);
            if (requestId === tableOrderRequestRef.current) {
                setTableOrders([]);
                showError('No se pudieron cargar las órdenes de esta mesa.');
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
        setIsOrdersModalOpen(true);
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
        setIsOrdersModalOpen(false);
        setPosTable(table);
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
        setBusyOrderId(order.id);
        try {
            const response = await invoicesAPI.issue(order.id);
            const invoiceNumber = response.data?.data?.invoiceNumber as string | undefined;
            if (!invoiceNumber) {
                throw new Error('La factura no devolvió un número fiscal.');
            }
            let nextOrder: Order = {
                ...order,
                invoiceNumber,
                invoicedAt: response.data?.data?.issuedAt || order.invoicedAt,
                invoiceFiscalStatus: 'ISSUED',
            };
            try {
                const refreshed = await ordersAPI.getById(order.id);
                nextOrder = refreshed.data.data as Order;
            } catch (refreshError) {
                console.error('Invoice issued but table order refresh failed:', refreshError);
                showWarning('La factura fue emitida, pero el detalle de la orden no pudo actualizarse. Recarga si necesitas revisarlo.');
            }
            setTableOrders((current) => current.map((item) => item.id === nextOrder.id ? nextOrder : item));
            await refreshOperationalTable();
            showSuccess(buildInvoiceStatusMessage({
                invoiceNumber,
                orderId: nextOrder.id,
                tableNumber: nextOrder.table?.number ?? order.table?.number,
                financialStatus: nextOrder.financialStatus,
            }));
        } catch (error) {
            showError(extractApiError(error, 'No se pudo emitir la factura.'));
        } finally {
            setBusyOrderId(null);
        }
    };

    const openPayment = async (order: Order, mode: 'single' | 'split') => {
        if (!canPay) {
            showWarning('Tu rol no puede procesar pagos.');
            return;
        }
        if (!order.invoiceNumber) {
            showWarning('Primero debes emitir la factura de esta orden.');
            return;
        }
        try {
            const response = await cashShiftsAPI.getActiveStatus();
            setCashShiftStatus(response.data.data as CashShiftScope);
        } catch {
            setCashShiftStatus(null);
            showWarning('No se pudo validar el turno de caja; el efectivo permanecerá bloqueado.');
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
        ? tables.filter(t => t.status === statusFilter)
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
        setIsOrdersModalOpen(false);
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

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'AVAILABLE': return 'available';
            case 'OCCUPIED': return 'occupied';
            case 'RESERVED': return 'reserved';
            default: return 'unavailable';
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'AVAILABLE': return 'Disponible';
            case 'OCCUPIED': return 'Ocupada';
            case 'RESERVED': return 'Reservada';
            default: return 'Fuera de Servicio';
        }
    };

    if (loading) return <div className="tables-loading">Cargando...</div>;

    return (
        <div className={`tables-page ${showMap ? 'tables-page--map' : 'tables-page--list'}`}>
            {!showMap && <PageHeader
                title="Gestión de Mesas"
                icon={Grid3x3}
                actions={(
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <ThemeToggle />
                        {canConsolidate && (
                            <button
                                type="button"
                                className="tables-map-toggle"
                                onClick={openLegacyReview}
                            >
                                <History size={18} /> Históricos
                            </button>
                        )}
                        <button
                            type="button"
                            className="tables-map-toggle"
                            onClick={() => setShowMap(true)}
                        >
                            <MapPinned size={18} /> Plano
                        </button>
                        <ViewToggle value={viewMode} onChange={setViewMode} />
                        {canCreateTable && (
                            <Button onClick={() => handleOpenSidebar()}>
                                <Plus size={20} />
                                Nueva Mesa
                            </Button>
                        )}
                    </div>
                )}
            />}

            {/* Filters Row */}
            {!showMap && <div className="tables-filters-row">
                <div className="table-status-filters">
                    <button
                        className={`table-status-btn ${statusFilter === null ? 'active' : ''}`}
                        onClick={() => setStatusFilter(null)}
                    >
                        Todas
                    </button>
                    <button
                        className={`table-status-btn available ${statusFilter === 'AVAILABLE' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('AVAILABLE')}
                    >
                        Disponibles
                    </button>
                    <button
                        className={`table-status-btn occupied ${statusFilter === 'OCCUPIED' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('OCCUPIED')}
                    >
                        Ocupadas
                    </button>
                    <button
                        className={`table-status-btn reserved ${statusFilter === 'RESERVED' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('RESERVED')}
                    >
                        Reservadas
                    </button>
                </div>

                {canChooseBranch && branches.length > 1 && (
                    <div className="tables-branch-filter">
                        <Select
                            placeholder="Todas las sucursales"
                            options={[
                                { value: 'all', label: 'Todas las sucursales' },
                                ...branches.map((b) => ({ value: b.id.toString(), label: b.name }))
                            ]}
                            value={
                                branchFilter
                                    ? { value: branchFilter.toString(), label: branches.find((b) => b.id === branchFilter)?.name || 'Sucursal' }
                                    : { value: 'all', label: 'Todas las sucursales' }
                            }
                            onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                setBranchFilter(option && option.value !== 'all' ? parseInt(option.value) : null)}
                            isSearchable={branches.length > 6}
                        />
                    </div>
                )}
            </div>}

            {showMap && !mapBranchId && (
                <div className="table-map-branch-required">
                    <MapPinned size={24} />
                    Selecciona una sucursal para visualizar y editar su plano.
                </div>
            )}

            {showMap && mapBranchId && floorPlan && (
                <TableMap
                    plan={floorPlan}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    canEdit={canEditMap}
                    saving={savingLayout}
                    onSelect={handleViewOrders}
                    onSave={handleSaveLayout}
                    onCreateTable={canCreateTable ? () => handleOpenSidebar() : undefined}
                    onReturnToAdministration={canEditMap ? () => navigate('/dashboard') : undefined}
                    themeControl={(
                        <div className="table-map-utility-controls">
                            {canConsolidate && (
                                <button type="button" onClick={openLegacyReview}>
                                    <History size={18} /> Históricos
                                </button>
                            )}
                            <KitchenNotificationBell inline />
                        </div>
                    )}
                    branchControl={canChooseBranch && branches.length > 1 ? (
                        <div className="table-map-branch-control">
                            <Select
                                placeholder="Sucursal"
                                options={branches.map((branch) => ({ value: branch.id.toString(), label: branch.name }))}
                                value={branchFilter ? {
                                    value: branchFilter.toString(),
                                    label: branches.find((branch) => branch.id === branchFilter)?.name || 'Sucursal'
                                } : null}
                                onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                    setBranchFilter(option ? Number(option.value) : null)}
                                isSearchable={branches.length > 6}
                            />
                        </div>
                    ) : !canChooseBranch ? (
                        <div className="table-map-fixed-branch" aria-label={`Sucursal activa: ${mapBranchName}`}>
                            <MapPin size={16} aria-hidden="true" />
                            <span><small>Sucursal activa</small><strong>{mapBranchName}</strong></span>
                        </div>
                    ) : undefined}
                />
            )}

            {!showMap && viewMode === 'table' && filteredTables.length > 0 && (
                <CatalogTable<Table>
                    rows={filteredTables}
                    rowKey={(table) => table.id}
                    resetKey={`${statusFilter}-${branchFilter}`}
                    columns={[
                        {
                            key: 'number',
                            header: 'Mesa',
                            render: (table) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">Mesa {table.number}</span>
                                </div>
                            ),
                        },
                        ...(canChooseBranch ? [{
                            key: 'branch',
                            header: 'Sucursal',
                            render: (table: Table) => table.branch?.name || '-',
                        }] : []),
                        {
                            key: 'capacity',
                            header: 'Sillas / comensales',
                            align: 'center',
                            render: (table) => `${table.capacity} ${table.capacity === 1 ? 'silla' : 'sillas'} / ${table.capacity} ${table.capacity === 1 ? 'comensal' : 'comensales'}`,
                        },
                        {
                            key: 'location',
                            header: 'Ubicación',
                            render: (table) => table.location || '-',
                        },
                        {
                            key: 'status',
                            header: 'Estado',
                            render: (table) => (
                                <span className={`catalog-pill ${table.status === 'AVAILABLE' ? 'ok' : table.status === 'OCCUPIED' ? 'warning' : 'neutral'}`}>
                                    {getStatusText(table.status)}
                                </span>
                            ),
                        },
                        {
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right',
                            render: (table) => (
                                <div className="catalog-table-actions">
                                    <button
                                        type="button"
                                        className="catalog-action-btn"
                                        onClick={() => handleViewOrders(table)}
                                        title="Ver órdenes"
                                    >
                                        <Eye size={16} />
                                    </button>
                                    {canEditTable && (
                                        <button
                                            type="button"
                                            className="catalog-action-btn"
                                            onClick={() => handleOpenSidebar(table)}
                                            title="Editar"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                    )}
                                    {canDeleteTable && (
                                        <button
                                            type="button"
                                            className="catalog-action-btn danger"
                                            onClick={() => handleDelete(table.id)}
                                            title="Eliminar"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            ),
                        },
                    ] as CatalogColumn<Table>[]}
                />
            )}

            {!showMap && viewMode === 'cards' && (
            <div className="tables-grid-new">
                {filteredTables.map(table => {
                    return (
                        <div key={table.id} className={`table-card-new ${getStatusColor(table.status)}`}>
                            {/* Status Badge */}
                            <div className={`status-badge-new ${getStatusColor(table.status)}`}>
                                {getStatusText(table.status)}
                            </div>

                            {/* Table Info */}
                            <div className="table-card-body-new">
                                <div className="table-number-new">Mesa {table.number}</div>

                                {canChooseBranch && table.branch && (
                                    <div className="table-branch-tag">
                                        <Building2 size={12} />
                                        <span>{table.branch.name}</span>
                                    </div>
                                )}

                                <div className="table-details-new">
                                    <div className="detail-item">
                                        <Armchair size={16} />
                                        <span>{table.capacity} {table.capacity === 1 ? 'silla' : 'sillas'} · {table.capacity} {table.capacity === 1 ? 'comensal' : 'comensales'}</span>
                                    </div>
                                    {table.location && (
                                        <div className="detail-item">
                                            <MapPin size={16} />
                                            <span>{table.location}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Order Count for Occupied Tables */}
                                {table.status === 'OCCUPIED' && (
                                    <div className="order-count-badge">
                                        📋 Ver órdenes activas
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="table-card-actions-new">
                                <button
                                    className="action-btn-new view"
                                    onClick={() => handleViewOrders(table)}
                                    title="Ver Órdenes"
                                >
                                    <Eye size={20} />
                                    <span>Ver</span>
                                </button>
                                {canEditTable && (
                                    <button
                                        className="action-btn-new edit"
                                        onClick={() => handleOpenSidebar(table)}
                                        title="Editar"
                                    >
                                        <Edit2 size={20} />
                                        <span>Editar</span>
                                    </button>
                                )}
                                {canDeleteTable && (
                                    <button
                                        className="action-btn-new delete"
                                        onClick={() => handleDelete(table.id)}
                                        title="Eliminar"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            )}

            {!showMap && filteredTables.length === 0 && (
                <div className="no-tables-message">
                    <Grid3x3 size={48} />
                    <p>No hay mesas {statusFilter ? 'con este estado' : 'registradas'}</p>
                    <Button
                        onClick={() => statusFilter ? setStatusFilter(null) : handleOpenSidebar()}
                        disabled={!statusFilter && !canCreateTable}
                    >
                        {statusFilter ? 'Ver todas' : 'Crear primera mesa'}
                    </Button>
                </div>
            )}

            {/* Create/Edit Sidebar */}
            <Sidebar
                isOpen={isLegacyReviewOpen}
                onClose={() => setIsLegacyReviewOpen(false)}
                title="Consolidaciones históricas"
                width="wide"
                description="Inventario de operaciones anteriores al registro transaccional reversible."
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
            </Sidebar>

            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingTable ? 'Editar Mesa' : 'Nueva Mesa'}
            >
                <div className="premium-modal-content table-modal-content">
                    {/* Tabs Navigation */}
                    <div className="modal-tabs">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'general'}
                            className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`}
                            onClick={() => setActiveTab('general')}
                        >
                            <Grid3x3 size={18} />
                            <span>General</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'ubicacion'}
                            className={`modal-tab ${activeTab === 'ubicacion' ? 'active' : ''}`}
                            onClick={() => setActiveTab('ubicacion')}
                        >
                            <MapPin size={18} />
                            <span>Ubicación</span>
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            {activeTab === 'general' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <Users size={18} />
                                        <h3>Información de la Mesa</h3>
                                    </div>

                                    {editingTable ? (
                                        <div className="modal-input-group">
                                            <label className="modal-input-label">Sucursal</label>
                                            <div className="modal-static-field">
                                                <Building2 size={16} />
                                                <span>{editingTable.branch?.name || `Sucursal #${editingTable.branchId}`}</span>
                                            </div>
                                        </div>
                                    ) : canChooseBranch && (
                                        <div className="modal-input-group">
                                            <Select
                                                variant="modal"
                                                label="Sucursal"
                                                placeholder="Selecciona la sucursal..."
                                                options={branches.map((b) => ({ value: b.id.toString(), label: b.name }))}
                                                value={
                                                    formData.branchId
                                                        ? {
                                                            value: formData.branchId,
                                                            label: branches.find((b) => b.id.toString() === formData.branchId)?.name || ''
                                                        }
                                                        : null
                                                }
                                                onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                                    setFormData({ ...formData, branchId: option?.value || '' })}
                                                isSearchable={branches.length > 6}
                                            />
                                        </div>
                                    )}

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="table-number">Número/Nombre</label>
                                            <input
                                                id="table-number"
                                                type="text"
                                                className="modal-standard-input"
                                                value={formData.number}
                                                onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                                                required
                                                placeholder="Ej: 01, A2..."
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="table-capacity">Sillas / comensales (relación 1:1)</label>
                                            <input
                                                id="table-capacity"
                                                type="number"
                                                className="modal-standard-input"
                                                value={formData.capacity}
                                                onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                                                aria-describedby="table-capacity-hint"
                                                required
                                                min="1"
                                            />
                                            <small id="table-capacity-hint" className="table-capacity-hint">Cada silla representa un comensal y aparecerá automáticamente en el plano.</small>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'ubicacion' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <MapPin size={18} />
                                        <h3>Localización y Estado</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="table-location">Área / Ubicación</label>
                                        <input
                                            id="table-location"
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.location}
                                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            placeholder="Ej: Terraza, Salón Principal, VIP..."
                                        />
                                    </div>

                                    {editingTable && (
                                        <Select
                                            variant="modal"
                                            label="Estado Operativo"
                                            options={[
                                                { value: 'AVAILABLE', label: 'Disponible' },
                                                { value: 'RESERVED', label: 'Reservada' },
                                                { value: 'OUT_OF_SERVICE', label: 'Fuera de Servicio' }
                                            ]}
                                            value={{
                                                value: formData.status,
                                                label: getStatusText(formData.status)
                                            }}
                                            onChange={(option: SingleValue<{ value: Table['status']; label: string }>) =>
                                                option && setFormData({ ...formData, status: option.value })}
                                            isDisabled={editingTable.status === 'OCCUPIED'}
                                            isSearchable={false}
                                        />
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="primary">
                                {editingTable ? 'Actualizar Mesa' : 'Guardar Mesa'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>

            {/* Orders Modal */}
            <TableOrdersModal
                isOpen={isOrdersModalOpen}
                onClose={() => setIsOrdersModalOpen(false)}
                table={selectedTable}
                orders={tableOrders}
                loading={loadingTableOrders}
                busyOrderId={busyOrderId}
                canIssueInvoice={canIssueInvoice}
                canPay={canPay}
                canOperatePOS={canOperatePOS}
                canTransfer={canTransfer}
                canConsolidate={canConsolidate}
                canGroup={canGroup}
                activeConsolidation={activeConsolidation}
                loadingConsolidation={loadingConsolidation}
                consolidationLookupError={consolidationLookupError}
                consolidationReversalError={consolidationReversalError}
                reversingConsolidation={reversingConsolidation}
                groupTotalCapacity={selectedTable?.activeTableGroup
                    ? tables.filter((table) => table.activeTableGroupId === selectedTable.activeTableGroupId).reduce((sum, table) => sum + table.capacity, 0)
                    : undefined}
                onOpenPOS={handleOpenPOS}
                onIssueInvoice={(order) => void handleIssueInvoice(order)}
                onPay={(order) => void openPayment(order, 'single')}
                onSplit={(order) => void openPayment(order, 'split')}
                onTransfer={(table) => {
                    setIsOrdersModalOpen(false);
                    setOperationTableId(table.id);
                    setOperation('TRANSFER');
                }}
                onConsolidate={(table) => {
                    setIsOrdersModalOpen(false);
                    setOperationTableId(table.id);
                    setOperation('CONSOLIDATE');
                }}
                onGroup={(table) => {
                    setIsOrdersModalOpen(false);
                    setGroupTableId(table.id);
                }}
                onEditGroup={(table) => {
                    setIsOrdersModalOpen(false);
                    setGroupTableId(table.id);
                }}
                onUngroup={(table) => void handleCloseGroup(table)}
                onRetryConsolidationLookup={() => {
                    setConsolidationReversalError(null);
                    if (selectedTable) void loadActiveConsolidation(selectedTable.id);
                }}
                onReverseConsolidation={handleReverseConsolidation}
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
                    onPaymentSuccess={() => {
                        setPaymentOrder(null);
                        void refreshOperationalTable();
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
            {posTable && (
                <div className="table-pos-workspace" role="dialog" aria-modal="true" aria-label={`Pedido de mesa ${posTable.number}`}>
                    <POS
                        key={posTable.id}
                        initialTableId={posTable.id}
                        embedded
                        onExit={() => setPosTable(null)}
                        onOperationalChange={refreshOperationalTable}
                    />
                </div>
            )}
        </div>
    );
}
