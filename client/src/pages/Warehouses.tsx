import { useState, useEffect, useCallback } from 'react';
import { warehousesAPI, inventoryMovementsAPI, branchesAPI, productsAPI, unitsAPI } from '../services/api';
import ViewToggle from '../components/ViewToggle';
import { useViewMode } from '../hooks/useViewMode';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { hasAnyRole } from '../utils/authz';
import {
    Warehouse as WarehouseIcon, Plus, ArrowRightLeft, Package, MapPin,
    Eye, Trash2, Edit2, Search, Info
} from 'lucide-react';
import type { Branch, InventoryMovement, Product, ProductAllowedUnit, Warehouse } from '../types';
import './Inventory.css';
import { AppSelect, Button, DataTable, Field, FullScreenModal, PageHeader, type Column, formatNumber } from '@/ui';

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
    product: { id: number; name: string; sku?: string; unit: string; minStock: number; cost: number };
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
    const [warehouseTypeFilter, setWarehouseTypeFilter] = useState<'ALL' | 'CENTRAL' | 'BRANCH'>('ALL');
    const { viewMode, setViewMode } = useViewMode('warehouses');

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

    // Transfer history
    const [showHistory, setShowHistory] = useState(false);
    const [transferHistory, setTransferHistory] = useState<InventoryMovement[]>([]);

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const [whRes, brRes, prRes] = await Promise.all([
                warehousesAPI.getAll(),
                branchesAPI.getAll(),
                productsAPI.getAll()
            ]);
            setWarehouses(whRes.data.data);
            setBranches(brRes.data.data);
            setProducts(prRes.data.data || []);
        } catch (e) {
            console.error(e);
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
        } catch {
            showError('Error al cargar stock');
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
                setTransferData(prev => ({ ...prev, productId, unit: defaultUnit?.abbreviation || product?.unit || '' }));
            } else {
                const baseUnit = product?.unit || 'unidad';
                setTransferUnits([{ unitId: 0, abbreviation: baseUnit, name: baseUnit, conversionFactor: 1, isBase: true, isDefault: true }] as ProductAllowedUnit[]);
                setTransferData(prev => ({ ...prev, productId, unit: baseUnit }));
            }
        } catch {
            const baseUnit = product?.unit || 'unidad';
            setTransferUnits([{ unitId: 0, abbreviation: baseUnit, name: baseUnit, conversionFactor: 1, isBase: true, isDefault: true }] as ProductAllowedUnit[]);
            setTransferData(prev => ({ ...prev, productId, unit: baseUnit }));
        }
    }, [products]);

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canTransferStock) return;
        setSaving(true);
        try {
            await inventoryMovementsAPI.transfer({
                fromWarehouseId: parseInt(transferData.fromWarehouseId),
                toWarehouseId: parseInt(transferData.toWarehouseId),
                productId: parseInt(transferData.productId),
                quantity: parseFloat(transferData.quantity),
                reference: transferData.reference || undefined,
                unit: transferData.unit || undefined
            });
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
        } catch {
            showError('Error al cargar historial');
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
        if (warehouseTypeFilter === 'ALL') return true;
        return warehouse.type === warehouseTypeFilter;
    });

    const groupedTransferHistory = transferHistory.reduce<Record<string, InventoryMovement[]>>((acc, movement) => {
        const key = movement.transferGroupId || `legacy-${movement.id}`;
        acc[key] = [...(acc[key] || []), movement];
        return acc;
    }, {});
    const showLegacyTransferHistory = false;

    const filteredStock = stock.filter(s =>
        s.product.name.toLowerCase().includes(stockSearch.toLowerCase()) ||
        s.product.sku?.toLowerCase().includes(stockSearch.toLowerCase())
    );

    if (loading) return <div className="inventory-loading">Cargando bodegas...</div>;

    return (
        <div className="inventory-page">
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            <PageHeader
                title="Gestión de Bodegas"
                actions={
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <ViewToggle value={viewMode} onChange={setViewMode} />
                        <Button variant="secondary" onClick={viewTransferHistory}>
                            <ArrowRightLeft size={18} /> Historial Traslados
                        </Button>
                        {canTransferStock && (
                            <Button variant="secondary" onClick={() => setShowTransfer(true)}>
                                <ArrowRightLeft size={18} /> Nuevo Traslado
                            </Button>
                        )}
                        {canMutateWarehouse && (
                            <Button variant="primary" onClick={openCreate}>
                                <Plus size={18} /> Nueva Bodega
                            </Button>
                        )}
                    </div>
                }
            />

            <div className="inventory-filters-row" style={{ marginBottom: '1rem' }}>
                <div className="inventory-status-filters">
                    {[
                        { value: 'ALL', label: 'Todas' },
                        { value: 'CENTRAL', label: 'Central' },
                        { value: 'BRANCH', label: 'Sucursales' }
                    ].map((option) => (
                        <button
                            key={option.value}
                            className={`inventory-status-btn ${warehouseTypeFilter === option.value ? 'active' : ''}`}
                            onClick={() => setWarehouseTypeFilter(option.value as 'ALL' | 'CENTRAL' | 'BRANCH')}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table view */}
            {viewMode === 'table' && filteredWarehouses.length > 0 && (
                <DataTable<Warehouse>
                    ariaLabel="Listado"
                    rows={filteredWarehouses}
                    rowKey={(w) => w.id}
                    resetKey={warehouseTypeFilter}
                    columns={[
                        {
                            key: 'name',
                            header: 'Bodega',
                            render: (w) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{w.name}</span>
                                    {w.code && <span className="cell-sub">{w.code}</span>}
                                </div>
                            )
                        },
                        { key: 'location', header: 'Ubicación', render: (w) => w.type === 'CENTRAL' ? 'Bodega central' : (w.branch?.name || 'Sin sucursal') },
                        { key: 'products', header: 'Productos', render: (w) => w._count?.stocks || 0 },
                        { key: 'movements', header: 'Movimientos', render: (w) => w._count?.movements || 0 },
                        {
                            key: 'actions',
                            header: 'Acciones',
                            type: 'number',
                            render: (w) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => viewStock(w)} title="Ver Stock">
                                        <Eye size={16} />
                                    </button>
                                    {canMutateWarehouse && (
                                        <button className="catalog-action-btn" onClick={() => openEdit(w)} title="Editar">
                                            <Edit2 size={16} />
                                        </button>
                                    )}
                                    {canDeleteWarehouse && (
                                        <button className="catalog-action-btn danger" onClick={() => handleDelete(w.id)} title="Eliminar">
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            )
                        }
                    ] as Column<Warehouse>[]}
                />
            )}

            {/* Warehouses Grid */}
            {viewMode === 'cards' && (
            <div className="inventory-grid-new">
                {filteredWarehouses.map(wh => (
                    <div key={wh.id} className="inventory-card-new">
                        <div className="inventory-card-body-new">
                            <div className="product-name-new">{wh.name}</div>
                                <div className="product-details-new">
                                    <div className="detail-item">
                                        <MapPin size={14} />
                                        <span>{wh.type === 'CENTRAL' ? 'Bodega central' : (wh.branch?.name || 'Sin sucursal')}</span>
                                    </div>
                                    <div className="detail-item">
                                        <span className="sku-tag">{wh.code}</span>
                                    </div>
                                <div className="detail-item">
                                    <Package size={14} />
                                    <span>{wh._count?.stocks || 0} productos</span>
                                </div>
                                <div className="detail-item">
                                    <ArrowRightLeft size={14} />
                                    <span>{wh._count?.movements || 0} movimientos</span>
                                </div>
                            </div>
                        </div>
                        <div className="inventory-card-actions-new">
                            <button className="action-btn-new" onClick={() => viewStock(wh)} title="Ver Stock">
                                <Eye size={20} /><span>Stock</span>
                            </button>
                            {canMutateWarehouse && (
                                <button className="action-btn-new edit" onClick={() => openEdit(wh)} title="Editar">
                                    <Edit2 size={20} /><span>Editar</span>
                                </button>
                            )}
                            {canDeleteWarehouse && (
                                <button className="action-btn-new delete" onClick={() => handleDelete(wh.id)} title="Eliminar">
                                    <Trash2 size={20} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            )}

            {filteredWarehouses.length === 0 && (
                <div className="no-products-message">
                    <WarehouseIcon size={48} />
                    <p>No hay bodegas registradas</p>
                    {canMutateWarehouse && (
                        <Button variant="primary" onClick={openCreate}>Crear primera bodega</Button>
                    )}
                </div>
            )}

            {/* Create/Edit Warehouse */}
            <FullScreenModal isOpen={showForm} onClose={() => setShowForm(false)} title={editingWarehouse ? 'Editar Bodega' : 'Nueva Bodega'}>
                <div className="premium-modal-content">
                    <form onSubmit={handleCreateUpdate} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <WarehouseIcon size={18} />
                                    <h3>Información de la bodega</h3>
                                </div>
                                <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="warehouse-name">Nombre</label>
                                <input id="warehouse-name" type="text" className="modal-standard-input" value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Ej: Bodega Central" required autoFocus />
                                </div>
                                <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="warehouse-code">Código</label>
                                    <input id="warehouse-code" type="text" className="modal-standard-input" value={formData.code}
                                        onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })} placeholder="Ej: CENTRAL-MAIN" required />
                                </div>
                                <div className="modal-input-group">
                                    <Field label="Tipo" htmlFor="sel-410" required>
<AppSelect inputId="sel-410" options={[
                                            { value: 'BRANCH', label: 'Sucursal' },
                                            { value: 'CENTRAL', label: 'Central' }
                                        ]} value={formData.type ?? null} onChange={(__v) => { const opt = ([
                                            { value: 'BRANCH', label: 'Sucursal' },
                                            { value: 'CENTRAL', label: 'Central' }
                                        ]).find((o) => o.value === __v) ?? null; return opt && setFormData({ ...formData, type: opt.value as typeof formData.type, branchId: opt.value === 'CENTRAL' ? '' : formData.branchId }); }} placeholder="Seleccionar tipo" />
</Field>
                                </div>
                                </div>
                                {formData.type === 'BRANCH' && (
                                    <div className="modal-input-group">
                                    <Field label="Sucursal" htmlFor="sel-422" required>
<AppSelect inputId="sel-422" options={branches.map((b) => ({ value: b.id.toString(), label: b.name }))} value={(formData.branchId ? { value: formData.branchId, label: branches.find((b) => b.id.toString() === formData.branchId)?.name } : null)?.value ?? null} onChange={(__v) => { const opt = (branches.map((b) => ({ value: b.id.toString(), label: b.name }))).find((o) => o.value === __v) ?? null; return opt && setFormData({ ...formData, branchId: opt.value }); }} placeholder="Seleccionar sucursal" />
</Field>
                                    </div>
                                )}
                                <p className="warehouse-form-hint"><Info size={14} /> El código identifica la bodega en movimientos y reportes.</p>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Guardando...' : editingWarehouse ? 'Guardar' : 'Crear'}</Button>
                        </div>
                    </form>
                </div>
            </FullScreenModal>

            {/* Stock View */}
            <FullScreenModal isOpen={showStock} onClose={() => setShowStock(false)} title={`Stock - ${selectedWarehouse?.name || ''}`}>
                <div className="premium-modal-content">
                    <div className="modal-tab-content">
                        <div className="modal-input-group">
                            <div className="search-input-wrapper">
                                <Search size={16} className="search-icon" />
                                <input type="text" className="modal-standard-input" style={{ paddingLeft: '34px' }} placeholder="Buscar producto..."
                                    value={stockSearch} onChange={e => setStockSearch(e.target.value)} />
                            </div>
                        </div>
                        <div className="stock-items-list">
                            {filteredStock.map(s => {
                                const isLow = Number(s.quantity) < Number(s.product.minStock);
                                return (
                                    <div key={s.id} className={`stock-item-row ${isLow ? 'stock-low' : ''}`}>
                                        <div>
                                            <div className="stock-item-name">{s.product.name}</div>
                                            {s.product.sku && <div className="stock-item-sku">{s.product.sku}</div>}
                                        </div>
                                        <div className="stock-item-qty">
                                            <div className={`stock-item-value ${isLow ? 'stock-low-text' : ''}`}>
                                                {formatNumber(s.quantity)} {s.product.unit}
                                            </div>
                                            <div className="stock-item-min">Min: {Number(s.product.minStock)}</div>
                                        </div>
                                    </div>
                                );
                            })}
                            {filteredStock.length === 0 && (
                                <p className="stock-empty-message">Sin productos en esta bodega</p>
                            )}
                        </div>
                    </div>
                </div>
            </FullScreenModal>

            {/* Transfer Modal */}
            <FullScreenModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} title="Nuevo Traslado entre Bodegas">
                <div className="premium-modal-content">
                    <form onSubmit={handleTransfer} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <ArrowRightLeft size={18} />
                                    <h3>Ruta del traslado</h3>
                                </div>
                                <div className="modal-form-row">
                                <div className="modal-input-group">
                                <Field label="Bodega Origen" htmlFor="sel-488" required>
<AppSelect inputId="sel-488" options={warehouses.map(w => ({ value: w.id.toString(), label: `${w.name} (${w.type === 'CENTRAL' ? 'Central' : w.branch?.name || 'Sin sucursal'})` }))} value={(transferData.fromWarehouseId ? { value: transferData.fromWarehouseId, label: warehouses.find(w => w.id.toString() === transferData.fromWarehouseId)?.name } : null)?.value ?? null} onChange={(__v) => { const opt = (warehouses.map(w => ({ value: w.id.toString(), label: `${w.name} (${w.type === 'CENTRAL' ? 'Central' : w.branch?.name || 'Sin sucursal'})` }))).find((o) => o.value === __v) ?? null; return opt && setTransferData({ ...transferData, fromWarehouseId: opt.value }); }} placeholder="Seleccionar..." />
</Field>
                                </div>
                                <div className="modal-input-group">
                                <Field label="Bodega Destino" htmlFor="sel-494" required>
<AppSelect inputId="sel-494" options={warehouses.filter(w => w.id.toString() !== transferData.fromWarehouseId).map(w => ({ value: w.id.toString(), label: `${w.name} (${w.type === 'CENTRAL' ? 'Central' : w.branch?.name || 'Sin sucursal'})` }))} value={(transferData.toWarehouseId ? { value: transferData.toWarehouseId, label: warehouses.find(w => w.id.toString() === transferData.toWarehouseId)?.name } : null)?.value ?? null} onChange={(__v) => { const opt = (warehouses.filter(w => w.id.toString() !== transferData.fromWarehouseId).map(w => ({ value: w.id.toString(), label: `${w.name} (${w.type === 'CENTRAL' ? 'Central' : w.branch?.name || 'Sin sucursal'})` }))).find((o) => o.value === __v) ?? null; return opt && setTransferData({ ...transferData, toWarehouseId: opt.value }); }} placeholder="Seleccionar..." />
</Field>
                                </div>
                                </div>
                            </div>
                            <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <Package size={18} />
                                    <h3>Producto y cantidad</h3>
                                </div>
                                <div className="modal-input-group">
                                <Field label="Producto" htmlFor="sel-507" required>
<AppSelect inputId="sel-507" options={products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))} value={(transferData.productId ? { value: transferData.productId, label: products.find((p) => p.id.toString() === transferData.productId)?.name } : null)?.value ?? null} onChange={(__v) => { const opt = (products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))).find((o) => o.value === __v) ?? null; return opt && handleTransferProductChange(opt.value); }} placeholder="Seleccionar producto..." />
</Field>
                                </div>
                                <div className="modal-form-row">
                                <div className="modal-input-group" style={{ flex: 2 }}>
                                    <label className="modal-input-label" htmlFor="transfer-quantity">Cantidad</label>
                                    <input id="transfer-quantity" type="number" step="0.001" className="modal-standard-input" value={transferData.quantity}
                                        onChange={e => setTransferData({ ...transferData, quantity: e.target.value })} required min="0.001" />
                                </div>
                                {transferUnits.length > 0 && (
                                    <div className="modal-input-group" style={{ flex: 1 }}>
                                        <Field label="Unidad" htmlFor="sel-520">
<AppSelect inputId="sel-520" options={transferUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))} value={(transferData.unit ? {
                                                value: transferData.unit,
                                                label: transferUnits.find(u => u.abbreviation === transferData.unit)
                                                    ? `${transferUnits.find(u => u.abbreviation === transferData.unit)!.name} (${transferData.unit})`
                                                    : transferData.unit
                                            } : null)?.value ?? null} onChange={(__v) => { const opt = (transferUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))).find((o) => o.value === __v) ?? null; return opt && setTransferData({ ...transferData, unit: opt.value }); }} placeholder="Unidad..." />
