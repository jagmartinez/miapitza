import { useState, useEffect, useCallback } from 'react';
import {
    Library, Plus, Trash2, Edit2,
    ClipboardList, FileText, BadgeDollarSign
} from 'lucide-react';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import LoadingSpinner from '../components/LoadingSpinner';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import { cateringAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import { useCurrency } from '../hooks/useCurrency';
import './CateringMod.css';

interface CateringServiceRow {
    id: number;
    name: string;
    description?: string;
    internalCost: number;
    salePrice: number;
}

const marginPct = (s: { internalCost: number; salePrice: number }) =>
    s.salePrice > 0 ? ((s.salePrice - s.internalCost) / s.salePrice) * 100 : 0;
const marginColor = (pct: number) =>
    pct >= 50 ? 'var(--color-success)' : pct >= 20 ? 'var(--color-warning)' : 'var(--color-danger)';
export default function CateringServices() {
    const { user } = useAuth();
    const { formatMoney: money } = useCurrency();
    const { confirm } = useConfirmDialog();
    const { warning: showWarning, error: showError } = useAppToast();
    const userRoleNames = getUserRoleNames(user);
    const canManageCatering = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const [services, setServices] = useState<CateringServiceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingService, setEditingService] = useState<CateringServiceRow | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const { viewMode, setViewMode } = useViewMode('catering-services', 'table');

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
            showWarning('No tienes permisos para gestionar servicios de catering');
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
        if (saving) return;
        if (!canManageCatering) {
            showWarning('No tienes permisos para guardar servicios');
            return;
        }
        if (!formData.name.trim()) {
            showError('El nombre del servicio es obligatorio.');
            return;
        }
        try {
            setSaving(true);
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
            showError('No se pudo guardar el servicio de catering.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!canManageCatering) {
            showWarning('No tienes permisos para eliminar servicios');
            return;
        }
        if (!(await confirm('¿Está seguro de eliminar este servicio del catálogo?', { title: 'Confirmar acción' }))) return;
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <ViewToggle value={viewMode} onChange={setViewMode} />
                    <Button onClick={() => handleOpenSidebar()} disabled={!canManageCatering}>
                        <Plus size={20} />
                        Nuevo Servicio
                    </Button>
                </div>
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
                <LoadingSpinner text="Cargando catálogo..." />
            ) : filteredServices.length === 0 ? (
                <div className="empty-state">
                    <ClipboardList size={64} opacity={0.2} />
                    <p>No hay servicios registrados en el catálogo</p>
                </div>
            ) : viewMode === 'table' ? (
                <CatalogTable<CateringServiceRow>
                    rows={filteredServices}
                    rowKey={(s) => s.id}
                    resetKey={searchQuery}
                    columns={[
                        {
                            key: 'name',
                            header: 'Servicio',
                            render: (s) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{s.name}</span>
                                    {s.description && <span className="cell-sub">{s.description}</span>}
                                </div>
                            )
                        },
                        { key: 'cost', header: 'Costo', align: 'right', render: (s) => money(s.internalCost) },
                        { key: 'sale', header: 'Venta', align: 'right', render: (s) => <span style={{ color: 'var(--color-success)' }}>{money(s.salePrice)}</span> },
                        { key: 'margin', header: 'Margen', align: 'right', render: (s) => { const m = marginPct(s); return <span style={{ fontWeight: 700, color: marginColor(m) }}>{m.toFixed(1)}%</span>; } },
                        ...(canManageCatering ? [{
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right' as const,
                            render: (s: CateringServiceRow) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => handleOpenSidebar(s)} title="Editar"><Edit2 size={16} /></button>
                                    <button className="catalog-action-btn danger" onClick={() => handleDelete(s.id)} title="Eliminar"><Trash2 size={16} /></button>
                                </div>
                            )
                        }] : [])
                    ] as CatalogColumn<CateringServiceRow>[]}
                />
            ) : (
                <div className="catalog-cards" style={{ marginTop: '24px' }}>
                    {filteredServices.map((service) => {
                        const m = marginPct(service);
                        return (
                            <div key={service.id} className="catalog-card">
                                <div>
                                    <div className="catalog-card-title">{service.name}</div>
                                    <div className="catalog-card-sub">{service.description || 'Sin descripción'}</div>
                                </div>
                                <div className="catalog-card-rows">
                                    <div className="catalog-card-row"><span className="label">Costo</span><span className="value">{money(service.internalCost)}</span></div>
                                    <div className="catalog-card-row"><span className="label">Venta</span><span className="value" style={{ color: 'var(--color-success)' }}>{money(service.salePrice)}</span></div>
                                    <div className="catalog-card-row"><span className="label">Margen</span><span className="value" style={{ color: marginColor(m) }}>{m.toFixed(1)}%</span></div>
                                </div>
                                {canManageCatering && (
                                    <div className="catalog-card-actions">
                                        <button className="action-btn-mini" onClick={() => handleOpenSidebar(service)} title="Editar"><Edit2 size={15} /></button>
                                        <button className="action-btn-mini delete" onClick={() => handleDelete(service.id)} title="Eliminar"><Trash2 size={15} /></button>
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
                <div className="premium-modal-content catering-modal-content catering-service-modal-content">
                    <form
                        className="modal-form-new"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleSave();
                        }}
                    >
                        <div className="modal-tab-content">
                            <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <FileText size={18} aria-hidden="true" />
                                    <h3>Información general</h3>
                                </div>
                                <div className="modal-input-group">
                                    <label htmlFor="catering-service-name">Nombre del servicio</label>
                                    <input
                                        id="catering-service-name"
                                        className="modal-standard-input"
                                        placeholder="Ej: Servicio de Mesoneros Premium"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        autoComplete="off"
                                        required
                                    />
                                </div>
                                <div className="modal-input-group">
                                    <label htmlFor="catering-service-description">Descripción / detalles</label>
                                    <textarea
                                        id="catering-service-description"
                                        className="modal-textarea"
                                        rows={4}
                                        placeholder="Describa qué incluye este servicio..."
                                        value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <BadgeDollarSign size={18} aria-hidden="true" />
                                    <h3>Análisis de costos y precios</h3>
                                </div>
                                <div className="modal-form-row">
                                    <div className="modal-input-group">
                                        <label htmlFor="catering-service-cost">Costo interno</label>
                                        <input
                                            id="catering-service-cost"
                                            type="number"
                                            className="modal-standard-input"
                                            placeholder="0.00"
                                            value={formData.internalCost}
                                            onChange={e => setFormData({ ...formData, internalCost: e.target.value })}
                                            min="0"
                                            step="0.01"
                                            inputMode="decimal"
                                            required
                                        />
                                    </div>
                                    <div className="modal-input-group">
                                        <label htmlFor="catering-service-price">Precio de venta</label>
                                        <input
                                            id="catering-service-price"
                                            type="number"
                                            className="modal-standard-input"
                                            placeholder="0.00"
                                            value={formData.salePrice}
                                            onChange={e => setFormData({ ...formData, salePrice: e.target.value })}
                                            min="0"
                                            step="0.01"
                                            inputMode="decimal"
                                            required
                                        />
                                    </div>
                                </div>

                                {formData.internalCost && formData.salePrice && parseFloat(formData.salePrice) > 0 && (
                                    <div className="financial-container" style={{ marginTop: '20px' }}>
                                        <div className="financial-main-row">
                                            <div className="summary-item">
                                                <span className="label">Costo</span>
                                                <span className="value">{money(parseFloat(formData.internalCost) || 0)}</span>
                                            </div>
                                            <div className="summary-item success">
                                                <span className="label">Utilidad</span>
                                                <span className="value">{money((parseFloat(formData.salePrice) || 0) - (parseFloat(formData.internalCost) || 0))}</span>
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

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>Cancelar</Button>
                            <Button type="submit" disabled={!canManageCatering || saving}>
                            {saving ? 'Guardando...' : editingService ? 'Actualizar Servicio' : 'Guardar Servicio'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
