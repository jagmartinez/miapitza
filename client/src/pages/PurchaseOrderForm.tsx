import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { purchaseOrdersAPI, suppliersAPI, productsAPI, branchesAPI, warehousesAPI, unitsAPI } from '../services/api';
import {
    AppSelect, Badge, Button, DataTable, DateInput, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    NumberInput, Textarea, formatMoney, formatNumber,
    type Column,
} from '@/ui';
import { Plus, Trash2, Save, CheckCircle, Package, Eye, Upload, Download } from 'lucide-react';
import type { PurchaseOrder, PurchaseOrderItem, Supplier, Product, Branch, Warehouse, ProductAllowedUnit } from '../types';
import { useCurrency } from '../hooks/useCurrency';
import { formatLocalDateInput } from '../utils/dateInput';
import { BANK_OPTIONS, INVOICE_TYPE_OPTIONS } from '../constants/purchaseOrderOptions';
import styles from './compras.module.css';

type PoTab = 'data' | 'receive' | 'attachments' | 'history';

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Borrador', ISSUED: 'Emitida', RECEIVED: 'Recibida', CANCELLED: 'Cancelada' };
const STATUS_TONE = { DRAFT: 'neutral', ISSUED: 'primary', RECEIVED: 'success', CANCELLED: 'danger' } as const;

