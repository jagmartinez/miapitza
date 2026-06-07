import { useState, useEffect } from 'react';
import { categoriesAPI } from '../services/api';
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
import { Plus, Tag, Edit2, Trash2, List } from 'lucide-react';
import { getCategoryVisibilityLabel } from '../utils/categoryVisibility';
import './Categories.css';

interface CategoryRow {
    id: number;
    name: string;
    description?: string;
    codePrefix?: string;
    sortOrder?: number;
    active: boolean;
    showInMenu: boolean;
    showInInventory: boolean;
    _count?: {
        menuItems?: number;
        products?: number;
    };
}

export default function Categories() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError } = useAppToast();
    /** Backend: category mutations require SUPERADMIN | ADMIN (CHEF can list only) */
    const canMutateCategory = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CHEF']);

    const [categories, setCategories] = useState<CategoryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        codePrefix: '',
        sortOrder: 0,
        active: true,
        showInMenu: true,
        showInInventory: true
    });
    const [activeTab, setActiveTab] = useState<'info' | 'config'>('info');
    const [saving, setSaving] = useState(false);
    const { viewMode, setViewMode } = useViewMode('categories');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const res = await categoriesAPI.getAll();
            setCategories(res.data.data);
        } catch (error) {
            console.error('Error loading categories:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutateCategory) return;

        if (formData.active && !formData.showInMenu && !formData.showInInventory) {
            showError('La categoría debe ser visible en menú, inventario o ambos.');
            setActiveTab('config');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                ...formData,
                codePrefix: formData.codePrefix.trim() || null,
            };
            if (editingCategory) {
                await categoriesAPI.update(editingCategory.id, payload);
            } else {
                await categoriesAPI.create(payload);
            }
            loadData();
            closeModal();
        } catch (error: unknown) {
            console.error('Error saving category:', error);
            let message = 'Error al guardar la categoría';
            if (typeof error === 'object' && error !== null && 'response' in error) {
                const apiMessage = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
                if (typeof apiMessage === 'string' && apiMessage.trim()) {
                    message = apiMessage;
                }
            }
            showError(message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!canMutateCategory) return;
        if (!(await confirm('¿Estás seguro de eliminar esta categoría? Solo se puede eliminar si no tiene platos asociados.', { title: 'Confirmar acción' }))) return;
        try {
            await categoriesAPI.delete(id);
            loadData();
        } catch (error: unknown) {
            console.error('Error deleting category:', error);
            const apiMsg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(apiMsg || 'Error al eliminar la categoría');
        }
    };

    const openModal = (category?: CategoryRow) => {
        if (!canMutateCategory) return;
        if (category) {
            setEditingCategory(category);
            setFormData({
                name: category.name,
                description: category.description || '',
                codePrefix: category.codePrefix || '',
                sortOrder: category.sortOrder || 0,
                active: category.active,
                showInMenu: category.showInMenu ?? true,
                showInInventory: category.showInInventory ?? true
            });
        } else {
            setEditingCategory(null);
            setFormData({
                name: '',
                description: '',
                codePrefix: '',
                sortOrder: categories.length,
                active: true,
                showInMenu: true,
                showInInventory: true
            });
        }
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingCategory(null);
    };

    if (loading) return <div className="categories-loading">Sincronizando Categorías...</div>;

    return (
        <div className="categories-page">
            <PageHeader
                title="Categorías"
                subtitle={`${categories.length} categorías configuradas`}
                icon={Tag}
                actions={(
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <ViewToggle value={viewMode} onChange={setViewMode} />
                        {canMutateCategory && (
                            <Button variant="primary" onClick={() => openModal()}>
                                <Plus size={20} />
                                Nueva Categoría
                            </Button>
                        )}
                    </div>
                )}
            />

            {viewMode === 'table' && categories.length > 0 && (
                <CatalogTable<CategoryRow>
                    rows={categories}
                    rowKey={(c) => c.id}
                    columns={[
                        {
                            key: 'name',
                            header: 'Categoría',
                            render: (c) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{c.name}</span>
                                    {c.description && <span className="cell-sub">{c.description}</span>}
                                </div>
                            )
                        },
                        { key: 'prefix', header: 'Prefijo', render: (c) => c.codePrefix || '-' },
                        { key: 'items', header: 'Platos', align: 'center', render: (c) => c._count?.menuItems || 0 },
                        { key: 'order', header: 'Orden', align: 'center', render: (c) => c.sortOrder ?? 0 },
                        {
                            key: 'status',
                            header: 'Estado',
                            render: (c) => (
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    <span className={`catalog-pill ${c.active ? 'ok' : 'neutral'}`}>{c.active ? 'Activa' : 'Inactiva'}</span>
                                    {c.active && (
                                        <span className="catalog-pill neutral">
                                            {getCategoryVisibilityLabel(c.showInMenu ?? true, c.showInInventory ?? true)}
                                        </span>
                                    )}
                                </div>
                            )
                        },
                        ...(canMutateCategory ? [{
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right' as const,
                            render: (c: CategoryRow) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => openModal(c)} title="Editar">
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        className="catalog-action-btn danger"
                                        onClick={() => handleDelete(c.id)}
                                        title="Eliminar"
                                        disabled={Number(c._count?.menuItems || 0) > 0}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            )
                        }] : [])
                    ] as CatalogColumn<CategoryRow>[]}
                />
            )}

            {viewMode === 'cards' && (
            <div className="categories-grid-new">
                {categories.map((category) => (
                    <div key={category.id} className="category-card-new">
                        {/* Status/Badge */}
                                <div className={`status-badge-new ${category.active ? 'active' : 'inactive'}`}>
                                    {!category.active
                                        ? 'Inactiva'
                                        : getCategoryVisibilityLabel(category.showInMenu ?? true, category.showInInventory ?? true)}
                                </div>

                        {/* Card Body */}
                        <div className="category-card-body-new">
                            <div className="category-name-new">{category.name}</div>

                            <div className="category-details-new">
                                <div className="detail-item">
                                    <List size={16} />
                                    <span>{category._count?.menuItems || 0} Platos asociados</span>
                                </div>
                                <div className="detail-item">
                                    <Tag size={16} />
                                    <span>{category._count?.products || 0} Productos inventario</span>
                                </div>
                                {category.codePrefix && (
                                    <div className="detail-item">
                                        <Tag size={16} />
                                        <span>Prefijo: <strong>{category.codePrefix}</strong></span>
                                    </div>
                                )}
                                <div className="detail-item">
                                    <Tag size={16} />
                                    <span>Orden: {category.sortOrder}</span>
                                </div>
                                <div className="detail-item category-description-text">
                                    <span>{category.description || 'Sin descripción'}</span>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        {canMutateCategory && (
                            <div className="category-card-actions-new">
                                <button
                                    className="action-btn-new edit"
                                    onClick={() => openModal(category)}
                                    title="Editar"
                                >
                                    <Edit2 size={20} />
                                    <span>Editar</span>
                                </button>
                                <button
                                    className="action-btn-new delete"
                                    onClick={() => handleDelete(category.id)}
                                    title="Eliminar"
                                    disabled={Number(category._count?.menuItems || 0) > 0}
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

            {categories.length === 0 && (
                <div className="no-categories-message">
                    <Tag size={48} />
                    <p>No hay categorías configuradas</p>
                    {canMutateCategory && (
                        <Button onClick={() => openModal()}>Crear primera categoría</Button>
                    )}
                </div>
            )}

            <Sidebar
                isOpen={isModalOpen}
                onClose={() => { closeModal(); setActiveTab('info'); }}
                title={editingCategory ? 'Editar Categoría' : 'Nueva Categoría'}
            >
                <div className="premium-modal-content categories-modal-content">
                    {/* NAVIGATION TABS */}
                    <div className="modal-tabs">
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'info' ? 'active' : ''}`}
                            onClick={() => setActiveTab('info')}
                        >
                            <Tag size={18} />
                            <span>Información</span>
                        </button>
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'config' ? 'active' : ''}`}
                            onClick={() => setActiveTab('config')}
                        >
                            <List size={18} />
                            <span>Configuración</span>
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            {/* 1. INFORMACIÓN TAB */}
                            {activeTab === 'info' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <Tag size={18} />
                                        <h3>Detalles de Categoría</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="category-name">Nombre de la Categoría</label>
                                        <input
                                            id="category-name"
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Ej: Entradas, Postres, Bebidas..."
                                            required
                                            autoFocus
                                        />
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="category-code-prefix">Prefijo de Código (SKU)</label>
                                        <input
                                            id="category-code-prefix"
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.codePrefix}
                                            onChange={e => setFormData({ ...formData, codePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 10) })}
                                            placeholder="Ej: CAR, BEB, VEG..."
                                            maxLength={10}
                                        />
                                        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                            Se usa para generar códigos automáticos en productos (ej: CAR-000001). Solo letras, máx 10 caracteres.
                                        </p>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="category-description">Descripción (Opcional)</label>
                                        <textarea
                                            id="category-description"
                                            className="modal-standard-input"
                                            style={{ minHeight: '120px', paddingTop: '12px', resize: 'vertical' }}
                                            value={formData.description}
                                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                                            placeholder="Breve detalle sobre lo que incluye esta categoría..."
                                        />
                                    </div>
                                </div>
                            )}

                            {/* 2. CONFIGURACIÓN TAB */}
                            {activeTab === 'config' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <List size={18} />
                                        <h3>Ajustes Visuales</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" id="category-show-in-menu-label">Visibilidad en Menú / POS</label>
                                        <div
                                            id="category-show-in-menu"
                                            role="switch"
                                            aria-checked={formData.showInMenu}
                                            aria-labelledby="category-show-in-menu-label"
                                            className={`modal-toggle-card ${formData.showInMenu ? 'active' : ''}`}
                                            onClick={() => setFormData({ ...formData, showInMenu: !formData.showInMenu })}
                                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--color-background)', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                                        >
                                            <div className="toggle-switch">
                                                <div className={`toggle-dot ${formData.showInMenu ? 'active' : ''}`} />
                                            </div>
                                            <span>{formData.showInMenu ? 'Visible en el menú / POS' : 'Oculta del menú / POS'}</span>
                                        </div>
                                        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                            Controla si la categoría aparece al crear platos y en el punto de venta.
                                        </p>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" id="category-show-in-inventory-label">Visibilidad en Inventario</label>
                                        <div
                                            id="category-show-in-inventory"
                                            role="switch"
                                            aria-checked={formData.showInInventory}
                                            aria-labelledby="category-show-in-inventory-label"
                                            className={`modal-toggle-card ${formData.showInInventory ? 'active' : ''}`}
                                            onClick={() => setFormData({ ...formData, showInInventory: !formData.showInInventory })}
                                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--color-background)', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                                        >
                                            <div className="toggle-switch">
                                                <div className={`toggle-dot ${formData.showInInventory ? 'active' : ''}`} />
                                            </div>
                                            <span>{formData.showInInventory ? 'Visible en inventario' : 'Oculta del inventario'}</span>
                                        </div>
                                        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                            Controla si la categoría aparece al crear productos y en los filtros de inventario.
                                        </p>
                                    </div>

                                    {formData.active && !formData.showInMenu && !formData.showInInventory && (
                                        <p style={{ fontSize: '12px', color: 'var(--color-danger, #ef4444)', margin: 0 }}>
                                            Debe activar al menos una visibilidad (menú o inventario).
                                        </p>
                                    )}

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" id="category-active-label">Estado de la Categoría</label>
                                        <div
                                            id="category-active"
                                            role="switch"
                                            aria-checked={formData.active}
                                            aria-labelledby="category-active-label"
                                            className={`modal-toggle-card ${formData.active ? 'active' : ''}`}
                                            onClick={() => setFormData({ ...formData, active: !formData.active })}
                                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--color-background)', borderRadius: '8px', border: '1px solid var(--color-border)' }}
                                        >
                                            <div className="toggle-switch">
                                                <div className={`toggle-dot ${formData.active ? 'active' : ''}`} />
                                            </div>
                                            <span>{formData.active ? 'Categoría activa' : 'Categoría desactivada'}</span>
                                        </div>
                                        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                            Si se desactiva, la categoría no aparecerá en ningún lugar del sistema.
                                        </p>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="category-sort-order">Orden de Visualización</label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                id="category-sort-order"
                                                type="number"
                                                className="modal-standard-input"
                                                value={formData.sortOrder}
                                                onChange={e => setFormData({ ...formData, sortOrder: parseInt(e.target.value) })}
                                                placeholder="0"
                                            />
                                            <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '8px' }}>
                                                Define la posición de esta categoría en los filtros del menú. Números menores aparecen primero.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button variant="ghost" type="button" onClick={closeModal}>
                                Cancelar
                            </Button>
                            <Button variant="primary" type="submit" disabled={saving}>
                                {saving ? 'Guardando...' : editingCategory ? 'Guardar Cambios' : 'Crear Categoría'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