</Field>
                                    </div>
                                )}
                                </div>
                                <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="transfer-reference">Referencia (opcional)</label>
                                <input id="transfer-reference" type="text" className="modal-standard-input" value={transferData.reference}
                                    onChange={e => setTransferData({ ...transferData, reference: e.target.value })} placeholder="Ej: TRF-001" />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setShowTransfer(false)}>Cancelar</Button>
                            <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Realizar Traslado'}</Button>
                        </div>
                    </form>
                </div>
            </FullScreenModal>

            {/* Transfer History */}
            <FullScreenModal isOpen={showHistory} onClose={() => setShowHistory(false)} title="Historial de Traslados">
                <div className="premium-modal-content">
                    <div className="modal-tab-content">
                        <div className="stock-items-list">
                            {Object.entries(groupedTransferHistory).map(([groupId, movements]) => {
                                const ordered = [...movements].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                                // Both legs of a transfer are stored as TRANSFER movements
                                // distinguished by their reason ("Transfer out" / "Transfer in").
                                const source = ordered.find((m) => (m.reason || '').toLowerCase().startsWith('transfer out')) || ordered[0];
                                const destination = ordered.find((m) => (m.reason || '').toLowerCase().startsWith('transfer in')) || ordered[1];

                                return (
                                    <div key={groupId} className="stock-item-row">
                                        <div style={{ flex: 1 }}>
                                            <div className="stock-item-name">{ordered[0]?.product?.name}</div>
                                            <div className="stock-item-sku">
                                                {source?.warehouse?.name || 'Origen desconocido'} &rarr; {destination?.warehouse?.name || 'Destino desconocido'}
                                                {' '}&middot; Cant: {formatNumber(ordered[0]?.quantity || 0)}
                                                {' '}&middot; Por: {ordered[0]?.user?.name}
                                                {ordered[0]?.reference && <> &middot; Ref: {ordered[0].reference}</>}
                                            </div>
                                        </div>
                                        <div className="stock-item-sku">{new Date(ordered[0]?.createdAt || Date.now()).toLocaleString('es-ES')}</div>
                                    </div>
                                );
                            })}
                            {showLegacyTransferHistory && transferHistory.map((m) => (
                                <div key={m.id} className="stock-item-row">
                                    <div style={{ flex: 1 }}>
                                        <div className="stock-item-name">{m.product?.name}</div>
                                        <div className="stock-item-sku">
                                            {m.warehouse?.name} &middot; {m.type === 'TRANSFER' ? 'OUT' : 'IN'}: {formatNumber(m.quantity)}
                                            {' '}&middot; Por: {m.user?.name}
                                            {m.reference && <> &middot; Ref: {m.reference}</>}
                                        </div>
                                    </div>
                                    <div className="stock-item-sku">{new Date(m.createdAt).toLocaleString('es-ES')}</div>
                                </div>
                            ))}
                            {transferHistory.length === 0 && (
                                <p className="stock-empty-message">No hay traslados registrados</p>
                            )}
                        </div>
                    </div>
                </div>
            </FullScreenModal>
        </div>
    );
}