type LineRow = {
    key: string | number;
    removeKey: number;
    index: number;
    name: string;
    unit: string;
    quantity: number;
    cost: number;
};

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
    const { symbol } = useCurrency();
    const money = (value: unknown) => formatMoney(value, symbol);
    const { id: paramId } = useParams();
    const navigate = useNavigate();
    const { confirm } = useConfirmDialog();
    const { success, error: showError, warning: showWarning } = useAppToast();

    // Use sidebarId if provided, otherwise fallback to URL params (for standalone page compatibility)
    const effectiveId = sidebarId || (paramId ? parseInt(paramId) : undefined);
    const isNew = !effectiveId;
    const [activeTab, setActiveTab] = useState<PoTab>('data');

    const [order, setOrder] = useState<PurchaseOrder | null>(null);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [loading, setLoading] = useState(true);
    const [depsError, setDepsError] = useState(false);

    // Form State for New Order
    const [formData, setFormData] = useState({
        branchId: '',
        supplierId: '',
        notes: '',
        invoiceNumber: '',
        invoiceDate: formatLocalDateInput(),
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
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
    const [saving, setSaving] = useState(false);

    const loadDependencies = useCallback(async () => {
        try {
            setDepsError(false);
            const [supRes, prodRes, branchRes, warehouseRes] = await Promise.all([
                suppliersAPI.getAll({ active: true }),
                // Purchasing may include ingredients, packaging, resale goods or
                // externally sourced intermediates; do not hide valid product types.
                productsAPI.getAll({ active: true, limit: 500 }),
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
            setDepsError(true);
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
                invoiceDate: formatLocalDateInput(),
                invoiceType: 'CASH' as 'CASH' | 'CREDIT',
                paymentDueDate: '',
                bank: '',
                transferNumber: ''
            });
            setInvoiceFile(null);
            setNewItems([]);
            setActiveTab('data');
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

    const handleDownloadInvoice = async () => {
        if (!effectiveId) return;
        try {
            const response = await purchaseOrdersAPI.getInvoice(Number(effectiveId));
            const url = window.URL.createObjectURL(response.data as Blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = order?.invoiceNumber ? `Factura-${order.invoiceNumber}` : `Factura-OC-${effectiveId}`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading invoice:', error);
            showError('No se pudo descargar la factura adjunta');
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
            setActiveTab('data');
            return;
        }

        if (isNew && newItems.length === 0) {
            showWarning('Agregue al menos un ítem');
            setActiveTab('data');
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
            loadOrder(Number(effectiveId));
            success('Orden recibida e inventario actualizado');
        } catch (error) {
            console.error('Error receiving order:', error);
            showError('Error al recibir orden');
        }
    };


    const isDraft = isNew || order?.status === 'DRAFT';
    const close = onClose ?? (() => navigate('/purchase-orders'));

    const lineSource: Array<PurchaseOrderItem | NewOrderLineDraft> = isNew ? newItems : (order?.items ?? []);
    const lineRows: LineRow[] = lineSource.map((item, index) => ({
        key: isNew ? index : ('id' in item ? item.id : index),
        removeKey: isNew ? index : ('id' in item ? item.id : index),
        index,
        name: item.product?.name ?? 'N/D',
        unit: ('purchaseUnit' in item && item.purchaseUnit) ? item.purchaseUnit : (item.product?.unit ?? ''),
        quantity: Number(item.quantity),
        cost: Number(item.cost),
    }));
    const subtotal = isNew
        ? newItems.reduce((sum, item) => sum + (item.quantity * item.cost), 0)
        : Number(order?.total || 0);

    const setNewItemField = (index: number, field: 'quantity' | 'cost', value: number | null) =>
        setNewItems(prev => prev.map((it, i) => (i === index ? { ...it, [field]: value ?? 0 } : it)));

    const lineColumns: Column<LineRow>[] = [
        {
            key: 'product', header: 'Producto', width: '2fr',
            render: (r) => (
                <span>
                    {r.name}
                    {r.unit ? <span className={styles.muted}> · {r.unit}</span> : null}
                </span>
            ),
        },
        {
            key: 'quantity', header: 'Cant.', width: '1fr', type: 'qty',
            render: (r) => (isNew
                ? (
                    <NumberInput
                        aria-label={`Cantidad de ${r.name}`}
                        value={r.quantity}
                        min={0}
                        onChange={(v) => setNewItemField(r.index, 'quantity', v)}
                    />
                )
                : formatNumber(r.quantity)),
        },
        {
            key: 'cost', header: `Costo (${symbol})`, width: '1fr', type: 'money',
            render: (r) => (isNew
                ? (
                    <NumberInput
                        aria-label={`Costo de ${r.name}`}
                        value={r.cost}
                        min={0}
                        onChange={(v) => setNewItemField(r.index, 'cost', v)}
                    />
                )
                : formatNumber(r.cost)),
        },
        { key: 'total', header: `Total (${symbol})`, width: '1fr', type: 'money', accessor: (r) => r.quantity * r.cost },
        ...(isDraft ? [{
            key: 'actions', header: '', width: '3.5rem', type: 'actions' as const,
            render: (r: LineRow) => (
                <IconButton icon={Trash2} size="sm" label={`Quitar ${r.name}`} onClick={() => void handleRemoveItem(r.removeKey)} />
            ),
        }] : []),
    ];

    const dirty = isNew
        ? Boolean(newItems.length > 0 || formData.supplierId || formData.invoiceNumber || formData.notes || invoiceFile)
        : Boolean(invoiceFile || (order && (
            formData.notes !== (order.notes || '')
            || formData.invoiceNumber !== (order.invoiceNumber || '')
            || formData.invoiceType !== (order.invoiceType || 'CASH')
            || formData.bank !== (order.bank || '')
            || formData.transferNumber !== (order.transferNumber || '')
            || formData.paymentDueDate !== (order.paymentDueDate ? order.paymentDueDate.split('T')[0] : '')
            || formData.invoiceDate !== (order.invoiceDate ? order.invoiceDate.split('T')[0] : '')
        )));

    const title = isNew ? 'Nueva Orden de Compra' : `Orden de Compra #${effectiveId}`;
    const selectedProductId = itemForm.productId || null;

    return (
        <FullScreenModal
            isOpen
            onClose={close}
            title={title}
            breadcrumb={['Compras', 'Órdenes de compra']}
            subtitle={!isNew && order ? `${order.supplier?.name ?? ''}`.trim() || undefined : undefined}
            status={!isNew && order ? (
                <Badge tone={STATUS_TONE[order.status] ?? 'neutral'} dot>{STATUS_LABEL[order.status] ?? order.status}</Badge>
            ) : undefined}
            tabs={[
                { id: 'data', label: 'Datos y productos' },
                { id: 'receive', label: 'Recepción' },
                { id: 'attachments', label: 'Adjuntos' },
                { id: 'history', label: 'Historial', disabled: isNew },
            ]}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as PoTab)}
            dirty={dirty}
            aside={(
                <div className={styles.summary} aria-label="Resumen de la orden">
                    <h3>Resumen</h3>
                    <div className={styles.summaryRow}><span>Ítems</span><strong>{lineRows.length}</strong></div>
                    <div className={styles.summaryRow}><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
                    <div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span>Total</span><strong>{money(subtotal)}</strong></div>
                    <p className={styles.muted}>La orden no maneja descuento ni IVA; el total es la suma de las líneas.</p>
                </div>
            )}
            footerStart={!isNew && order?.status === 'ISSUED' ? (
                <Button icon={Package} onClick={() => setActiveTab('receive')}>Recibir</Button>
            ) : undefined}
            footer={({ requestClose }) => (
                <>
                    <Button onClick={requestClose}>Cancelar</Button>
                    {!isNew && order?.status === 'DRAFT' && (
                        <Button icon={CheckCircle} onClick={() => void handleStatusChange('ISSUED')}>Emitir</Button>
                    )}
                    {isDraft && (
                        <Button variant="primary" icon={Save} type="submit" form="po-form" loading={saving} disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Button>
                    )}
                </>
            )}
        >
            {loading ? (
                <p role="status">Cargando...</p>
            ) : (
                <form id="po-form" onSubmit={handleSave} className={styles.stack}>
                    {depsError && (
                        <div className={styles.alert} role="alert">
                            <span className={styles.inline}>
                                No se pudieron cargar sucursales, proveedores o productos; las listas pueden estar incompletas.
                                <Button size="sm" onClick={() => void loadDependencies()}>Reintentar</Button>
                            </span>
                        </div>
                    )}

                    {activeTab === 'data' && (
                        <>
                            <FormSection step={1} title="Detalles de la orden">
                                <FormGrid>
                                    <Field label="Sucursal" htmlFor="po-branch" required>
                                        <AppSelect
                                            inputId="po-branch"
                                            options={branches.map(b => ({ value: b.id.toString(), label: b.name }))}
                                            value={formData.branchId || null}
                                            onChange={(v) => v && setFormData({ ...formData, branchId: v })}
                                            isDisabled={!isNew}
                                            placeholder="Seleccione Sucursal"
                                        />
                                    </Field>
                                    <Field label="Proveedor" htmlFor="po-supplier" required>
                                        <AppSelect
                                            inputId="po-supplier"
                                            options={suppliers.map(s => ({ value: s.id.toString(), label: s.name }))}
                                            value={formData.supplierId || null}
                                            onChange={(v) => v && setFormData({ ...formData, supplierId: v })}
                                            isDisabled={!isNew}
                                            placeholder="Seleccione Proveedor"
                                        />
                                    </Field>
                                    <Field label="Nº FT" htmlFor="po-invoice-number">
                                        <Input
                                            id="po-invoice-number"
                                            value={formData.invoiceNumber}
                                            onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })}
                                            disabled={!isDraft}
                                            placeholder="Ej: FAC-12345"
                                        />
                                    </Field>
                                    <Field label="Fecha FT" htmlFor="po-invoice-date">
                                        <DateInput
                                            id="po-invoice-date"
                                            value={formData.invoiceDate}
                                            onChange={e => setFormData({ ...formData, invoiceDate: e.target.value })}
                                            disabled={!isDraft}
                                        />
                                    </Field>
                                    <Field label="Tipo" htmlFor="po-invoice-type">
                                        <AppSelect
                                            inputId="po-invoice-type"
                                            options={INVOICE_TYPE_OPTIONS}
                                            value={formData.invoiceType}
                                            onChange={(v) => v && setFormData({ ...formData, invoiceType: v as 'CASH' | 'CREDIT' })}
                                            isDisabled={!isDraft}
                                            placeholder="Seleccionar tipo..."
                                        />
                                    </Field>
                                    {formData.invoiceType === 'CREDIT' && (
                                        <Field label="Fecha de Vencimiento" htmlFor="po-payment-due">
                                            <DateInput
                                                id="po-payment-due"
                                                value={formData.paymentDueDate}
                                                onChange={e => setFormData({ ...formData, paymentDueDate: e.target.value })}
                                                disabled={!isDraft}
                                            />
                                        </Field>
                                    )}
                                    {formData.invoiceType === 'CASH' && (
                                        <>
                                            <Field label="Banco" htmlFor="po-bank">
                                                <AppSelect
                                                    inputId="po-bank"
                                                    options={BANK_OPTIONS}
                                                    value={formData.bank || null}
                                                    onChange={(v) => setFormData({ ...formData, bank: v ?? '' })}
                                                    isDisabled={!isDraft}
                                                    isClearable
                                                    placeholder="Seleccionar banco..."
                                                />
                                            </Field>
                                            <Field label="Nº Transferencia" htmlFor="po-transfer-number">
                                                <Input
                                                    id="po-transfer-number"
                                                    value={formData.transferNumber}
                                                    onChange={e => setFormData({ ...formData, transferNumber: e.target.value })}
                                                    disabled={!isDraft}
                                                    placeholder="Nº referencia"
                                                />
                                            </Field>
                                        </>
                                    )}
                                </FormGrid>
                                <Field label="Notas adicionales" htmlFor="po-notes">
                                    <Textarea
                                        id="po-notes"
                                        value={formData.notes}
                                        onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                        disabled={!isDraft}
                                        placeholder="Ingrese observaciones o detalles relevantes..."
                                        rows={4}
                                    />
                                </Field>
                            </FormSection>

                            <FormSection step={2} title="Productos de la orden">
                                {isDraft && (
                                    <>
                                        <input
                                            ref={importInputRef}
                                            type="file"
                                            accept=".xlsx,.xls"
                                            aria-label="Archivo Excel de ítems"
                                            onChange={handleImportExcel}
                                            hidden
                                        />
                                        <div className={styles.inline}>
                                            <Button icon={Download} onClick={handleDownloadTemplate}>Plantilla</Button>
                                            <Button icon={Upload} onClick={() => importInputRef.current?.click()} disabled={importing}>
                                                {importing ? 'Importando...' : 'Importar Excel'}
                                            </Button>
                                        </div>
                                        <FormGrid columns="repeat(auto-fit, minmax(min(100%, 12rem), 1fr))">
                                            <Field label="Producto" htmlFor="po-item-product">
                                                <AppSelect
                                                    inputId="po-item-product"
                                                    options={products.map(p => ({ value: p.id.toString(), label: `${p.name} (${p.unit})` }))}
                                                    value={selectedProductId}
                                                    onChange={(v) => v && void handleItemProductChange(v)}
                                                    placeholder="Seleccione Producto"
                                                />
                                            </Field>
                                            {itemUnits.length > 0 && (
                                                <Field label="Unidad de compra" htmlFor="po-item-unit">
                                                    <AppSelect
                                                        inputId="po-item-unit"
                                                        options={itemUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))}
                                                        value={itemForm.purchaseUnit || null}
                                                        onChange={(v) => setItemForm({ ...itemForm, purchaseUnit: v || '' })}
                                                        placeholder="Seleccione Unidad"
                                                    />
                                                </Field>
                                            )}
                                            <Field
                                                label={`Cantidad${itemForm.purchaseUnit ? ` (en ${itemForm.purchaseUnit})` : ''}`}
                                                htmlFor="po-item-quantity"
                                                hint={itemForm.purchaseUnit ? `Se convertirá a la unidad base del inventario al recibir.` : undefined}
                                            >
                                                <NumberInput
                                                    id="po-item-quantity"
                                                    value={itemForm.quantity}
                                                    min={0}
                                                    decimals={3}
                                                    onChange={(v) => setItemForm({ ...itemForm, quantity: v ?? 0 })}
                                                />
                                            </Field>
                                            <Field label="Costo unitario" htmlFor="po-item-cost">
                                                <NumberInput
                                                    id="po-item-cost"
                                                    value={itemForm.cost}
                                                    min={0}
                                                    prefix={symbol}
                                                    onChange={(v) => setItemForm({ ...itemForm, cost: v ?? 0 })}
                                                />
                                            </Field>
                                        </FormGrid>
                                        <div>
                                            <Button icon={Plus} onClick={() => void handleAddItem()} disabled={!itemForm.productId}>
                                                Agregar ítem
                                            </Button>
                                        </div>
                                    </>
                                )}
                                <DataTable
                                    ariaLabel="Ítems de la orden"
                                    columns={lineColumns}
                                    rows={lineRows}
                                    rowKey={(r) => r.key}
                                    empty="No hay ítems agregados aún"
                                />
                            </FormSection>
                        </>
                    )}

                    {activeTab === 'receive' && (
                        <FormSection title="Recepción de inventario">
                            {order?.status === 'ISSUED' ? (
                                <>
                                    <p className={styles.muted}>
                                        Esta acción ingresará los ítems de la orden al inventario físico. Asegúrese de contar los productos antes de confirmar.
                                    </p>
                                    <Field label="Almacén de destino" htmlFor="po-warehouse" required>
                                        <AppSelect
                                            inputId="po-warehouse"
                                            options={warehouses.map(w => ({ value: w.id.toString(), label: `${w.name} (${w.branch?.name})` }))}
                                            value={selectedWarehouseId || null}
                                            onChange={(v) => v && setSelectedWarehouseId(v)}
                                            placeholder="Seleccione Almacén"
                                        />
                                    </Field>
                                    <div>
                                        <Button variant="primary" icon={CheckCircle} onClick={() => void handleReceive()} disabled={!selectedWarehouseId}>
                                            Confirmar Recepción
                                        </Button>
                                    </div>
                                </>
                            ) : order?.status === 'RECEIVED' ? (
                                <p className={styles.muted}>Esta orden ya fue recibida y los ítems ingresaron al inventario.</p>
                            ) : (
                                <p className={styles.muted}>La orden debe estar emitida para poder recibirla.</p>
                            )}
                        </FormSection>
                    )}

                    {activeTab === 'attachments' && (
                        <FormSection title="Factura adjunta">
                            <div className={styles.fileDrop}>
                                <input
                                    type="file"
                                    id="invoice-pdf"
                                    accept="application/pdf,image/*"
                                    aria-label="Factura PDF o imagen"
                                    onChange={e => setInvoiceFile(e.target.files?.[0] || null)}
                                    disabled={!isDraft}
                                    hidden
                                />
                                <Button icon={Plus} disabled={!isDraft} onClick={() => document.getElementById('invoice-pdf')?.click()}>
                                    {invoiceFile ? invoiceFile.name : (order?.invoicePdf ? 'Cambiar archivo' : 'Adjuntar factura')}
                                </Button>
                                {order?.invoicePdf && !invoiceFile && (
                                    <Button variant="ghost" icon={Eye} onClick={() => void handleDownloadInvoice()}>Ver actual</Button>
                                )}
                            </div>
                        </FormSection>
                    )}

                    {activeTab === 'history' && order && (
                        <FormSection title="Historial de la orden">
                            <dl className={styles.details}>
                                <div><dt>Estado</dt><dd>{STATUS_LABEL[order.status] ?? order.status}</dd></div>
                                <div><dt>Fecha de la orden</dt><dd>{new Date(order.date).toLocaleDateString('es-ES')}</dd></div>
                                <div><dt>Fecha de factura</dt><dd>{order.invoiceDate ? new Date(order.invoiceDate).toLocaleDateString('es-ES') : 'No disponible'}</dd></div>
                                <div><dt>Abonado</dt><dd>{order.invoiceType === 'CREDIT' ? money(Number(order.paidAmount || 0)) : 'Contado'}</dd></div>
                            </dl>
                            {(order.payments ?? []).length > 0 && (
                                <div>
                                    {(order.payments ?? []).map((p) => (
                                        <div key={p.id} className={`${styles.paymentCard} ${p.status === 'REVERSED' ? styles.reversed : ''}`}>
                                            <div className={styles.summaryRow}>
                                                <strong>{money(Number(p.amount))}</strong>
                                                <span>{new Date(p.date).toLocaleDateString('es-ES')}{p.status === 'REVERSED' ? ' · Revertido' : ''}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </FormSection>
                    )}
                </form>
            )}
        </FullScreenModal>
    );
}
