import { useState, useEffect, useCallback, useRef } from 'react';
import Select from '../components/Select';
import { useParams, useNavigate } from 'react-router-dom';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { purchaseOrdersAPI, suppliersAPI, productsAPI, branchesAPI, warehousesAPI, unitsAPI } from '../services/api';
import Button from '../components/Button';
import Input from '../components/Input';
import Modal from '../components/Modal';
import Sidebar from '../components/Sidebar';
import { Plus, Trash2, Save, CheckCircle, Package, Info, MapPin, Building2, FileText, Eye, Upload, Download } from 'lucide-react';
import type { PurchaseOrder, PurchaseOrderItem, Supplier, Product, Branch, Warehouse, ProductAllowedUnit } from '../types';
import type { SingleValue } from 'react-select';
import { useCurrency } from '../hooks/useCurrency';
import './PurchaseOrderForm.css';

type StrOption = { value: string; label: string };

interface NewOrderLineDraft {
    productId: number;
    quantity: number;
    cost: number;
    purchaseUnit?: string;
    product: Product;
}

interface PurchaseOrderFormProps {
    sidebarId?: number;
    onClose?: () => void;
    onSaved?: () => void;
}

export default function PurchaseOrderForm({ sidebarId, onClose, onSaved }: PurchaseOrderFormProps) {
    const { formatMoney } = useCurrency();
    const { id: paramId } = useParams();
    const navigate = useNavigate();
    const { confirm } = useConfirmDialog();
    const { success, error: showError, warning: showWarning } = useAppToast();

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
        invoiceNumber: '',
        invoiceDate: new Date().toISOString().split('T')[0],
        invoiceType: 'CASH' as 'CASH' | 'CREDIT',
        paymentDueDate: '',
        bank: '',
        transferNumber: ''
    });
    const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
    const [newItems, setNewItems] = useState<NewOrderLineDraft[]>([]);

    // State for Adding Item (Modal or Inline)
    const [itemForm, setItemForm] = useState({
        productId: '',
        quantity: 1,
        cost: 0,
        purchaseUnit: ''
    });
    const [itemUnits, setItemUnits] = useState<ProductAllowedUnit[]>([]);
    const [importing, setImporting] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);

    // Receive Modal
    const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
    const [isItemSidebarOpen, setIsItemSidebarOpen] = useState(false);
    const [saving, setSaving] = useState(false);

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
                invoiceNumber: res.data.data.invoiceNumber || '',
                invoiceDate: res.data.data.invoiceDate ? res.data.data.invoiceDate.split('T')[0] : '',
                invoiceType: res.data.data.invoiceType || 'CASH',
                paymentDueDate: res.data.data.paymentDueDate ? res.data.data.paymentDueDate.split('T')[0] : '',
                bank: res.data.data.bank || '',
                transferNumber: res.data.data.transferNumber || ''
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
                invoiceNumber: '',
                invoiceDate: new Date().toISOString().split('T')[0],
                invoiceType: 'CASH' as 'CASH' | 'CREDIT',
                paymentDueDate: '',
                bank: '',
                transferNumber: ''
            });
            setInvoiceFile(null);
            setNewItems([]);
            setActiveTab('general');
        }
    }, [effectiveId, loadDependencies, loadOrder]);

    const loadItemUnits = useCallback(async (productId: number) => {
        try {
            const res = await unitsAPI.getProductUnits(productId);
            const units: ProductAllowedUnit[] = res.data.data || [];
            setItemUnits(units);
            const defaultUnit = units.find(u => u.isDefault) || units.find(u => u.isBase) || units[0];
            return defaultUnit?.abbreviation || '';
        } catch {
            setItemUnits([]);
            return '';
        }
    }, []);

    const handleItemProductChange = useCallback(async (productId: string) => {
        const defaultUnit = await loadItemUnits(Number(productId));
        setItemForm(prev => ({ ...prev, productId, purchaseUnit: defaultUnit }));
    }, [loadItemUnits]);

    const handleAddItem = async () => {
        if (!itemForm.productId || itemForm.quantity <= 0 || itemForm.cost < 0) {
            showWarning('Por favor complete los datos del ítem correctamente');
            return;
        }

        const product = products.find(p => p.id === Number(itemForm.productId));
        if (!product) return;

        if (isNew) {
            setNewItems([...newItems, {
                productId: Number(itemForm.productId),
                quantity: Number(itemForm.quantity),
                cost: Number(itemForm.cost),
                purchaseUnit: itemForm.purchaseUnit || undefined,
                product
            }]);
            setItemForm({ productId: '', quantity: 1, cost: 0, purchaseUnit: '' });
            setItemUnits([]);
        } else {
            try {
                await purchaseOrdersAPI.addItem(Number(effectiveId), {
                    productId: Number(itemForm.productId),
                    quantity: Number(itemForm.quantity),
                    cost: Number(itemForm.cost),
                    purchaseUnit: itemForm.purchaseUnit || undefined
                });
                loadOrder(Number(effectiveId));
                setItemForm({ productId: '', quantity: 1, cost: 0, purchaseUnit: '' });
                setItemUnits([]);
            } catch (error) {
                console.error('Error adding item:', error);
                showError('Error al agregar ítem');
            }
        }
    };

    const handleRemoveItem = async (indexOrId: number) => {
        if (isNew) {
            setNewItems(newItems.filter((_, i) => i !== indexOrId));
        } else {
            if (!(await confirm('¿Eliminar ítem?', { title: 'Confirmar acción' }))) return;
            try {
                await purchaseOrdersAPI.removeItem(indexOrId);
                loadOrder(Number(effectiveId));
            } catch (error) {
                console.error('Error removing item:', error);
                showError('Error al eliminar ítem');
            }
        }
    };

    const handleDownloadTemplate = async () => {
        try {
            const res = await purchaseOrdersAPI.getImportTemplate();
            const blob = res.data instanceof Blob
                ? res.data
                : new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Plantilla_Orden_Compra.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading template:', error);
            showError('No se pudo descargar la plantilla');
        }
    };

    interface ImportPreviewItem {
        productId: number | null;
        name: string;
        unit: string;
        purchaseUnit: string | null;
        quantity: number;
        unitCost: number;
        isValid: boolean;
        errors?: string[];
    }

    const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Reset the input so selecting the same file again re-triggers onChange.
        e.target.value = '';
        if (!file) return;

        setImporting(true);
        try {
            const res = await purchaseOrdersAPI.validateImport(file);
            const result = (res.data?.data ?? res.data) as { items?: ImportPreviewItem[]; summary?: { invalid?: number } };
            const allItems = result.items || [];
            const validItems = allItems.filter(it => it.isValid && it.productId);
            const invalidCount = result.summary?.invalid ?? (allItems.length - validItems.length);

            if (validItems.length === 0) {
                showWarning('No se encontraron ítems válidos en el archivo. Revise los SKU y cantidades.');
                return;
            }

            if (isNew) {
                const lines: NewOrderLineDraft[] = validItems.map(it => {
                    const product = products.find(p => p.id === it.productId)
                        ?? ({ id: it.productId, name: it.name, unit: it.unit } as Product);
                    return {
                        productId: it.productId as number,
                        quantity: Number(it.quantity),
                        cost: Number(it.unitCost),
                        purchaseUnit: it.purchaseUnit || undefined,
                        product
                    };
                });
                setNewItems(prev => [...prev, ...lines]);
            } else {
                for (const it of validItems) {
                    await purchaseOrdersAPI.addItem(Number(effectiveId), {
                        productId: it.productId as number,
                        quantity: Number(it.quantity),
                        cost: Number(it.unitCost),
                        purchaseUnit: it.purchaseUnit || undefined
                    });
                }
                await loadOrder(Number(effectiveId));
            }

            success(
                `${validItems.length} ítem(s) importados` +
                (invalidCount > 0 ? `. ${invalidCount} fila(s) omitidas por errores.` : '.')
            );
        } catch (error) {
            console.error('Error importing items:', error);
            showError('Error al importar el archivo. Verifique que use la plantilla correcta.');
        } finally {
            setImporting(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.branchId || !formData.supplierId) {
            showWarning('Complete los campos obligatorios');
            setActiveTab('general');
            return;
        }

        if (isNew && newItems.length === 0) {
            showWarning('Agregue al menos un ítem');
            setActiveTab('items');
            return;
        }

        setSaving(true);
        try {
            const payload = new FormData();
            payload.append('branchId', formData.branchId);
            payload.append('supplierId', formData.supplierId);
            payload.append('notes', formData.notes);
            payload.append('invoiceNumber', formData.invoiceNumber);
            payload.append('invoiceDate', formData.invoiceDate);
            payload.append('invoiceType', formData.invoiceType);
            if (formData.invoiceType === 'CREDIT' && formData.paymentDueDate) {
                payload.append('paymentDueDate', formData.paymentDueDate);
            }
            if (formData.invoiceType === 'CASH') {
                payload.append('bank', formData.bank);
                payload.append('transferNumber', formData.transferNumber);
            }
            if (invoiceFile) {
                payload.append('invoicePdf', invoiceFile);
            }

            if (isNew) {
                payload.append('items', JSON.stringify(newItems.map(item => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    cost: item.cost,
                    purchaseUnit: item.purchaseUnit
                }))));
                const res = await purchaseOrdersAPI.create(payload);
                if (onSaved) {
                    onSaved();
                } else {
                    navigate(`/purchase-orders/${res.data.data.id}`);
                }
            } else {
                await purchaseOrdersAPI.update(Number(effectiveId), payload);
                success('Cambios guardados');
                if (onSaved) {
                    onSaved();
                } else {
                    navigate('/purchase-orders');
                }
            }
        } catch (error) {
            console.error('Error saving order:', error);
            showError('Error al guardar orden');
        } finally {
            setSaving(false);
        }
    };

    const handleStatusChange = async (newStatus: string) => {
        if (!(await confirm(`¿Cambiar estado a ${newStatus}?`, { title: 'Confirmar acción' }))) return;
        try {
            await purchaseOrdersAPI.update(Number(effectiveId), { status: newStatus });
            loadOrder(Number(effectiveId));
        } catch (error) {
            console.error('Error updating status:', error);
            showError('Error al actualizar estado');
        }
    };

    const handleReceive = async () => {
        if (!selectedWarehouseId) {
            showWarning('Seleccione un almacén');
            return;
        }
        try {
            await purchaseOrdersAPI.receive(Number(effectiveId), Number(selectedWarehouseId));
            setIsReceiveModalOpen(false);
            loadOrder(Number(effectiveId));
            success('Orden recibida e inventario actualizado');
        } catch (error) {
            console.error('Error receiving order:', error);
            showError('Error al recibir orden');
        }
    };

    if (loading) return <div>Cargando...</div>;

    const isDraft = isNew || order?.status === 'DRAFT';

    return (
        <div className="premium-modal-content po-sidebar-form">
            <div className="modal-tabs">
                <button
                    type="button"
                    className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`}
                    onClick={() => setActiveTab('general')}
                >
                    <Info size={18} />
                    <span>Información General</span>
                </button>
                <button
                    type="button"
                    className={`modal-tab ${activeTab === 'items' ? 'active' : ''}`}
                    onClick={() => setActiveTab('items')}
                >
                    <Package size={18} />
                    <span>Ítems de la Orden</span>
                </button>
            </div>

            <form onSubmit={handleSave} className="modal-form-new">
            <div className="modal-tab-content">
                {activeTab === 'general' ? (
                    <div className="modal-section animate-slide-in">
                        <div className="modal-section-header">
                            <Info size={18} />
                            <h3>Detalles de la Orden</h3>
                        </div>
                        <div className="form-grid-modern">
                            <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="po-branch"><Building2 size={14} /> Sucursal</label>
                                {(() => {
                                    const branch = branches.find(b => b.id.toString() === formData.branchId);
                                    return (
                                        <Select
                                            inputId="po-branch"
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
                                <label className="modal-input-label" htmlFor="po-supplier"><MapPin size={14} /> Proveedor</label>
                                {(() => {
                                    const supplier = suppliers.find(s => s.id.toString() === formData.supplierId);
                                    return (
                                        <Select
                                            inputId="po-supplier"
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
                                <label className="modal-input-label" htmlFor="po-invoice-number"><FileText size={14} /> Nº Factura de Proveedor</label>
                                <Input
                                    id="po-invoice-number"
                                    value={formData.invoiceNumber}
                                    onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })}
                                    disabled={!isDraft}
                                    placeholder="Ej: FAC-12345"
                                    variant="modal"
                                />
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="po-invoice-date"><FileText size={14} /> Fecha de Factura</label>
                                <input
                                    id="po-invoice-date"
                                    type="date"
                                    className="modal-standard-input"
                                    value={formData.invoiceDate}
                                    onChange={e => setFormData({ ...formData, invoiceDate: e.target.value })}
                                    disabled={!isDraft}
                                />
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="po-invoice-type"><FileText size={14} /> Tipo de Factura</label>
                                <select
                                    id="po-invoice-type"
                                    className="modal-standard-input"
                                    value={formData.invoiceType}
                                    onChange={e => setFormData({ ...formData, invoiceType: e.target.value as 'CASH' | 'CREDIT' })}
                                    disabled={!isDraft}
                                >
                                    <option value="CASH">Contado</option>
                                    <option value="CREDIT">Crédito</option>
                                </select>
                            </div>
                            {formData.invoiceType === 'CREDIT' && (
                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="po-payment-due"><FileText size={14} /> Fecha de Vencimiento</label>
                                    <input
                                        id="po-payment-due"
                                        type="date"
                                        className="modal-standard-input"
                                        value={formData.paymentDueDate}
                                        onChange={e => setFormData({ ...formData, paymentDueDate: e.target.value })}
                                        disabled={!isDraft}
                                    />
                                </div>
                            )}
                            {formData.invoiceType === 'CASH' && (
                                <>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="po-bank"><FileText size={14} /> Banco</label>
                                        <select
                                            id="po-bank"
                                            className="modal-standard-input"
                                            value={formData.bank}
                                            onChange={e => setFormData({ ...formData, bank: e.target.value })}
                                            disabled={!isDraft}
                                        >
                                            <option value="">Seleccionar banco...</option>
                                            <option value="BAC">BAC</option>
                                            <option value="BANPRO">BANPRO</option>
                                            <option value="LAFISE">LAFISE</option>
                                            <option value="FICOHSA">FICOHSA</option>
                                            <option value="AVANZ">AVANZ</option>
                                            <option value="ATLANTIDA">ATLANTIDA</option>
                                            <option value="EFECTIVO">EFECTIVO</option>
                                            <option value="OTRO">OTRO</option>
                                        </select>
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="po-transfer-number"><FileText size={14} /> Nº Transferencia</label>
                                        <Input
                                            id="po-transfer-number"
                                            value={formData.transferNumber}
                                            onChange={e => setFormData({ ...formData, transferNumber: e.target.value })}
                                            disabled={!isDraft}
                                            placeholder="Nº referencia"
                                            variant="modal"
                                        />
                                    </div>
                                </>
                            )}
                            <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="invoice-pdf"><FileText size={14} /> Factura PDF/Imagen</label>
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
                                <label className="modal-input-label" htmlFor="po-notes"><FileText size={14} /> Notas Adicionales</label>
                                <textarea
                                    id="po-notes"
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
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input
                                        ref={importInputRef}
                                        type="file"
                                        accept=".xlsx,.xls"
                                        onChange={handleImportExcel}
                                        style={{ display: 'none' }}
                                    />
                                    <Button variant="ghost" type="button" onClick={handleDownloadTemplate} className="add-item-btn-modern">
                                        <Download size={18} />
                                        Plantilla
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        type="button"
                                        onClick={() => importInputRef.current?.click()}
                                        disabled={importing}
                                        className="add-item-btn-modern"
                                    >
                                        <Upload size={18} />
                                        {importing ? 'Importando...' : 'Importar Excel'}
                                    </Button>
                                    <Button variant="ghost" type="button" onClick={() => setIsItemSidebarOpen(true)} className="add-item-btn-modern">
                                        <Plus size={20} />
                                        Agregar Ítem
                                    </Button>
                                </div>
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
                                                    <span className="p-unit">
                                                        {'purchaseUnit' in item && item.purchaseUnit
                                                            ? item.purchaseUnit
                                                            : item.product?.unit}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="text-right font-mono">{Number(item.quantity).toFixed(2)}</td>
                                            <td className="text-right font-mono">{formatMoney(Number(item.cost))}</td>
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
                    <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
                    {isDraft && (
                        <Button type="submit" className="save-btn-premium" disabled={saving}>
                            <Save size={20} />
                            <span>{saving ? 'Guardando...' : 'Guardar'}</span>
                        </Button>
                    )}
                    {!isNew && order?.status === 'DRAFT' && (
                        <Button variant="secondary" type="button" onClick={() => handleStatusChange('ISSUED')}>
                            <CheckCircle size={20} />
                            <span>Emitir</span>
                        </Button>
                    )}
                    {!isNew && order?.status === 'ISSUED' && (
                        <Button variant="secondary" type="button" onClick={() => setIsReceiveModalOpen(true)}>
                            <Package size={20} />
                            <span>Recibir</span>
                        </Button>
                    )}
                </div>
            </div>
            </form>

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
                        <label className="modal-input-label" htmlFor="po-warehouse">
                            <Building2 size={16} /> Almacén de Destino
                        </label>
                        {(() => {
                            const warehouse = warehouses.find(w => w.id.toString() === selectedWarehouseId);
                            return (
                                <Select
                                    inputId="po-warehouse"
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
                                    onChange={(option: SingleValue<StrOption>) => option && handleItemProductChange(option?.value || '')}
                                    placeholder="Seleccione Producto"
                                />
                            );
                        })()}
                        {itemUnits.length > 0 && (
                            <Select
                                variant="modal"
                                label="Unidad de Compra"
                                options={itemUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))}
                                value={itemForm.purchaseUnit
                                    ? {
                                        value: itemForm.purchaseUnit,
                                        label: itemUnits.find(u => u.abbreviation === itemForm.purchaseUnit)
                                            ? `${itemUnits.find(u => u.abbreviation === itemForm.purchaseUnit)!.name} (${itemForm.purchaseUnit})`
                                            : itemForm.purchaseUnit
                                    }
                                    : null}
                                onChange={(option: SingleValue<StrOption>) => setItemForm({ ...itemForm, purchaseUnit: option?.value || '' })}
                                placeholder="Seleccione Unidad"
                            />
                        )}
                        <Input
                            label={`Cantidad${itemForm.purchaseUnit ? ` (en ${itemForm.purchaseUnit})` : ''}`}
                            type="number"
                            value={itemForm.quantity}
                            onChange={e => setItemForm({ ...itemForm, quantity: Number(e.target.value) })}
                            min={0.001}
                            step="any"
                        />
                        {itemForm.purchaseUnit && (
                            <p style={{ fontSize: '12px', color: 'var(--text-secondary, #6b7280)', margin: '-8px 0 0' }}>
                                <Info size={12} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
                                La cantidad se ingresa en <strong>{itemForm.purchaseUnit}</strong>; se convertirá a la unidad base del inventario al recibir.
                            </p>
                        )}
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
