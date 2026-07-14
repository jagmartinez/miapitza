import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { tablesAPI, ordersAPI, branchesAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import TableOrdersModal from '../components/TableOrdersModal';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import { Grid3x3, Plus, Edit2, Trash2, Eye, Users, MapPin, Building2, MapPinned, ArrowRightLeft, Merge } from 'lucide-react';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import type { Table, Order, Branch } from '../types';
import type { SingleValue } from 'react-select';
import Select from '../components/Select';
import { ACTIVE_ORDER_STATUSES } from '../utils/orderStatus';
import './Tables.css';
import TableMap, { type PositionedTable } from '../components/TableMap';
import { newIdempotencyKey } from '../utils/idempotency';
import TableOperationModal from '../components/TableOperationModal';

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
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning, success: showSuccess } = useAppToast();
    const userRoleNames = getUserRoleNames(user);
    const canCreateTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const canEditTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'HOST'].includes(role));
    const canDeleteTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const canEditMap = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const canTransfer = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'MESERO'].includes(role));
    const canConsolidate = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'CAJERO'].includes(role));
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
    const [submittingOperation, setSubmittingOperation] = useState(false);

    const loadTables = useCallback(async () => {
        try {
            const response = await tablesAPI.getAll(branchFilter ?? undefined);
            setTables(response.data.data);
        } catch (error) {
            console.error('Error loading tables:', error);
        } finally {
            setLoading(false);
        }
    }, [branchFilter]);

    useEffect(() => {
        loadTables();
    }, [loadTables]);

    useEffect(() => {
        if (!canChooseBranch) return;
        branchesAPI.getAll()
            .then((res) => setBranches(res.data.data || []))
            .catch((error) => console.error('Error loading branches:', error));
    }, [canChooseBranch]);

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
            loadTables();
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
            loadTables();
        } catch (error) {
            console.error('Error deleting table:', error);
            showError(extractApiError(error, 'Error al eliminar la mesa'));
        }
    };

    const handleViewOrders = async (table: Table) => {
        setSelectedTable(table);
        setIsOrdersModalOpen(true);
        try {
            const response = await ordersAPI.getAll({
                tableId: table.id,
            });
            const active = response.data.data.filter((o: Order) =>
                ACTIVE_ORDER_STATUSES.includes(o.status)
            );
            setTableOrders(active);
        } catch (error) {
            console.error('Error loading table orders:', error);
        }
    };

    const filteredTables = statusFilter
        ? tables.filter(t => t.status === statusFilter)
        : tables;

    const mapBranchIds = Array.from(new Set(filteredTables.map((table) => table.branchId)));
    const mapBranchId = mapBranchIds.length === 1 ? mapBranchIds[0] : undefined;

    const handleSaveLayout = async (changed: PositionedTable[]) => {
        if (!mapBranchId) {
            showWarning('Selecciona una sucursal antes de editar su plano.');
            return;
        }
        setSavingLayout(true);
        try {
            await tablesAPI.updateLayout(
                mapBranchId,
                changed.map((table) => ({
                    id: table.id,
                    x: table.mapX,
                    y: table.mapY,
                    width: table.mapWidth,
                    height: table.mapHeight,
                    rotation: table.mapRotation,
                    shape: table.mapShape,
                    expectedVersion: table.mapVersion
                })),
                newIdempotencyKey()
            );
            await loadTables();
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
            await loadTables();
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
            await loadTables();
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
        <div className="tables-page">
            <PageHeader
                title="Gestión de Mesas"
                icon={Grid3x3}
                actions={(
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                            type="button"
                            className={`tables-map-toggle ${showMap ? 'active' : ''}`}
                            onClick={() => setShowMap((value) => !value)}
                            aria-pressed={showMap}
                        >
                            {showMap ? <Grid3x3 size={18} /> : <MapPinned size={18} />}
                            {showMap ? 'Lista' : 'Plano'}
                        </button>
                        {!showMap && <ViewToggle value={viewMode} onChange={setViewMode} />}
                        {canTransfer && (
                            <button type="button" className="tables-map-toggle" onClick={() => setOperation('TRANSFER')}>
                                <ArrowRightLeft size={18} /> Cambiar mesa
                            </button>
                        )}
                        {canConsolidate && (
                            <button type="button" className="tables-map-toggle" onClick={() => setOperation('CONSOLIDATE')}>
                                <Merge size={18} /> Consolidar
                            </button>
                        )}
                        {canCreateTable && (
                            <Button onClick={() => handleOpenSidebar()}>
                                <Plus size={20} />
                                Nueva Mesa
                            </Button>
                        )}
                    </div>
                )}
            />

            {/* Filters Row */}
            <div className="tables-filters-row">
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
            </div>

            {showMap && filteredTables.length > 0 && mapBranchIds.length > 1 && (
                <div className="table-map-branch-required">
                    <MapPinned size={24} />
                    Selecciona una sucursal para visualizar y editar su plano.
                </div>
            )}

            {showMap && filteredTables.length > 0 && mapBranchIds.length === 1 && (
                <TableMap
                    tables={filteredTables}
                    canEdit={canEditMap}
                    saving={savingLayout}
                    onSelect={handleViewOrders}
                    onSave={handleSaveLayout}
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
                            header: 'Capacidad',
                            align: 'center',
                            render: (table) => `${table.capacity} pers.`,
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
                                        <Users size={16} />
                                        <span>{table.capacity} personas</span>
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

            {filteredTables.length === 0 && (
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
                        <div
                            className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`}
                            onClick={() => setActiveTab('general')}
                        >
                            <Grid3x3 size={18} />
                            <span>General</span>
                        </div>
                        <div
                            className={`modal-tab ${activeTab === 'ubicacion' ? 'active' : ''}`}
                            onClick={() => setActiveTab('ubicacion')}
                        >
                            <MapPin size={18} />
                            <span>Ubicación</span>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            {activeTab === 'general' && (
                                <div className="modal-section animate-slide-in">
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
                                            <label className="modal-input-label" htmlFor="table-capacity">Capacidad (Personas)</label>
                                            <input
                                                id="table-capacity"
                                                type="number"
                                                className="modal-standard-input"
                                                value={formData.capacity}
                                                onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                                                required
                                                min="1"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'ubicacion' && (
                                <div className="modal-section animate-slide-in">
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
                tableNumber={selectedTable?.number || ''}
                orders={tableOrders}
            />
            <TableOperationModal
                isOpen={operation !== null}
                operation={operation ?? 'TRANSFER'}
                tables={mapBranchId ? tables.filter((table) => table.branchId === mapBranchId) : tables}
                submitting={submittingOperation}
                onClose={() => setOperation(null)}
                onTransfer={handleTransfer}
                onConsolidate={handleConsolidate}
            />
        </div>
    );
}
