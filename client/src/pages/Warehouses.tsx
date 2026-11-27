import { useState, useEffect, useCallback, useRef } from 'react';
import { warehousesAPI, inventoryMovementsAPI, branchesAPI, productsAPI, unitsAPI } from '../services/api';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { hasAnyRole } from '../utils/authz';
import { newIdempotencyKey } from '../utils/idempotency';
import { Warehouse as WarehouseIcon, Plus, ArrowRightLeft, Eye, Trash2, Pencil, Search, History } from 'lucide-react';
import type { Branch, InventoryMovement, Product, ProductAllowedUnit, Warehouse } from '../types';
import styles from './catalog.module.css';
import {
    AppSelect, Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    LoadErrorState, PageContent, PageHeader, TableToolbar, Tabs, type Column,
} from '@/ui';
import { getApiErrorMessage } from '../utils/apiError';

function axiosMessage(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    return fallback;
}


interface StockItem {
    id: number;
    productId: number;
    quantity: number;
    product: {
        id: number;
        name: string;
        sku?: string;
        unit: string;
        baseUnit?: { abbreviation: string } | null;
        minStock: number;
        cost: number;
    };
}

type TypeFilter = 'ALL' | 'CENTRAL' | 'BRANCH';
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
    { value: 'ALL', label: 'Todas' },
    { value: 'CENTRAL', label: 'Central' },
    { value: 'BRANCH', label: 'Sucursales' }
];

interface TransferRow {
    id: string;
    first?: InventoryMovement;
    source?: InventoryMovement;
    destination?: InventoryMovement;
}

