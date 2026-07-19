import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { tablesAPI, ordersAPI, branchesAPI, invoicesAPI, cashShiftsAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import TableOrdersModal from '../components/TableOrdersModal';
import PaymentModal from '../components/PaymentModal';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { canCreatePayment, getUserRoleNames } from '../utils/authz';
import { Armchair, Grid3x3, Plus, Edit2, Trash2, Eye, Users, MapPin, Building2, MapPinned } from 'lucide-react';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import type { Table, Order, Branch, TableFloorPlan } from '../types';
import type { SingleValue } from 'react-select';
import Select from '../components/Select';
import { ACTIVE_ORDER_STATUSES } from '../utils/orderStatus';
import './Tables.css';
import TableMap, { type FloorPlanDraft } from '../components/TableMap';
import { newIdempotencyKey } from '../utils/idempotency';
import TableOperationModal from '../components/TableOperationModal';
import POS from './POS';
import { hasUsableCashShift, type CashShiftScope } from '../utils/paymentAccess';
import { initializeWebSocket, subscribeWebSocket, WS_EVENTS } from '../utils/websocket';
import { useCurrency } from '../hooks/useCurrency';
import ThemeToggle from '../components/ThemeToggle';
import KitchenNotificationBell from '../components/KitchenNotificationBell';
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
    const userRoleNames = getUserRoleNames(user);
    const canCreateTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const canEditTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'HOST'].includes(role));
    const canDeleteTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const canEditMap = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const canTransfer = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'MESERO'].includes(role));
    const canConsolidate = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'CAJERO'].includes(role));
    const canIssueInvoice = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'CAJERO'].includes(role));
    const canPay = canCreatePayment(user);
    const canOperatePOS = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO'].includes(role));
    // Managers (company-wide) may create/list tables across branches of their company.
    const canChooseBranch = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
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
    const { viewMode, setViewMode } = useViewMode('tables');
    const [showMap, setShowMap] = useState(true);
    const [savingLayout, setSavingLayout] = useState(false);
    const [operation, setOperation] = useState<'TRANSFER' | 'CONSOLIDATE' | null>(null);
    const [operationTableId, setOperationTableId] = useState<number | null>(null);
    const [submittingOperation, setSubmittingOperation] = useState(false);
    const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
    const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
    const [paymentMode, setPaymentMode] = useState<'single' | 'split'>('single');
    const [cashShiftStatus, setCashShiftStatus] = useState<CashShiftScope | null>(null);
    const [posTable, setPosTable] = useState<Table | null>(null);
    const [floorPlan, setFloorPlan] = useState<TableFloorPlan | null>(null);

    const loadedBranchIds = Array.from(new Set(tables.map((table) => table.branchId)));
    const mapBranchId = branchFilter ?? (loadedBranchIds.length === 1 ? loadedBranchIds[0] : undefined);

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
        try {
            const response = await ordersAPI.getAll({
                tableId: table.id,
            });
            const active = response.data.data.filter((o: Order) =>
                ACTIVE_ORDER_STATUSES.includes(o.status)
                || (o.status === 'DELIVERED' && o.financialStatus !== 'PAID')
            );
            setTableOrders(active);
        } catch (error) {
            console.error('Error loading table orders:', error);
            showError('No se pudieron cargar las órdenes de esta mesa.');
        }
    }, [showError]);

    const handleViewOrders = async (table: Table) => {
        setSelectedTable(table);
        setIsOrdersModalOpen(true);
        await loadTableOrders(table);
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
            const refreshed = await ordersAPI.getById(order.id);
            const nextOrder = refreshed.data.data as Order;
            setTableOrders((current) => current.map((item) => item.id === nextOrder.id ? nextOrder : item));
            await loadTables();
            await loadFloorPlan();
            showSuccess(`Factura ${invoiceNumber || ''} emitida correctamente.`.trim());
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
            if (selectedTable) void loadTableOrders(selectedTable);
        });
    }, [loadFloorPlan, loadTableOrders, loadTables, selectedTable]);

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
            await tablesAPI.consolidate(data, newIdempotencyKey());
            setOperation(null);
            setOperationTableId(null);
            await loadTables();
            await loadFloorPlan();
            showSuccess('Las cuentas fueron consolidadas en la mesa principal.');
        } catch (error) {
            showError(extractApiError(error, 'No se pudieron consolidar las cuentas'));
        } finally {
            setSubmittingOperation(false);
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
                    themeControl={<KitchenNotificationBell inline />}
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
                busyOrderId={busyOrderId}
                canIssueInvoice={canIssueInvoice}
                canPay={canPay}
                canOperatePOS={canOperatePOS}
                canTransfer={canTransfer}
                canConsolidate={canConsolidate}
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
