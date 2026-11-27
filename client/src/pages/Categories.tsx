import { useState, useEffect } from 'react';
import { notifyError } from '../services/notify';
import { categoriesAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import { Plus, Tag, Pencil, Trash2, Search } from 'lucide-react';
import { getCategoryVisibilityLabel } from '../utils/categoryVisibility';
import styles from './catalog.module.css';
import {
    Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    NumberInput, PageContent, PageHeader, SegmentedControl, Switch, TableToolbar, Textarea, type Column,
} from '@/ui';

type StatusFilter = 'all' | 'active' | 'inactive';
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'active', label: 'Activas' },
    { value: 'inactive', label: 'Inactivas' },
];

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
    const [loadError, setLoadError] = useState<string | null>(null);
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
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const res = await categoriesAPI.getAll();
            setCategories(res.data.data);
            setLoadError(null);
        } catch (error) {
            setLoadError('No se pudieron cargar las categorías.');
            notifyError(error, 'No se pudieron cargar las categorías');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutateCategory) return;

        if (formData.active && !formData.showInMenu && !formData.showInInventory) {
            showError('La categoría debe ser visible en menú, inventario o ambos.');
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

    const columns: Column<CategoryRow>[] = [
        {
            key: 'name',
            header: 'Categoría',
            render: (c) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{c.name}</span>
                    {c.description && <span className={styles.muted}>{c.description}</span>}
                </div>
            )
        },
        { key: 'prefix', header: 'Prefijo', width: '1fr', accessor: (c) => c.codePrefix || '—' },
        { key: 'items', header: 'Platos', type: 'number', decimals: 0, accessor: (c) => c._count?.menuItems || 0 },
        { key: 'order', header: 'Orden', type: 'number', decimals: 0, accessor: (c) => c.sortOrder ?? 0 },
        {
            key: 'status',
            header: 'Estado',
            render: (c) => (
                <div className={styles.inline}>
                    <Badge tone={c.active ? 'success' : 'neutral'} dot>{c.active ? 'Activa' : 'Inactiva'}</Badge>
                    {c.active && <Badge>{getCategoryVisibilityLabel(c.showInMenu ?? true, c.showInInventory ?? true)}</Badge>}
                </div>
            )
        },
        ...(canMutateCategory ? [{
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '100px',
            render: (c: CategoryRow) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Pencil} label={`Editar ${c.name}`} tooltip="Editar" onClick={() => openModal(c)} />
                    <IconButton
                        size="sm"
                        icon={Trash2}
                        tone="danger"
                        tooltip="Eliminar"
                        label={`Eliminar ${c.name}`}
                        onClick={() => handleDelete(c.id)}
                        disabled={Number(c._count?.menuItems || 0) > 0}
                    />
                </div>
            )
        }] : [])
    ] as Column<CategoryRow>[];

    const q = search.trim().toLowerCase();
    const filtered = categories.filter((c) => {
        if (statusFilter === 'active' && !c.active) return false;
        if (statusFilter === 'inactive' && c.active) return false;
        return !q || c.name.toLowerCase().includes(q) || (c.codePrefix ?? '').toLowerCase().includes(q);
    });
    const noVisibility = formData.active && !formData.showInMenu && !formData.showInInventory;

    return (
        <PageContent>
            <PageHeader
                title="Categorías"
                description={`${categories.length} categorías configuradas`}
                actions={canMutateCategory ? (
                    <Button variant="primary" icon={Plus} onClick={() => openModal()}>
                        Nueva categoría
                    </Button>
                ) : undefined}
            />

            <TableToolbar>
                <Input
                    type="search"
                    aria-label="Buscar categoría"
                    placeholder="Buscar por nombre o prefijo"
                    prefix={<Search size={14} aria-hidden="true" />}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <SegmentedControl ariaLabel="Estado" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
            </TableToolbar>

            <DataTable<CategoryRow>
                ariaLabel="Listado de categorías"
                rows={filtered}
                rowKey={(c) => c.id}
                columns={columns}
                loading={loading}
                error={loadError}
                onRetry={() => void loadData()}
                resetKey={`${q}|${statusFilter}`}
                onRowClick={canMutateCategory ? (c) => openModal(c) : undefined}
                empty={categories.length === 0 ? (
                    <EmptyState
                        icon={Tag}
                        title="No hay categorías configuradas"
                        action={canMutateCategory ? <Button variant="primary" onClick={() => openModal()}>Crear primera categoría</Button> : undefined}
                    />
                ) : 'Sin resultados. Ajusta o limpia los filtros.'}
            />

            <FullScreenModal
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editingCategory ? 'Editar categoría' : 'Nueva categoría'}
                breadcrumb={['Menú', 'Categorías']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="category-form" loading={saving}>
                            {editingCategory ? 'Guardar cambios' : 'Crear categoría'}
                        </Button>
                    </>
                )}
            >
                <form id="category-form" onSubmit={handleSubmit} className={styles.stack}>
                    <FormSection step={1} title="Información general" description="Nombre, prefijo de código y descripción.">
                        <FormGrid>
                            <Field label="Nombre de la categoría" htmlFor="category-name" required>
                                <Input
                                    id="category-name"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="Ej: Bebidas, Postres, Entradas..."
                                    required
                                />
                            </Field>
                            <Field label="Prefijo de código (SKU)" htmlFor="category-code-prefix" hint="Solo letras, hasta 10. Se usa para generar códigos de producto.">
                                <Input
                                    id="category-code-prefix"
                                    value={formData.codePrefix}
                                    onChange={e => setFormData({ ...formData, codePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 10) })}
                                    placeholder="Ej: BEB"
                                />
                            </Field>
                        </FormGrid>
                        <Field label="Descripción (opcional)" htmlFor="category-description">
                            <Textarea
                                id="category-description"
                                rows={4}
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Breve detalle sobre lo que incluye esta categoría..."
                            />
                        </Field>
                    </FormSection>

                    <FormSection step={2} title="Visibilidad y estado" description="Dónde aparece la categoría y en qué orden.">
                        <div className={styles.stack}>
                            <div className={styles.cellStack}>
                                <Switch
                                    id="category-show-in-menu"
                                    checked={formData.showInMenu}
                                    onChange={(showInMenu) => setFormData({ ...formData, showInMenu })}
                                    label={formData.showInMenu ? 'Visible en el menú / POS' : 'Oculta del menú / POS'}
                                />
                                <p className={styles.muted}>Controla si la categoría aparece al crear platos y en el punto de venta.</p>
                            </div>
                            <div className={styles.cellStack}>
                                <Switch
                                    id="category-show-in-inventory"
                                    checked={formData.showInInventory}
                                    onChange={(showInInventory) => setFormData({ ...formData, showInInventory })}
                                    label={formData.showInInventory ? 'Visible en inventario' : 'Oculta del inventario'}
                                />
                                <p className={styles.muted}>Controla si la categoría aparece al crear productos y en los filtros de inventario.</p>
                            </div>
                            {noVisibility && (
                                <p className={styles.alert} role="alert">Debe activar al menos una visibilidad (menú o inventario).</p>
                            )}
                            <div className={styles.cellStack}>
                                <Switch
                                    id="category-active"
                                    checked={formData.active}
                                    onChange={(active) => setFormData({ ...formData, active })}
                                    label={formData.active ? 'Categoría activa' : 'Categoría desactivada'}
                                />
                                <p className={styles.muted}>Si se desactiva, la categoría no aparecerá en ningún lugar del sistema.</p>
                            </div>
                        </div>
                        <FormGrid>
                            <Field label="Orden de visualización" htmlFor="category-sort-order">
                                <NumberInput
                                    id="category-sort-order"
                                    decimals={0}
                                    min={0}
                                    value={formData.sortOrder}
                                    onChange={(v) => setFormData({ ...formData, sortOrder: v ?? 0 })}
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
