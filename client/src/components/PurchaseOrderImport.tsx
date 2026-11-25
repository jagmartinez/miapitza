import { useState, useEffect } from 'react';
import { purchaseOrdersAPI, suppliersAPI, branchesAPI } from '../services/api';
import {
    AppSelect, Button, DataTable, Field, FormGrid, FormSection, FullScreenModal, Input, Textarea, formatMoney, formatNumber,
    type Column,
} from '@/ui';
import { Download, Upload, CheckCircle, AlertTriangle, ShoppingCart, FileSpreadsheet, ArrowLeft, ArrowRight } from 'lucide-react';
import type { CurrencySettings } from '../utils/currency';
import styles from '../pages/compras.module.css';

const STEP_LABELS = ['Cargar Excel', 'Validar Datos', 'Confirmar'];

function axiosErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof msg === 'string' && msg) return msg;
    }
    return fallback;
}


interface SupplierRow {
    id: number;
    name: string;
}

interface BranchRow {
    id: number;
    name: string;
}

interface ImportItem {
    rowNumber: number;
    sku: string;
    name: string;
    productId: number | null;
    unit: string;
    purchaseUnit: string | null;
    quantity: number;
    unitCost: number;
    total: number;
    errors: string[];
    isValid: boolean;
}

interface ImportSummary {
    valid: number;
    invalid: number;
    totalRows: number;
    totalCost: number;
}

interface PurchaseOrderImportProps {
    onClose: () => void;
    onSaved: () => void;
    settings: CurrencySettings;
}

