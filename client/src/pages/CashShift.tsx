import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { cashShiftsAPI, cashArqueoAPI, suppliersAPI } from '../services/api';
import { buildCashShiftReportHtml } from './cashShiftReport';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, FormGrid, FormSection, FullScreenModal, Input,
    PageContent, PageHeader, SegmentedControl, StatCard, StatusBadge, TableToolbar, Textarea,
    formatMoney as formatMoneyUi, formatNumber,
    type Column, type Opt,
} from '@/ui';
import { AlertTriangle, ArrowLeft, Lock, Minus, Plus, Printer } from 'lucide-react';
import type { CashMovement, CashShift, Supplier } from '../types';
import { hasAnyRole } from '../utils/authz';
import { useAppToast } from '../context/ToastContext';
import { DEFAULT_EXCHANGE_RATE } from '../utils/currency';
import { useCurrency } from '../hooks/useCurrency';
import { formatLocalDateInput } from '../utils/dateInput';
import styles from './CashShift.module.css';

interface DenomCountRow {
    denomination: number;
    count: number;
}

interface ShiftSummaryState {
    expectedAmount?: number;
    totalIn?: number;
    totalOut?: number;
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
            const message = error instanceof Error ? error.message : 'Error';
            setLoadError(message);
            showError(`Error cargando datos del turno: ${message}`);
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


    const isOpen = !!shift && !shift.endDate;
    const movementOptions = useMemo<Opt<string>[]>(
        () => [{ value: '', label: 'Sin proveedor' }, ...suppliers.map(s => ({ value: s.id.toString(), label: s.name }))],
        [suppliers]
    );