export default function Warehouses() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { toasts, removeToast, success: showSuccess, error: showError } = useToast();

    /** Backend: POST/PUT /warehouses — SUPERADMIN | ADMIN */
    const canMutateWarehouse = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);
    /** Backend: DELETE /warehouses — SUPERADMIN only */
    const canDeleteWarehouse = hasAnyRole(user, ['SUPERADMIN']);
    /** Backend: POST /inventory-movements/transfer — SUPERADMIN | ADMIN | BODEGA */
    const canTransferStock = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [warehouseTypeFilter, setWarehouseTypeFilter] = useState<TypeFilter>('ALL');
    const [warehouseSearch, setWarehouseSearch] = useState('');

    // Sidebar states
    const [showForm, setShowForm] = useState(false);
    const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
    const [formData, setFormData] = useState({ name: '', code: '', branchId: '', type: 'BRANCH' as 'CENTRAL' | 'BRANCH' });

    // Stock view
    const [showStock, setShowStock] = useState(false);
    const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
    const [stock, setStock] = useState<StockItem[]>([]);
    const [stockSearch, setStockSearch] = useState('');

    // Transfer
    const [showTransfer, setShowTransfer] = useState(false);
    const [transferData, setTransferData] = useState({
        fromWarehouseId: '', toWarehouseId: '', productId: '', quantity: '', reference: '', unit: ''
    });
    const [transferUnits, setTransferUnits] = useState<ProductAllowedUnit[]>([]);
    const [saving, setSaving] = useState(false);
    const transferAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

    // Transfer history
    const [showHistory, setShowHistory] = useState(false);
    const [transferHistory, setTransferHistory] = useState<InventoryMovement[]>([]);

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [whRes, brRes, prRes] = await Promise.all([
                warehousesAPI.getAll(),
                branchesAPI.getAll(),
                productsAPI.getAll({ active: true, limit: 500 })
            ]);
            setWarehouses(whRes.data.data);
            setBranches(brRes.data.data);
            setProducts(prRes.data.data || []);
            setLoadError(null);
        } catch (e) {
            console.error(e);
            setLoadError(getApiErrorMessage(e, 'No se pudieron cargar las bodegas y sus catálogos (no se asumirá que el inventario está vacío)'));
        } finally {
            setLoading(false);
        }
    };

    const handleCreateUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutateWarehouse) return;
        setSaving(true);
        try {
            const payload = {
                name: formData.name,
                code: formData.code,
                type: formData.type,
                branchId: formData.type === 'BRANCH' ? parseInt(formData.branchId) : null
            };
            if (editingWarehouse) {
                await warehousesAPI.update(editingWarehouse.id, payload);
                showSuccess('Bodega actualizada');
            } else {
                await warehousesAPI.create(payload);
                showSuccess('Bodega creada');
            }
            setShowForm(false);
            loadData();
        } catch (err: unknown) {
            showError(axiosMessage(err, 'Error al guardar'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteWarehouse) return;
        if (!(await confirm('¿Eliminar esta bodega?', { title: 'Confirmar acción' }))) return;
        try {
            await warehousesAPI.delete(id);
            showSuccess('Bodega eliminada');
            loadData();
        } catch (err: unknown) {
            showError(axiosMessage(err, 'No se puede eliminar'));
        }
    };

    const viewStock = async (wh: Warehouse) => {
        try {
            const res = await warehousesAPI.getStock(wh.id);
            setStock(res.data.data || []);
            setSelectedWarehouse(wh);
            setShowStock(true);
        } catch (error) {
            showError(getApiErrorMessage(error, 'Error al cargar stock'));
        }
    };

    const handleTransferProductChange = useCallback(async (productId: string) => {
        const product = products.find(p => p.id === parseInt(productId));
        try {
            const res = await unitsAPI.getProductUnits(Number(productId));
            const units: ProductAllowedUnit[] = res.data.data || [];
            if (units.length > 0) {
                setTransferUnits(units);
                const defaultUnit = units.find(u => u.isDefault) || units.find(u => u.isBase) || units[0];
                setTransferData(prev => ({
                    ...prev,
                    productId,
                    unit: defaultUnit?.abbreviation || product?.baseUnit?.abbreviation || product?.unit || ''
                }));
            } else {
                const baseUnit = product?.baseUnit?.abbreviation || product?.unit || 'unidad';
                setTransferUnits([{ unitId: 0, abbreviation: baseUnit, name: baseUnit, conversionFactor: 1, isBase: true, isDefault: true }] as ProductAllowedUnit[]);
                setTransferData(prev => ({ ...prev, productId, unit: baseUnit }));
            }
        } catch {
            const baseUnit = product?.baseUnit?.abbreviation || product?.unit || 'unidad';
            setTransferUnits([{ unitId: 0, abbreviation: baseUnit, name: baseUnit, conversionFactor: 1, isBase: true, isDefault: true }] as ProductAllowedUnit[]);
            setTransferData(prev => ({ ...prev, productId, unit: baseUnit }));
        }
    }, [products]);

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canTransferStock) return;
        setSaving(true);
        try {
            const payload = {
                fromWarehouseId: parseInt(transferData.fromWarehouseId),
                toWarehouseId: parseInt(transferData.toWarehouseId),
                productId: parseInt(transferData.productId),
                quantity: parseFloat(transferData.quantity),
                reference: transferData.reference || undefined,
                unit: transferData.unit || undefined
            };
            const fingerprint = JSON.stringify(payload);
            if (transferAttemptRef.current?.fingerprint !== fingerprint) {
                transferAttemptRef.current = { fingerprint, key: newIdempotencyKey() };
            }
            await inventoryMovementsAPI.transfer(payload, transferAttemptRef.current.key);
            transferAttemptRef.current = null;
            showSuccess('Traslado realizado correctamente');
            setShowTransfer(false);
            setTransferData({ fromWarehouseId: '', toWarehouseId: '', productId: '', quantity: '', reference: '', unit: '' });
            setTransferUnits([]);
            loadData();
        } catch (err: unknown) {
            showError(axiosMessage(err, 'Error en traslado'));
        } finally {
            setSaving(false);
        }
    };

    const viewTransferHistory = async () => {
        try {
            const res = await inventoryMovementsAPI.getAll({ type: 'TRANSFER' });
            setTransferHistory(res.data.data || []);
            setShowHistory(true);
        } catch (error) {
            showError(getApiErrorMessage(error, 'Error al cargar historial de transferencias'));
        }
    };

    const openCreate = () => {
        if (!canMutateWarehouse) return;
        setEditingWarehouse(null);
        setFormData({ name: '', code: '', branchId: '', type: 'BRANCH' });
        setShowForm(true);
    };

    const openEdit = (wh: Warehouse) => {
        if (!canMutateWarehouse) return;
        setEditingWarehouse(wh);
        setFormData({
            name: wh.name,
            code: wh.code || '',
            branchId: wh.branchId?.toString() || '',
            type: wh.type || 'BRANCH'
        });
        setShowForm(true);
    };

    const filteredWarehouses = warehouses.filter((warehouse) => {
        if (warehouseTypeFilter !== 'ALL' && warehouse.type !== warehouseTypeFilter) return false;
        const q = warehouseSearch.trim().toLowerCase();
        return !q || warehouse.name.toLowerCase().includes(q) || (warehouse.code ?? '').toLowerCase().includes(q)
            || (warehouse.branch?.name ?? '').toLowerCase().includes(q);
    });

    const transferRows: TransferRow[] = Object.entries(
        transferHistory.reduce<Record<string, InventoryMovement[]>>((acc, movement) => {
            const key = movement.transferGroupId || `legacy-${movement.id}`;
            acc[key] = [...(acc[key] || []), movement];
            return acc;
        }, {})
    ).map(([id, movements]) => {
        const ordered = [...movements].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        // Both legs of a transfer are stored as TRANSFER movements
        // distinguished by their reason ("Transfer out" / "Transfer in").
        const source = ordered.find((m) => (m.reason || '').toLowerCase().startsWith('transfer out')) || ordered[0];
        const destination = ordered.find((m) => (m.reason || '').toLowerCase().startsWith('transfer in')) || ordered[1];
        return { id, first: ordered[0], source, destination };
    });

    const filteredStock = stock.filter(s =>
        s.product.name.toLowerCase().includes(stockSearch.toLowerCase()) ||
        s.product.sku?.toLowerCase().includes(stockSearch.toLowerCase())
    );

    const warehouseOption = (w: Warehouse) => ({
        value: w.id.toString(),
        label: `${w.name} (${w.type === 'CENTRAL' ? 'Central' : w.branch?.name || 'Sin sucursal'})`
    });

    const columns: Column<Warehouse>[] = [
        {
            key: 'name',
            header: 'Bodega',
            render: (w) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{w.name}</span>
                    {w.code && <span className={styles.muted}>{w.code}</span>}
                </div>
            )
        },
        { key: 'location', header: 'Ubicación', accessor: (w) => w.type === 'CENTRAL' ? 'Bodega central' : (w.branch?.name || 'Sin sucursal') },
        {
            key: 'type',
            header: 'Tipo',
            type: 'status',
            render: (w) => <Badge tone={w.type === 'CENTRAL' ? 'primary' : 'neutral'}>{w.type === 'CENTRAL' ? 'Central' : 'Sucursal'}</Badge>
        },
        { key: 'products', header: 'Productos', type: 'number', decimals: 0, accessor: (w) => w._count?.stocks || 0 },
        { key: 'movements', header: 'Movimientos', type: 'number', decimals: 0, accessor: (w) => w._count?.movements || 0 },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '136px',
            render: (w) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Eye} tooltip="Ver detalle" label={`Ver stock de ${w.name}`} onClick={() => viewStock(w)} />
                    {canMutateWarehouse && <IconButton size="sm" icon={Pencil} tooltip="Editar" label={`Editar ${w.name}`} onClick={() => openEdit(w)} />}
                    {canDeleteWarehouse && <IconButton size="sm" icon={Trash2} tone="danger" tooltip="Eliminar" label={`Eliminar ${w.name}`} onClick={() => handleDelete(w.id)} />}
                </div>
            )
        }
    ] as Column<Warehouse>[];

    const stockColumns: Column<StockItem>[] = [
        {
            key: 'product',
            header: 'Producto',
            render: (s) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{s.product.name}</span>
                    {s.product.sku && <span className={styles.muted}>{s.product.sku}</span>}
                </div>
            )
        },
        { key: 'quantity', header: 'Existencia', type: 'qty', decimals: 2, accessor: (s) => s.quantity },
        { key: 'unit', header: 'Unidad', accessor: (s) => s.product.baseUnit?.abbreviation || s.product.unit },
        { key: 'min', header: 'Mín. agregado', type: 'qty', decimals: 2, accessor: (s) => Number(s.product.minStock) },
    ];

    const historyColumns: Column<TransferRow>[] = [
        { key: 'date', header: 'Fecha', type: 'date', render: (r) => new Date(r.first?.createdAt || Date.now()).toLocaleString('es-NI') },
        { key: 'product', header: 'Producto', render: (r) => <span className={styles.cellTitle}>{r.first?.product?.name}</span> },
        {
            key: 'route',
            header: 'Ruta',
            type: 'text',
            accessor: (r) => `${r.source?.warehouse?.name || 'Origen desconocido'} → ${r.destination?.warehouse?.name || 'Destino desconocido'}`
        },
        { key: 'quantity', header: 'Cantidad', type: 'qty', decimals: 2, accessor: (r) => r.first?.quantity || 0 },
        { key: 'user', header: 'Responsable', accessor: (r) => r.first?.user?.name ?? '—' },
        { key: 'reference', header: 'Referencia', accessor: (r) => r.first?.reference || '—' },
    ];

    return (
        <PageContent>
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            <PageHeader
                title="Bodegas"
                description="Bodegas por sucursal, existencias y traslados."
                actions={canMutateWarehouse ? (
                    <Button variant="primary" icon={Plus} onClick={openCreate}>Nueva bodega</Button>
                ) : undefined}
            />

            {loadError && <LoadErrorState message={loadError} onRetry={() => { void loadData(); }} />}

            <Tabs
                ariaLabel="Filtrar por tipo de bodega"
                active={warehouseTypeFilter}
                onChange={(id) => setWarehouseTypeFilter(id as TypeFilter)}
                tabs={TYPE_FILTERS.map(({ value, label }) => ({
                    id: value,
                    label,
                    badge: loadError ? undefined : value === 'ALL' ? warehouses.length : warehouses.filter((w) => w.type === value).length,
                }))}
            />

            <TableToolbar
                actions={(
                    <>
                        <Button icon={History} onClick={viewTransferHistory}>Historial de traslados</Button>
                        {canTransferStock && (
                            <Button icon={ArrowRightLeft} onClick={() => setShowTransfer(true)}>Nuevo traslado</Button>
                        )}
                    </>
                )}
            >
                <Input
                    type="search"
                    aria-label="Buscar bodega"
                    placeholder="Buscar por nombre, código o sucursal"
                    prefix={<Search size={14} aria-hidden="true" />}
                    value={warehouseSearch}
                    onChange={(e) => setWarehouseSearch(e.target.value)}
                />
            </TableToolbar>

            <DataTable<Warehouse>
                ariaLabel="Listado de bodegas"
                rows={filteredWarehouses}
                rowKey={(w) => w.id}
                columns={columns}
                loading={loading}
                resetKey={`${warehouseTypeFilter}|${warehouseSearch}`}
                onRowClick={(w) => { void viewStock(w); }}
                empty={warehouses.length === 0 ? (
                    <EmptyState
                        icon={WarehouseIcon}
                        title="No hay bodegas registradas"
                        action={canMutateWarehouse ? <Button variant="primary" onClick={openCreate}>Crear primera bodega</Button> : undefined}
                    />
                ) : 'Sin resultados. Ajusta o limpia los filtros.'}
            />

            {/* Create/Edit Warehouse */}
            <FullScreenModal
                isOpen={showForm}
                onClose={() => setShowForm(false)}
                title={editingWarehouse ? 'Editar bodega' : 'Nueva bodega'}
                breadcrumb={['Inventario', 'Bodegas']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="warehouse-form" loading={saving}>
                            {editingWarehouse ? 'Guardar cambios' : 'Crear bodega'}
                        </Button>
                    </>
                )}
            >
                <form id="warehouse-form" onSubmit={handleCreateUpdate} className={styles.stack}>
                    <FormSection step={1} title="Información de la bodega" description="El código identifica la bodega en movimientos y reportes.">
                        <FormGrid>
                            <Field label="Nombre" htmlFor="warehouse-name" required>
                                <Input id="warehouse-name" value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Ej: Bodega Central" required autoFocus />
                            </Field>
                            <Field label="Código" htmlFor="warehouse-code" required>
                                <Input id="warehouse-code" value={formData.code}
                                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })} placeholder="Ej: CENTRAL-MAIN" required />
                            </Field>
                            <Field label="Tipo" htmlFor="warehouse-type" required>
                                <AppSelect<'CENTRAL' | 'BRANCH'>
                                    isClearable={false}
                                    isSearchable={false}
                                    inputId="warehouse-type"
                                    options={[
                                        { value: 'BRANCH', label: 'Sucursal' },
                                        { value: 'CENTRAL', label: 'Central' }
                                    ]}
                                    value={formData.type}
                                    onChange={(v) => v && setFormData({ ...formData, type: v, branchId: v === 'CENTRAL' ? '' : formData.branchId })}
                                />
                            </Field>
                            {formData.type === 'BRANCH' && (
                                <Field label="Sucursal" htmlFor="warehouse-branch" required>
                                    <AppSelect
                                        isClearable={false}
                                        inputId="warehouse-branch"
                                        options={branches.map((b) => ({ value: b.id.toString(), label: b.name }))}
                                        value={formData.branchId || null}
                                        onChange={(v) => v && setFormData({ ...formData, branchId: v })}
                                        placeholder="Seleccionar sucursal"
                                    />
                                </Field>
                            )}
                        </FormGrid>
                    </FormSection>
                </form>
            </FullScreenModal>

            {/* Stock View */}
            <FullScreenModal
                isOpen={showStock}
                onClose={() => setShowStock(false)}
                title={`Existencias · ${selectedWarehouse?.name || ''}`}
                breadcrumb={['Inventario', 'Bodegas']}
                subtitle={`${stock.length} productos con existencia registrada`}
            >
                <DataTable<StockItem>
                    ariaLabel="Existencias de la bodega"
                    rows={filteredStock}
                    rowKey={(s) => s.id}
                    columns={stockColumns}
                    resetKey={stockSearch}
                    empty="Sin productos en esta bodega"
                    toolbar={(
                        <TableToolbar>
                            <Input
                                type="search"
                                aria-label="Buscar producto"
                                placeholder="Buscar por producto o SKU"
                                prefix={<Search size={14} aria-hidden="true" />}
                                value={stockSearch}
                                onChange={e => setStockSearch(e.target.value)}
                            />
                        </TableToolbar>
                    )}
                />
            </FullScreenModal>

            {/* Transfer Modal */}
            <FullScreenModal
                isOpen={showTransfer}
                onClose={() => setShowTransfer(false)}
                title="Nuevo traslado entre bodegas"
                breadcrumb={['Inventario', 'Bodegas']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="transfer-form" loading={saving}>Realizar traslado</Button>
                    </>
                )}
            >
                <form id="transfer-form" onSubmit={handleTransfer} className={styles.stack}>
                    <FormSection step={1} title="Ruta del traslado" description="Bodega que entrega y bodega que recibe.">
                        <FormGrid>
                            <Field label="Bodega origen" htmlFor="transfer-from" required>
                                <AppSelect
                                    isClearable={false}
                                    inputId="transfer-from"
                                    options={warehouses.map(warehouseOption)}
                                    value={transferData.fromWarehouseId || null}
                                    onChange={(v) => v && setTransferData({ ...transferData, fromWarehouseId: v })}
                                    placeholder="Seleccionar..."
                                />
                            </Field>
                            <Field label="Bodega destino" htmlFor="transfer-to" required>
                                <AppSelect
                                    isClearable={false}
                                    inputId="transfer-to"
                                    options={warehouses.filter(w => w.id.toString() !== transferData.fromWarehouseId).map(warehouseOption)}
                                    value={transferData.toWarehouseId || null}
                                    onChange={(v) => v && setTransferData({ ...transferData, toWarehouseId: v })}
                                    placeholder="Seleccionar..."
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>
                    <FormSection step={2} title="Producto y cantidad" description="La cantidad se descuenta del origen en la unidad elegida.">
                        <FormGrid>
                            <Field label="Producto" htmlFor="transfer-product" required>
                                <AppSelect
                                    isClearable={false}
                                    inputId="transfer-product"
                                    options={products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))}
                                    value={transferData.productId || null}
                                    onChange={(v) => { if (v) void handleTransferProductChange(v); }}
                                    placeholder="Seleccionar producto..."
                                />
                            </Field>
                            <Field label="Cantidad" htmlFor="transfer-quantity" required>
                                <Input id="transfer-quantity" type="number" step="0.001" min="0.001" className="ui-input--number"
                                    value={transferData.quantity}
                                    onChange={e => setTransferData({ ...transferData, quantity: e.target.value })} required />
                            </Field>
                            {transferUnits.length > 0 && (
                                <Field label="Unidad" htmlFor="transfer-unit">
                                    <AppSelect
                                        isClearable={false}
                                        inputId="transfer-unit"
                                        options={transferUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))}
                                        value={transferData.unit || null}
                                        onChange={(v) => v && setTransferData({ ...transferData, unit: v })}
                                        placeholder="Unidad..."
                                    />
                                </Field>
                            )}
                            <Field label="Referencia (opcional)" htmlFor="transfer-reference">
                                <Input id="transfer-reference" value={transferData.reference}
                                    onChange={e => setTransferData({ ...transferData, reference: e.target.value })} placeholder="Ej: TRF-001" />
                            </Field>
                        </FormGrid>
                    </FormSection>
                </form>
            </FullScreenModal>

            {/* Transfer History */}
            <FullScreenModal
                isOpen={showHistory}
                onClose={() => setShowHistory(false)}
                title="Historial de traslados"
                breadcrumb={['Inventario', 'Bodegas']}
            >
                <DataTable<TransferRow>
                    ariaLabel="Historial de traslados"
                    rows={transferRows}
                    rowKey={(r) => r.id}
                    columns={historyColumns}
                    empty="No hay traslados registrados"
                />
            </FullScreenModal>
        </PageContent>
    );
}
