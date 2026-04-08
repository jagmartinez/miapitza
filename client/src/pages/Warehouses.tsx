import { useState, useEffect } from 'react';
import { warehousesAPI, inventoryMovementsAPI, branchesAPI, productsAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import Select from '../components/Select';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import {
    Warehouse as WarehouseIcon, Plus, ArrowRightLeft, Package, MapPin,
    Eye, Trash2, Edit2, Search
} from 'lucide-react';
import type { Branch, InventoryMovement, Product, Warehouse } from '../types';
import type { SingleValue } from 'react-select';
import './Inventory.css';

function axiosMessage(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    return fallback;
}

type StrOption = { value: string; label?: string };
type WarehouseTypeOption = { value: 'CENTRAL' | 'BRANCH'; label: string };

interface StockItem {
    id: number;
    productId: number;
    quantity: number;
    product: { id: number; name: string; sku?: string; unit: string; minStock: number; cost: number };
}

export default function Warehouses() {
    const { user } = useAuth();
    const { toasts, removeToast, success: showSuccess, error: showError } = useToast();

    /** Backend: POST/PUT /warehouses — SUPERADMIN | ADMIN */
    const canMutateWarehouse = hasAnyRole(user, ['SUPERADMIN', 'ADMIN']);
    /** Backend: DELETE /warehouses — SUPERADMIN only */
    const canDeleteWarehouse = hasAnyRole(user, ['SUPERADMIN']);
    /** Backend: POST /inventory-movements/transfer — SUPERADMIN | ADMIN | BODEGA */
    const canTransferStock = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [warehouseTypeFilter, setWarehouseTypeFilter] = useState<'ALL' | 'CENTRAL' | 'BRANCH'>('ALL');

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
        fromWarehouseId: '', toWarehouseId: '', productId: '', quantity: '', reference: ''
    });

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
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteWarehouse) return;
        if (!confirm('¿Eliminar esta bodega?')) return;
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

    const handleTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canTransferStock) return;
        try {
            await inventoryMovementsAPI.transfer({
                fromWarehouseId: parseInt(transferData.fromWarehouseId),
                toWarehouseId: parseInt(transferData.toWarehouseId),
                productId: parseInt(transferData.productId),
                quantity: parseFloat(transferData.quantity),
                reference: transferData.reference || undefined
            });
            showSuccess('Traslado realizado correctamente');
            setShowTransfer(false);
            setTransferData({ fromWarehouseId: '', toWarehouseId: '', productId: '', quantity: '', reference: '' });
            loadData();
        } catch (err: unknown) {
            showError(axiosMessage(err, 'Error en traslado'));
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

            <div className="inventory-header-new">
                <div className="header-title-section">
                    <h1><WarehouseIcon size={32} /> Gestión de Bodegas</h1>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Button variant="secondary" onClick={viewTransferHistory}>
                        <ArrowRightLeft size={18} /> Historial Traslados
                    </Button>
                    {canTransferStock && (
                        <Button variant="secondary" onClick={() => setShowTransfer(true)}>
                            <ArrowRightLeft size={18} /> Nuevo Traslado
                        </Button>
                    )}
                    {canMutateWarehouse && (
                        <Button onClick={openCreate}>
                            <Plus size={18} /> Nueva Bodega
                        </Button>
                    )}
                </div>
            </div>

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

            {/* Warehouses Grid */}
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
                {filteredWarehouses.length === 0 && (
                    <div className="no-products-message">
                        <WarehouseIcon size={48} />
                        <p>No hay bodegas registradas</p>
                        {canMutateWarehouse && (
                            <Button onClick={openCreate}>Crear primera bodega</Button>
                        )}
                    </div>
                )}
            </div>

            {/* Create/Edit Warehouse */}
            <Sidebar isOpen={showForm} onClose={() => setShowForm(false)} title={editingWarehouse ? 'Editar Bodega' : 'Nueva Bodega'}>
                <form onSubmit={handleCreateUpdate} className="modal-form-new" style={{ padding: '16px' }}>
                    <div className="modal-input-group">
                        <label className="modal-input-label">Nombre</label>
                        <input type="text" className="modal-standard-input" value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Ej: Bodega Central" required autoFocus />
                    </div>
                    <div className="modal-form-row">
                        <div className="modal-input-group">
                            <label className="modal-input-label">CÃ³digo</label>
                            <input type="text" className="modal-standard-input" value={formData.code}
                                onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })} placeholder="Ej: CENTRAL-MAIN" required />
                        </div>
                        <div className="modal-input-group">
                            <Select variant="modal" label="Tipo" placeholder="Seleccionar tipo"
                                options={[
                                    { value: 'BRANCH', label: 'Sucursal' },
                                    { value: 'CENTRAL', label: 'Central' }
                                ]}
                                value={{ value: formData.type, label: formData.type === 'CENTRAL' ? 'Central' : 'Sucursal' }}
                                onChange={(opt: SingleValue<WarehouseTypeOption>) =>
                                    opt && setFormData({ ...formData, type: opt.value, branchId: opt.value === 'CENTRAL' ? '' : formData.branchId })} required />
                        </div>
                    </div>
                    {formData.type === 'BRANCH' && (
                        <div className="modal-input-group">
                            <Select variant="modal" label="Sucursal" placeholder="Seleccionar sucursal"
                                options={branches.map((b) => ({ value: b.id.toString(), label: b.name }))}
                                value={formData.branchId ? { value: formData.branchId, label: branches.find((b) => b.id.toString() === formData.branchId)?.name } : null}
                                onChange={(opt: SingleValue<StrOption>) => opt && setFormData({ ...formData, branchId: opt.value })} required />
                        </div>
                    )}
                    <div className="modal-footer">
                        <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                        <Button type="submit">{editingWarehouse ? 'Guardar' : 'Crear'}</Button>
                    </div>
                </form>
            </Sidebar>

            {/* Stock View */}
            <Sidebar isOpen={showStock} onClose={() => setShowStock(false)} title={`Stock - ${selectedWarehouse?.name || ''}`} width="large">
                <div style={{ padding: '16px' }}>
                    <div style={{ marginBottom: '12px', position: 'relative' }}>
                        <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)' }} />
                        <input type="text" className="modal-standard-input" style={{ paddingLeft: '34px' }} placeholder="Buscar producto..."
                            value={stockSearch} onChange={e => setStockSearch(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {filteredStock.map(s => {
                            const isLow = Number(s.quantity) < Number(s.product.minStock);
                            return (
                                <div key={s.id} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '10px 14px', borderRadius: '8px',
                                    background: isLow ? 'var(--color-error, #ef4444)08' : 'var(--color-neutral-50)',
                                    border: `1px solid ${isLow ? 'var(--color-error, #ef4444)30' : 'var(--color-neutral-200)'}`
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.product.name}</div>
                                        {s.product.sku && <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-500)' }}>{s.product.sku}</div>}
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 700, fontSize: '1rem', color: isLow ? 'var(--color-error)' : 'inherit' }}>
                                            {Number(s.quantity).toFixed(2)} {s.product.unit}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-neutral-400)' }}>Min: {Number(s.product.minStock)}</div>
                                    </div>
                                </div>
                            );
                        })}
                        {filteredStock.length === 0 && (
                            <p style={{ textAlign: 'center', color: 'var(--color-neutral-400)', padding: '24px 0' }}>Sin productos en esta bodega</p>
                        )}
                    </div>
                </div>
            </Sidebar>

            {/* Transfer Modal */}
            <Sidebar isOpen={showTransfer} onClose={() => setShowTransfer(false)} title="Nuevo Traslado entre Bodegas">
                <form onSubmit={handleTransfer} className="modal-form-new" style={{ padding: '16px' }}>
                    <div className="modal-input-group">
                        <Select variant="modal" label="Bodega Origen" placeholder="Seleccionar..."
                            options={warehouses.map(w => ({ value: w.id.toString(), label: `${w.name} (${w.type === 'CENTRAL' ? 'Central' : w.branch?.name || 'Sin sucursal'})` }))}
                            value={transferData.fromWarehouseId ? { value: transferData.fromWarehouseId, label: warehouses.find(w => w.id.toString() === transferData.fromWarehouseId)?.name } : null}
                            onChange={(opt: SingleValue<StrOption>) => opt && setTransferData({ ...transferData, fromWarehouseId: opt.value })} required />
                    </div>
                    <div className="modal-input-group">
                        <Select variant="modal" label="Bodega Destino" placeholder="Seleccionar..."
                            options={warehouses.filter(w => w.id.toString() !== transferData.fromWarehouseId).map(w => ({ value: w.id.toString(), label: `${w.name} (${w.type === 'CENTRAL' ? 'Central' : w.branch?.name || 'Sin sucursal'})` }))}
                            value={transferData.toWarehouseId ? { value: transferData.toWarehouseId, label: warehouses.find(w => w.id.toString() === transferData.toWarehouseId)?.name } : null}
                            onChange={(opt: SingleValue<StrOption>) => opt && setTransferData({ ...transferData, toWarehouseId: opt.value })} required />
                    </div>
                    <div className="modal-input-group">
                        <Select variant="modal" label="Producto" placeholder="Seleccionar producto..."
                            options={products.map((p) => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))}
                            value={transferData.productId ? { value: transferData.productId, label: products.find((p) => p.id.toString() === transferData.productId)?.name } : null}
                            onChange={(opt: SingleValue<StrOption>) => opt && setTransferData({ ...transferData, productId: opt.value })} required />
                    </div>
                    <div className="modal-form-row">
                        <div className="modal-input-group">
                            <label className="modal-input-label">Cantidad</label>
                            <input type="number" step="0.001" className="modal-standard-input" value={transferData.quantity}
                                onChange={e => setTransferData({ ...transferData, quantity: e.target.value })} required min="0.001" />
                        </div>
                        <div className="modal-input-group">
                            <label className="modal-input-label">Referencia (opcional)</label>
                            <input type="text" className="modal-standard-input" value={transferData.reference}
                                onChange={e => setTransferData({ ...transferData, reference: e.target.value })} placeholder="Ej: TRF-001" />
                        </div>
                    </div>
                    <div className="modal-footer">
                        <Button type="button" variant="ghost" onClick={() => setShowTransfer(false)}>Cancelar</Button>
                        <Button type="submit">Realizar Traslado</Button>
                    </div>
                </form>
            </Sidebar>

            {/* Transfer History */}
            <Sidebar isOpen={showHistory} onClose={() => setShowHistory(false)} title="Historial de Traslados" width="wide">
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {Object.entries(groupedTransferHistory).map(([groupId, movements]) => {
                        const ordered = [...movements].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                        const source = ordered.find((movement) => movement.type === 'TRANSFER');
                        const destination = ordered.find((movement) => movement.type === 'IN');

                        return (
                            <div key={groupId} style={{
                                padding: '12px', borderRadius: '8px', background: 'var(--color-neutral-50)',
                                border: '1px solid var(--color-neutral-200)', fontSize: '0.85rem'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                    <strong>{ordered[0]?.product?.name}</strong>
                                    <span style={{ color: 'var(--color-neutral-500)' }}>{new Date(ordered[0]?.createdAt || Date.now()).toLocaleString('es-ES')}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '16px', color: 'var(--color-neutral-600)', flexWrap: 'wrap' }}>
                                    <span>{source?.warehouse?.name || 'Origen desconocido'} → {destination?.warehouse?.name || 'Destino desconocido'}</span>
                                    <span>Cant: {Number(ordered[0]?.quantity || 0).toFixed(2)}</span>
                                    <span>Por: {ordered[0]?.user?.name}</span>
                                    {ordered[0]?.reference && <span>Ref: {ordered[0].reference}</span>}
                                    <span>ID: {groupId}</span>
                                </div>
                            </div>
                        );
                    })}
                    {showLegacyTransferHistory && transferHistory.map((m) => (
                        <div key={m.id} style={{
                            padding: '12px', borderRadius: '8px', background: 'var(--color-neutral-50)',
                            border: '1px solid var(--color-neutral-200)', fontSize: '0.85rem'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <strong>{m.product?.name}</strong>
                                <span style={{ color: 'var(--color-neutral-500)' }}>{new Date(m.createdAt).toLocaleString('es-ES')}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', color: 'var(--color-neutral-600)' }}>
                                <span>{m.warehouse?.name}</span>
                                <span>{m.type === 'TRANSFER' ? '→ OUT' : '← IN'}: {Number(m.quantity).toFixed(2)}</span>
                                <span>Por: {m.user?.name}</span>
                                {m.reference && <span>Ref: {m.reference}</span>}
                            </div>
                        </div>
                    ))}
                    {transferHistory.length === 0 && (
                        <p style={{ textAlign: 'center', color: 'var(--color-neutral-400)', padding: '24px 0' }}>No hay traslados registrados</p>
                    )}
                </div>
            </Sidebar>
        </div>
    );
}
