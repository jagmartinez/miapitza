import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { cashShiftsAPI, cashArqueoAPI, suppliersAPI } from '../services/api';
import { buildCashShiftReportHtml, getMovementAuditLabel, getMovementCategoryLabel, getMovementPaymentOrigin } from './cashShiftReport';
import {
    AppSelect, Badge, Button, DataTable, DateInput, Field, FormGrid, FormSection, FullScreenModal, Input,
    LoadErrorState, PageContent, PageHeader, SegmentedControl, StatusBadge, TableToolbar, Textarea,
    formatMoney as formatMoneyUi, formatNumber,
    type Column, type Opt,
} from '@/ui';
import { ArrowLeft, Lock, Minus, Plus, Printer } from 'lucide-react';
import type { CashMovement, CashShift, Supplier } from '../types';
import { hasAnyRole } from '../utils/authz';
import { useAppToast } from '../context/ToastContext';
import { DEFAULT_EXCHANGE_RATE } from '../utils/currency';
import { useCurrency } from '../hooks/useCurrency';
import { formatLocalDateInput } from '../utils/dateInput';
import styles from './CashShift.module.css';
import { getIdempotentAttempt, isAmbiguousMutationFailure, type IdempotentAttempt } from '../utils/idempotency';

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
    salesByMethod?: { cash: number; card: number; transfer: number; paymentCount: number };
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
    /** Always present; the server omits expected/difference for blind cashiers. */
    status?: 'CUADRADO' | 'SOBRANTE' | 'FALTANTE';
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

const DOCUMENT_TYPES = [
    { value: 'FACTURA', label: 'Factura' },
    { value: 'RECIBO_GASTO', label: 'Recibo de Gasto' },
    { value: 'RECIBO_CAJA', label: 'Recibo de Caja' },
    { value: 'NOTA_CREDITO', label: 'Nota de Crédito' },
    { value: 'NOTA_DEBITO', label: 'Nota de Débito' }
];

const formatCurrency = (value: number): string => formatNumber(value, 2);

// Format duration
const formatDuration = (startDate: string, endDate?: string): string => {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
};

