import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { tablesAPI, ordersAPI, branchesAPI, invoicesAPI, cashShiftsAPI } from '../services/api';
import {
    AppSelect, Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton,
    Input, NumberInput, PageContent, PageHeader, SegmentedControl,
    type Column, type Opt, type Tone,
} from '@/ui';
import SalonCards from '../components/SalonCards';
import TableOrdersModal from '../components/TableOrdersModal';
import PaymentModal from '../components/PaymentModal';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { canCreatePayment, getUserRoleNames } from '../utils/authz';
import { Grid3x3, Plus, Edit2, Trash2, Eye, MapPinned } from 'lucide-react';
import type { Table, Order, Branch, TableFloorPlan } from '../types';
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
    const [formDirty, setFormDirty] = useState(false);

    // Orders Modal State
    const [isOrdersModalOpen, setIsOrdersModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [tableOrders, setTableOrders] = useState<Order[]>([]);
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
        { key: 'capacity', header: 'Capacidad (pers.)', width: '9rem', type: 'number' as const, decimals: 0, accessor: (table) => table.capacity },
        { key: 'location', header: 'Ubicación', width: '1fr', hideBelow: 'md' as const, render: (table) => table.location || '-' },
        { key: 'status', header: 'Estado', width: '10rem', type: 'status' as const, render: (table) => <Badge tone={getStatusTone(table.status)} dot>{getStatusText(table.status)}</Badge> },
        {
            key: 'actions',
            header: 'Acciones',
            width: '8rem',
            type: 'actions' as const,
            render: (table) => (
                <>
                    <IconButton icon={Eye} label={`Ver órdenes de la mesa ${table.number}`} onClick={() => void handleViewOrders(table)} />
                    {canEditTable && <IconButton icon={Edit2} label={`Editar mesa ${table.number}`} onClick={() => handleOpenSidebar(table)} />}
                    {canDeleteTable && <IconButton icon={Trash2} label={`Eliminar mesa ${table.number}`} onClick={() => void handleDelete(table.id)} />}
                </>
            ),
        },
    ];

    if (loading) return <div className="tables-loading">Cargando...</div>;

    return (
        <div className={`tables-page ${showMap ? 'tables-page--map' : 'tables-page--list'}`}>
            {!showMap && (
                <PageContent>
                    <PageHeader
                        title="Gestión de mesas"
                        description="Plano, estado y consumo abierto del salón"
                        actions={(
                            <>
                                <ThemeToggle />
                                <Button icon={MapPinned} onClick={() => setShowMap(true)}>Plano</Button>
                                {canCreateTable && (
                                    <Button variant="primary" icon={Plus} onClick={() => handleOpenSidebar()}>Nueva mesa</Button>
                                )}
                            </>
                        )}
                    />

                    <SalonCards branchId={branchFilter} tables={tables} onReviewOrders={() => navigate('/orders')} />

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
                    insights={<SalonCards branchId={mapBranchId} tables={tables} onReviewOrders={() => navigate('/orders')} />}
                    branchControl={canChooseBranch && branches.length > 1 ? (
                        <div className="table-map-branch-control">
                            <AppSelect<number>
                                aria-label="Sucursal"
                                placeholder="Sucursal"
                                options={branchOptions}
                                value={branchFilter}
                                onChange={setBranchFilter}
                            />
                        </div>
                    ) : undefined}
                />
            )}

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
                                <Field label="Capacidad (personas)" htmlFor="table-capacity" required>
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
