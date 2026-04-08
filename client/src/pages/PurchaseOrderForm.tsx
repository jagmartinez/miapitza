import { useState, useEffect, useCallback } from 'react';
import Select from '../components/Select';
import { useParams, useNavigate } from 'react-router-dom';
import { purchaseOrdersAPI, suppliersAPI, productsAPI, branchesAPI, warehousesAPI } from '../services/api';
import Button from '../components/Button';
import Input from '../components/Input';
import Modal from '../components/Modal';
import Sidebar from '../components/Sidebar';
import { Plus, Trash2, Save, CheckCircle, Package, Info, MapPin, Building2, FileText, Eye } from 'lucide-react';
import type { PurchaseOrder, PurchaseOrderItem, Supplier, Product, Branch, Warehouse } from '../types';
import type { SingleValue } from 'react-select';
import './PurchaseOrderForm.css';

type StrOption = { value: string; label: string };

interface NewOrderLineDraft {
    productId: number;
    quantity: number;
    cost: number;
    product: Product;
}

interface PurchaseOrderFormProps {
    sidebarId?: number;
    onClose?: () => void;
    onSaved?: () => void;
}

export default function PurchaseOrderForm({ sidebarId, onClose, onSaved }: PurchaseOrderFormProps) {
    const { id: paramId } = useParams();
    const navigate = useNavigate();

    // Use sidebarId if provided, otherwise fallback to URL params (for standalone page compatibility)
    const effectiveId = sidebarId || (paramId ? parseInt(paramId) : undefined);
    const isNew = !effectiveId;
    const [activeTab, setActiveTab] = useState<'general' | 'items'>('general');

    const [order, setOrder] = useState<PurchaseOrder | null>(null);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [loading, setLoading] = useState(true);

    // Form State for New Order
    const [formData, setFormData] = useState({
        branchId: '',
        supplierId: '',
        notes: '',
        invoiceNumber: ''
    });
    const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
    const [newItems, setNewItems] = useState<NewOrderLineDraft[]>([]);

    // State for Adding Item (Modal or Inline)
    const [itemForm, setItemForm] = useState({
        productId: '',
        quantity: 1,
        cost: 0
    });

    // Receive Modal
    const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
    const [isItemSidebarOpen, setIsItemSidebarOpen] = useState(false);

    const loadDependencies = useCallback(async () => {
        try {
            const [supRes, prodRes, branchRes, warehouseRes] = await Promise.all([
                suppliersAPI.getAll({ active: true }),
                productsAPI.getAll({ type: 'INGREDIENT' }), // Assuming we buy ingredients
                branchesAPI.getAll(),
                warehousesAPI.getAll()
            ]);
            setSuppliers(supRes.data.data);
            setProducts(prodRes.data.data);
            setBranches(branchRes.data.data);
            setWarehouses(warehouseRes.data.data);

            // Set default branch if available
            if (branchRes.data.data.length > 0 && isNew) {
                setFormData(prev => ({ ...prev, branchId: branchRes.data.data[0].id.toString() }));
            }
        } catch (error) {
            console.error('Error loading dependencies:', error);
        } finally {
            if (isNew) setLoading(false);
        }
    }, [isNew]);

    const loadOrder = useCallback(async (orderId: number) => {
        try {
            const res = await purchaseOrdersAPI.getById(orderId);
            setOrder(res.data.data);
            setFormData({
                branchId: res.data.data.branchId.toString(),
                supplierId: res.data.data.supplierId.toString(),
                notes: res.data.data.notes || '',
                invoiceNumber: res.data.data.invoiceNumber || ''
            });
            setInvoiceFile(null);
        } catch (error) {
            console.error('Error loading order:', error);
            navigate('/purchase-orders');
        } finally {
            setLoading(false);
        }
    }, [navigate]);

    useEffect(() => {
        void loadDependencies();
        if (effectiveId) {
            void loadOrder(effectiveId);
        } else {
            setOrder(null);
            setFormData({
                branchId: '',
                supplierId: '',
                notes: '',
                invoiceNumber: ''
            });
            setInvoiceFile(null);
            setNewItems([]);
            setActiveTab('general');
        }
    }, [effectiveId, loadDependencies, loadOrder]);

    const handleAddItem = async () => {
        if (!itemForm.productId || itemForm.quantity <= 0 || itemForm.cost < 0) {
            alert('Por favor complete los datos del ítem correctamente');
            return;
        }

        const product = products.find(p => p.id === Number(itemForm.productId));
        if (!product) return;

        if (isNew) {
            setNewItems([...newItems, {
                productId: Number(itemForm.productId),
                quantity: Number(itemForm.quantity),
                cost: Number(itemForm.cost),
                product // for display
            }]);
            setItemForm({ productId: '', quantity: 1, cost: 0 });
        } else {
            // Add to existing order
            try {
                await purchaseOrdersAPI.addItem(Number(effectiveId), {
                    productId: Number(itemForm.productId),
                    quantity: Number(itemForm.quantity),
                    cost: Number(itemForm.cost)
                });
                loadOrder(Number(effectiveId));
                setItemForm({ productId: '', quantity: 1, cost: 0 });
            } catch (error) {
                console.error('Error adding item:', error);
                alert('Error al agregar ítem');
            }
        }
    };

    const handleRemoveItem = async (indexOrId: number) => {
        if (isNew) {
            setNewItems(newItems.filter((_, i) => i !== indexOrId));
        } else {
            if (!window.confirm('¿Eliminar ítem?')) return;
            try {
                await purchaseOrdersAPI.removeItem(indexOrId);
                loadOrder(Number(effectiveId));
            } catch (error) {
                console.error('Error removing item:', error);
                alert('Error al eliminar ítem');
            }
        }
    };

    const handleSave = async () => {
        if (!formData.branchId || !formData.supplierId) {
            alert('Complete los campos obligatorios');
            return;
        }

        if (isNew && newItems.length === 0) {
            alert('Agregue al menos un ítem');
            return;
        }

        try {
            const payload = new FormData();
            payload.append('branchId', formData.branchId);
            payload.append('supplierId', formData.supplierId);
            payload.append('notes', formData.notes);
            payload.append('invoiceNumber', formData.invoiceNumber);
            if (invoiceFile) {
                payload.append('invoicePdf', invoiceFile);
            }

            if (isNew) {
                payload.append('items', JSON.stringify(newItems.map(item => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    cost: item.cost
                }))));
                const res = await purchaseOrdersAPI.create(payload);
                if (onSaved) {
                    onSaved();
                } else {
                    navigate(`/purchase-orders/${res.data.data.id}`);
                }
            } else {
                await purchaseOrdersAPI.update(Number(effectiveId), payload);
                alert('Cambios guardados');
                if (onSaved) {
                    onSaved();
                } else {
                    navigate('/purchase-orders');
                }
            }
        } catch (error) {
            console.error('Error saving order:', error);
            alert('Error al guardar orden');
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        if (!window.confirm(`¿Cambiar estado a ${newStatus}?`)) return;
        try {
            await purchaseOrdersAPI.update(Number(effectiveId), { status: newStatus });
            loadOrder(Number(effectiveId));
        } catch (error) {
            console.error('Error updating status:', error);
            alert('Error al actualizar estado');
        }
    };

    const handleReceive = async () => {
        if (!selectedWarehouseId) {
            alert('Seleccione un almacén');
            return;
        }
        try {
            await purchaseOrdersAPI.receive(Number(effectiveId), Number(selectedWarehouseId));
            setIsReceiveModalOpen(false);
            loadOrder(Number(effectiveId));
            alert('Orden recibida e inventario actualizado');
        } catch (error) {
            console.error('Error receiving order:', error);
            alert('Error al recibir orden');
        }
    };

    if (loading) return <div>Cargando...</div>;

    const isDraft = isNew || order?.status === 'DRAFT';

    return (
        <div className="premium-modal-content po-sidebar-form">
            <div className="modal-tabs">
                <div
                    className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`}
                    onClick={() => setActiveTab('general')}
                >
                    <Info size={18} />
                    <span>Información General</span>
                </div>
                <div
                    className={`modal-tab ${activeTab === 'items' ? 'active' : ''}`}
                    onClick={() => setActiveTab('items')}
                >
                    <Package size={18} />
                    <span>Ítems de la Orden</span>
                </div>
            </div>

            <div className="modal-tab-content">
                {activeTab === 'general' ? (
                    <div className="modal-section animate-slide-in">
                        <div className="modal-section-header">
                            <Info size={18} />
                            <h3>Detalles de la Orden</h3>
                        </div>
                        <div className="form-grid-modern">
                            <div className="modal-input-group">
                                <label className="modal-input-label"><Building2 size={14} /> Sucursal</label>
                                {(() => {
                                    const branch = branches.find(b => b.id.toString() === formData.branchId);
                                    return (
                                        <Select
                                            options={branches.map(b => ({ value: b.id.toString(), label: b.name }))}
                                            value={branch ? { value: formData.branchId, label: branch.name } : null}
                                            onChange={(option: SingleValue<StrOption>) => option && setFormData({ ...formData, branchId: option.value })}
                                            isDisabled={!isNew}
                                            placeholder="Seleccione Sucursal"
                                            variant="modal"
                                        />
                                    );
                                })()}
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label"><MapPin size={14} /> Proveedor</label>
                                {(() => {
                                    const supplier = suppliers.find(s => s.id.toString() === formData.supplierId);
                                    return (
                                        <Select
                                            options={suppliers.map(s => ({ value: s.id.toString(), label: s.name }))}
                                            value={supplier ? { value: formData.supplierId, label: supplier.name } : null}
                                            onChange={(option: SingleValue<StrOption>) => option && setFormData({ ...formData, supplierId: option.value })}
                                            isDisabled={!isNew}
                                            placeholder="Seleccione Proveedor"
                                            variant="modal"
                                        />
                                    );
                                })()}
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label"><FileText size={14} /> Nº Factura de Proveedor</label>
                                <Input
                                    value={formData.invoiceNumber}
                                    onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })}
                                    disabled={!isDraft}
                                    placeholder="Ej: FAC-12345"
                                    variant="modal"
                                />
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label"><FileText size={14} /> Factura PDF/Imagen</label>
                                <div className="file-upload-wrapper">
                                    <input
                                        type="file"
                                        id="invoice-pdf"
                                        accept="application/pdf,image/*"
                                        onChange={e => setInvoiceFile(e.target.files?.[0] || null)}
                                        disabled={!isDraft}
                                        style={{ display: 'none' }}
                                    />
                                    <label htmlFor="invoice-pdf" className={`file-upload-label ${!isDraft ? 'disabled' : ''}`}>
                                        <Plus size={16} />
                                        {invoiceFile ? invoiceFile.name : (order?.invoicePdf ? 'Cambiar archivo' : 'Adjuntar factura')}
                                    </label>
                                    {order?.invoicePdf && !invoiceFile && (
                                        <a
                                            href={`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${order.invoicePdf}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="view-pdf-link"
                                        >
                                            <Eye size={14} /> Ver actual
                                        </a>
                                    )}
                                </div>
                            </div>
                            <div className="modal-input-group full-width">
                                <label className="modal-input-label"><FileText size={14} /> Notas Adicionales</label>
                                <textarea
                                    value={formData.notes}
                                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                    disabled={!isDraft}
                                    className="modal-textarea"
                                    placeholder="Ingrese observaciones o detalles relevantes..."
                                    rows={4}
                                />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="modal-section animate-slide-in">
                        <div className="modal-section-header" style={{ justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <Package size={18} />
                                <h3>Ítems de la Orden</h3>
                            </div>
                            {isDraft && (
                                <Button variant="ghost" onClick={() => setIsItemSidebarOpen(true)} className="add-item-btn-modern">
                                    <Plus size={20} />
                                    Agregar Ítem
                                </Button>
                            )}
                        </div>

                        <div className="modern-table-container">
                            <table className="modern-po-table">
                                <thead>
                                    <tr>
                                        <th>Producto</th>
                                        <th style={{ textAlign: 'right' }}>Cant.</th>
                                        <th style={{ textAlign: 'right' }}>Costo</th>
                                        <th style={{ textAlign: 'right' }}>Total</th>
                                        {isDraft && <th className="text-center"></th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(isNew ? newItems : order?.items || []).map((item: PurchaseOrderItem | NewOrderLineDraft, index: number) => (
                                        <tr key={isNew ? index : ('id' in item ? item.id : index)}>
                                            <td className="product-name-cell">
                                                <div className="product-info-mini">
                                                    <span className="p-name">{item.product?.name}</span>
                                                    <span className="p-unit">{item.product?.unit}</span>
                                                </div>
                                            </td>
                                            <td className="text-right font-mono">{Number(item.quantity).toFixed(2)}</td>
                                            <td className="text-right font-mono">${Number(item.cost).toFixed(2)}</td>
                                            <td className="text-right font-bold">${(Number(item.quantity) * Number(item.cost)).toFixed(2)}</td>
                                            {isDraft && (
                                                <td className="text-center">
                                                    <button
                                                        className="action-btn-mini delete"
                                                        onClick={() => handleRemoveItem(isNew ? index : ('id' in item ? item.id : index))}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    {(isNew ? newItems.length : (order?.items?.length || 0)) === 0 && (
                                        <tr>
                                            <td colSpan={isDraft ? 5 : 4} className="empty-table-msg">
                                                No hay ítems agregados aún
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr className="po-total-row">
                                        <td colSpan={3} className="text-right">Total:</td>
                                        <td className="text-right total-amount">
                                            $
                                            {(isNew
                                                ? newItems.reduce((sum, item) => sum + (item.quantity * item.cost), 0)
                                                : Number(order?.total || 0)
                                            ).toFixed(2)}
                                        </td>
                                        {isDraft && <td></td>}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            <div className="modal-footer">
                <div className="status-indicator" style={{ marginRight: 'auto' }}>
                    {!isNew && order && (
                        <div className={`modern-status-badge status-${order.status.toLowerCase()}`}>
                            {order.status === 'DRAFT' ? 'Borrador' :
                                order.status === 'ISSUED' ? 'Emitida' :
                                    order.status === 'RECEIVED' ? 'Recibida' : 'Cancelada'}
                        </div>
                    )}
                </div>
                <div className="action-buttons" style={{ display: 'flex', gap: '8px' }}>
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    {isDraft && (
                        <Button onClick={handleSave} className="save-btn-premium">
                            <Save size={20} />
                            <span>Guardar</span>
                        </Button>
                    )}
                    {!isNew && order?.status === 'DRAFT' && (
                        <Button variant="secondary" onClick={() => handleStatusChange('ISSUED')}>
                            <CheckCircle size={20} />
                            <span>Emitir</span>
                        </Button>
                    )}
                    {!isNew && order?.status === 'ISSUED' && (
                        <Button variant="secondary" onClick={() => setIsReceiveModalOpen(true)}>
                            <Package size={20} />
                            <span>Recibir</span>
                        </Button>
                    )}
                </div>
            </div>

            <Modal
                isOpen={isReceiveModalOpen}
                onClose={() => setIsReceiveModalOpen(false)}
                title="Recibir Orden"
            >
                <div className="receive-modal-container">
                    <div className="receive-info-box">
                        <Info size={20} className="info-icon" />
                        <div className="info-text">
                            <p>Esta acción ingresará los ítems de la orden al inventario físico.</p>
                            <span className="info-subtext">Asegúrese de contar los productos antes de confirmar.</span>
                        </div>
                    </div>

                    <div className="modal-input-group">
                        <label className="modal-input-label">
                            <Building2 size={16} /> Almacén de Destino
                        </label>
                        {(() => {
                            const warehouse = warehouses.find(w => w.id.toString() === selectedWarehouseId);
                            return (
                                <Select
                                    variant="modal"
                                    options={warehouses.map(w => ({ value: w.id.toString(), label: `${w.name} (${w.branch?.name})` }))}
                                    value={warehouse ? { value: selectedWarehouseId, label: `${warehouse.name} (${warehouse.branch?.name})` } : null}
                                    onChange={(option: SingleValue<StrOption>) => option && setSelectedWarehouseId(option.value)}
                                    placeholder="Seleccione Almacén"
                                />
                            );
                        })()}
                    </div>

                    <div className="modal-footer-actions">
                        <Button variant="secondary" onClick={() => setIsReceiveModalOpen(false)} fullWidth>
                            Cancelar
                        </Button>
                        <Button onClick={handleReceive} fullWidth className="receive-confirm-btn">
                            <CheckCircle size={20} />
                            Confirmar Recepción
                        </Button>
                    </div>
                </div>
            </Modal>

            <Sidebar
                isOpen={isItemSidebarOpen}
                onClose={() => setIsItemSidebarOpen(false)}
                title="Agregar Ítem"
            >
                <div className="add-item-form-container">
                    <div className="add-item-form">
                        {(() => {
                            const prod = products.find(p => p.id.toString() === itemForm.productId);
                            return (
                                <Select
                                    variant="modal"
                                    label="Producto"
                                    options={products.map(p => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))}
                                    value={prod ? { value: itemForm.productId, label: `${prod.name} (${prod.unit})` } : null}
                                    onChange={(option: SingleValue<StrOption>) => option && setItemForm({ ...itemForm, productId: option.value })}
                                    placeholder="Seleccione Producto"
                                />
                            );
                        })()}
                        <Input
                            label="Cantidad"
                            type="number"
                            value={itemForm.quantity}
                            onChange={e => setItemForm({ ...itemForm, quantity: Number(e.target.value) })}
                            min={0.001}
                            step="any"
                        />
                        <Input
                            label="Costo Unitario"
                            type="number"
                            value={itemForm.cost}
                            onChange={e => setItemForm({ ...itemForm, cost: Number(e.target.value) })}
                            min={0}
                            step="0.01"
                        />
                        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                            <Button variant="ghost" onClick={() => setIsItemSidebarOpen(false)} fullWidth>
                                Cancelar
                            </Button>
                            <Button onClick={() => { handleAddItem(); setIsItemSidebarOpen(false); }} disabled={!itemForm.productId} fullWidth>
                                Agregar
                            </Button>
                        </div>
                    </div>
                </div>
            </Sidebar>
        </div>
    );
}