export default function CashShiftPage() {
    const { symbol } = useCurrency();
    const formatMoney = useCallback((value: unknown) => formatMoneyUi(value, symbol), [symbol]);
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { error: showError, warning: showWarning, success } = useAppToast();
    const [shift, setShift] = useState<CashShift | null>(null);
    const [summary, setSummary] = useState<ShiftSummaryState | null>(null);
    const [arqueoDetails, setArqueoDetails] = useState<ArqueoDetailsState | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Movement Table State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'IN' | 'OUT'>('all');

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

    // Arqueo (conteo por denominación en la página)
    const [arqueoTab, setArqueoTab] = useState<'NIO' | 'USD'>('NIO');
    const [billsCount, setBillsCount] = useState<Record<number, number>>({});
    const [coinsCount, setCoinsCount] = useState<Record<number, number>>({});
    const [usdBillsCount, setUsdBillsCount] = useState<Record<number, number>>({});
    const [exchangeRate, setExchangeRate] = useState(DEFAULT_EXCHANGE_RATE);
    const [closeNotes, setCloseNotes] = useState('');
    const [closePreview, setClosePreview] = useState<ClosePreviewState | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    // In-flight guards: refs block same-tick double submits, state disables the buttons.
    const [submittingMovement, setSubmittingMovement] = useState(false);
    const [closingShift, setClosingShift] = useState(false);
    const submittingMovementRef = useRef(false);
    const movementAttemptRef = useRef<IdempotentAttempt | null>(null);
    const closingShiftRef = useRef(false);

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
    // Blind cashiers never receive the numeric difference: classify by status.
    const closeStatusLabel = closePreview?.status === 'SOBRANTE' ? 'Sobrante'
        : closePreview?.status === 'FALTANTE' ? 'Faltante' : 'Cuadrado';
    const closeTolerance = Number(closePreview?.tolerance ?? 1);

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
            setLoadError(null);
        } catch (error: unknown) {
            console.error('[CASH-SHIFT-PAGE] Error loading shift data:', error);
            const message = getApiErrorMessage(error, 'Error');
            setLoadError(message);
            showError(`Error cargando datos del turno: ${message}`);
        } finally {
            setLoading(false);
        }
    }, [id, showError]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    // Cualquier cambio en el conteo invalida la validación previa del arqueo.
    useEffect(() => {
        setClosePreview(null);
    }, [totalCounted]);

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

    // Movement counts by type
    const inCount = shift?.movements?.filter(m => m.type === 'IN').length || 0;
    const outCount = shift?.movements?.filter(m => m.type === 'OUT').length || 0;

    const handleAddMovement = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submittingMovementRef.current) return;
        submittingMovementRef.current = true;
        setSubmittingMovement(true);
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

            // One key per logical movement: a retry of the same form after a
            // timeout reuses it; any edit to the payload yields a new key.
            const attempt = getIdempotentAttempt(
                movementAttemptRef.current,
                JSON.stringify({ shiftId: Number(id), ...payload }),
            );
            movementAttemptRef.current = attempt;
            await cashShiftsAPI.addMovement(Number(id), payload, attempt.key);
            movementAttemptRef.current = null;
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
            if (!isAmbiguousMutationFailure(error)) movementAttemptRef.current = null;
            console.error('Error adding movement:', error);
            showError(getApiErrorMessage(error, 'Error al registrar movimiento'));
        } finally {
            submittingMovementRef.current = false;
            setSubmittingMovement(false);
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
        if (closingShiftRef.current) return;
        closingShiftRef.current = true;
        setClosingShift(true);
        try {
            // Enter en un campo del conteo envía el formulario: sin validación previa solo se valida, nunca se cierra.
            if (!closePreview) {
                const validated = (await cashArqueoAPI.previewClose(Number(id), buildClosePayload())).data.data;
                setClosePreview(validated);
                return;
            }
            const preview = closePreview;

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
            loadData();
            success('Turno cerrado correctamente');
        } catch (error: unknown) {
            console.error('Error closing shift:', error);
            showError('Error al cerrar turno: ' + errMsg(error, 'Error'));
        } finally {
            closingShiftRef.current = false;
            setClosingShift(false);
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

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                showError('No se pudo abrir el reporte. Permite ventanas emergentes e inténtalo de nuevo.');
                return;
            }

            printWindow.document.write(buildCashShiftReportHtml({
                shift, amounts, movements, counts, symbol,
                salesCash: Number(summary?.totalSalesCash || 0)
            }));
            printWindow.document.close();
        } catch (error) {
            console.error('Error printing report:', error);
            showError(getApiErrorMessage(error, 'Error al generar el reporte'));
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
                notifyError(error, 'No se pudieron cargar los proveedores', { type: 'warning' });
            }
        }

        setIsMovementSidebarOpen(true);
    };


    const isOpen = !!shift && !shift.endDate;
    const movementOptions = useMemo<Opt<string>[]>(
        () => [{ value: '', label: 'Sin proveedor' }, ...suppliers.map(s => ({ value: s.id.toString(), label: s.name }))],
        [suppliers]
    );

    const movementColumns: Column<CashMovement>[] = [
        { key: 'time', header: 'Hora', width: '1fr', render: m => new Date(m.createdAt).toLocaleTimeString('es-NI') },
        {
            key: 'type', header: 'Tipo', width: '1fr',
            render: m => <Badge tone={m.type === 'IN' ? 'success' : 'danger'}>{m.type === 'IN' ? 'Ingreso' : 'Egreso'}</Badge>
        },
        { key: 'document', header: 'Documento', width: '1.2fr', render: m => m.documentNumber || '-' },
        {
            key: 'origin', header: 'Forma de pago / origen', width: '1.6fr',
            render: m => (
                <span className={styles.originCell}>
                    <span>{getMovementPaymentOrigin(m)}</span>
                    <small>{getMovementAuditLabel(m)}</small>
                </span>
            )
        },
        { key: 'description', header: 'Descripción', width: '2fr', render: m => m.description || '-' },
        { key: 'supplier', header: 'Proveedor', width: '1.5fr', render: m => m.supplier?.name || '-' },
        {
            key: 'amount', header: 'Monto', width: '1.2fr', type: 'money',
            render: m => (
                <span className={m.type === 'IN' ? styles.amountIn : styles.amountOut}>
                    {m.type === 'IN' ? '+' : '-'}{formatMoney(Math.abs(Number(m.amount)))}
                </span>
            )
        }
    ];

    if (loading || !shift) {
        return (
            <PageContent>
                <PageHeader
                    title="Turno de caja"
                    actions={<Button icon={ArrowLeft} onClick={() => navigate('/cash-registers')}>Volver a cajas</Button>}
                />
                {loading ? (
                    <p className={styles.loading} role="status">Cargando turno...</p>
                ) : (
                    <LoadErrorState
                        message={`No disponible: no se pudo cargar el turno. ${loadError || 'Inténtalo de nuevo en unos segundos.'}`}
                        onRetry={() => { setLoading(true); void loadData(); }}
                    />
                )}
            </PageContent>
        );
    }

    const grossSales = summary?.grossSalesCash as number | undefined;
    const refunds = summary?.cashRefunds as number | undefined;
    const hasBreakdown = typeof grossSales === 'number' && typeof refunds === 'number';
    const money = (value: unknown) => (value == null || value === '' || !Number.isFinite(Number(value)) ? 'N/D' : formatMoney(Number(value)));
    // Server-side classification wins: "otros ingresos" are manual entries only (never POS/Catering collections).
    const otherIn = typeof summary?.otherIncome === 'number'
        ? summary.otherIncome
        : hasBreakdown && summary?.totalIn != null ? Number(summary.totalIn) - grossSales : summary?.totalIn;
    const otherOut = typeof summary?.otherOutflows === 'number'
        ? summary.otherOutflows
        : hasBreakdown && summary?.totalOut != null ? Number(summary.totalOut) - refunds : summary?.totalOut;
    const movementCount = shift.movements?.length || 0;
    const registerName = shift.register?.name || `Caja #${shift.cashRegisterId || shift.id}`;
    const arqueoBills = arqueoDetails?.counts?.bills ?? [];
    const arqueoCoins = arqueoDetails?.counts?.coins ?? [];
    const billsTotal = Object.entries(billsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0);
    const coinsTotal = Object.entries(coinsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0);
    const closeSubmitLabel = closePreview?.exceedsTolerance && canForceClose ? 'Forzar cierre' : 'Cerrar turno';
    const closeSubmitDisabled =
        closingShift ||
        !closePreview ||
        (!!closePreview.requiresNote && !closeNotes.trim()) ||
        (!!closePreview.exceedsTolerance && (!canForceClose || !closeNotes.trim()));

    // Ventas del turno por medio de pago (GET /cash-shifts/:id/summary → salesByMethod).
    const salesByMethod = summary?.salesByMethod;
    const paymentRows = salesByMethod
        ? [
            { label: 'Efectivo', value: Number(salesByMethod.cash) },
            { label: 'Tarjeta', value: Number(salesByMethod.card) },
            { label: 'Transferencia', value: Number(salesByMethod.transfer) },
        ].filter((row) => Number.isFinite(row.value))
        : [];
    const salesTotal = paymentRows.reduce((sum, row) => sum + row.value, 0);

    // Resultado del arqueo: validado (abierto) o registrado (cerrado).
    const diffStatus: 'CUADRADO' | 'SOBRANTE' | 'FALTANTE' | null = isOpen
        ? (closePreview
            ? closePreview.status ?? (Math.abs(effectiveDifference) < 0.005 ? 'CUADRADO' : effectiveDifference > 0 ? 'SOBRANTE' : 'FALTANTE')
            : null)
        : shift.difference == null
            ? null
            : Math.abs(Number(shift.difference)) < 0.005 ? 'CUADRADO' : Number(shift.difference) > 0 ? 'SOBRANTE' : 'FALTANTE';
    const diffTone = diffStatus === 'CUADRADO' ? 'success' : diffStatus === 'FALTANTE' ? 'danger' : 'warning';
    const diffTitle = diffStatus === 'CUADRADO' ? 'Caja cuadrada' : diffStatus === 'FALTANTE' ? 'Faltante' : 'Sobrante';
    const diffAmount = isOpen
        ? (isBlindCashier ? null : effectiveDifference)
        : (shift.difference == null ? null : Number(shift.difference));
    const diffHint = !isOpen
        ? (shift.notes ? `Observación: ${shift.notes}` : 'Turno cerrado.')
        : diffStatus === 'CUADRADO'
            ? 'Puedes cerrar el turno.'
            : closePreview?.exceedsTolerance
                ? (canForceClose
                    ? 'Excede la tolerancia: puedes forzar el cierre como administrador si agregas una observación.'
                    : 'Excede la tolerancia: requiere visto bueno del supervisor para cerrar.')
                : 'Dentro de tolerancia: registra una observación para cerrar.';

    const renderDenominations = (
        kind: string,
        denominations: number[],
        counts: Record<number, number>,
        setCounts: (next: Record<number, number>) => void,
        prefix: string,
        format: (value: number) => string,
        quantityLabel: (den: number) => string
    ) => denominations.map(den => (
        <div key={`${kind}-${den}`} role="row" className={styles.denomRow}>
            <span role="cell" className={styles.denomValue}>{prefix} {formatNumber(den, den % 1 === 0 ? 0 : 2)}</span>
            <span role="cell" className={styles.denomInput}>
                <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label={quantityLabel(den)}
                    value={counts[den] || ''}
                    onChange={(e) => setCounts({ ...counts, [den]: parseInt(e.target.value) || 0 })}
                    placeholder="0"
                    disabled={!isOpen}
                />
            </span>
            <span role="cell" className={`${styles.denomSubtotal} ${counts[den] > 0 ? styles.hasValue : ''}`}>
                {format(den * (counts[den] || 0))}
            </span>
        </div>
    ));

    const recordedRows = (rows: DenomCountRow[], kind: string) => rows.map((row) => (
        <div key={`${kind}-${row.denomination}`} role="row" className={styles.denomRow}>
            <span role="cell" className={styles.denomValue}>{symbol} {formatNumber(row.denomination, row.denomination % 1 === 0 ? 0 : 2)}</span>
            <span role="cell" className={styles.denomCount}>{formatNumber(row.count, 0)}</span>
            <span role="cell" className={`${styles.denomSubtotal} ${styles.hasValue}`}>{formatMoney(row.denomination * row.count)}</span>
        </div>
    ));

    const countHeader = (
        <div role="row" className={`${styles.denomRow} ${styles.denomHead}`}>
            <span role="columnheader">Denominación</span>
            <span role="columnheader" className={styles.alignEnd}>Cantidad</span>
            <span role="columnheader" className={styles.alignEnd}>Subtotal</span>
        </div>
    );

    return (
        <PageContent>
            <PageHeader
                breadcrumb={['Caja', `Turno #${shift.id}`]}
                title={isOpen ? 'Arqueo y cierre de turno' : `Turno #${shift.id}`}
                description={
                    <span className={styles.headerMeta}>
                        <StatusBadge status={isOpen ? 'OPEN' : 'COMPLETED'} label={isOpen ? 'Abierto' : 'Cerrado'} />
                        <span>{registerName}</span>
                        <span>Cajero: {shift.user?.name || 'N/D'}</span>
                        <span>Apertura {new Date(shift.startDate).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{formatDuration(shift.startDate, shift.endDate || undefined)} {isOpen ? 'abierto' : 'de turno'}</span>
                    </span>
                }
                actions={
                    <>
                        <Button icon={ArrowLeft} onClick={() => navigate('/cash-registers')}>Volver a cajas</Button>
                        {isOpen && (
                            <>
                                <Button icon={Plus} onClick={() => openMovementSidebar('IN')}>Ingreso</Button>
                                <Button icon={Minus} onClick={() => openMovementSidebar('OUT')}>Retiro</Button>
                            </>
                        )}
                        <Button icon={Printer} onClick={handlePrintReport}>{isOpen ? 'Imprimir corte' : 'Imprimir reporte'}</Button>
                        {isOpen && (
                            <Button type="submit" form="cash-close-form" variant="primary" icon={Lock} disabled={closeSubmitDisabled} loading={closingShift}>
                                {closeSubmitLabel}
                            </Button>
                        )}
                    </>
                }
            />

            {loadError && (
                <LoadErrorState
                    message={`No se pudieron actualizar los datos del turno (${loadError}). Los montos pueden estar desactualizados.`}
                    onRetry={() => { void loadData(); }}
                />
            )}

            <form id="cash-close-form" onSubmit={handleCloseShift} className={styles.arqueo} aria-label="Arqueo de caja">
                <section className={styles.card} aria-labelledby="cash-count-title">
                    <div className={styles.cardHead}>
                        <h2 id="cash-count-title" className={styles.cardTitle}>Conteo de efectivo</h2>
                        {isOpen ? (
                            <SegmentedControl<'NIO' | 'USD'>
                                ariaLabel="Moneda del conteo"
                                size="sm"
                                value={arqueoTab}
                                onChange={setArqueoTab}
                                options={[{ value: 'NIO', label: 'Córdobas' }, { value: 'USD', label: 'Dólares' }]}
                            />
                        ) : (
                            <span className={styles.muted}>Conteo registrado al cierre</span>
                        )}
                    </div>

                    {isOpen && arqueoTab === 'NIO' && (
                        <div role="table" aria-label="Denominaciones" className={styles.denomTable}>
                            {countHeader}
                            <div role="row" className={styles.denomGroup}><span role="cell">Billetes · {formatMoney(billsTotal)}</span></div>
                            {renderDenominations('bill', BILL_DENOMINATIONS, billsCount, setBillsCount, symbol, formatMoney, (den) => `Cantidad de billetes de ${symbol} ${den}`)}
                            <div role="row" className={styles.denomGroup}><span role="cell">Monedas · {formatMoney(coinsTotal)}</span></div>
                            {renderDenominations('coin', COIN_DENOMINATIONS, coinsCount, setCoinsCount, symbol, formatMoney, (den) => `Cantidad de monedas de ${symbol} ${den}`)}
                            <div role="row" className={`${styles.denomRow} ${styles.denomTotal}`}>
                                <span role="cell" className={styles.denomTotalLabel}>Total contado</span>
                                <span role="cell" className={styles.denomSubtotal}>{formatMoney(totalCounted)}</span>
                            </div>
                        </div>
                    )}

                    {isOpen && arqueoTab === 'USD' && (
                        <>
                            <div className={styles.exchange}>
                                <Field label="1 USD equivale a (NIO)" htmlFor="arqueo-exchange-rate">
                                    <Input
                                        id="arqueo-exchange-rate"
                                        type="number"
                                        inputMode="decimal"
                                        value={exchangeRate}
                                        onChange={(e) => setExchangeRate(parseFloat(e.target.value) || DEFAULT_EXCHANGE_RATE)}
                                        step="0.01"
                                        min="1"
                                    />
                                </Field>
                            </div>
                            <div role="table" aria-label="Denominaciones USD" className={styles.denomTable}>
                                {countHeader}
                                <div role="row" className={styles.denomGroup}><span role="cell">Billetes USD · $ {formatCurrency(totalUSD)}</span></div>
                                {renderDenominations('usd', USD_BILL_DENOMINATIONS, usdBillsCount, setUsdBillsCount, '$', (v) => `$ ${formatCurrency(v)}`, (den) => `Cantidad de billetes USD de ${den}`)}
                                <div role="row" className={`${styles.denomRow} ${styles.denomTotal}`}>
                                    <span role="cell" className={styles.denomTotalLabel}>Equivalente en {symbol}</span>
                                    <span role="cell" className={styles.denomSubtotal}>{formatMoney(totalUSDinCordobas)}</span>
                                </div>
                                <div role="row" className={`${styles.denomRow} ${styles.denomTotal}`}>
                                    <span role="cell" className={styles.denomTotalLabel}>Total contado (córdobas + dólares)</span>
                                    <span role="cell" className={styles.denomSubtotal}>{formatMoney(totalCounted)}</span>
                                </div>
                            </div>
                        </>
                    )}

                    {!isOpen && (arqueoBills.length > 0 || arqueoCoins.length > 0 ? (
                        <div role="table" aria-label="Denominaciones" className={styles.denomTable}>
                            {countHeader}
                            {arqueoBills.length > 0 && <div role="row" className={styles.denomGroup}><span role="cell">Billetes</span></div>}
                            {recordedRows(arqueoBills, 'view-bill')}
                            {arqueoCoins.length > 0 && <div role="row" className={styles.denomGroup}><span role="cell">Monedas</span></div>}
                            {recordedRows(arqueoCoins, 'view-coin')}
                            <div role="row" className={`${styles.denomRow} ${styles.denomTotal}`}>
                                <span role="cell" className={styles.denomTotalLabel}>Total contado</span>
                                <span role="cell" className={styles.denomSubtotal}>{money(shift.endAmount)}</span>
                            </div>
                        </div>
                    ) : (
                        <p className={styles.cardEmpty}>El cierre no registró conteo por denominación. Contado: {money(shift.endAmount)}.</p>
                    ))}
                </section>

                <div className={styles.sideCol}>
                    <section className={`${styles.card} ${styles.cardPad}`} aria-labelledby="cash-recon-title">
                        <h2 id="cash-recon-title" className={styles.cardTitle}>Conciliación de efectivo ({symbol})</h2>
                        <dl className={styles.dl}>
                            <div><dt>Fondo inicial</dt><dd>{formatMoney(Number(shift.startAmount))}</dd></div>
                            <div>
                                <dt title={hasBreakdown ? `Bruto ${formatMoney(grossSales)} menos reembolsos ${formatMoney(refunds)}` : 'Neto de reembolsos en efectivo'}>+ Ventas netas efectivo</dt>
                                <dd>{money(summary?.totalSalesCash)}</dd>
                            </div>
                            <div><dt title="Entradas manuales o no asociadas a ventas; no incluyen cobros POS ni Catering">+ Otros ingresos</dt><dd>{money(otherIn)}</dd></div>
                            <div><dt title="Gastos y retiros; los reembolsos ya descuentan de ventas netas">− Gastos y retiros</dt><dd>{money(otherOut)}</dd></div>
                        </dl>
                        <dl className={`${styles.dl} ${styles.dlStrong}`}>
                            <div>
                                <dt>Esperado en caja</dt>
                                <dd>{isOpen && isBlindCashier ? 'Oculto (arqueo ciego)' : money(isOpen ? (closePreview?.expectedAmount ?? summary?.expectedAmount) : summary?.expectedAmount)}</dd>
                            </div>
                            <div><dt>Contado</dt><dd>{isOpen ? formatMoney(totalCounted) : money(shift.endAmount)}</dd></div>
                        </dl>

                        {diffStatus ? (
                            <div className={styles.diffBox} data-tone={diffTone} role="status">
                                <span className={styles.diffText}>
                                    <strong>{isOpen && isBlindCashier ? closeStatusLabel : diffTitle}</strong>
                                    <span>{diffHint}</span>
                                </span>
                                {diffAmount !== null && (
                                    <strong className={styles.diffAmount}>{diffAmount > 0 ? '+' : ''}{formatMoney(diffAmount)}</strong>
                                )}
                            </div>
                        ) : isOpen ? (
                            <p className={styles.message}>Cuenta el efectivo y valida el arqueo para revisar la diferencia y habilitar el cierre.</p>
                        ) : null}

                        {isOpen && (
                            <>
                                <div className={styles.messages}>
                                    {closePreview?.requiresNote && (
                                        <p className={styles.message} role="alert">
                                            Debes registrar una observación para cerrar con diferencia dentro de tolerancia.
                                        </p>
                                    )}
                                    {closePreview?.exceedsTolerance && !canForceClose && (
                                        <p className={styles.message} role="alert">
                                            La diferencia excede la tolerancia oficial de {formatMoney(closeTolerance)}. Un supervisor (administrador) debe autorizar el cierre.
                                        </p>
                                    )}
                                    {closePreview?.exceedsTolerance && canForceClose && (
                                        <p className={styles.message} role="alert">
                                            Puedes forzar el cierre como administrador si agregas una observación.
                                        </p>
                                    )}
                                </div>
                                <Field label="Observaciones" htmlFor="arqueo-notes">
                                    <Textarea
                                        id="arqueo-notes"
                                        rows={2}
                                        value={closeNotes}
                                        onChange={(e) => setCloseNotes(e.target.value)}
                                        placeholder="Notas del cierre..."
                                    />
                                </Field>
                                <div className={styles.closeActions}>
                                    <Button onClick={handlePreviewClose} loading={previewLoading}>
                                        {previewLoading ? 'Validando...' : 'Validar arqueo'}
                                    </Button>
                                </div>
                            </>
                        )}
                    </section>

                    <section className={`${styles.card} ${styles.cardPad}`} aria-labelledby="cash-sales-title">
                        <div className={styles.cardHeadInline}>
                            <h2 id="cash-sales-title" className={styles.cardTitle}>Ventas del turno por medio de pago</h2>
                            <strong className={styles.num}>{salesByMethod ? formatMoney(salesTotal) : 'N/D'}</strong>
                        </div>
                        {salesByMethod ? (
                            <>
                                <ul className={styles.payList}>
                                    {paymentRows.map((row) => (
                                        <li key={row.label} className={styles.payRow}>
                                            <span className={styles.muted}>{row.label}</span>
                                            <span className={styles.payBar} aria-hidden="true">
                                                <span style={{ width: `${salesTotal > 0 ? Math.max(0, (row.value / salesTotal) * 100) : 0}%` }} />
                                            </span>
                                            <span className={styles.num}>{formatMoney(row.value)}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className={styles.footnote}>
                                    {formatNumber(Number(salesByMethod.paymentCount) || 0, 0)} órdenes cobradas. Tarjeta y transferencia se concilian contra el voucher del banco, no entran al arqueo.
                                </p>
                            </>
                        ) : (
                            <p className={styles.message}>No disponible: el resumen del turno no incluyó el desglose por medio de pago.</p>
                        )}
                    </section>
                </div>
            </form>

            <section className={styles.movements} aria-labelledby="cash-moves-title">
                <div className={styles.cardHeadInline}>
                    <h2 id="cash-moves-title" className={styles.cardTitle}>Movimientos del turno</h2>
                    <span className={styles.muted}>Ventas, ingresos y egresos registrados en la caja</span>
                </div>
                <TableToolbar>
                    <SegmentedControl<'all' | 'IN' | 'OUT'>
                        ariaLabel="Tipo de movimiento"
                        value={filterType}
                        onChange={setFilterType}
                        options={[
                            { value: 'all', label: `Todos (${movementCount})` },
                            { value: 'IN', label: `Ingresos (${inCount})` },
                            { value: 'OUT', label: `Egresos (${outCount})` }
                        ]}
                    />
                    <Field label="Buscar" htmlFor="movement-search">
                        <Input
                            id="movement-search"
                            type="search"
                            placeholder="Buscar..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </Field>
                </TableToolbar>
                <DataTable
                    ariaLabel="Movimientos del turno"
                    columns={movementColumns}
                    rows={filteredMovements}
                    rowKey={m => m.id}
                    resetKey={`${filterType}|${searchQuery}`}
                    empty={searchQuery || filterType !== 'all'
                        ? 'No hay movimientos que coincidan con los filtros'
                        : 'No hay movimientos registrados'}
                />
            </section>

            {/* Registrar ingreso / retiro */}
            <FullScreenModal
                isOpen={isMovementSidebarOpen}
                onClose={() => setIsMovementSidebarOpen(false)}
                title={movementType === 'IN' ? 'Registrar Ingreso' : 'Registrar Retiro'}
                subtitle={`Turno #${shift.id}`}
                dirty={!!movementForm.amount || !!movementForm.description}
                footerStart={movementType === 'OUT' && canCreateSupplier ? (
                    <Button icon={Plus} onClick={() => setIsNewSupplierModalOpen(true)}>Nuevo proveedor</Button>
                ) : undefined}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="cash-movement-form" variant="primary" disabled={submittingMovement} loading={submittingMovement}>
                            {movementType === 'IN' ? 'Registrar Ingreso' : 'Registrar Retiro'}
                        </Button>
                    </>
                )}
            >
                <form id="cash-movement-form" onSubmit={handleAddMovement} className={styles.form}>
                    <FormSection title="Información del documento">
                        <FormGrid>
                            <Field label="Fecha documento" htmlFor="movement-document-date">
                                <DateInput
                                    id="movement-document-date"
                                    value={movementForm.documentDate}
                                    onChange={(e) => setMovementForm({ ...movementForm, documentDate: e.target.value })}
                                />
                            </Field>
                            <Field label="Tipo de documento" htmlFor="movement-document-type">
                                <AppSelect<string>
                                    inputId="movement-document-type"
                                    options={DOCUMENT_TYPES}
                                    value={movementForm.documentType || null}
                                    onChange={(v) => setMovementForm({ ...movementForm, documentType: v || '' })}
                                    placeholder="Seleccionar..."
                                />
                            </Field>
                            <Field label="Número de documento" htmlFor="movement-document-number">
                                <Input
                                    id="movement-document-number"
                                    value={movementForm.documentNumber}
                                    onChange={(e) => setMovementForm({ ...movementForm, documentNumber: e.target.value })}
                                    placeholder="Ej: FAC-001, REC-2026-001"
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>

                    {movementType === 'OUT' && (
                        <FormSection title="Proveedor">
                            <Field label="Proveedor" htmlFor="movement-supplier">
                                <AppSelect<string>
                                    inputId="movement-supplier"
                                    options={movementOptions}
                                    value={movementForm.supplierId}
                                    onChange={(v) => setMovementForm({ ...movementForm, supplierId: v || '' })}
                                />
                            </Field>
                        </FormSection>
                    )}

                    <FormSection title="Monto y descripción">
                        <FormGrid columns="1fr">
                            <Field label="Monto" htmlFor="movement-amount" required>
                                <Input
                                    id="movement-amount"
                                    type="number"
                                    inputMode="decimal"
                                    prefix={symbol}
                                    value={movementForm.amount}
                                    onChange={(e) => setMovementForm({ ...movementForm, amount: e.target.value })}
                                    min={0}
                                    step="0.01"
                                    required
                                />
                            </Field>
                            <Field label="Descripción" htmlFor="movement-description" required>
                                <Textarea
                                    id="movement-description"
                                    rows={3}
                                    value={movementForm.description}
                                    onChange={(e) => setMovementForm({ ...movementForm, description: e.target.value })}
                                    placeholder="Describe el motivo del movimiento..."
                                    required
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>
                </form>
            </FullScreenModal>

            {/* Nuevo proveedor desde un retiro */}
            <FullScreenModal
                isOpen={isNewSupplierModalOpen}
                onClose={() => setIsNewSupplierModalOpen(false)}
                title="Nuevo Proveedor"
                dirty={Object.values(newSupplierForm).some(Boolean)}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="cash-supplier-form" variant="primary">Guardar</Button>
                    </>
                )}
            >
                <form
                    id="cash-supplier-form"
                    className={styles.form}
                    onSubmit={async (e) => {
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
                            showError(getApiErrorMessage(error, 'Error al crear proveedor'));
                        }
                    }}
                >
                    <FormSection title="Datos del proveedor">
                        <FormGrid>
                            <Field label="Nombre empresa" htmlFor="supplier-name" required>
                                <Input
                                    id="supplier-name"
                                    value={newSupplierForm.name}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, name: e.target.value })}
                                    required
                                    autoFocus
                                />
                            </Field>
                            <Field label="Contacto principal" htmlFor="supplier-contact">
                                <Input
                                    id="supplier-contact"
                                    value={newSupplierForm.contact}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, contact: e.target.value })}
                                />
                            </Field>
                            <Field label="Teléfono" htmlFor="supplier-phone">
                                <Input
                                    id="supplier-phone"
                                    value={newSupplierForm.phone}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, phone: e.target.value })}
                                />
                            </Field>
                            <Field label="Email" htmlFor="supplier-email">
                                <Input
                                    id="supplier-email"
                                    type="email"
                                    value={newSupplierForm.email}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, email: e.target.value })}
                                />
                            </Field>
                            <Field label="Dirección" htmlFor="supplier-address">
                                <Input
                                    id="supplier-address"
                                    value={newSupplierForm.address}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, address: e.target.value })}
                                />
                            </Field>
                            <Field label="RUC / NIT" htmlFor="supplier-tax-id">
                                <Input
                                    id="supplier-tax-id"
                                    value={newSupplierForm.taxId}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, taxId: e.target.value })}
                                />
                            </Field>
                            <Field label="Tipo de insumo o servicio" htmlFor="supplier-supply-type">
                                <Input
                                    id="supplier-supply-type"
                                    value={newSupplierForm.supplyType}
                                    onChange={(e) => setNewSupplierForm({ ...newSupplierForm, supplyType: e.target.value })}
                                    placeholder="Ej: Verduras, Carnes, Mantenimiento"
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
