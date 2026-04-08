import { useState, useEffect } from 'react';
import { purchaseOrdersAPI, suppliersAPI, branchesAPI } from '../services/api';
import Button from './Button';
import Select from './Select';
import { Download, Upload, CheckCircle, AlertTriangle, X, ShoppingCart, Loader2, FileSpreadsheet } from 'lucide-react';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import type { SingleValue } from 'react-select';
import './PurchaseOrderImport.css';

type IdNameOption = { value: number; label: string };

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
                    unitCost: item.unitCost
                }))
            });
            onSaved();
        } catch (error: unknown) {
            setError(axiosErrorMessage(error, 'Error al crear la orden de compra'));
        } finally {
            setConfirming(false);
        }
    };

    return (
        <div className="po-import-container">
            {/* Stepper */}
            <div className="import-stepper">
                <div className={`step-item ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
                    <div className="step-number">{step > 1 ? <CheckCircle size={16} /> : 1}</div>
                    <div className="step-label">Cargar Excel</div>
                </div>
                <div className="step-line"></div>
                <div className={`step-item ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
                    <div className="step-number">{step > 2 ? <CheckCircle size={16} /> : 2}</div>
                    <div className="step-label">Validar Datos</div>
                </div>
                <div className="step-line"></div>
                <div className={`step-item ${step >= 3 ? 'active' : ''}`}>
                    <div className="step-number">3</div>
                    <div className="step-label">Confirmar</div>
                </div>
            </div>

            {error && (
                <div className="import-error">
                    <AlertTriangle size={20} />
                    <span>{error}</span>
                    <button onClick={() => setError(null)}><X size={16} /></button>
                </div>
            )}

            {/* Step 1: Upload */}
            {step === 1 && (
                <div className="import-step-content">
                    <div className="template-download-section">
                        <h3>1. Descargar Plantilla</h3>
                        <p>Use nuestra plantilla Excel para asegurarse de que los datos tengan el formato correcto.</p>
                        <Button variant="secondary" onClick={handleDownloadTemplate} className="w-full">
                            <Download size={18} />
                            Descargar Plantilla.xlsx
                        </Button>
                    </div>

                    <div className="file-upload-section">
                        <h3>2. Subir Archivo</h3>
                        <div className={`file-drop-zone ${file ? 'has-file' : ''}`}>
                            <input
                                type="file"
                                accept=".xlsx, .xls"
                                onChange={handleFileChange}
                                id="file-input"
                                className="hidden-input"
                            />
                            <label htmlFor="file-input" className="file-label">
                                {file ? <FileSpreadsheet size={48} className="file-icon success" /> : <Upload size={48} className="file-icon" />}
                                <div className="file-info">
                                    <span className="file-name">{file ? file.name : 'Seleccionar o arrastrar archivo Excel'}</span>
                                    <span className="file-hint">Formatos soportados: .xlsx, .xls</span>
                                </div>
                            </label>
                        </div>

                        <div className="import-actions flex-row">
                            <Button
                                variant="secondary"
                                onClick={onClose}
                                disabled={uploading}
                                className="w-full"
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleUpload}
                                disabled={!file || uploading}
                                className="w-full"
                            >
                                {uploading ? <><Loader2 size={18} className="animate-spin" /> Procesando...</> : 'Procesar Archivo'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Step 2: Preview */}
            {step === 2 && importData && (
                <div className="import-step-content wide">
                    <div className="import-summary-bar">
                        <div className="summary-item">
                            <span className="label">Total Filas:</span>
                            <span className="value">{importData.summary.totalRows}</span>
                        </div>
                        <div className="summary-item success">
                            <span className="label">Válidos:</span>
                            <span className="value">{importData.summary.valid}</span>
                        </div>
                        <div className="summary-item error">
                            <span className="label">Con Error:</span>
                            <span className="value">{importData.summary.invalid}</span>
                        </div>
                        <div className="summary-item total">
                            <span className="label">Costo Total:</span>
                            <span className="value">{formatCurrency(importData.summary.totalCost, settings)}</span>
                        </div>
                    </div>

                    <div className="import-preview-table-wrapper">
                        <table className="preview-table">
                            <thead>
                                <tr>
                                    <th>Fila</th>
                                    <th>Estado</th>
                                    <th>SKU</th>
                                    <th>Producto</th>
                                    <th>Cantidad</th>
                                    <th>Costo Unit.</th>
                                    <th>Subtotal</th>
                                    <th>Errores</th>
                                </tr>
                            </thead>
                            <tbody>
                                {importData.items.map((item, idx) => (
                                    <tr key={idx} className={item.isValid ? '' : 'row-error'}>
                                        <td>{item.rowNumber}</td>
                                        <td>
                                            {item.isValid ?
                                                <CheckCircle size={18} className="text-success" /> :
                                                <AlertTriangle size={18} className="text-error" />
                                            }
                                        </td>
                                        <td>{item.sku}</td>
                                        <td>{item.name}</td>
                                        <td>{item.quantity} {item.unit}</td>
                                        <td>{formatCurrency(item.unitCost, settings)}</td>
                                        <td>{formatCurrency(item.total, settings)}</td>
                                        <td className="cell-errors">
                                            {item.errors.map((err, eIdx) => (
                                                <div key={eIdx} className="error-text">{err}</div>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="import-actions flex-row">
                        <Button variant="secondary" onClick={() => setStep(1)}>
                            <ArrowLeft size={18} />
                            Subir otro archivo
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => setStep(3)}
                            disabled={importData.summary.valid === 0}
                        >
                            Siguiente Paso
                            <ArrowRight size={18} />
                        </Button>
                    </div>
                </div>
            )}

            {/* Step 3: Confirm */}
            {step === 3 && importData && (
                <div className="import-step-content">
                    <div className="final-info-section">
                        <h3>Detalles de la Orden</h3>
                        <p>Seleccione el proveedor y la sucursal para finalizar la creación de la orden con los <strong>{importData.summary.valid}</strong> productos válidos.</p>

                        <div className="form-group">
                            <Select
                                label="Proveedor"
                                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                                value={selectedSupplier ? { value: selectedSupplier, label: suppliers.find(s => s.id === selectedSupplier)?.name || '' } : null}
                                onChange={(opt: SingleValue<IdNameOption>) => setSelectedSupplier(opt?.value ?? null)}
                                placeholder="Seleccionar proveedor..."
                                required
                            />
                        </div>

                        <div className="form-group">
                            <Select
                                label="Sucursal"
                                options={branches.map(b => ({ value: b.id, label: b.name }))}
                                value={selectedBranch ? { value: selectedBranch, label: branches.find(b => b.id === selectedBranch)?.name || '' } : null}
                                onChange={(opt: SingleValue<IdNameOption>) => setSelectedBranch(opt?.value ?? null)}
                                placeholder="Seleccionar sucursal..."
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Nº Factura de Proveedor (Opcional)</label>
                            <input
                                type="text"
                                className="form-input"
                                value={invoiceNumber}
                                onChange={(e) => setInvoiceNumber(e.target.value)}
                                placeholder="Ej: FAC-12345"
                                style={{
                                    width: '100%',
                                    padding: 'var(--spacing-md)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    background: 'var(--color-surface)',
                                    color: 'var(--color-text)',
                                    fontSize: 'var(--font-size-sm)'
                                }}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Notas (Opcional)</label>
                            <textarea
                                className="form-textarea"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Observaciones de la orden..."
                                rows={3}
                            />
                        </div>

                        <div className="import-totals-card">
                            <div className="total-row">
                                <span>Productos a importar:</span>
                                <strong>{importData.summary.valid}</strong>
                            </div>
                            <div className="total-row big">
                                <span>Total Estimado:</span>
                                <strong>{formatCurrency(importData.summary.totalCost, settings)}</strong>
                            </div>
                        </div>
                    </div>

                    <div className="import-actions flex-row">
                        <Button variant="secondary" onClick={() => setStep(2)} disabled={confirming}>
                            <ArrowLeft size={18} />
                            Volver al Preview
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleConfirmImport}
                            disabled={!selectedSupplier || confirming}
                        >
                            {confirming ? <><Loader2 size={18} className="animate-spin" /> Creando...</> : <><ShoppingCart size={18} /> Crear Orden de Compra</>}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Internal icons helper for step navigation
function ArrowLeft({ size }: { size: number }) {
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>;
}

function ArrowRight({ size }: { size: number }) {
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>;
}
