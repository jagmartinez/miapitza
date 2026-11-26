import { useState, useEffect, useCallback } from 'react';
import { notifyError } from '../services/notify';
import { menuBrandsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import { Plus, Tags, Edit2, Trash2, Search } from 'lucide-react';
import type { MenuBrand } from '../types';
import styles from './catalog.module.css';
import {
    Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    NumberInput, PageContent, PageHeader, SegmentedControl, Switch, TableToolbar, type Column,
} from '@/ui';

type StatusFilter = 'all' | 'active' | 'inactive';
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'active', label: 'Activas' },
    { value: 'inactive', label: 'Inactivas' },
];

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
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    const loadData = useCallback(async () => {
        try {
            const res = await menuBrandsAPI.getAll();
            setBrands(res.data.data);
        } catch (error) {
            notifyError(error, 'No se pudieron cargar las marcas');
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

    const columns: Column<MenuBrand>[] = [
        {
            key: 'name',
            header: 'Marca',
            render: (b) => (
                <span className={styles.cellTitle}>
                    <span className={styles.swatch} style={{ background: b.color || DEFAULT_COLOR }} aria-hidden="true" />
                    {b.name}
                </span>
            )
        },
        { key: 'items', header: 'Platos', type: 'number', decimals: 0, accessor: (b) => b._count?.menuItems || 0 },
        { key: 'order', header: 'Orden', type: 'number', decimals: 0, accessor: (b) => b.sortOrder ?? 0 },
        {
            key: 'status',
            header: 'Estado',
            render: (b) => <Badge tone={b.active ? 'success' : 'neutral'} dot>{b.active ? 'Activa' : 'Inactiva'}</Badge>
        },
        ...(canMutate ? [{
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            render: (b: MenuBrand) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Edit2} label={`Editar ${b.name}`} onClick={() => openModal(b)} />
                    <IconButton
                        size="sm"
                        icon={Trash2}
                        label={`Eliminar ${b.name}`}
                        onClick={() => handleDelete(b)}
                        disabled={Number(b._count?.menuItems || 0) > 0}
                    />
                </div>
            )
        }] : [])
    ] as Column<MenuBrand>[];

    const q = search.trim().toLowerCase();
    const filtered = brands.filter((b) => {
        if (statusFilter === 'active' && !b.active) return false;
        if (statusFilter === 'inactive' && b.active) return false;
        return !q || b.name.toLowerCase().includes(q);
    });

    return (
        <PageContent>
            <PageHeader
                title="Marcas"
                description={`${brands.length} marcas configuradas`}
                actions={canMutate ? (
                    <Button variant="primary" icon={Plus} onClick={() => openModal()}>
                        Nueva marca
                    </Button>
                ) : undefined}
            />

            <DataTable<MenuBrand>
                ariaLabel="Listado de marcas"
                rows={filtered}
                rowKey={(b) => b.id}
                columns={columns}
                loading={loading}
                resetKey={`${q}|${statusFilter}`}
                onRowClick={canMutate ? (b) => openModal(b) : undefined}
                empty={brands.length === 0 ? (
                    <EmptyState
                        icon={Tags}
                        title="No hay marcas configuradas"
                        action={canMutate ? <Button variant="primary" onClick={() => openModal()}>Crear primera marca</Button> : undefined}
                    />
                ) : 'Sin resultados. Ajusta o limpia los filtros.'}
                toolbar={(
                    <TableToolbar>
                        <Input
                            type="search"
                            aria-label="Buscar marca"
                            placeholder="Buscar marca"
                            prefix={<Search size={14} aria-hidden="true" />}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <SegmentedControl
                            ariaLabel="Estado"
                            options={STATUS_OPTIONS}
                            value={statusFilter}
                            onChange={setStatusFilter}
                        />
                    </TableToolbar>
                )}
            />

            <FullScreenModal
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editing ? 'Editar marca' : 'Nueva marca'}
                breadcrumb={['Menú', 'Marcas']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="brand-form" loading={saving}>
                            {editing ? 'Guardar cambios' : 'Crear marca'}
                        </Button>
                    </>
                )}
            >
                <form id="brand-form" onSubmit={handleSubmit} className={styles.stack}>
                    <FormSection step={1} title="Detalles de la marca" description="Nombre, color y posición en el POS.">
                        <FormGrid>
                            <Field label="Nombre de la marca" htmlFor="brand-name" required>
                                <Input
                                    id="brand-name"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="Ej: Pizzería, Cafetería, Heladería..."
                                    required
                                />
                            </Field>
                            <Field label="Color" htmlFor="brand-color">
                                <input
                                    id="brand-color"
                                    type="color"
                                    className={styles.colorInput}
                                    value={formData.color}
                                    onChange={e => setFormData({ ...formData, color: e.target.value })}
                                />
                            </Field>
                            <Field label="Orden" htmlFor="brand-sort">
                                <NumberInput
                                    id="brand-sort"
                                    decimals={0}
                                    min={0}
                                    value={formData.sortOrder}
                                    onChange={(v) => setFormData({ ...formData, sortOrder: v ?? 0 })}
                                />
                            </Field>
                        </FormGrid>
                        <Switch
                            id="brand-active"
                            checked={formData.active}
                            onChange={(active) => setFormData({ ...formData, active })}
                            label={formData.active ? 'Visible en el POS' : 'Oculta en el POS'}
                        />
                    </FormSection>
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