    const movementColumns: Column<CashMovement>[] = [
        { key: 'time', header: 'Hora', width: '1fr', render: m => new Date(m.createdAt).toLocaleTimeString() },
        {
            key: 'type', header: 'Tipo', width: '1fr',
            render: m => <Badge tone={m.type === 'IN' ? 'success' : 'danger'}>{m.type === 'IN' ? 'Ingreso' : 'Egreso'}</Badge>
        },
        { key: 'document', header: 'Documento', width: '1.2fr', render: m => m.documentNumber || '-' },
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
                    <EmptyState
                        icon={AlertTriangle}
                        title="No disponible: no se pudo cargar el turno"
                        description={loadError || 'Inténtalo de nuevo en unos segundos.'}
                        action={<Button variant="primary" onClick={() => { setLoading(true); void loadData(); }}>Reintentar</Button>}
                    />
                )}
            </PageContent>
        );
    }

    const grossSales = summary?.grossSalesCash as number | undefined;
    const refunds = summary?.cashRefunds as number | undefined;
    const hasBreakdown = typeof grossSales === 'number' && typeof refunds === 'number';
    const money = (value: unknown) => (value == null || value === '' || !Number.isFinite(Number(value)) ? 'N/D' : formatMoney(Number(value)));
    const otherIn = hasBreakdown && summary?.totalIn != null ? Number(summary.totalIn) - grossSales : summary?.totalIn;
    const otherOut = hasBreakdown && summary?.totalOut != null ? Number(summary.totalOut) - refunds : summary?.totalOut;
    const movementCount = shift.movements?.length || 0;
    const closedExpected = isBlindCashier ? 'Oculto hasta validar' : money(summary?.expectedAmount);
    const arqueoBills = arqueoDetails?.counts?.bills ?? [];
    const arqueoCoins = arqueoDetails?.counts?.coins ?? [];
    const billsTotal = Object.entries(billsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0);
    const coinsTotal = Object.entries(coinsCount).reduce((sum, [den, count]) => sum + (Number(den) * (count || 0)), 0);
    const closeSubmitLabel = closePreview?.exceedsTolerance && canForceClose ? 'Forzar cierre' : 'Cerrar turno';
    const closeSubmitDisabled =
        !closePreview ||
        (!!closePreview.requiresNote && !closeNotes.trim()) ||
        (!!closePreview.exceedsTolerance && (!canForceClose || !closeNotes.trim()));

    const renderDenominations = (
        kind: string,
        label: string,
        denominations: number[],
        counts: Record<number, number>,
        setCounts: (next: Record<number, number>) => void,
        prefix: string,
        format: (value: number) => string
    ) => (
        <div className={styles.denomList} role="group" aria-label={label}>
            {denominations.map(den => (
                <div key={`${kind}-${den}`} className={styles.denomRow}>
                    <span className={styles.denomValue}>{prefix} {den}</span>
                    <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-label={`${label} ${prefix} ${den} cantidad`}
                        value={counts[den] || ''}
                        onChange={(e) => setCounts({ ...counts, [den]: parseInt(e.target.value) || 0 })}
                        placeholder="0"
                    />
                    <span className={`${styles.denomSubtotal} ${counts[den] > 0 ? styles.hasValue : ''}`}>
                        {format(den * (counts[den] || 0))}
                    </span>
                </div>
            ))}
        </div>
    );

    return (
        <PageContent>
            <PageHeader
                title={`Turno #${shift.id}`}
                description={
                    <span className={styles.headerMeta}>
                        <StatusBadge status={isOpen ? 'OPEN' : 'COMPLETED'} label={isOpen ? 'Abierto' : 'Cerrado'} />
                        <span>{shift.register?.name || `Caja #${shift.cashRegisterId || shift.id}`}</span>
                        <span>{shift.user?.name}</span>
                    </span>
                }
                actions={
                    <>
                        <Button icon={ArrowLeft} onClick={() => navigate('/cash-registers')}>Volver a cajas</Button>
                        {isOpen ? (
                            <>
                                <Button icon={Plus} onClick={() => openMovementSidebar('IN')}>Ingreso</Button>
                                <Button icon={Minus} onClick={() => openMovementSidebar('OUT')}>Retiro</Button>
                                <Button variant="primary" icon={Lock} onClick={() => setIsCloseModalOpen(true)}>Cerrar turno</Button>
                            </>
                        ) : (
                            <Button icon={Printer} onClick={handlePrintReport}>Imprimir reporte</Button>
                        )}
                    </>
                }
            />

            {loadError && (
                <p className={styles.notice} role="alert">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>No disponible: no se pudieron actualizar los datos del turno ({loadError}). Los montos mostrados pueden estar desactualizados.</span>
                    <Button size="sm" onClick={() => { void loadData(); }}>Reintentar</Button>
                </p>
            )}

            <div className={styles.kpis}>
                <StatCard
                    label="Saldo inicial"
                    value={formatMoney(Number(shift.startAmount))}
                    context={`Apertura ${new Date(shift.startDate).toLocaleString()}`}
                />
                <StatCard
                    label="Ventas en efectivo"
                    tone="success"
                    value={money(summary?.totalSalesCash)}
                    context={hasBreakdown ? `Bruto ${formatMoney(grossSales)} menos reembolsos ${formatMoney(refunds)}` : 'Neto de reembolsos en efectivo'}
                />
                <StatCard
                    label="Otros ingresos"
                    tone="primary"
                    value={money(otherIn)}
                    context={hasBreakdown ? 'Ingresos manuales de caja' : 'Incluye ventas en efectivo'}
                />
                <StatCard
                    label="Gastos y retiros"
                    tone="danger"
                    value={money(otherOut)}
                    context={hasBreakdown ? 'Egresos manuales de caja' : 'Incluye reembolsos en efectivo'}
                />
                {!isBlindCashier && (
                    <StatCard
                        label="Esperado en caja"
                        value={money(summary?.expectedAmount)}
                        context={`Saldo inicial más ingresos menos egresos de ${movementCount} movimientos`}
                        action={isOpen ? { label: 'Arquear y cerrar', onClick: () => setIsCloseModalOpen(true) } : undefined}
                    />
                )}
            </div>

            <div className={styles.layout}>
                <div className={styles.main}>
                    <DataTable
                        ariaLabel="Movimientos del turno"
                        columns={movementColumns}
                        rows={filteredMovements}
                        rowKey={m => m.id}
                        resetKey={`${filterType}|${searchQuery}`}
                        empty={searchQuery || filterType !== 'all'
                            ? 'No hay movimientos que coincidan con los filtros'
                            : 'No hay movimientos registrados'}
                        toolbar={
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
                                <Input
                                    type="search"
                                    aria-label="Buscar movimientos"
                                    placeholder="Buscar..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </TableToolbar>
                        }
                    />
                </div>

                <aside className={styles.side}>
                    <section className={styles.panel} aria-labelledby="shift-info-title">
                        <h2 id="shift-info-title" className={styles.panelTitle}>Información del turno</h2>
                        <dl className={styles.dl}>
                            <div><dt>Caja</dt><dd>{shift.register?.name || `Caja #${shift.cashRegisterId || shift.id}`}</dd></div>
                            <div><dt>Cajero</dt><dd>{shift.user?.name || 'N/D'}</dd></div>
                            <div><dt>Inicio</dt><dd>{new Date(shift.startDate).toLocaleString()}</dd></div>
                            {shift.endDate && <div><dt>Cierre</dt><dd>{new Date(shift.endDate).toLocaleString()}</dd></div>}
                            <div><dt>Duración</dt><dd>{formatDuration(shift.startDate, shift.endDate || undefined)}</dd></div>
                        </dl>
                    </section>

                    {!isOpen && (arqueoBills.length > 0 || arqueoCoins.length > 0) && (
                        <section className={styles.panel} aria-labelledby="shift-arqueo-title">
                            <h2 id="shift-arqueo-title" className={styles.panelTitle}>Arqueo detallado</h2>
                            <dl className={styles.dl}>
                                {arqueoBills.map(b => (
                                    <div key={`view-bill-${b.denomination}`}>
                                        <dt>{symbol} {b.denomination} × {b.count}</dt>
                                        <dd>{formatMoney(b.denomination * b.count)}</dd>
                                    </div>
                                ))}
                                {arqueoCoins.map(c => (
                                    <div key={`view-coin-${c.denomination}`}>
                                        <dt>{symbol} {formatNumber(c.denomination)} × {c.count}</dt>
                                        <dd>{formatMoney(c.denomination * c.count)}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    )}

                    {!isOpen && (
                        <section className={styles.panel} aria-labelledby="shift-result-title">
                            <h2 id="shift-result-title" className={styles.panelTitle}>Resultado del cierre</h2>
                            <dl className={styles.dl}>
                                <div><dt>Esperado</dt><dd>{closedExpected}</dd></div>
                                <div><dt>Real</dt><dd>{money(shift.endAmount)}</dd></div>
                                <div>
                                    <dt>Diferencia</dt>
                                    <dd className={shift.difference == null ? undefined : Number(shift.difference) >= 0 ? styles.amountIn : styles.amountOut}>
                                        {money(shift.difference)}
                                    </dd>
                                </div>
                            </dl>
                            {shift.notes && (
                                <p className={styles.notes}><strong>Notas:</strong> {shift.notes}</p>
                            )}
                        </section>
                    )}
                </aside>
            </div>

            {/* Registrar ingreso / retiro */}
            <FullScreenModal
                isOpen={isMovementSidebarOpen}
                onClose={() => setIsMovementSidebarOpen(false)}
                title={movementType === 'IN' ? 'Registrar Ingreso' : 'Registrar Retiro'}
                subtitle={`Turno #${shift.id}`}
                dirty={!!movementForm.amount || !!movementForm.description}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="cash-movement-form" variant="primary">
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
                            <div className={styles.supplierRow}>
                                <div className={styles.supplierSelect}>
                                    <Field label="Proveedor" htmlFor="movement-supplier">
                                        <AppSelect<string>
                                            inputId="movement-supplier"
                                            options={movementOptions}
                                            value={movementForm.supplierId}
                                            onChange={(v) => setMovementForm({ ...movementForm, supplierId: v || '' })}
                                        />
                                    </Field>
                                </div>
                                {canCreateSupplier && (
                                    <Button icon={Plus} onClick={() => setIsNewSupplierModalOpen(true)}>Nuevo proveedor</Button>
                                )}
                            </div>
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

            {/* Arqueo de caja (cierre de turno) */}
            <FullScreenModal
                isOpen={isCloseModalOpen}
                onClose={() => setIsCloseModalOpen(false)}
                title="Cierre de Turno"
                subtitle={`Turno #${shift.id} · ${shift.register?.name || `Caja #${shift.cashRegisterId || shift.id}`}`}
                tabs={[{ id: 'NIO', label: 'Córdobas' }, { id: 'USD', label: 'Dólares' }]}
                activeTab={arqueoTab}
                onTabChange={(id) => setArqueoTab(id as 'NIO' | 'USD')}
                dirty={totalCounted > 0 || !!closeNotes.trim()}
                dirtyMessage="El arqueo no se ha guardado. Si cierras ahora se perderá el conteo."
                aside={
                    <div className={styles.asideStack}>
                        <section className={styles.panel} aria-labelledby="arqueo-summary-title">
                            <h2 id="arqueo-summary-title" className={styles.panelTitle}>Conciliación</h2>
                            <dl className={styles.dl}>
                                <div>
                                    <dt>Esperado</dt>
                                    <dd>{isBlindCashier && !closePreview ? 'Oculto' : money(closePreview?.expectedAmount ?? summary?.expectedAmount)}</dd>
                                </div>
                                <div><dt>Contado</dt><dd>{formatMoney(totalCounted)}</dd></div>
                                <div>
                                    <dt>Diferencia</dt>
                                    <dd className={closePreview ? (effectiveDifference >= 0 ? styles.amountIn : styles.amountOut) : undefined}>
                                        {closePreview ? `${effectiveDifference >= 0 ? '+' : ''}${formatMoney(effectiveDifference)}` : 'Pendiente validar'}
                                    </dd>
                                </div>
                            </dl>
                        </section>
                        <div className={styles.messages}>
                            {!closePreview && (
                                <p className={styles.message}>Valida el arqueo para revisar diferencia y habilitar el cierre.</p>
                            )}
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
                    </div>
                }
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button onClick={handlePreviewClose} loading={previewLoading}>
                            {previewLoading ? 'Validando...' : 'Validar arqueo'}
                        </Button>
                        <Button type="submit" form="cash-close-form" variant="primary" icon={Lock} disabled={closeSubmitDisabled}>
                            {closeSubmitLabel}
                        </Button>
                    </>
                )}
            >
                <form id="cash-close-form" onSubmit={handleCloseShift} className={styles.form}>
                    {arqueoTab === 'NIO' ? (
                        <>
                            <FormSection title={`Billetes · ${formatMoney(billsTotal)}`}>
                                {renderDenominations('bill', 'Billetes', BILL_DENOMINATIONS, billsCount, setBillsCount, symbol, formatMoney)}
                            </FormSection>
                            <FormSection title={`Monedas · ${formatMoney(coinsTotal)}`}>
                                {renderDenominations('coin', 'Monedas', COIN_DENOMINATIONS, coinsCount, setCoinsCount, symbol, formatMoney)}
                            </FormSection>
                        </>
                    ) : (
                        <>
                            <FormSection title="Tipo de cambio">
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
                            </FormSection>
                            <FormSection title={`Billetes USD · $ ${formatCurrency(totalUSD)}`}>
                                {renderDenominations('usd', 'Billetes USD', USD_BILL_DENOMINATIONS, usdBillsCount, setUsdBillsCount, '$', (v) => `$ ${formatCurrency(v)}`)}
                                {totalUSD > 0 && (
                                    <dl className={styles.dl}>
                                        <div><dt>Total USD</dt><dd>$ {formatCurrency(totalUSD)}</dd></div>
                                        <div><dt>Equivalente en {symbol}</dt><dd>{formatMoney(totalUSDinCordobas)}</dd></div>
                                    </dl>
                                )}
                            </FormSection>
                        </>
                    )}
                    <FormSection title="Observaciones del cierre">
                        <Field label="Observaciones" htmlFor="arqueo-notes">
                            <Textarea
                                id="arqueo-notes"
                                rows={2}
                                value={closeNotes}
                                onChange={(e) => setCloseNotes(e.target.value)}
                                placeholder="Notas del cierre..."
                            />
                        </Field>
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
                            showError('Error al crear proveedor');
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
