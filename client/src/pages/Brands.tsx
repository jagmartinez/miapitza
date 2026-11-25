import { useState, useEffect, useCallback } from 'react';
import { menuBrandsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import { Plus, Tags, Edit2, Trash2, List } from 'lucide-react';
import type { MenuBrand } from '../types';
import './Categories.css';

const DEFAULT_COLOR = '#2563eb';

export default function Brands() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError } = useAppToast();
    /** Backend: brand mutations require SUPERADMIN | ADMIN | CHEF */
    const canMutate = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CHEF']);

    const [brands, setBrands] = useState<MenuBrand[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<MenuBrand | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        color: DEFAULT_COLOR,
        sortOrder: 0,
        active: true
    });
    const [saving, setSaving] = useState(false);
    const { viewMode, setViewMode } = useViewMode('brands');

    const loadData = useCallback(async () => {
        try {
            const res = await menuBrandsAPI.getAll();
            setBrands(res.data.data);
        } catch (error) {
            console.error('Error loading brands:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
        setEditing(null);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutate) return;
        setSaving(true);
        try {
            const payload = {
                name: formData.name.trim(),
                color: formData.color || null,
                sortOrder: formData.sortOrder,
                active: formData.active
            };
            if (editing) {
                await menuBrandsAPI.update(editing.id, payload);
            } else {
                await menuBrandsAPI.create(payload);
            }
            await loadData();
            closeModal();
        } catch (error: unknown) {
            console.error('Error saving brand:', error);
            const apiMsg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(apiMsg || 'Error al guardar la marca');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (brand: MenuBrand) => {
        if (!canMutate) return;
        if (!(await confirm('¿Eliminar esta marca? Solo se puede si no tiene platillos asociados.', { title: 'Confirmar acción' }))) return;
        try {
            await menuBrandsAPI.delete(brand.id);
            await loadData();
        } catch (error: unknown) {
            console.error('Error deleting brand:', error);
            const apiMsg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(apiMsg || 'Error al eliminar la marca');
        }
    };

    const openModal = (brand?: MenuBrand) => {
        if (!canMutate) return;
        if (brand) {
            setEditing(brand);
            setFormData({
                name: brand.name,
                color: brand.color || DEFAULT_COLOR,
                sortOrder: brand.sortOrder || 0,
                active: brand.active
            });
        } else {
            setEditing(null);
            setFormData({
                name: '',
                color: DEFAULT_COLOR,
                sortOrder: brands.length,
                active: true
            });
        }
        setIsModalOpen(true);
    };

    if (loading) return <div className="categories-loading">Sincronizando Marcas...</div>;

    return (
        <div className="categories-page">
            <PageHeader
                title="Marcas"
                subtitle={`${brands.length} marcas configuradas`}
                icon={Tags}
                actions={(
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <ViewToggle value={viewMode} onChange={setViewMode} />
                        {canMutate && (
                            <Button variant="primary" onClick={() => openModal()}>
                                <Plus size={20} />
                                Nueva Marca
                            </Button>
                        )}
                    </div>
                )}
            />

            {viewMode === 'table' && brands.length > 0 && (
                <CatalogTable<MenuBrand>
                    rows={brands}
                    rowKey={(b) => b.id}
                    columns={[
                        {
                            key: 'name',
                            header: 'Marca',
                            render: (b) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: b.color || DEFAULT_COLOR, display: 'inline-block', flexShrink: 0 }} />
                                        {b.name}
                                    </span>
                                </div>
                            )
                        },
                        { key: 'items', header: 'Platos', align: 'center', render: (b) => b._count?.menuItems || 0 },
                        { key: 'order', header: 'Orden', align: 'center', render: (b) => b.sortOrder ?? 0 },
                        {
                            key: 'status',
                            header: 'Estado',
                            render: (b) => <span className={`catalog-pill ${b.active ? 'ok' : 'neutral'}`}>{b.active ? 'Activa' : 'Inactiva'}</span>
                        },
                        ...(canMutate ? [{
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right' as const,
                            render: (b: MenuBrand) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => openModal(b)} title="Editar">
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        className="catalog-action-btn danger"
                                        onClick={() => handleDelete(b)}
                                        title="Eliminar"
                                        disabled={Number(b._count?.menuItems || 0) > 0}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            )
                        }] : [])
                    ] as CatalogColumn<MenuBrand>[]}
                />
            )}

            {viewMode === 'cards' && (
            <div className="categories-grid-new">
                {brands.map((brand) => (
                    <div key={brand.id} className="category-card-new">
                        <div className={`status-badge-new ${brand.active ? 'active' : 'inactive'}`}>
                            {brand.active ? 'Activa' : 'Inactiva'}
                        </div>

                        <div className="category-card-body-new">
                            <div className="category-name-new" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span
                                    style={{
                                        width: 14,
                                        height: 14,
                                        borderRadius: '50%',
                                        background: brand.color || DEFAULT_COLOR,
                                        display: 'inline-block',
                                        flexShrink: 0
                                    }}
                                />
                                {brand.name}
                            </div>

                            <div className="category-details-new">
                                <div className="detail-item">
                                    <List size={16} />
                                    <span>{brand._count?.menuItems || 0} platillos asociados</span>
                                </div>
                                <div className="detail-item">
                                    <Tags size={16} />
                                    <span>Orden: {brand.sortOrder}</span>
                                </div>
                            </div>
                        </div>

                        {canMutate && (
                            <div className="category-card-actions-new">
                                <button className="action-btn-new edit" onClick={() => openModal(brand)} title="Editar">
                                    <Edit2 size={20} />
                                    <span>Editar</span>
                                </button>
                                <button
                                    className="action-btn-new delete"
                                    onClick={() => handleDelete(brand)}
                                    title="Eliminar"
                                    disabled={Number(brand._count?.menuItems || 0) > 0}
                                >
                                    <Trash2 size={20} />
                                    <span>Eliminar</span>
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            )}

            {brands.length === 0 && (
                <div className="no-categories-message">
                    <Tags size={48} />
                    <p>No hay marcas configuradas</p>
                    {canMutate && (
                        <Button onClick={() => openModal()}>Crear primera marca</Button>
                    )}
                </div>
            )}

            <Sidebar
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editing ? 'Editar Marca' : 'Nueva Marca'}
            >
                <div className="premium-modal-content categories-modal-content">
                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-content-group">
                                <div className="modal-section-header">
                                    <Tags size={18} />
                                    <h3>Detalles de la Marca</h3>
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="brand-name">Nombre de la Marca</label>
                                    <input
                                        id="brand-name"
                                        type="text"
                                        className="modal-standard-input"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Ej: Pizzería, Cafetería, Heladería..."
                                        required
                                    />
                                </div>

                                <div className="modal-form-row">
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="brand-color">Color</label>
                                        <input
                                            id="brand-color"
                                            type="color"
                                            className="modal-standard-input"
                                            style={{ padding: '4px', height: '44px' }}
                                            value={formData.color}
                                            onChange={e => setFormData({ ...formData, color: e.target.value })}
                                        />
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="brand-sort">Orden</label>
                                        <input
                                            id="brand-sort"
                                            type="number"
                                            className="modal-standard-input"
                                            value={formData.sortOrder}
                                            onChange={e => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label" id="brand-active-label">Estado de la Marca</label>
                                    <div
                                        role="switch"
                                        aria-checked={formData.active}
                                        aria-labelledby="brand-active-label"
                                        className={`modal-toggle-card ${formData.active ? 'active' : ''}`}
                                        onClick={() => setFormData({ ...formData, active: !formData.active })}
                                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--color-background)', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                                    >
                                        <div className="toggle-switch">
                                            <div className={`toggle-dot ${formData.active ? 'active' : ''}`} />
                                        </div>
                                        <span>{formData.active ? 'Visible en el POS' : 'Oculta en el POS'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <Button variant="ghost" type="button" onClick={closeModal}>
                                Cancelar
                            </Button>
                            <Button variant="primary" type="submit" disabled={saving}>
                                {saving ? 'Guardando...' : editing ? 'Guardar Cambios' : 'Crear Marca'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
