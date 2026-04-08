import { useState, useEffect } from 'react';
import { tablesAPI, ordersAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import TableOrdersModal from '../components/TableOrdersModal';
import { useAuth } from '../hooks/useAuth';
import { getUserRoleNames } from '../utils/authz';
import { Grid3x3, Plus, Edit2, Trash2, Eye, Users, MapPin } from 'lucide-react';
import type { Table, Order } from '../types';
import type { SingleValue } from 'react-select';
import Select from '../components/Select';
import { ACTIVE_ORDER_STATUSES } from '../utils/orderStatus';
import './Tables.css';

export default function Tables() {
    const { user } = useAuth();
    const userRoleNames = getUserRoleNames(user);
    const canCreateTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const canEditTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'HOST'].includes(role));
    const canDeleteTable = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const [tables, setTables] = useState<Table[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string | null>(null);

    // CRUD State
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingTable, setEditingTable] = useState<Table | null>(null);
    const [formData, setFormData] = useState({
        number: '',
        capacity: '4',
        location: '',
        status: 'AVAILABLE' as 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'OUT_OF_SERVICE'
    });
    const [activeTab, setActiveTab] = useState<'general' | 'ubicacion'>('general');

    // Orders Modal State
    const [isOrdersModalOpen, setIsOrdersModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [tableOrders, setTableOrders] = useState<Order[]>([]);

    useEffect(() => {
        loadTables();
    }, []);

    const loadTables = async () => {
        try {
            const response = await tablesAPI.getAll();
            setTables(response.data.data);
        } catch (error) {
            console.error('Error loading tables:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenSidebar = (table?: Table) => {
        if (table && !canEditTable) {
            alert('No tienes permisos para editar mesas');
            return;
        }
        if (!table && !canCreateTable) {
            alert('No tienes permisos para crear mesas');
            return;
        }

        if (table) {
            setEditingTable(table);
            setFormData({
                number: table.number,
                capacity: table.capacity.toString(),
                location: table.location || '',
                status: table.status
            });
        } else {
            setEditingTable(null);
            setFormData({
                number: '',
                capacity: '4',
                location: '',
                status: 'AVAILABLE'
            });
        }
        setActiveTab('general');
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (editingTable && !canEditTable) {
            alert('No tienes permisos para editar mesas');
            return;
        }
        if (!editingTable && !canCreateTable) {
            alert('No tienes permisos para crear mesas');
            return;
        }
        try {
            const data = {
                ...formData,
                capacity: parseInt(formData.capacity)
            };

            if (editingTable) {
                await tablesAPI.update(editingTable.id, data);
            } else {
                await tablesAPI.create(data);
            }

            setIsSidebarOpen(false);
            loadTables();
        } catch (error) {
            console.error('Error saving table:', error);
            alert('Error al guardar la mesa');
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteTable) {
            alert('No tienes permisos para eliminar mesas');
            return;
        }
        if (!window.confirm('¿Estás seguro de eliminar esta mesa?')) return;
        try {
            await tablesAPI.delete(id);
            loadTables();
        } catch (error) {
            console.error('Error deleting table:', error);
            alert('Error al eliminar la mesa');
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

    const filteredTables = statusFilter
        ? tables.filter(t => t.status === statusFilter)
        : tables;


    if (loading) return <div className="tables-loading">Cargando...</div>;

    return (
        <div className="tables-page">
            <div className="tables-header-new">
                <div className="header-title-section">
                    <h1><Grid3x3 size={32} /> Gestión de Mesas</h1>
                </div>
                {canCreateTable && (
                    <Button onClick={() => handleOpenSidebar()}>
                        <Plus size={20} />
                        Nueva Mesa
                    </Button>
                )}
            </div>

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

            </div>

            {/* Enhanced Table Grid */}
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

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label">Número/Nombre</label>
                                            <input
                                                type="text"
                                                className="modal-standard-input"
                                                value={formData.number}
                                                onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                                                required
                                                placeholder="Ej: 01, A2..."
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label">Capacidad (Personas)</label>
                                            <input
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
                                        <label className="modal-input-label">Área / Ubicación</label>
                                        <input
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.location}
                                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                            placeholder="Ej: Terraza, Salón Principal, VIP..."
                                        />
                                    </div>

                                    <Select
                                        variant="modal"
                                        label="Estado Inicial"
                                        options={[
                                            { value: 'AVAILABLE', label: 'Disponible' },
                                            { value: 'OCCUPIED', label: 'Ocupada' },
                                            { value: 'RESERVED', label: 'Reservada' },
                                            { value: 'OUT_OF_SERVICE', label: 'Fuera de Servicio' }
                                        ]}
                                        value={{
                                            value: formData.status,
                                            label: getStatusText(formData.status)
                                        }}
                                        onChange={(option: SingleValue<{ value: Table['status']; label: string }>) =>
                                            option && setFormData({ ...formData, status: option.value })}
                                        isSearchable={false}
                                    />
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
        </div>
    );
}
