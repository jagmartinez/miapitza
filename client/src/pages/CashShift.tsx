import { useState, useEffect, useMemo, useCallback } from 'react';
import Select from '../components/Select';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { cashShiftsAPI, cashArqueoAPI, suppliersAPI } from '../services/api';
import { escapeHtml } from '../utils/escapeHtml';
import Card from '../components/Card';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import Input from '../components/Input';
import Sidebar from '../components/Sidebar';
import { ArrowLeft, Lock, Plus, Minus, Calendar, User, Banknote, Coins, Printer, Clock, Hash, TrendingUp, TrendingDown, Wallet, FileText, Building2, DollarSign } from 'lucide-react';
import type { CashMovement, CashShift, Supplier } from '../types';
import type { SingleValue } from 'react-select';
import { hasAnyRole } from '../utils/authz';
import { useAppToast } from '../context/ToastContext';
import { DEFAULT_EXCHANGE_RATE } from '../utils/currency';
import { useCurrency } from '../hooks/useCurrency';
import { formatLocalDateInput } from '../utils/dateInput';
import './CashShift.css';

interface DenomCountRow {
    denomination: number;
    count: number;
}

interface ShiftSummaryState {
    expectedAmount?: number;
    totalIn?: number;
    totalOut?: number;
    totalSalesCash?: number;
    grossSalesCash?: number;
    cashRefunds?: number;
    otherIncome?: number;
    otherOutflows?: number;
    [key: string]: unknown;
}

interface ArqueoDetailsState {
    counts?: {
        bills?: DenomCountRow[];
        coins?: DenomCountRow[];
    };
    [key: string]: unknown;
}

interface ClosePreviewState {
    difference?: number;
    tolerance?: number;
    requiresNote?: boolean;
    exceedsTolerance?: boolean;
    expectedAmount?: number;
}

function errMsg(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return fallback;
}


const BILL_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10];
const COIN_DENOMINATIONS = [10, 5, 1, 0.5, 0.25];
const USD_BILL_DENOMINATIONS = [100, 50, 20, 10, 5, 1];
const ITEMS_PER_PAGE = 8;

const DOCUMENT_TYPES = [
    { value: 'FACTURA', label: 'Factura' },
    { value: 'RECIBO_GASTO', label: 'Recibo de Gasto' },
    { value: 'RECIBO_CAJA', label: 'Recibo de Caja' },
    { value: 'NOTA_CREDITO', label: 'Nota de Crédito' },
    { value: 'NOTA_DEBITO', label: 'Nota de Débito' }
];

