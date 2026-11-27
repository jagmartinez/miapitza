import { useState, useEffect } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';
import { suppliersAPI, settingsAPI } from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import { Plus, Trash2, Truck, Search, History, Pencil } from 'lucide-react';
import type { Supplier } from '../types';
import styles from './catalog.module.css';
import {
    AppSelect, Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    PageContent, PageHeader, TableToolbar, Textarea, type Column,
} from '@/ui';


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

const FIXED_SUPPLY_TYPES = [
    'Aceites y Especias', 'Carnes y Embutidos', 'Lácteos', 'Frutas y Verduras',
    'Vinos', 'Mariscos', 'Harinas y Sales', 'Panadería', 'Bebidas', 'Suministros'
];

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
            notifyError(err, 'No se pudo cargar el historial de precios');
        } finally {
            setPriceHistoryLoading(false);
        }
    };

    useEffect(() => {
        loadSuppliers();
        settingsAPI.getAll()
            .then((res) => setSettings(res.data.data || {}))
            .catch((err) => notifyError(err, 'No se pudo cargar la configuración; los montos usan el formato predeterminado', { type: 'warning' }));
    }, []);

    const loadSuppliers = async () => {
        try {
            const res = await suppliersAPI.getAll();
            setSuppliers(res.data.data);
        } catch (error) {
            notifyError(error, 'No se pudieron cargar los proveedores');
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
            showError(getApiErrorMessage(error, 'Error al guardar proveedor'));
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
            showError(getApiErrorMessage(error, 'Error al eliminar proveedor'));
        }
    };

    const filteredSuppliers = suppliers.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (s.contact?.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (s.supplyType?.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesType = !supplyTypeFilter || s.supplyType === supplyTypeFilter;

        return matchesSearch && matchesType;
    });



    const columns: Column<Supplier>[] = [
        {
            key: 'name',
            header: 'Proveedor',
            render: (s) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{s.name}</span>
                    {s.taxId && <span className={styles.muted}>RUC/NIT: {s.taxId}</span>}
                </div>
            )
        },
        { key: 'type', header: 'Tipo', render: (s) => s.supplyType ? <Badge>{s.supplyType}</Badge> : '—' },
        { key: 'contact', header: 'Contacto', accessor: (s) => s.contact || '—' },
        { key: 'phone', header: 'Teléfono', accessor: (s) => s.phone || '—' },
        { key: 'email', header: 'Email', accessor: (s) => s.email || '—', hideBelow: 'lg' },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '136px',
            render: (s) => (
                <div className={styles.rowActions}>
                    {canManageSupplier && <IconButton size="sm" icon={Pencil} tooltip="Editar" label={`Editar ${s.name}`} onClick={() => handleOpenModal(s)} />}
                    <IconButton size="sm" icon={History} tooltip="Historial" label={`Historial de precios de ${s.name}`} onClick={() => viewPriceHistory(s)} />
                    {canDeleteSupplier && <IconButton size="sm" icon={Trash2} tone="danger" tooltip="Eliminar" label={`Eliminar ${s.name}`} onClick={() => handleDelete(s.id)} />}
                </div>
            )
        }
    ] as Column<Supplier>[];

    const priceColumns: Column<PriceHistoryRow>[] = [
        {
            key: 'product',
            header: 'Producto',
            render: (item) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{item.productName}</span>
                    {item.productSku && <span className={styles.muted}>{item.productSku}</span>}
                </div>
            )
        },
        { key: 'unitCost', header: 'Precio unit.', type: 'money', render: (item) => `${formatCurrency(item.unitCost, settings)}/${item.unit}` },
        { key: 'quantity', header: 'Cantidad', type: 'qty', accessor: (item) => item.quantity },
        { key: 'subtotal', header: 'Subtotal', type: 'money', render: (item) => formatCurrency(item.subtotal, settings) },
        { key: 'date', header: 'Fecha', type: 'date', accessor: (item) => item.date },
        { key: 'po', header: 'OC', accessor: (item) => `#${item.purchaseOrderId}` },
        { key: 'branch', header: 'Sucursal', accessor: (item) => item.branchName || '—' },
    ];

    return (
        <PageContent>
            <PageHeader
                title="Proveedores"
                description={`${suppliers.length} proveedores registrados`}
                actions={canManageSupplier ? (
                    <Button variant="primary" icon={Plus} onClick={() => handleOpenModal()}>
                        Nuevo proveedor
                    </Button>
                ) : undefined}
            />

            <DataTable<Supplier>
                ariaLabel="Listado de proveedores"
                rows={filteredSuppliers}
                rowKey={(s) => s.id}
                columns={columns}
                loading={loading}
                resetKey={`${searchTerm}|${supplyTypeFilter}`}
                onRowClick={canManageSupplier ? (s) => handleOpenModal(s) : undefined}
                empty={(
                    <EmptyState
                        icon={Truck}
                        title={suppliers.length === 0 ? 'No hay proveedores registrados' : 'No se encontraron proveedores'}
                        action={searchTerm || supplyTypeFilter ? (
                            <Button onClick={() => { setSearchTerm(''); setSupplyTypeFilter(null); }}>Limpiar filtros</Button>
                        ) : undefined}
                    />
                )}
                toolbar={(
                    <TableToolbar>
                        <Input
                            type="search"
                            aria-label="Buscar proveedor"
                            placeholder="Buscar por nombre, contacto o tipo"
                            prefix={<Search size={14} aria-hidden="true" />}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <AppSelect
                            options={FIXED_SUPPLY_TYPES.map(type => ({ value: type, label: type }))}
                            value={supplyTypeFilter}
                            onChange={(v) => setSupplyTypeFilter(v)}
                            placeholder="Todos los tipos"
                            isClearable
                            aria-label="Filtrar por tipo de suministro"
                        />
                    </TableToolbar>
                )}
            />

            <FullScreenModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingSupplier ? 'Editar proveedor' : 'Nuevo proveedor'}
                breadcrumb={['Compras', 'Proveedores']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="supplier-form" loading={saving}>
                            {editingSupplier ? 'Guardar cambios' : 'Guardar proveedor'}
                        </Button>
                    </>
                )}
            >
                <form id="supplier-form" onSubmit={handleSubmit} className={styles.stack}>
                    <FormSection step={1} title="Empresa" description="Razón social, identificación fiscal y tipo de suministro.">
                        <FormGrid>
                            <Field label="Nombre de la empresa" htmlFor="supplier-name" required>
                                <Input id="supplier-name" value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required placeholder="Ej: Distribuidora Central S.A." />
                            </Field>
                            <Field label="RUC / NIT (opcional)" htmlFor="supplier-tax-id">
                                <Input id="supplier-tax-id" value={formData.taxId}
                                    onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                                    placeholder="Ej: J031000000123" />
                            </Field>
                            <Field label="Tipo de suministro" htmlFor="supplier-supply-type">
                                <AppSelect
                                    inputId="supplier-supply-type"
                                    options={FIXED_SUPPLY_TYPES.map(type => ({ value: type, label: type }))}
                                    value={formData.supplyType || null}
                                    onChange={(v) => setFormData({ ...formData, supplyType: v ?? '' })}
                                    placeholder="Seleccionar tipo"
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>

                    <FormSection step={2} title="Contacto" description="Persona y medios para pedidos y cobros.">
                        <FormGrid>
                            <Field label="Nombre del contacto" htmlFor="supplier-contact">
                                <Input id="supplier-contact" value={formData.contact}
                                    onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                                    placeholder="Ej: Juan Pérez" />
                            </Field>
                            <Field label="Teléfono" htmlFor="supplier-phone">
                                <Input id="supplier-phone" type="tel" value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="Ej: +505 8888 8888" />
                            </Field>
                            <Field label="Email" htmlFor="supplier-email">
                                <Input id="supplier-email" type="email" value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="Ej: contacto@empresa.com" />
                            </Field>
                        </FormGrid>
                    </FormSection>

                    <FormSection step={3} title="Ubicación">
                        <Field label="Dirección completa" htmlFor="supplier-address">
                            <Textarea
                                id="supplier-address"
                                rows={3}
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                placeholder="Calle, ciudad, puntos de referencia..."
                            />
                        </Field>
                    </FormSection>
                </form>
            </FullScreenModal>

            <FullScreenModal
                isOpen={showPriceHistory}
                onClose={() => setShowPriceHistory(false)}
                title={`Historial de precios · ${priceHistorySupplier?.name || ''}`}
                breadcrumb={['Compras', 'Proveedores']}
            >
                <DataTable<PriceHistoryRow>
                    ariaLabel="Historial de precios"
                    rows={priceHistory}
                    loading={priceHistoryLoading}
                    rowKey={(item) => `${item.purchaseOrderId}-${item.productName}-${item.date}`}
                    columns={priceColumns}
                    empty="No hay historial de precios para este proveedor"
                />
            </FullScreenModal>
        </PageContent>
    );
}
