import { useState, useEffect } from 'react';
import { suppliersAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import Input from '../components/Input';
import { Plus, Trash2, Phone, Mail, MapPin, Truck, Search, Users, Info, Building2, Tag, History } from 'lucide-react';
import type { Supplier } from '../types';
import './Suppliers.css';

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
    const [activeTab, setActiveTab] = useState<'empresa' | 'contacto' | 'ubicacion'>('empresa');

    // Price history
    const [showPriceHistory, setShowPriceHistory] = useState(false);
    const [priceHistorySupplier, setPriceHistorySupplier] = useState<Supplier | null>(null);
    const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
    const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);

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
            alert('Error al guardar proveedor');
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteSupplier) return;
        if (!window.confirm('¿Estás seguro de eliminar este proveedor?')) return;
        try {
            await suppliersAPI.delete(id);
            loadSuppliers();
        } catch (error) {
            console.error('Error deleting supplier:', error);
            alert('Error al eliminar proveedor');
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
            <div className="suppliers-header-new">
                <div className="header-title-section">
                    <h1><Truck size={32} /> Proveedores</h1>
                </div>
                {canManageSupplier && (
                    <Button onClick={() => handleOpenModal()}>
                        <Plus size={20} />
                        Nuevo Proveedor
                    </Button>
                )}
            </div>

            {/* Filters Row */}
            <div className="suppliers-filters-row">
                <div className="supplier-type-filters">
                    <button
                        className={`supplier-type-btn ${supplyTypeFilter === null ? 'active' : ''}`}
                        onClick={() => setSupplyTypeFilter(null)}
                    >
                        Todos
                    </button>
                    {supplyTypes.map(type => (
                        <button
                            key={type}
                            className={`supplier-type-btn ${supplyTypeFilter === type ? 'active' : ''}`}
                            onClick={() => setSupplyTypeFilter(type as string)}
                        >
                            {type}
                        </button>
                    ))}
                </div>

                <div className="supplier-search-section">
                    <div className="search-input-wrapper">
                        <Search size={18} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Buscar proveedor..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="search-input-new"
                        />
                    </div>
                </div>
            </div>

            {/* Enhanced Suppliers Grid */}
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
                <div className="supplier-modal-content">
                    {/* Tabs Navigation */}
                    <div className="supplier-tabs">
                        <button
                            className={`supplier-tab ${activeTab === 'empresa' ? 'active' : ''}`}
                            onClick={() => setActiveTab('empresa')}
                        >
                            <Building2 size={18} />
                            <span>Empresa</span>
                        </button>
                        <button
                            className={`supplier-tab ${activeTab === 'contacto' ? 'active' : ''}`}
                            onClick={() => setActiveTab('contacto')}
                        >
                            <Users size={18} />
                            <span>Contacto</span>
                        </button>
                        <button
                            className={`supplier-tab ${activeTab === 'ubicacion' ? 'active' : ''}`}
                            onClick={() => setActiveTab('ubicacion')}
                        >
                            <MapPin size={18} />
                            <span>Ubicación</span>
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="supplier-form-new">
                        <div className="tab-content-container">
                            {/* Tab 1: Empresa */}
                            {activeTab === 'empresa' && (
                                <div className="form-section-new animate-slide-in">
                                    <div className="section-header-new">
                                        <Info size={16} />
                                        <h3>Información Principal</h3>
                                    </div>
                                    <Input
                                        label="Nombre de la Empresa"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        required
                                        placeholder="Ej: Distribuidora Central S.A."
                                    />
                                    <Input
                                        label="RUC / NIT (Opcional)"
                                        value={formData.taxId}
                                        onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                                        placeholder="Ej: J031000000123"
                                    />

                                    <div className="input-group-new">
                                        <label className="input-label-new">
                                            <Tag size={14} />
                                            Tipo de Suministro
                                        </label>
                                        <div className="supply-type-chips">
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

                            {/* Tab 2: Contacto */}
                            {activeTab === 'contacto' && (
                                <div className="form-section-new animate-slide-in">
                                    <div className="section-header-new">
                                        <Users size={16} />
                                        <h3>Datos de Contacto</h3>
                                    </div>
                                    <Input
                                        label="Nombre del Contacto"
                                        value={formData.contact}
                                        onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                                        placeholder="Ej: Juan Pérez"
                                    />
                                    <div className="form-row-new">
                                        <Input
                                            label="Teléfono"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            placeholder="Ej: +505 8888 8888"
                                        />
                                        <Input
                                            label="Email"
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            placeholder="Ej: contacto@empresa.com"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Tab 3: Ubicación */}
                            {activeTab === 'ubicacion' && (
                                <div className="form-section-new animate-slide-in">
                                    <div className="section-header-new">
                                        <MapPin size={16} />
                                        <h3>Ubicación Física</h3>
                                    </div>
                                    <div className="input-group-new">
                                        <label className="input-label-new">Dirección Completa</label>
                                        <textarea
                                            className="textarea-new"
                                            rows={4}
                                            value={formData.address}
                                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                            placeholder="Calle, ciudad, puntos de referencia..."
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="form-footer-new">
                            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit">
                                {editingSupplier ? 'Actualizar Proveedor' : 'Guardar Proveedor'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>

            {/* Price History Sidebar */}
            <Sidebar isOpen={showPriceHistory} onClose={() => setShowPriceHistory(false)}
                title={`Historial de Precios - ${priceHistorySupplier?.name || ''}`} width="wide">
                <div style={{ padding: '16px' }}>
                    {priceHistoryLoading ? (
                        <p style={{ textAlign: 'center', padding: '24px', color: 'var(--color-neutral-400)' }}>Cargando...</p>
                    ) : priceHistory.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--color-neutral-100)' }}>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Producto</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Precio Unit.</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Cantidad</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Subtotal</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Fecha</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>OC#</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Sucursal</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {priceHistory.map((item, idx: number) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid var(--color-neutral-200)' }}>
                                            <td style={{ padding: '8px 12px' }}>
                                                <div style={{ fontWeight: 600 }}>{item.productName}</div>
                                                {item.productSku && <div style={{ fontSize: '0.7rem', color: 'var(--color-neutral-400)' }}>{item.productSku}</div>}
                                            </td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>${item.unitCost.toFixed(2)}/{item.unit}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.quantity.toFixed(2)}</td>
                                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>${item.subtotal.toFixed(2)}</td>
                                            <td style={{ padding: '8px 12px' }}>{new Date(item.date).toLocaleDateString('es-ES')}</td>
                                            <td style={{ padding: '8px 12px' }}>#{item.purchaseOrderId}</td>
                                            <td style={{ padding: '8px 12px' }}>{item.branchName || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p style={{ textAlign: 'center', padding: '32px', color: 'var(--color-neutral-400)' }}>
                            No hay historial de precios para este proveedor
                        </p>
                    )}
                </div>
            </Sidebar>
        </div>
    );
}