// Format currency with thousand separators
const formatCurrency = (value: number): string => {
    return value.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Format duration
const formatDuration = (startDate: string, endDate?: string): string => {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
};

const CASH_MOVEMENT_CATEGORY_LABELS: Record<string, string> = {
    POS_SALE: 'Venta POS',
    CATERING_SALE: 'Cobro Catering',
    POS_PAYMENT_REVERSAL: 'Reverso de pago POS',
    CATERING_PAYMENT_REVERSAL: 'Reverso de pago Catering',
    CREDIT_NOTE_REFUND: 'Reembolso por nota de crédito',
    MANUAL_INCOME: 'Entrada manual',
    MANUAL_OUTFLOW: 'Salida manual',
    UNCLASSIFIED_INCOME: 'Entrada no clasificada',
    UNCLASSIFIED_OUTFLOW: 'Salida no clasificada'
};

const getMovementCategoryLabel = (movement: CashMovement): string =>
    movement.category
        ? (CASH_MOVEMENT_CATEGORY_LABELS[movement.category] || 'Movimiento no clasificado')
        : 'Movimiento no clasificado';

const getMovementPaymentOrigin = (movement: CashMovement): string =>
    movement.paymentMethod?.name || 'Movimiento no clasificado';

const getMovementAuditLabel = (movement: CashMovement): string => {
    const typeLabel = movement.paymentMethod?.type
        ? ({
            CASH: 'Efectivo',
            CARD: 'Tarjeta',
            BANK_TRANSFER: 'Transferencia bancaria',
            OTHER: 'Otro método'
        }[movement.paymentMethod.type])
        : null;
    return [getMovementCategoryLabel(movement), typeLabel].filter(Boolean).join(' · ');
};

export default function CashShiftPage() {
    const { formatMoney, symbol } = useCurrency();
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { error: showError, warning: showWarning, success } = useAppToast();
    const [shift, setShift] = useState<CashShift | null>(null);
    const [summary, setSummary] = useState<ShiftSummaryState | null>(null);
    const [arqueoDetails, setArqueoDetails] = useState<ArqueoDetailsState | null>(null);
    const [loading, setLoading] = useState(true);

    // Movement Table State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'IN' | 'OUT'>('all');
    const [currentPage, setCurrentPage] = useState(1);

    // Movement Sidebar
    const [isMovementSidebarOpen, setIsMovementSidebarOpen] = useState(false);
    const [movementType, setMovementType] = useState<'IN' | 'OUT'>('OUT');
    const [movementForm, setMovementForm] = useState({
        amount: '',
        description: '',
        documentDate: '',
        documentType: '',
        documentNumber: '',
        supplierId: ''
    });

    // Suppliers for withdrawal
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [isNewSupplierModalOpen, setIsNewSupplierModalOpen] = useState(false);
    const [newSupplierForm, setNewSupplierForm] = useState({
        name: '',
        contact: '',
        phone: '',
        email: '',
        address: '',
        taxId: '',
        supplyType: ''
    });

    // Close Shift Sidebar
    const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
    const [arqueoTab, setArqueoTab] = useState<'NIO' | 'USD'>('NIO');
    const [billsCount, setBillsCount] = useState<Record<number, number>>({});
    const [coinsCount, setCoinsCount] = useState<Record<number, number>>({});
    const [usdBillsCount, setUsdBillsCount] = useState<Record<number, number>>({});
    const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
    const [closeNotes, setCloseNotes] = useState('');
    const [closePreview, setClosePreview] = useState<ClosePreviewState | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    const canForceClose = hasAnyRole(user, ['ADMIN', 'SUPERADMIN']);
    /** Same backend constraint as supplier POST from cash context */
    const canCreateSupplier = canForceClose;
    const isBlindCashier = hasAnyRole(user, ['CAJERO']) && !canForceClose;

    // Calculate totals
    const totalCordobas = useMemo(() => {
        const billsTotal = Object.entries(billsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0);
        const coinsTotal = Object.entries(coinsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0);
        return billsTotal + coinsTotal;
    }, [billsCount, coinsCount]);

    const totalUSD = useMemo(() => {
        return Object.entries(usdBillsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0);
    }, [usdBillsCount]);

    const totalUSDinCordobas = useMemo(() => {
        return totalUSD * exchangeRate;
    }, [totalUSD, exchangeRate]);

    const totalCounted = useMemo(() => {
        return totalCordobas + totalUSDinCordobas;
    }, [totalCordobas, totalUSDinCordobas]);

    const closeDifference = useMemo(() => {
        const expectedAmount = Number(summary?.expectedAmount || 0);
        return Math.round((totalCounted - expectedAmount) * 100) / 100;
    }, [summary?.expectedAmount, totalCounted]);

    const effectiveDifference = closePreview?.difference ?? closeDifference;
    const closeTolerance = Number(closePreview?.tolerance ?? 1);
    const showLegacyExactMatchWarning = false;

    const buildClosePayload = () => ({
        endAmount: totalCounted,
        notes: closeNotes,
        bills: Object.entries(billsCount).map(([den, count]) => ({ denomination: Number(den), count })),
        coins: Object.entries(coinsCount).map(([den, count]) => ({ denomination: Number(den), count })),
        usdBills: Object.entries(usdBillsCount).map(([den, count]) => ({ denomination: Number(den), count })),
        exchangeRate
    });

    const loadData = useCallback(async () => {
        try {
            const [shiftRes, summaryRes, arqueoRes] = await Promise.all([
                cashShiftsAPI.getById(Number(id)).catch(e => {
                    console.error('[CASH-SHIFT-PAGE] Error loading shift:', e);
                    throw new Error(`Failed to load shift: ${e.response?.data?.message || e.message}`);
                }),
                cashShiftsAPI.getSummary(Number(id)).catch(e => {
                    console.error('[CASH-SHIFT-PAGE] Error loading summary:', e);
                    throw new Error(`Failed to load summary: ${e.response?.data?.message || e.message}`);
                }),
                cashArqueoAPI.getDetails(Number(id)).catch(e => {
                    console.error('[CASH-SHIFT-PAGE] Error loading arqueo details:', e);
                    throw new Error(`Failed to load arqueo: ${e.response?.data?.message || e.message}`);
                })
            ]);

            setShift(shiftRes.data.data);
            setSummary(summaryRes.data.data.summary); // Access the nested summary object
            setArqueoDetails(arqueoRes.data.data);
        } catch (error: unknown) {
            console.error('[CASH-SHIFT-PAGE] Error loading shift data:', error);
            showError(`Error cargando datos del turno: ${error instanceof Error ? error.message : 'Error'}`);
        } finally {
            setLoading(false);
        }
    }, [id, showError]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    useEffect(() => {
        if (!isCloseModalOpen) {
            setClosePreview(null);
        }
    }, [isCloseModalOpen]);

    // Filtered and paginated movements
    const filteredMovements = useMemo(() => {
        if (!shift?.movements) return [];

        let filtered = shift.movements;

        // Filter by type
        if (filterType !== 'all') {
            filtered = filtered.filter(m => m.type === filterType);
        }

        // Filter by search
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(m =>
                m.description?.toLowerCase().includes(query) ||
                m.reference?.toLowerCase().includes(query) ||
                getMovementPaymentOrigin(m).toLowerCase().includes(query) ||
                getMovementCategoryLabel(m).toLowerCase().includes(query) ||
                m.amount.toString().includes(query)
            );
        }

        return filtered;
    }, [shift?.movements, filterType, searchQuery]);

    const totalPages = Math.max(1, Math.ceil(filteredMovements.length / ITEMS_PER_PAGE));
    const paginatedMovements = filteredMovements.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    // Movement counts by type
    const inCount = shift?.movements?.filter(m => m.type === 'IN').length || 0;
    const outCount = shift?.movements?.filter(m => m.type === 'OUT').length || 0;

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [filterType, searchQuery]);

    const handleAddMovement = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const payload: {
                type: 'IN' | 'OUT';
                amount: number;
                description: string;
                documentDate?: string;
                documentType?: string;
                documentNumber?: string;
                supplierId?: number;
            } = {
                type: movementType,
                amount: Number(movementForm.amount),
                description: movementForm.description
            };

            // Add optional document fields if provided
            if (movementForm.documentDate) {
                payload.documentDate = movementForm.documentDate;
            }
            if (movementForm.documentType) {
                payload.documentType = movementForm.documentType;
            }
            if (movementForm.documentNumber) {
                payload.documentNumber = movementForm.documentNumber;
            }
            // Only add supplier for withdrawals
            if (movementType === 'OUT' && movementForm.supplierId) {
                payload.supplierId = Number(movementForm.supplierId);
            }

            await cashShiftsAPI.addMovement(Number(id), payload);
            setIsMovementSidebarOpen(false);
            setMovementForm({
                amount: '',
                description: '',
                documentDate: '',
                documentType: '',
                documentNumber: '',
                supplierId: ''
            });
            loadData();
        } catch (error) {
            console.error('Error adding movement:', error);
            showError('Error al registrar movimiento');
        }
    };


    const handlePreviewClose = async () => {
        try {
            setPreviewLoading(true);
            const response = await cashArqueoAPI.previewClose(Number(id), buildClosePayload());
            setClosePreview(response.data.data);
        } catch (error: unknown) {
            console.error('Error previewing close:', error);
            showError('Error al validar arqueo: ' + errMsg(error, 'Error'));
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleCloseShift = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const preview = closePreview || (await cashArqueoAPI.previewClose(Number(id), buildClosePayload())).data.data;
            setClosePreview(preview);

            if (preview.requiresNote && !closeNotes.trim()) {
                showWarning('Debes agregar una observación cuando exista una diferencia dentro de tolerancia.');
                return;
            }

            if (preview.exceedsTolerance && !canForceClose) {
                showWarning(`La diferencia excede la tolerancia de ${formatMoney(closeTolerance)}.`);
                return;
            }

            if (preview.exceedsTolerance && canForceClose && !closeNotes.trim()) {
                showWarning('El cierre forzado requiere una observación obligatoria.');
                return;
            }

            await cashArqueoAPI.closeShift(Number(id), {
                ...buildClosePayload(),
                forceClose: preview.exceedsTolerance && canForceClose
            });
            setIsCloseModalOpen(false);
            loadData();
            success('Turno cerrado correctamente');
        } catch (error: unknown) {
            console.error('Error closing shift:', error);
            showError('Error al cerrar turno: ' + errMsg(error, 'Error'));
        }
    };

    const handlePrintReport = async () => {
        try {
            const res = await cashArqueoAPI.getReport(Number(id));
            const data = res.data.data;
            const shift = data.shift;
            const amounts = data.amounts;
            const movements = data.movements;
            const counts = data.counts;
            const safeCurrencySymbol = escapeHtml(symbol);

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                showError('No se pudo abrir el reporte. Permite ventanas emergentes e inténtalo de nuevo.');
                return;
            }

            printWindow.document.write(`
                    <html>
                        <head>
                            <title>Reporte de Caja - Turno #${shift.id}</title>
                            <style>
                                body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1a1a1a; line-height: 1.5; padding: 40px; }
                                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
                                .header h1 { margin: 0; font-size: 24px; color: #111; text-transform: uppercase; letter-spacing: 1px; }
                                .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; background: #f8f9fa; padding: 15px; border-radius: 8px; font-size: 14px; }
                                .section-title { font-size: 16px; font-weight: 700; margin: 25px 0 15px 0; padding-bottom: 8px; border-bottom: 1px solid #ddd; text-transform: uppercase; color: #444; }
                                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
                                th { text-align: left; padding: 10px; background: #f1f3f5; border: 1px solid #dee2e6; color: #495057; }
                                td { padding: 8px 10px; border: 1px solid #dee2e6; }
                                .text-right { text-align: right; }
                                .total-row { font-weight: 700; background: #f8f9fa; }
                                .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
                                .amount-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #eee; }
                                .amount-item.grand-total { border-top: 2px solid #111; border-bottom: none; margin-top: 10px; padding-top: 10px; font-size: 16px; font-weight: 800; }
                                .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
                                .badge-in { background: #d4edda; color: #155724; }
                                .badge-out { background: #f8d7da; color: #721c24; }
                                .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #777; }
                                .signature-row { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 80px; }
                                .signature-box { border-top: 1px solid #000; text-align: center; padding-top: 10px; font-size: 13px; }
                                @media print {
                                    body { padding: 0; }
                                    .no-print { display: none; }
                                }
                            </style>
                        </head>
                        <body>
                            <div class="no-print" style="margin-bottom: 20px; text-align: right;">
                                <button onclick="window.print()" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer;">Imprimir</button>
                            </div>

                            <div class="header">
                                <h1>Cierre de Caja</h1>
                                <p style="margin: 5px 0 0 0; color: #666;">Turno #${escapeHtml(shift.id)}</p>
                            </div>

                            <div class="meta">
                                <div>
                                    <strong>Caja:</strong> ${escapeHtml(shift.cashRegister)}<br>
                                    <strong>Cajero:</strong> ${escapeHtml(shift.user)}
                                </div>
                                <div class="text-right">
                                    <strong>Apertura:</strong> ${new Date(shift.startDate).toLocaleString()}<br>
                                    <strong>Cierre:</strong> ${shift.endDate ? new Date(shift.endDate).toLocaleString() : 'Pendiente'}
                                </div>
                            </div>

                            <div class="summary-grid">
                                <div>
                                    <div class="section-title">Resumen de Totales</div>
                                     <div class="amount-item"><span>Monto Inicial:</span> <span>${safeCurrencySymbol} ${formatCurrency(amounts.startAmount)}</span></div>
                                     <div class="amount-item"><span>Ventas netas en efectivo (POS + Catering):</span> <span style="color: #28a745;">+ ${safeCurrencySymbol} ${formatCurrency(Number(amounts.totalSalesCash || 0))}</span></div>
                                     <div class="amount-item"><span>Otros ingresos de caja:</span> <span style="color: #28a745;">+ ${safeCurrencySymbol} ${formatCurrency(Number(amounts.otherIncome || 0))}</span></div>
                                     <div class="amount-item"><span>Gastos / Retiros:</span> <span style="color: #dc3545;">- ${safeCurrencySymbol} ${formatCurrency(Number(amounts.otherOutflows || 0))}</span></div>
                                     <div class="amount-item grand-total"><span>Monto Esperado:</span> <span>${safeCurrencySymbol} ${formatCurrency(amounts.expectedEndAmount)}</span></div>
                                     <p style="font-size: 11px; color: #666; margin-top: 12px;">
                                         Otros ingresos son únicamente entradas manuales o no asociadas a una venta.
                                         No incluyen cobros POS/Catering. Las ventas netas descuentan reversos y notas de crédito.
                                     </p>
                                    
                                    <div class="section-title">Resultados del Arqueo</div>
                                     <div class="amount-item"><span>Monto Contado:</span> <span>${safeCurrencySymbol} ${formatCurrency(amounts.actualEndAmount || 0)}</span></div>
                                    <div class="amount-item" style="font-weight: 700; color: ${amounts.difference >= 0 ? '#28a745' : '#dc3545'};">
                                        <span>Diferencia:</span> 
                                         <span>${safeCurrencySymbol} ${formatCurrency(amounts.difference || 0)}</span>
                                    </div>
                                </div>

                                <div>
                                    <div class="section-title">Billetaje (Efectivo)</div>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Denominación</th>
                                                <th class="text-right">Cant.</th>
                                                <th class="text-right">Subtotal</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${counts.bills.map((b: DenomCountRow) => `
                                                <tr>
                                                     <td>Billete ${safeCurrencySymbol} ${b.denomination}</td>
                                                    <td class="text-right">${b.count}</td>
                                                     <td class="text-right">${safeCurrencySymbol} ${formatCurrency(b.denomination * b.count)}</td>
                                                </tr>
                                            `).join('')}
                                            ${counts.coins.map((c: DenomCountRow) => `
                                                <tr>
                                                     <td>Moneda ${safeCurrencySymbol} ${c.denomination.toFixed(2)}</td>
                                                    <td class="text-right">${c.count}</td>
                                                     <td class="text-right">${safeCurrencySymbol} ${formatCurrency(c.denomination * c.count)}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                        <tfoot>
                                            <tr class="total-row">
                                                <td colspan="2">TOTAL EFECTIVO</td>
                                                 <td class="text-right">${safeCurrencySymbol} ${formatCurrency(amounts.actualEndAmount || 0)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            <div class="section-title">Detalle de Movimientos (Ingresos y Egresos)</div>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Hora</th>
                                        <th>Tipo</th>
                                        <th>Referencia</th>
                                        <th>Forma de pago / origen</th>
                                        <th>Descripción</th>
                                        <th class="text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${[...movements.in, ...movements.out].sort((a: CashMovement, b: CashMovement) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((m: CashMovement) => `
                                        <tr>
                                            <td>${escapeHtml(new Date(m.createdAt).toLocaleTimeString())}</td>
                                            <td><span class="badge ${m.type === 'IN' ? 'badge-in' : 'badge-out'}">${m.type === 'IN' ? 'INGRESO' : 'EGRESO'}</span></td>
                                            <td>${escapeHtml(m.documentNumber || m.reference || '-')}</td>
                                            <td>
                                                ${escapeHtml(getMovementPaymentOrigin(m))}
                                                <br><small>${escapeHtml(getMovementAuditLabel(m))}</small>
                                            </td>
                                            <td>${escapeHtml(m.description)} ${m.supplier ? `(${escapeHtml(m.supplier.name)})` : ''}</td>
                                            <td class="text-right" style="color: ${m.type === 'IN' ? '#28a745' : '#dc3545'};">
                                                 ${m.type === 'IN' ? '+' : '-'}${safeCurrencySymbol} ${formatCurrency(Number(m.amount))}
                                            </td>
                                        </tr>
                                    `).join('')}
                                    ${(movements.in.length === 0 && movements.out.length === 0) ? '<tr><td colspan="6" style="text-align: center;">No se registraron movimientos adicionales</td></tr>' : ''}
                                </tbody>
                            </table>

                            <div class="signature-row">
                                <div class="signature-box">Firma del Cajero</div>
                                <div class="signature-box">Firma del Supervisor</div>
                            </div>

                            <div class="footer">
                                <p>Este documento es un comprobante oficial de arqueo de caja.</p>
                                <p>Generado por Sistema de Restaurante | ${new Date().toLocaleString()}</p>
                            </div>
                        </body>
                    </html>
            `);
            printWindow.document.close();
        } catch (error) {
            console.error('Error printing report:', error);
            showError('Error al generar el reporte');
        }
    };

    const openMovementSidebar = async (type: 'IN' | 'OUT') => {
        setMovementType(type);
        setMovementForm({
            amount: '',
            description: '',
            documentDate: formatLocalDateInput(), // Default to today
            documentType: '',
            documentNumber: '',
            supplierId: ''
        });

        // Load suppliers for withdrawals
        if (type === 'OUT') {
            try {
                const res = await suppliersAPI.getAll({ active: true });
                setSuppliers(res.data.data);
            } catch (error) {
                console.error('Error loading suppliers:', error);
            }
        }

        setIsMovementSidebarOpen(true);
    };


    if (loading || !shift) return <div className="cash-shift-loading">Cargando turno...</div>;

    const isOpen = !shift.endDate;

    return (
        <div className="cash-shift-page">
            {/* Header */}
            <div className="page-header">
                <div className="flex items-center gap-4">
                    <Button variant="secondary" onClick={() => navigate('/cash-registers')}>
                        <ArrowLeft size={20} />
                    </Button>
                    <h1>Turno #{shift.id}</h1>
                    <span className={`status-badge ${isOpen ? 'OPEN' : 'CLOSED'}`}>
                        {isOpen ? 'ABIERTO' : 'CERRADO'}
                    </span>
                </div>
                {isOpen ? (
                    <div className="actions">
                        <Button variant="secondary" onClick={() => openMovementSidebar('IN')}>
                            <Plus size={18} />
                            Ingreso
                        </Button>
                        <Button variant="secondary" onClick={() => openMovementSidebar('OUT')}>
                            <Minus size={18} />
                            Retiro
                        </Button>
                        <Button onClick={() => setIsCloseModalOpen(true)}>
                            <Lock size={18} />
                            Cerrar Turno
                        </Button>
                    </div>
                ) : (
                    <div className="actions">
                        <Button variant="secondary" onClick={handlePrintReport}>
                            <Printer size={18} />
                            Imprimir Reporte
                        </Button>
                    </div>
                )}
            </div>

            <div className="shift-grid">
                <div className="shift-main">
                    {/* Stats Layout - Professional Dashboard Style */}
                    <div className="shift-summary-dashboard">
                        <div className="summary-card-v2 primary">
                            <div className="card-icon"><Wallet size={24} /></div>
                            <div className="card-data">
                                <span className="label">Saldo Inicial</span>
                                <span className="amount">{formatMoney(Number(shift.startAmount))}</span>
                            </div>
                        </div>
                        <div className="summary-card-v2 success">
                            <div className="card-icon"><TrendingUp size={24} /></div>
                            <div className="card-data">
                                <span className="label">Ventas netas efectivo</span>
                                <span className="amount">+ {formatMoney(Number(summary?.totalSalesCash || 0))}</span>
                            </div>
                        </div>
                        <div className="summary-card-v2 blue">
                            <div className="card-icon"><Plus size={24} /></div>
                            <div className="card-data">
                                <span className="label">Otros ingresos de caja</span>
                                <span className="amount">+ {formatMoney(Number(summary?.otherIncome || 0))}</span>
                            </div>
                        </div>
                        <div className="summary-card-v2 danger">
                            <div className="card-icon"><Minus size={24} /></div>
                            <div className="card-data">
                                <span className="label">Gastos / Retiros</span>
                                <span className="amount">- {formatMoney(Number(summary?.otherOutflows || 0))}</span>
                            </div>
                        </div>
                    </div>
                    <div className="cash-income-explanation" role="note">
                        <strong>¿Qué son “Otros ingresos”?</strong>
                        <span>
                            Entradas manuales o no asociadas a ventas. No incluyen cobros POS ni Catering.
                            “Ventas netas efectivo” ya descuenta reversos y reembolsos por notas de crédito;
                            “Gastos / Retiros” muestra únicamente las demás salidas.
                        </span>
                    </div>

                    {/* Movements Card with Filters */}
                    <Card>
                        <div className="movements-header">
                            <h3>Movimientos</h3>
                            <div className="movements-toolbar">
                                {/* Type Filter */}
                                <div className="type-filter-buttons">
                                    <button
                                        className={`type-filter-btn ${filterType === 'all' ? 'active' : ''}`}
                                        onClick={() => setFilterType('all')}
                                    >
                                        Todos ({shift.movements?.length || 0})
                                    </button>
                                    <button
                                        className={`type-filter-btn in ${filterType === 'IN' ? 'active' : ''}`}
                                        onClick={() => setFilterType('IN')}
                                    >
                                        <TrendingUp size={14} />
                                        Ingresos ({inCount})
                                    </button>
                                    <button
                                        className={`type-filter-btn out ${filterType === 'OUT' ? 'active' : ''}`}
                                        onClick={() => setFilterType('OUT')}
                                    >
                                        <TrendingDown size={14} />
                                        Egresos ({outCount})
                                    </button>
                                </div>
                                {/* Search */}
                                <input
                                    type="text"
                                    className="search-input"
                                    placeholder="Buscar..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="table-responsive">
                            <table className="movements-table">
                                <thead>
                                    <tr>
                                        <th>Hora</th>
                                        <th>Tipo</th>
                                        <th>Documento</th>
                                        <th>Forma de pago / origen</th>
                                        <th>Descripción</th>
                                        <th>Proveedor</th>
                                        <th className="text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedMovements.map(mov => (
                                        <tr key={mov.id}>
                                            <td>{new Date(mov.createdAt).toLocaleTimeString()}</td>
                                            <td>
                                                <span className={`type-badge ${mov.type}`}>
                                                    {mov.type === 'IN' ? 'INGRESO' : 'EGRESO'}
                                                </span>
                                            </td>
                                            <td>
                                                {mov.documentNumber ? (
                                                    <span className="document-ref">
                                                        {mov.documentNumber}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td>
                                                <div className="payment-origin">
                                                    <span>{getMovementPaymentOrigin(mov)}</span>
                                                    <small>{getMovementAuditLabel(mov)}</small>
                                                </div>
                                            </td>
                                            <td>{mov.description || '-'}</td>
                                            <td>{mov.supplier?.name || '-'}</td>
                                            <td className={`text-right amount-cell ${mov.type === 'IN' ? 'text-green' : 'text-red'}`}>
                                                {mov.type === 'IN' ? '+' : '-'}{formatMoney(Number(mov.amount))}
                                            </td>
                                        </tr>
                                    ))}
                                    {paginatedMovements.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="text-center empty-row">
                                                {searchQuery || filterType !== 'all'
                                                    ? 'No hay movimientos que coincidan con los filtros'
                                                    : 'No hay movimientos registrados'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <Pagination
                            page={currentPage}
                            totalPages={totalPages}
                            totalItems={filteredMovements.length}
                            pageSize={ITEMS_PER_PAGE}
                            onPageChange={setCurrentPage}
                            alwaysShow
                            emptyLabel="Sin resultados"
                        />
                    </Card>
                </div>

                {/* Enhanced Sidebar */}
                <div className="shift-sidebar">
                    {/* Shift Info Card */}
                    <Card title="Información del Turno">
                        <div className="sidebar-info-grid">
                            <div className="sidebar-info-item">
                                <Hash size={16} />
                                <div className="sidebar-info-content">
                                    <span className="sidebar-info-label">ID Turno</span>
                                    <span className="sidebar-info-value">#{shift.id}</span>
                                </div>
                            </div>
                            <div className="sidebar-info-item">
                                <Wallet size={16} />
                                <div className="sidebar-info-content">
                                    <span className="sidebar-info-label">Caja</span>
                                    <span className="sidebar-info-value">{shift.register?.name || `Caja #${shift.cashRegisterId || shift.id}`}</span>
                                </div>
                            </div>
                            <div className="sidebar-info-item">
                                <User size={16} />
                                <div className="sidebar-info-content">
                                    <span className="sidebar-info-label">Cajero</span>
                                    <span className="sidebar-info-value">{shift.user?.name}</span>
                                </div>
                            </div>
                            <div className="sidebar-info-item">
                                <Calendar size={16} />
                                <div className="sidebar-info-content">
                                    <span className="sidebar-info-label">Inicio</span>
                                    <span className="sidebar-info-value">{new Date(shift.startDate).toLocaleString()}</span>
                                </div>
                            </div>
                            {shift.endDate && (
                                <div className="sidebar-info-item">
                                    <Calendar size={16} />
                                    <div className="sidebar-info-content">
                                        <span className="sidebar-info-label">Cierre</span>
                                        <span className="sidebar-info-value">{new Date(shift.endDate).toLocaleString()}</span>
                                    </div>
                                </div>
                            )}
                            <div className="sidebar-info-item">
                                <Clock size={16} />
                                <div className="sidebar-info-content">
                                    <span className="sidebar-info-label">Duración</span>
                                    <span className="sidebar-info-value">{formatDuration(shift.startDate, shift.endDate || undefined)}</span>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Quick Summary */}
                    <Card title="Resumen Rápido">
                        <div className="quick-summary">
                            <div className="summary-row">
                                <span>Total Movimientos</span>
                                <span className="summary-value">{shift.movements?.length || 0}</span>
                            </div>
                            <div className="summary-row">
                                <span>Ingresos</span>
                                <span className="summary-value text-green">+{formatMoney(Number(summary?.totalIn || 0))}</span>
                            </div>
                            <div className="summary-row">
                                <span>Egresos</span>
                                <span className="summary-value text-red">-{formatMoney(Number(summary?.totalOut || 0))}</span>
                            </div>
                            <div className="summary-row total">
                                <span>Balance</span>
                                <span className={`summary-value ${(summary?.totalIn || 0) - (summary?.totalOut || 0) >= 0 ? 'text-green' : 'text-red'}`}>
                                    {formatMoney((summary?.totalIn || 0) - (summary?.totalOut || 0))}
                                </span>
                            </div>
                        </div>
                    </Card>

                    {!isOpen && (
                        <>
                            {(() => {
                                const arqueoBills = arqueoDetails?.counts?.bills ?? [];
                                const arqueoCoins = arqueoDetails?.counts?.coins ?? [];
                                if (arqueoBills.length === 0 && arqueoCoins.length === 0) return null;
                                return (
                                <Card title="Arqueo Detallado">
                                    <div className="arqueo-breakdown-list">
                                        {arqueoBills.map((b) => (
                                            <div key={`view-bill-${b.denomination}`} className="info-row">
                                                <span>{symbol} {b.denomination} × {b.count}</span>
                                                <span>{formatMoney(b.denomination * b.count)}</span>
                                            </div>
                                        ))}
                                        {arqueoCoins.map((c) => (
                                            <div key={`view-coin-${c.denomination}`} className="info-row">
                                                <span>{symbol} {c.denomination.toFixed(2)} × {c.count}</span>
                                                <span>{formatMoney(c.denomination * c.count)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                                );
                            })()}

                            <Card title="Resultado del Cierre">
                                <div className="closing-info">
                                    <div className="info-row">
                                        <span>Esperado:</span>
                                        <span>{isBlindCashier ? 'Oculto hasta validar' : formatMoney(Number(summary?.expectedAmount || 0))}</span>
                                    </div>
                                    <div className="info-row">
                                        <span>Real:</span>
                                        <span>{formatMoney(Number(shift.endAmount))}</span>
                                    </div>
                                    <div className={`info-row difference ${Number(shift.difference) >= 0 ? 'positive' : 'negative'}`}>
                                        <span>Diferencia:</span>
                                        <span>{formatMoney(Number(shift.difference))}</span>
                                    </div>
                                    {shift.notes && (
                                        <div className="closing-notes">
                                            <strong>Notas:</strong>
                                            <p>{shift.notes}</p>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </>
                    )}
                </div>
            </div>

            {/* Movement Sidebar */}
            <Sidebar
                isOpen={isMovementSidebarOpen}
                onClose={() => setIsMovementSidebarOpen(false)}
                title={movementType === 'IN' ? 'Registrar Ingreso' : 'Registrar Retiro'}
            >
                <div className="premium-modal-content">
                    <form onSubmit={handleAddMovement} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-section">
                                <div className="modal-section-header">
                                    <FileText size={18} />
                                    <h3>Información del Documento</h3>
                                </div>
                                <div className="modal-form-row">
                                    <Input
                                        label="Fecha Documento"
                                        type="date"
                                        variant="modal"
                                        value={movementForm.documentDate}
                                        onChange={(e) => setMovementForm({ ...movementForm, documentDate: e.target.value })}
                                    />
                                    <Select
                                        variant="modal"
                                        label="Tipo Documento"
                                        options={DOCUMENT_TYPES}
                                        value={DOCUMENT_TYPES.find(dt => dt.value === movementForm.documentType) || null}
                                        onChange={(option: SingleValue<{ value: string; label: string }>) => setMovementForm({ ...movementForm, documentType: option?.value || '' })}
                                        placeholder="Seleccionar..."
                                        isSearchable={false}
                                    />
                                </div>
                                <Input
                                    label="Número de Documento"
                                    variant="modal"
                                    value={movementForm.documentNumber}
                                    onChange={(e) => setMovementForm({ ...movementForm, documentNumber: e.target.value })}
                                    placeholder="Ej: FAC-001, REC-2026-001"
                                />
                            </div>

                            {movementType === 'OUT' && (
                                <div className="modal-section">
                                    <div className="modal-section-header">
                                        <Building2 size={18} />
                                        <h3>Proveedor</h3>
                                    </div>
                                    {(() => {
                                        const supplier = suppliers.find(s => s.id.toString() === movementForm.supplierId);
                                        return (
                                            <div className="modal-form-row" style={{ alignItems: 'flex-end' }}>
                                                <div style={{ flex: 1 }}>
                                                    <Select
                                                        variant="modal"
                                                        label="Seleccionar Proveedor"
                                                        options={[{ value: '', label: 'Sin proveedor' }, ...suppliers.map(s => ({ value: s.id.toString(), label: s.name }))]}
                                                        value={supplier ? { value: movementForm.supplierId, label: supplier.name } : { value: '', label: 'Sin proveedor' }}
                                                        onChange={(option: SingleValue<{ value: string; label: string }>) => setMovementForm({ ...movementForm, supplierId: option?.value || '' })}
                                                    />
                                                </div>
                                                {canCreateSupplier && (
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        onClick={() => setIsNewSupplierModalOpen(true)}
                                                        className="add-supplier-btn"
                                                        style={{ width: '42px', height: '42px', padding: 0, marginBottom: '2px' }}
                                                    >
                                                        <Plus size={16} />
                                                    </Button>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            <div className="modal-section">
                                <div className="modal-section-header">
                                    <Banknote size={18} />
                                    <h3>Monto y Descripción</h3>
                                </div>
                                <Input
                                    label="Monto"
                                    variant="modal"
                                    type="number"
                                    value={movementForm.amount}
                                    onChange={(e) => setMovementForm({ ...movementForm, amount: e.target.value })}
                                    min={0}
                                    step="0.01"
                                    required
                                />
                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="movement-description">Descripción</label>
                                    <textarea
                                        id="movement-description"
                                        className="modal-textarea"
                                        rows={3}
                                        value={movementForm.description}
                                        onChange={(e) => setMovementForm({ ...movementForm, description: e.target.value })}
                                        placeholder="Describe el motivo del movimiento..."
                                        required
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsMovementSidebarOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit">
                                {movementType === 'IN' ? 'Registrar Ingreso' : 'Registrar Retiro'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>

            {/* Arqueo de Caja (Close Shift) Sidebar */}
            <Sidebar
                isOpen={isCloseModalOpen}
                onClose={() => setIsCloseModalOpen(false)}
                title="Cierre de Turno"
            >
                <div className="arqueo-sidebar">
                    {/* Summary Cards */}
                    <div className="arqueo-summary-cards">
                        <div className="arqueo-summary-card">
                            <Wallet size={18} />
                            <div>
                                <span className="label">Esperado</span>
                                <span className="value">
                                    {isBlindCashier && !closePreview ? 'Oculto' : formatMoney(Number(closePreview?.expectedAmount ?? (summary?.expectedAmount || 0)))}
                                </span>
                            </div>
                        </div>
                        <div className="arqueo-summary-card highlight">
                            <Banknote size={18} />
                            <div>
                                <span className="label">Contado</span>
                                <span className="value">{formatMoney(totalCounted)}</span>
                            </div>
                        </div>
                        <div className={`arqueo-summary-card ${effectiveDifference >= 0 ? 'positive' : 'negative'}`}>
                            {effectiveDifference >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                            <div>
                                <span className="label">Diferencia</span>
                                <span className="value">
                                    {closePreview ? `${effectiveDifference >= 0 ? '+' : ''}${formatMoney(effectiveDifference)}` : 'Pendiente validar'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Currency Tabs */}
                    <div className="arqueo-tabs">
                        <button
                            type="button"
                            className={`arqueo-tab ${arqueoTab === 'NIO' ? 'active' : ''}`}
                            onClick={() => setArqueoTab('NIO')}
                        >
                            <Banknote size={16} />
                            Córdobas
                        </button>
                        <button
                            type="button"
                            className={`arqueo-tab usd ${arqueoTab === 'USD' ? 'active' : ''}`}
                            onClick={() => setArqueoTab('USD')}
                        >
                            <DollarSign size={16} />
                            Dólares
                        </button>
                    </div>

                    <form onSubmit={handleCloseShift} className="arqueo-form-sidebar">
                        {/* Córdobas Tab Content */}
                        {arqueoTab === 'NIO' && (
                            <div className="arqueo-tab-content">
                                {/* Bills */}
                                <div className="arqueo-denomination-section">
                                    <div className="denomination-header">
                                        <Banknote size={16} />
                                        <span>Billetes</span>
                                        <span className="denomination-total">{formatMoney(Object.entries(billsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0))}</span>
                                    </div>
                                    <div className="denomination-list">
                                        {BILL_DENOMINATIONS.map(den => (
                                            <div key={`bill-${den}`} className="denomination-item">
                                                <span className="den-value">{symbol} {den}</span>
                                                <span className="den-times">×</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="den-input-compact"
                                                    value={billsCount[den] || ''}
                                                    onChange={(e) => setBillsCount({
                                                        ...billsCount,
                                                        [den]: parseInt(e.target.value) || 0
                                                    })}
                                                    placeholder="0"
                                                />
                                                <span className={`den-subtotal ${billsCount[den] > 0 ? 'has-value' : ''}`}>
                                                    = {formatMoney(den * (billsCount[den] || 0))}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Coins */}
                                <div className="arqueo-denomination-section">
                                    <div className="denomination-header">
                                        <Coins size={16} />
                                        <span>Monedas</span>
                                        <span className="denomination-total">{formatMoney(Object.entries(coinsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0))}</span>
                                    </div>
                                    <div className="denomination-list">
                                        {COIN_DENOMINATIONS.map(den => (
                                            <div key={`coin-${den}`} className="denomination-item">
                                                <span className="den-value">{symbol} {den}</span>
                                                <span className="den-times">×</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="den-input-compact"
                                                    value={coinsCount[den] || ''}
                                                    onChange={(e) => setCoinsCount({
                                                        ...coinsCount,
                                                        [den]: parseInt(e.target.value) || 0
                                                    })}
                                                    placeholder="0"
                                                />
                                                <span className={`den-subtotal ${coinsCount[den] > 0 ? 'has-value' : ''}`}>
                                                    = {formatMoney(den * (coinsCount[den] || 0))}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* USD Tab Content */}
                        {arqueoTab === 'USD' && (
                            <div className="arqueo-tab-content usd">
                                {/* Exchange Rate */}
                                <div className="exchange-rate-bar">
                                    <label>Tipo de Cambio:</label>
                                    <div className="exchange-rate-input-wrapper">
                                        <span>1 USD =</span>
                                        <input
                                            type="number"
                                            className="exchange-rate-input"
                                            value={exchangeRate}
                                            onChange={(e) => setExchangeRate(parseFloat(e.target.value) || DEFAULT_EXCHANGE_RATE)}
                                            step="0.01"
                                            min="1"
                                        />
                                        <span>NIO</span>
                                    </div>
                                </div>

                                {/* USD Bills */}
                                <div className="arqueo-denomination-section usd">
                                    <div className="denomination-header usd">
                                        <DollarSign size={16} />
                                        <span>Billetes USD</span>
                                        <span className="denomination-total usd">$ {formatCurrency(totalUSD)}</span>
                                    </div>
                                    <div className="denomination-list">
                                        {USD_BILL_DENOMINATIONS.map(den => (
                                            <div key={`usd-${den}`} className="denomination-item">
                                                <span className="den-value usd">$ {den}</span>
                                                <span className="den-times">×</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="den-input-compact"
                                                    value={usdBillsCount[den] || ''}
                                                    onChange={(e) => setUsdBillsCount({
                                                        ...usdBillsCount,
                                                        [den]: parseInt(e.target.value) || 0
                                                    })}
                                                    placeholder="0"
                                                />
                                                <span className={`den-subtotal usd ${usdBillsCount[den] > 0 ? 'has-value' : ''}`}>
                                                    = $ {formatCurrency(den * (usdBillsCount[den] || 0))}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Conversion Summary */}
                                {totalUSD > 0 && (
                                    <div className="usd-conversion-summary">
                                        <div className="conversion-row">
                                            <span>Total USD:</span>
                                            <strong>$ {formatCurrency(totalUSD)}</strong>
                                        </div>
                                        <div className="conversion-row highlight">
                                            <span>Equivalente en {symbol}:</span>
                                            <strong>{formatMoney(totalUSDinCordobas)}</strong>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Notes Section */}
                        <div className="arqueo-notes-compact">
                            <label>
                                <FileText size={14} />
                                Observaciones
                            </label>
                            <textarea
                                className="arqueo-notes-textarea"
                                rows={2}
                                value={closeNotes}
                                onChange={(e) => setCloseNotes(e.target.value)}
                                placeholder="Notas del cierre..."
                            />
                        </div>

                        {/* Actions */}
                        <div className="arqueo-actions-sidebar">
                            {!closePreview && (
                                <p className="arqueo-error-message">
                                    Valida el arqueo para revisar diferencia y habilitar el cierre.
                                </p>
                            )}
                            {closePreview?.requiresNote && (
                                <p className="arqueo-error-message">
                                    Debes registrar una observación para cerrar con diferencia dentro de tolerancia.
                                </p>
                            )}
                            {closePreview?.exceedsTolerance && !canForceClose && (
                                <p className="arqueo-error-message">
                                    La diferencia excede la tolerancia oficial de {formatMoney(closeTolerance)}.
                                </p>
                            )}
                            {closePreview?.exceedsTolerance && canForceClose && (
                                <p className="arqueo-error-message">
                                    Puedes forzar el cierre como administrador si agregas una observación.
                                </p>
                            )}
                            {showLegacyExactMatchWarning && (
                                <p className="arqueo-error-message">
                                    ⚠️ No puede cerrar el turno con diferencia. El arqueo debe cuadrar exactamente.
                                </p>
                            )}
                            <Button type="button" variant="ghost" onClick={() => setIsCloseModalOpen(false)} fullWidth>
                                Cancelar
                            </Button>
                            <Button type="button" variant="ghost" onClick={handlePreviewClose} disabled={previewLoading} fullWidth>
                                {previewLoading ? 'Validando...' : 'Validar Arqueo'}
                            </Button>
                            <Button
                                type="submit"
                                variant="primary"
                                disabled={
                                    !closePreview ||
                                    (closePreview.requiresNote && !closeNotes.trim()) ||
                                    (closePreview.exceedsTolerance && (!canForceClose || !closeNotes.trim()))
                                }
                                fullWidth
                            >
                                <Lock size={16} />
                                {closePreview?.exceedsTolerance && canForceClose ? 'Forzar Cierre' : 'Cerrar Turno'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>

            {/* New Supplier Sidebar */}
            <Sidebar
                isOpen={isNewSupplierModalOpen}
                onClose={() => setIsNewSupplierModalOpen(false)}
                title="Nuevo Proveedor"
            >
                <div className="premium-modal-content">
                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (!canCreateSupplier) {
                            showWarning('Solo administradores pueden registrar nuevos proveedores.');
                            return;
                        }
                        try {
                            const res = await suppliersAPI.create(newSupplierForm);
                            setSuppliers([...suppliers, res.data.data]);
                            setMovementForm({ ...movementForm, supplierId: String(res.data.data.id) });
                            setNewSupplierForm({ name: '', contact: '', phone: '', email: '', address: '', taxId: '', supplyType: '' });
                            setIsNewSupplierModalOpen(false);
                        } catch (error) {
                            console.error('Error creating supplier:', error);
                            showError('Error al crear proveedor');
                        }
                    }} className="modal-form-new">
                        <div className="modal-tab-content">
                            <Input
                                label="Nombre Empresa"
                                variant="modal"
                                value={newSupplierForm.name}
                                onChange={(e) => setNewSupplierForm({ ...newSupplierForm, name: e.target.value })}
                                required
                                autoFocus
                            />
                            <Input
                                label="Contacto Principal"
                                variant="modal"
                                value={newSupplierForm.contact}
                                onChange={(e) => setNewSupplierForm({ ...newSupplierForm, contact: e.target.value })}
                            />
                            <div className="modal-form-row">
                                <Input
                                    label="Teléfono"
                                    variant="modal"
                                    value={newSupplierForm.phone}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, phone: e.target.value })}
                                />
                                <Input
                                    label="Email"
                                    variant="modal"
                                    type="email"
                                    value={newSupplierForm.email}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, email: e.target.value })}
                                />
                            </div>
                            <Input
                                label="Dirección"
                                variant="modal"
                                value={newSupplierForm.address}
                                onChange={(e) => setNewSupplierForm({ ...newSupplierForm, address: e.target.value })}
                            />
                            <Input
                                label="RUC / NIT"
                                variant="modal"
                                value={newSupplierForm.taxId}
                                onChange={(e) => setNewSupplierForm({ ...newSupplierForm, taxId: e.target.value })}
                            />
                            <Input
                                label="Tipo de Insumo/Servicio"
                                variant="modal"
                                value={newSupplierForm.supplyType}
                                onChange={(e) => setNewSupplierForm({ ...newSupplierForm, supplyType: e.target.value })}
                                placeholder="Ej: Verduras, Carnes, Mantenimiento"
                            />
                        </div>
                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsNewSupplierModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit">
                                Guardar
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}