export default function PurchaseOrderImport({ onClose, onSaved, settings }: PurchaseOrderImportProps) {
    const [step, setStep] = useState(1);
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [importData, setImportData] = useState<{ items: ImportItem[]; summary: ImportSummary } | null>(null);

    // Finalization state
    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [branches, setBranches] = useState<BranchRow[]>([]);
    const [selectedSupplier, setSelectedSupplier] = useState<number | null>(null);
    const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        try {
            const [suppliersRes, branchesRes] = await Promise.all([
                suppliersAPI.getAll(),
                branchesAPI.getAll()
            ]);
            setSuppliers(suppliersRes.data.data || []);
            setBranches(branchesRes.data.data || []);

            if (branchesRes.data.data?.length > 0) {
                setSelectedBranch(branchesRes.data.data[0].id);
            }
        } catch (error) {
            console.error('Error loading initial data for import:', error);
            setError('No se pudieron cargar proveedores y sucursales; cierra y vuelve a abrir la carga masiva para reintentar.');
        }
    };

    const handleDownloadTemplate = async () => {
        try {
            const response = await purchaseOrdersAPI.getImportTemplate();
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'Plantilla_Orden_Compra.xlsx');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            setError('Error al descargar la plantilla');
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setError(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setUploading(true);
        setError(null);
        try {
            const response = await purchaseOrdersAPI.validateImport(file);
            setImportData(response.data.data);
            setStep(2);
        } catch (error: unknown) {
            setError(axiosErrorMessage(error, 'Error al procesar el archivo'));
        } finally {
            setUploading(false);
        }
    };

    const handleConfirmImport = async () => {
        if (!selectedSupplier || !selectedBranch || !importData) return;

        const validItems = importData.items.filter(item => item.isValid);
        if (validItems.length === 0) {
            setError('No hay productos válidos para importar');
            return;
        }

        setConfirming(true);
        setError(null);
        try {
            await purchaseOrdersAPI.confirmImport({
                branchId: selectedBranch,
                supplierId: selectedSupplier,
                invoiceNumber: invoiceNumber,
                notes: notes,
                items: validItems.map(item => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitCost: item.unitCost,
                    purchaseUnit: item.purchaseUnit
                }))
            });
            onSaved();
        } catch (error: unknown) {
            setError(axiosErrorMessage(error, 'Error al crear la orden de compra'));
        } finally {
            setConfirming(false);
        }
    };


    const symbol = settings.currency_symbol || 'C$';
    const money = (value: unknown) => formatMoney(value, symbol);

    const previewColumns: Column<ImportItem>[] = [
        { key: 'rowNumber', header: 'Fila', width: '0.6fr', type: 'number', decimals: 0 },
        {
            key: 'valid', header: 'Estado', width: '0.7fr',
            render: (it) => (it.isValid
                ? <span aria-label="Válida"><CheckCircle size={18} aria-hidden="true" /></span>
                : <span aria-label="Con error"><AlertTriangle size={18} aria-hidden="true" /></span>),
        },
        { key: 'sku', header: 'SKU', width: '1fr', hideBelow: 'md' },
        { key: 'name', header: 'Producto', width: '2fr' },
        { key: 'quantity', header: 'Cantidad', width: '1fr', type: 'qty', render: (it) => `${formatNumber(it.quantity)} ${it.unit}`.trim() },
        { key: 'purchaseUnit', header: 'Unidad Compra', width: '1fr', hideBelow: 'lg', render: (it) => it.purchaseUnit || 'Por defecto' },
        { key: 'unitCost', header: `Costo Unit. (${symbol})`, width: '1fr', type: 'money' },
        { key: 'total', header: `Subtotal (${symbol})`, width: '1fr', type: 'money' },
        {
            key: 'errors', header: 'Errores', width: '2fr',
            render: (it) => (it.errors.length ? <span>{it.errors.join(' · ')}</span> : ''),
        },
    ];

    const footer = (
        <>
            {step === 1 && (
                <>
                    <Button onClick={onClose} disabled={uploading}>Cancelar</Button>
                    <Button variant="primary" onClick={handleUpload} loading={uploading} disabled={!file || uploading}>
                        {uploading ? 'Procesando...' : 'Procesar Archivo'}
                    </Button>
                </>
            )}
            {step === 2 && importData && (
                <>
                    <Button icon={ArrowLeft} onClick={() => setStep(1)}>Subir otro archivo</Button>
                    <Button variant="primary" onClick={() => setStep(3)} disabled={importData.summary.valid === 0}>
                        Siguiente Paso <ArrowRight size={16} aria-hidden="true" />
                    </Button>
                </>
            )}
            {step === 3 && importData && (
                <>
                    <Button icon={ArrowLeft} onClick={() => setStep(2)} disabled={confirming}>Volver al Preview</Button>
                    <Button
                        variant="primary" icon={ShoppingCart}
                        onClick={handleConfirmImport} loading={confirming}
                        disabled={!selectedSupplier || confirming}
                    >
                        {confirming ? 'Creando...' : 'Crear Orden de Compra'}
                    </Button>
                </>
            )}
        </>
    );

    return (
        <FullScreenModal
            isOpen
            onClose={onClose}
            title="Carga Masiva desde Excel"
            breadcrumb={['Compras', 'Órdenes de compra']}
            subtitle={`Paso ${step} de 3 · ${STEP_LABELS[step - 1]}`}
            dirty={Boolean(file) || importData !== null}
            dirtyMessage="Hay un archivo cargado sin confirmar. Si cierras ahora se perderá."
            footer={footer}
        >
            <div className={styles.stack}>
                {error && (
                    <div className={styles.alert} role="alert">
                        <span className={styles.inline}>
                            {error}
                            <Button size="sm" variant="ghost" onClick={() => setError(null)}>Cerrar aviso</Button>
                        </span>
                    </div>
                )}

                {step === 1 && (
                    <>
                        <FormSection step={1} title="Descargar plantilla" description="Use la plantilla Excel para asegurarse de que los datos tengan el formato correcto.">
                            <p className={styles.muted}>
                                Opcional: puede incluir una columna <strong>&quot;Unidad de compra&quot;</strong> (ej: caja, kg, l) para que la cantidad se convierta a la unidad base al recibir.
                            </p>
                            <div>
                                <Button icon={Download} onClick={handleDownloadTemplate}>Descargar Plantilla.xlsx</Button>
                            </div>
                        </FormSection>
                        <FormSection step={2} title="Subir archivo" description="Formatos soportados: .xlsx, .xls">
                            <div className={styles.fileDrop}>
                                <input
                                    type="file"
                                    accept=".xlsx, .xls"
                                    onChange={handleFileChange}
                                    id="file-input"
                                    aria-label="Archivo Excel"
                                    hidden
                                />
                                <Button
                                    icon={file ? FileSpreadsheet : Upload}
                                    onClick={() => document.getElementById('file-input')?.click()}
                                >
                                    {file ? file.name : 'Seleccionar archivo Excel'}
                                </Button>
                            </div>
                        </FormSection>
                    </>
                )}

                {step === 2 && importData && (
                    <FormSection
                        title="Validar datos"
                        description={`${importData.summary.valid} válidas de ${importData.summary.totalRows} filas · ${importData.summary.invalid} con error · costo total ${money(importData.summary.totalCost)}`}
                    >
                        <DataTable
                            ariaLabel="Vista previa de la importación"
                            columns={previewColumns}
                            rows={importData.items}
                            rowKey={(it) => it.rowNumber}
                            rowTone={(it) => (it.isValid ? undefined : 'danger')}
                            empty="El archivo no contiene filas"
                        />
                    </FormSection>
                )}

                {step === 3 && importData && (
                    <FormSection
                        title="Detalles de la orden"
                        description={`Seleccione el proveedor y la sucursal para crear la orden con los ${importData.summary.valid} productos válidos.`}
                    >
                        <FormGrid>
                            <Field label="Proveedor" htmlFor="import-supplier" required>
                                <AppSelect<number>
                                    inputId="import-supplier"
                                    options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                                    value={selectedSupplier}
                                    onChange={(v) => setSelectedSupplier(v)}
                                    placeholder="Seleccionar proveedor..."
                                />
                            </Field>
                            <Field label="Sucursal" htmlFor="import-branch" required>
                                <AppSelect<number>
                                    inputId="import-branch"
                                    options={branches.map(b => ({ value: b.id, label: b.name }))}
                                    value={selectedBranch}
                                    onChange={(v) => setSelectedBranch(v)}
                                    placeholder="Seleccionar sucursal..."
                                />
                            </Field>
                            <Field label="Nº Factura de Proveedor (opcional)" htmlFor="import-invoice">
                                <Input
                                    id="import-invoice"
                                    value={invoiceNumber}
                                    onChange={(e) => setInvoiceNumber(e.target.value)}
                                    placeholder="Ej: FAC-12345"
                                />
                            </Field>
                        </FormGrid>
                        <Field label="Notas (opcional)" htmlFor="import-notes">
                            <Textarea
                                id="import-notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Observaciones de la orden..."
                            />
                        </Field>
                        <div className={styles.summary}>
                            <div className={styles.summaryRow}><span>Productos a importar</span><strong>{importData.summary.valid}</strong></div>
                            <div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span>Total estimado</span><strong>{money(importData.summary.totalCost)}</strong></div>
                        </div>
                    </FormSection>
                )}
            </div>
        </FullScreenModal>
    );
}
