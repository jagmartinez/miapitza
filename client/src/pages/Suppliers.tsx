import { useState, useEffect } from 'react';
import { suppliersAPI, settingsAPI } from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import Select from '../components/Select';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import type { SingleValue } from 'react-select';
import { Plus, Trash2, Phone, Mail, MapPin, Truck, Search, Users, Info, Building2, Tag, History, X, Edit2 } from 'lucide-react'; // Tag kept for use inside modal
import type { Supplier } from '../types';
import './Suppliers.css';

type SupplyTypeOption = { value: string; label: string };

interface PriceHistoryRow {
    productName: string;
    productSku?: string;
    unitCost: number;
    unit: string;
    quantity: number;
    subtotal: number;
    date: string;
    purchaseOrderId: number;
    branchName?: string;
}

export default function Suppliers() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError } = useAppToast();
    /** Backend: POST/PUT /suppliers — SUPERADMIN | ADMIN */
    const canManageSupplier = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);
    /** Backend: DELETE /suppliers — SUPERADMIN only */
    const canDeleteSupplier = hasAnyRole(user, ['SUPERADMIN']);

    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        contact: '',
        phone: '',
        email: '',
        address: '',
        taxId: '',
        supplyType: ''
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [supplyTypeFilter, setSupplyTypeFilter] = useState<string | null>(null);
    const { viewMode, setViewMode } = useViewMode('suppliers');
    const [activeTab, setActiveTab] = useState<'empresa' | 'contacto' | 'ubicacion'>('empresa');
    const [saving, setSaving] = useState(false);

    // Price history
    const [showPriceHistory, setShowPriceHistory] = useState(false);
    const [priceHistorySupplier, setPriceHistorySupplier] = useState<Supplier | null>(null);
    const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
    const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
    const [settings, setSettings] = useState<CurrencySettings>({});

    const viewPriceHistory = async (supplier: Supplier) => {
        setPriceHistorySupplier(supplier);
        setPriceHistoryLoading(true);
        setShowPriceHistory(true);
        try {
            const res = await suppliersAPI.getPriceHistory(supplier.id);
            setPriceHistory(res.data.data || []);
        } catch (err) {
            console.error('Error loading price history:', err);
        } finally {
            setPriceHistoryLoading(false);
        }
    };

    useEffect(() => {
        loadSuppliers();
        settingsAPI.getAll()
            .then((res) => setSettings(res.data.data || {}))
            .catch((err) => console.error('Error loading settings:', err));
    }, []);

    const loadSuppliers = async () => {
        try {
            const res = await suppliersAPI.getAll();
            setSuppliers(res.data.data);
        } catch (error) {
            console.error('Error loading suppliers:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (supplier?: Supplier) => {
        if (!canManageSupplier) return;
        if (supplier) {
            setEditingSupplier(supplier);
            setFormData({
                name: supplier.name,
                contact: supplier.contact || '',
                phone: supplier.phone || '',
                email: supplier.email || '',
                address: supplier.address || '',
                taxId: supplier.taxId || '',
                supplyType: supplier.supplyType || ''
            });
        } else {
            setEditingSupplier(null);
            setFormData({
                name: '',
                contact: '',
                phone: '',
                email: '',
                address: '',
                taxId: '',
                supplyType: ''
            });
        }
        setIsModalOpen(true);
        setActiveTab('empresa');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canManageSupplier) return;
        setSaving(true);
        try {
            if (editingSupplier) {
                await suppliersAPI.update(editingSupplier.id, formData);
            } else {
                await suppliersAPI.create(formData);
            }
            setIsModalOpen(false);
            loadSuppliers();
        } catch (error) {
            console.error('Error saving supplier:', error);
            showError('Error al guardar proveedor');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteSupplier) return;
        if (!(await confirm('¿Estás seguro de eliminar este proveedor?', { title: 'Confirmar acción' }))) return;
        try {
            await suppliersAPI.delete(id);
            loadSuppliers();
        } catch (error) {
            console.error('Error deleting supplier:', error);
            showError('Error al eliminar proveedor');
        }
    };

    const filteredSuppliers = suppliers.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (s.contact?.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (s.supplyType?.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesType = !supplyTypeFilter || s.supplyType === supplyTypeFilter;

        return matchesSearch && matchesType;
    });

    const FIXED_SUPPLY_TYPES = [
        'Aceites y Especias', 'Carnes y Embutidos', 'Lácteos', 'Frutas y Verduras',
        'Vinos', 'Mariscos', 'Harinas y Sales', 'Panadería', 'Bebidas', 'Suministros'
    ];
    const supplyTypes = FIXED_SUPPLY_TYPES;


    if (loading) return <div className="suppliers-loading">Cargando...</div>;

    return (
        <div className="suppliers-page">
            <PageHeader
                title="Proveedores"
                icon={Truck}
                actions={(
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <ViewToggle value={viewMode} onChange={setViewMode} />
                        {canManageSupplier && (
                            <Button onClick={() => handleOpenModal()}>
                                <Plus size={20} />
                                Nuevo Proveedor
                            </Button>
                        )}
                    </div>
                )}
            />

            {/* Filters Row */}
            <div className="suppliers-filters-row">
                <div className="supplier-search-section">
                    <div className="search-input-wrapper">
                        <Search size={18} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Buscar por nombre, contacto o tipo..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="search-input-new"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                className="search-clear-btn"
                                onClick={() => setSearchTerm('')}
                                aria-label="Limpiar búsqueda"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="supplier-filter-group">
                    <Select<SupplyTypeOption>
                        isClearable
                        isSearchable={false}
                        placeholder="Todos los tipos"
                        options={supplyTypes.map(type => ({ value: type, label: type }))}
                        value={supplyTypeFilter ? { value: supplyTypeFilter, label: supplyTypeFilter } : null}
                        onChange={(option: SingleValue<SupplyTypeOption>) =>
                            setSupplyTypeFilter(option?.value ?? null)}
                        aria-label="Filtrar por tipo de suministro"
                    />
                </div>

                <div className="supplier-results-info">
                    <span className="results-count">{filteredSuppliers.length}</span>
                    <span className="results-label">
                        {filteredSuppliers.length === 1 ? 'proveedor' : 'proveedores'}
                    </span>
                    {(searchTerm || supplyTypeFilter) && (
                        <button
                            type="button"
                            className="filter-clear-btn"
                            onClick={() => { setSearchTerm(''); setSupplyTypeFilter(null); }}
                        >
                            <X size={14} />
                            Limpiar
                        </button>
                    )}
                </div>
            </div>

            {/* Table view */}
            {viewMode === 'table' && filteredSuppliers.length > 0 && (
                <CatalogTable<Supplier>
                    rows={filteredSuppliers}
                    rowKey={(s) => s.id}
                    resetKey={`${searchTerm}|${supplyTypeFilter}`}
                    columns={[
                        {
                            key: 'name',
                            header: 'Proveedor',
                            render: (s) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{s.name}</span>
                                    {s.taxId && <span className="cell-sub">RUC/NIT: {s.taxId}</span>}
                                </div>
                            )
                        },
                        { key: 'type', header: 'Tipo', render: (s) => s.supplyType || '-' },
                        { key: 'contact', header: 'Contacto', render: (s) => s.contact || '-' },
                        { key: 'phone', header: 'Teléfono', render: (s) => s.phone || '-' },
                        { key: 'email', header: 'Email', render: (s) => s.email || '-' },
                        {
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right',
                            render: (s) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => viewPriceHistory(s)} title="Historial de Precios">
                                        <History size={16} />
                                    </button>
                                    {canManageSupplier && (
                                        <button className="catalog-action-btn" onClick={() => handleOpenModal(s)} title="Editar">
                                            <Edit2 size={16} />
                                        </button>
                                    )}
                                    {canDeleteSupplier && (
                                        <button className="catalog-action-btn danger" onClick={() => handleDelete(s.id)} title="Eliminar">
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            )
                        }
                    ] as CatalogColumn<Supplier>[]}
                />
            )}

            {/* Enhanced Suppliers Grid */}
            {viewMode === 'cards' && (
            <div className="suppliers-grid-new">
                {filteredSuppliers.map(supplier => (
                    <div key={supplier.id} className="supplier-card-new">

                        {/* Supplier Info */}
                        <div className="supplier-card-body-new">
                            <div className="supplier-name-new">{supplier.name}</div>

                            <div className="supplier-details-new">
                                {supplier.contact && (
                                    <div className="detail-item">
                                        <Users size={16} />
                                        <span>{supplier.contact}</span>
                                    </div>
                                )}
                                {supplier.phone && (
                                    <div className="detail-item">
                                        <Phone size={16} />
                                        <span>{supplier.phone}</span>
                                    </div>
                                )}
                                {supplier.email && (
                                    <div className="detail-item">
                                        <Mail size={16} />
                                        <span>{supplier.email}</span>
                                    </div>
                                )}
                                {supplier.address && (
                                    <div className="detail-item">
                                        <MapPin size={16} />
                                        <span>{supplier.address}</span>
                                    </div>
                                )}
                                {supplier.taxId && (
                                    <div className="detail-item">
                                        <span className="tax-id-label">RUC/NIT:</span>
                                        <span>{supplier.taxId}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="supplier-card-actions-new">
                            <button
                                className="action-btn-new"
                                onClick={() => viewPriceHistory(supplier)}
                                title="Historial de Precios"
                            >
                                <History size={20} />
                                <span>Precios</span>
                            </button>
                            {canManageSupplier && (
                                <button
                                    className="action-btn-new edit"
                                    onClick={() => handleOpenModal(supplier)}
                                    title="Editar"
                                >
                                    <Plus size={20} />
                                    <span>Editar</span>
                                </button>
                            )}
                            {canDeleteSupplier && (
                                <button
                                    className="action-btn-new delete"
                                    onClick={() => handleDelete(supplier.id)}
                                    title="Eliminar"
                                >
                                    <Trash2 size={20} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            )}

            {filteredSuppliers.length === 0 && (
                <div className="no-suppliers-message">
                    <Truck size={48} />
                    <p>No se encontraron proveedores</p>
                    <Button onClick={() => { setSearchTerm(''); setSupplyTypeFilter(null); }}>
                        Limpiar filtros
                    </Button>
                </div>
            )}


            <Sidebar
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            >
                <div className="premium-modal-content">
                    <div className="modal-tabs" role="tablist" aria-label="Secciones del proveedor">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'empresa'}
                            className={`modal-tab ${activeTab === 'empresa' ? 'active' : ''}`}
                            onClick={() => setActiveTab('empresa')}
                        >
                            <Building2 size={18} />
                            <span>Empresa</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'contacto'}
                            className={`modal-tab ${activeTab === 'contacto' ? 'active' : ''}`}
                            onClick={() => setActiveTab('contacto')}
                        >
                            <Users size={18} />
                            <span>Contacto</span>
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
                            {activeTab === 'empresa' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <Info size={16} />
                                        <h3>Información Principal</h3>
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="supplier-name">Nombre de la Empresa</label>
                                        <input id="supplier-name" type="text" className="modal-standard-input" value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required placeholder="Ej: Distribuidora Central S.A." />
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="supplier-tax-id">RUC / NIT (Opcional)</label>
                                        <input id="supplier-tax-id" type="text" className="modal-standard-input" value={formData.taxId}
                                            onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                                            placeholder="Ej: J031000000123" />
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" id="supplier-supply-type-label">
                                            <Tag size={14} />
                                            Tipo de Suministro
                                        </label>
                                        <div className="supply-type-chips" role="group" aria-labelledby="supplier-supply-type-label">
                                            {FIXED_SUPPLY_TYPES.map(type => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    className={`type-chip ${formData.supplyType === type ? 'active' : ''}`}
                                                    onClick={() => setFormData({ ...formData, supplyType: type })}
                                                >
                                                    {type}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'contacto' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <Users size={16} />
                                        <h3>Datos de Contacto</h3>
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="supplier-contact">Nombre del Contacto</label>
                                        <input id="supplier-contact" type="text" className="modal-standard-input" value={formData.contact}
                                            onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                                            placeholder="Ej: Juan Pérez" />
                                    </div>
                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="supplier-phone">Teléfono</label>
                                            <input id="supplier-phone" type="text" className="modal-standard-input" value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                                placeholder="Ej: +505 8888 8888" />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="supplier-email">Email</label>
                                            <input id="supplier-email" type="email" className="modal-standard-input" value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                                placeholder="Ej: contacto@empresa.com" />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'ubicacion' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <MapPin size={16} />
                                        <h3>Ubicación Física</h3>
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="supplier-address">Dirección Completa</label>
                                        <textarea
                                            id="supplier-address"
                                            className="modal-textarea"
                                            rows={4}
                                            value={formData.address}
                                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                            placeholder="Calle, ciudad, puntos de referencia..."
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={saving}>
                                {saving ? 'Guardando...' : editingSupplier ? 'Actualizar Proveedor' : 'Guardar Proveedor'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>

            {/* Price History Sidebar */}
            <Sidebar isOpen={showPriceHistory} onClose={() => setShowPriceHistory(false)}
                title={`Historial de Precios - ${priceHistorySupplier?.name || ''}`} width="wide">
                <div className="premium-modal-content">
                    <div className="modal-tab-content">
                        {priceHistoryLoading ? (
                            <p className="stock-empty-message">Cargando...</p>
                        ) : priceHistory.length > 0 ? (
                            <div className="price-history-table-wrap">
                                <table className="price-history-table">
                                    <thead>
                                        <tr>
                                            <th>Producto</th>
                                            <th className="text-right">Precio Unit.</th>
                                            <th className="text-right">Cantidad</th>
                                            <th className="text-right">Subtotal</th>
                                            <th>Fecha</th>
                                            <th>OC#</th>
                                            <th>Sucursal</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {priceHistory.map((item, idx: number) => (
                                            <tr key={idx}>
                                                <td>
                                                    <div className="product-cell-name">{item.productName}</div>
                                                    {item.productSku && <div className="product-cell-sku">{item.productSku}</div>}
                                                </td>
                                                <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(item.unitCost, settings)}/{item.unit}</td>
                                                <td className="text-right">{item.quantity.toFixed(2)}</td>
                                                <td className="text-right">{formatCurrency(item.subtotal, settings)}</td>
                                                <td>{new Date(item.date).toLocaleDateString('es-ES')}</td>
                                                <td>#{item.purchaseOrderId}</td>
                                                <td>{item.branchName || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="stock-empty-message">
                                No hay historial de precios para este proveedor
                            </p>
                        )}
                    </div>
                </div>
            </Sidebar>
        </div>
    );
}
