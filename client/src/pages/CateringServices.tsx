import { useState, useEffect, useCallback } from 'react';
import {
    Library, Plus, Trash2, Edit2,
    ClipboardList
} from 'lucide-react';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import { cateringAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { getUserRoleNames } from '../utils/authz';
import './CateringMod.css';

interface CateringServiceRow {
    id: number;
    name: string;
    description?: string;
    internalCost: number;
    salePrice: number;
}

export default function CateringServices() {
    const { user } = useAuth();
    const userRoleNames = getUserRoleNames(user);
    const canManageCatering = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const [services, setServices] = useState<CateringServiceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingService, setEditingService] = useState<CateringServiceRow | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        internalCost: '',
        salePrice: ''
    });

    const loadServices = useCallback(async () => {
        try {
            setLoading(true);
            const response = await cateringAPI.getAllServices();
            setServices(response.data.data);
        } catch (error) {
            console.error('Error loading services:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadServices();
    }, [loadServices]);

    const handleOpenSidebar = (service?: CateringServiceRow) => {
        if (!canManageCatering) {
            alert('No tienes permisos para gestionar servicios de catering');
            return;
        }
        if (service) {
            setEditingService(service);
            setFormData({
                name: service.name,
                description: service.description || '',
                internalCost: service.internalCost.toString(),
                salePrice: service.salePrice.toString()
            });
        } else {
            setEditingService(null);
            setFormData({
                name: '',
                description: '',
                internalCost: '',
                salePrice: ''
            });
        }
        setIsSidebarOpen(true);
    };

    const handleSave = async () => {
        if (!canManageCatering) {
            alert('No tienes permisos para guardar servicios');
            return;
        }
        try {
            const data = {
                ...formData,
                internalCost: parseFloat(formData.internalCost) || 0,
                salePrice: parseFloat(formData.salePrice) || 0
            };

            if (editingService) {
                await cateringAPI.updateService(editingService.id, data);
            } else {
                await cateringAPI.createService(data);
            }

            loadServices();
            setIsSidebarOpen(false);
        } catch (error) {
            console.error('Error saving service:', error);
        }
    };

    const handleDelete = async (id: number) => {
        if (!canManageCatering) {
            alert('No tienes permisos para eliminar servicios');
            return;
        }
        if (!window.confirm('¿Está seguro de eliminar este servicio del catálogo?')) return;
        try {
            await cateringAPI.deleteService(id);
            loadServices();
        } catch (error) {
            console.error('Error deleting service:', error);
        }
    };

    const filteredServices = services.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="catering-page">
            <div className="catering-header">
                <div>
                    <h1><Library size={32} /> Catálogo de Servicios</h1>
                    <p className="catering-subtitle">Gestiona servicios, costos y precios de catering</p>
                </div>
                <Button onClick={() => handleOpenSidebar()} disabled={!canManageCatering}>
                    <Plus size={20} />
                    Nuevo Servicio
                </Button>
            </div>

            <div className="catering-filters">
                <div className="filter-right-section" style={{ width: '100%', maxWidth: '400px' }}>
                    <div style={{ position: 'relative', width: '100%' }}>
                        <input
                            type="text"
                            placeholder="Buscar en el catálogo..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input catering-search"
                            style={{ paddingLeft: '16px' }}
                        />
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="loading-state">Cargando catálogo...</div>
            ) : filteredServices.length === 0 ? (
                <div className="empty-state">
                    <ClipboardList size={64} opacity={0.2} />
                    <p>No hay servicios registrados en el catálogo</p>
                </div>
            ) : (
                <div className="items-table catalog-table" style={{ marginTop: '24px' }}>
                    <div className="items-table-header">
                        <span>Servicio y Descripción</span>
                        <span>Costo</span>
                        <span>Venta</span>
                        <span>Margen</span>
                        <span>Acciones</span>
                    </div>
                    {filteredServices.map((service) => {
                        const margin = service.salePrice - service.internalCost;
                        const marginPercent = service.salePrice > 0 ? (margin / service.salePrice) * 100 : 0;

                        let marginColor = 'var(--color-danger)';
                        if (marginPercent >= 50) marginColor = 'var(--color-success)';
                        else if (marginPercent >= 20) marginColor = 'var(--color-warning)';

                        return (
                            <div key={service.id} className="items-table-row">
                                <div className="service-name-container">
                                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>{service.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{service.description || 'Sin descripción'}</div>
                                </div>
                                <div className="service-price-text">
                                    ${Number(service.internalCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </div>
                                <div className="service-price-text" style={{ color: 'var(--color-success)' }}>
                                    ${Number(service.salePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </div>
                                <div style={{ fontWeight: 700, color: marginColor }}>
                                    {marginPercent.toFixed(1)}%
                                </div>
                                {canManageCatering && (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            className="action-btn-mini"
                                            onClick={() => handleOpenSidebar(service)}
                                            title="Editar"
                                        >
                                            <Edit2 size={15} />
                                        </button>
                                        <button
                                            className="action-btn-mini delete"
                                            onClick={() => handleDelete(service.id)}
                                            title="Eliminar"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingService ? `Editar: ${editingService.name}` : 'Nuevo Servicio de Catering'}
                width="normal"
            >
                <div className="catering-modal-content">
                    <div className="modal-tab-body" style={{ padding: '20px', overflowY: 'auto' }}>
                        <div className="animate-slide-in">
                            <div className="modal-section-v2">
                                <h3 className="section-title-v2">Información General</h3>
                                <div className="modal-input-group">
                                    <label>Nombre del Servicio</label>
                                    <input
                                        className="modal-standard-input"
                                        placeholder="Ej: Servicio de Mesoneros Premium"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div className="modal-input-group" style={{ marginTop: '16px' }}>
                                    <label>Descripción / Detalles</label>
                                    <textarea
                                        className="modal-standard-input"
                                        rows={4}
                                        placeholder="Describa qué incluye este servicio..."
                                        value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="modal-section-v2">
                                <h3 className="section-title-v2">Análisis de Costos y Precios</h3>
                                <div className="modal-form-row">
                                    <div className="modal-input-group">
                                        <label>Costo Interno ($)</label>
                                        <input
                                            type="number"
                                            className="modal-standard-input"
                                            placeholder="0.00"
                                            value={formData.internalCost}
                                            onChange={e => setFormData({ ...formData, internalCost: e.target.value })}
                                        />
                                    </div>
                                    <div className="modal-input-group">
                                        <label>Precio de Venta ($)</label>
                                        <input
                                            type="number"
                                            className="modal-standard-input"
                                            placeholder="0.00"
                                            value={formData.salePrice}
                                            onChange={e => setFormData({ ...formData, salePrice: e.target.value })}
                                        />
                                    </div>
                                </div>

                                {formData.internalCost && formData.salePrice && parseFloat(formData.salePrice) > 0 && (
                                    <div className="financial-container" style={{ marginTop: '20px' }}>
                                        <div className="financial-main-row">
                                            <div className="summary-item">
                                                <span className="label">Costo</span>
                                                <span className="value">${parseFloat(formData.internalCost).toLocaleString()}</span>
                                            </div>
                                            <div className="summary-item success">
                                                <span className="label">Utilidad</span>
                                                <span className="value">${(parseFloat(formData.salePrice) - parseFloat(formData.internalCost)).toLocaleString()}</span>
                                            </div>
                                            <div className="summary-item highlighted">
                                                <span className="label">Margen %</span>
                                                <span className="value">{((parseFloat(formData.salePrice) - parseFloat(formData.internalCost)) / parseFloat(formData.salePrice) * 100).toFixed(1)}%</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer" style={{ marginTop: 'auto', padding: '20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        <Button variant="secondary" onClick={() => setIsSidebarOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} disabled={!canManageCatering}>
                            {editingService ? 'Actualizar Servicio' : 'Guardar Servicio'}
                        </Button>
                    </div>
                </div>
            </Sidebar>
        </div>
    );
}
