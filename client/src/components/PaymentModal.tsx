import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { X, DollarSign, Users, CreditCard, Banknote, Smartphone, Calculator, Plus, Trash2, type LucideIcon } from 'lucide-react';
import { paymentsAPI, splitBillAPI } from '../services/api';
import Select from './Select';
import type { SingleValue } from 'react-select';
import { calculateTipAmount, calculateTotalWithTip, splitTotalEvenly } from '../utils/payment';
import type { Order } from '../types';
import { isCashPaymentMethodName } from '../utils/paymentAccess';
import './PaymentModal.css';

interface PaymentMethodOption {
    id: number;
    name: string;
    icon: LucideIcon;
}

/** Resolve a display icon from the (company-defined) payment method name. */
const resolveMethodIcon = (name: string): LucideIcon => {
    const normalized = name.toLowerCase();
    if (normalized.includes('efectivo') || normalized.includes('cash')) return Banknote;
    if (
        normalized.includes('tarjeta') || normalized.includes('card') ||
        normalized.includes('crédito') || normalized.includes('credito') ||
        normalized.includes('débito') || normalized.includes('debito')
    ) return CreditCard;
    if (
        normalized.includes('transfer') || normalized.includes('móvil') ||
        normalized.includes('movil') || normalized.includes('qr') || normalized.includes('billetera')
    ) return Smartphone;
    return DollarSign;
};

/** A cash-like method requires the "amount tendered" / change workflow. */
const isCashMethodName = isCashPaymentMethodName;

interface SplitEntry {
    payerName: string;
    paymentMethodId: number;
    amount: string;
    reference: string;
}

type SplitStrategy = 'evenly' | 'by-items' | 'by-amount';

type ApiEnvelope = { _offline?: boolean };

function axiosErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof msg === 'string' && msg) return msg;
    }
    return fallback;
}

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    orderTotal: number;
    orderId: number | null;
    order?: Order | null;
    onPaymentSuccess: (data?: { offlineQueued?: boolean }) => void;
    currencySymbol?: string;
    /** Defensa adicional: si la sucursal no tiene almacén, el cobro se bloquea. */
    branchHasWarehouse?: boolean;
    /** Efectivo exige un turno abierto, vigente y de la misma sucursal que la orden. */
    hasUsableCashShift?: boolean;
}

const PaymentModal = ({
    isOpen,
    onClose,
    orderTotal,
    orderId,
    order,
    onPaymentSuccess,
    currencySymbol = '$',
    branchHasWarehouse = true,
    hasUsableCashShift = true,
}: PaymentModalProps) => {
    const [mode, setMode] = useState<'single' | 'split'>('single');

    // Payment methods are validated server-side against the company's DB rows;
    // the available IDs are NOT guaranteed to be {1,2,3}, so load them at runtime.
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
    const [methodsLoading, setMethodsLoading] = useState(false);
    const [methodsError, setMethodsError] = useState('');
    const cashMethodId = useMemo(
        () => paymentMethods.find((m) => isCashMethodName(m.name))?.id ?? null,
        [paymentMethods]
    );
    const defaultMethodId = useMemo(
        () => (hasUsableCashShift ? cashMethodId : null)
            ?? paymentMethods.find((method) => method.id !== cashMethodId)?.id
            ?? null,
        [cashMethodId, hasUsableCashShift, paymentMethods]
    );

    // Single mode state
    const [selectedMethod, setSelectedMethod] = useState<number | null>(null);
    const [amountTendered, setAmountTendered] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [pendingNotice, setPendingNotice] = useState('');
    const [hasQueuedPayment, setHasQueuedPayment] = useState(false);
    const [tipPercentage, setTipPercentage] = useState<number>(0);
    const [customTip, setCustomTip] = useState<string>('');
    const [showCustomTipInput, setShowCustomTipInput] = useState(false);

    // Split mode state
    const [splits, setSplits] = useState<SplitEntry[]>([]);
    const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>('evenly');
    const [itemAssignments, setItemAssignments] = useState<Record<number, number>>({});
    const [previewLoading, setPreviewLoading] = useState(false);
    // Indexes of splits already charged successfully, so a retry after a partial
    // failure does NOT double-charge the diners who already paid.
    const [paidSplitIndexes, setPaidSplitIndexes] = useState<number[]>([]);
    const dialogRef = useRef<HTMLDivElement>(null);

    const handleClose = useCallback(() => {
        if (loading) return;
        onClose();
    }, [loading, onClose]);

    const { titleId } = useDialogA11y(isOpen, handleClose, dialogRef as RefObject<HTMLElement | null>, {
        closeOnEscape: !loading,
    });

    const isCashSelected = selectedMethod !== null && selectedMethod === cashMethodId;

    const orderItems = useMemo(() => order?.items || [], [order]);

    // Load the company's payment methods whenever the modal opens.
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setMethodsLoading(true);
        setMethodsError('');
        paymentsAPI.getPaymentMethods()
            .then((res) => {
                if (cancelled) return;
                const rows = (res.data?.data || []) as Array<{ id: number; name: string; active?: boolean }>;
                const options = rows
                    .filter((row) => row.active !== false)
                    .map((row) => ({ id: row.id, name: row.name, icon: resolveMethodIcon(row.name) }));
                setPaymentMethods(options);
                setSelectedMethod((prev) => (prev !== null
                    && options.some((o) => o.id === prev)
                    && (hasUsableCashShift || prev !== options.find((o) => isCashMethodName(o.name))?.id)
                    ? prev
                    : (hasUsableCashShift ? options.find((o) => isCashMethodName(o.name))?.id : null)
                        ?? options.find((o) => !isCashMethodName(o.name))?.id
                        ?? null));
                if (options.length === 0) {
                    setMethodsError('No hay métodos de pago configurados. Contacta a un administrador.');
                }
            })
            .catch(() => {
                if (cancelled) return;
                setMethodsError('No se pudieron cargar los métodos de pago. Verifica tu conexión e inténtalo de nuevo.');
            })
            .finally(() => {
                if (!cancelled) setMethodsLoading(false);
            });
        return () => { cancelled = true; };
    }, [hasUsableCashShift, isOpen]);

    useEffect(() => {
        if (isOpen) {
            const total = orderTotal;
            setAmountTendered(total.toFixed(2));
            setError('');
            setPendingNotice('');
            setHasQueuedPayment(false);
            setTipPercentage(0);
            setCustomTip('');
            setShowCustomTipInput(false);
            setMode('single');
            setSplits([]);
            setSplitStrategy('evenly');
            setItemAssignments({});
            setPreviewLoading(false);
            setPaidSplitIndexes([]);
        }
    }, [isOpen, orderTotal]);

    const persistedTipAmount = Number(order?.tipAmount || 0);
    const hasPersistedOrder = Boolean(orderId && order);
    const allowLocalTipEditing = !hasPersistedOrder;
    const tipAmount = allowLocalTipEditing
        ? calculateTipAmount(orderTotal, tipPercentage, customTip)
        : persistedTipAmount;
    const totalWithTip = allowLocalTipEditing
        ? calculateTotalWithTip(orderTotal, tipAmount)
        : Number(order?.total || orderTotal);

    const calculateChange = () => {
        const tendered = parseFloat(amountTendered) || 0;
        return Math.max(0, tendered - totalWithTip);
    };

    const buildSplitEntries = useCallback((count: number, amounts?: number[]) => {
        return Array.from({ length: count }, (_, index) => ({
            payerName: splits[index]?.payerName || `Comensal ${index + 1}`,
            paymentMethodId: splits[index]?.paymentMethodId || defaultMethodId || 0,
            amount: (amounts?.[index] ?? 0).toFixed(2),
            reference: splits[index]?.reference || ''
        }));
    }, [defaultMethodId, splits]);

    const handleQuickAmount = (multiplier: number) => {
        const rounded = Math.ceil(totalWithTip / multiplier) * multiplier;
        setAmountTendered(rounded.toFixed(2));
    };

    // Split helpers
    const addSplit = () => {
        const nextCount = splits.length + 1;
        const amounts = splitTotalEvenly(totalWithTip, nextCount);
        setSplits(buildSplitEntries(nextCount, amounts));
        setPaidSplitIndexes([]);
    };

    const removeSplit = (index: number) => {
        const nextSplits = splits.filter((_, i) => i !== index);
        setSplits(nextSplits);
        setPaidSplitIndexes([]);
        setItemAssignments((prev) => Object.fromEntries(
            Object.entries(prev).map(([itemId, payerIndex]) => {
                const numericIndex = Number(payerIndex);
                if (numericIndex === index) {
                    return [itemId, 0];
                }
                if (numericIndex > index) {
                    return [itemId, numericIndex - 1];
                }
                return [itemId, numericIndex];
            })
        ));
    };

    const updateSplit = (index: number, field: keyof SplitEntry, value: string | number) => {
        const updated = [...splits];
        updated[index] = { ...updated[index], [field]: value };
        setSplits(updated);
    };

    const splitEvenlyAmong = (count: number) => {
        const amounts = splitTotalEvenly(totalWithTip, count);
        setSplits(buildSplitEntries(count, amounts));
        setPaidSplitIndexes([]);
        setItemAssignments((prev) => {
            const nextAssignments: Record<number, number> = {};
            Object.entries(prev).forEach(([itemId, payerIndex]) => {
                nextAssignments[Number(itemId)] = Math.min(Number(payerIndex), count - 1);
            });
            return nextAssignments;
        });
    };

    const initializeItemAssignments = useCallback((count: number) => {
        const nextAssignments: Record<number, number> = {};
        orderItems.forEach((item, index) => {
            nextAssignments[item.id] = index % count;
        });
        setItemAssignments(nextAssignments);
    }, [orderItems]);

    // Monotonic id used to ignore stale split-preview responses. Each invocation
    // claims the latest id; if a newer call starts before this one resolves, this
    // call's results are discarded (it neither updates state nor returns entries).
    const previewSeqRef = useRef(0);

    const recalculateSplitPreview = useCallback(async (
        strategy: SplitStrategy,
        entries: SplitEntry[] = splits,
        assignments: Record<number, number> = itemAssignments
    ): Promise<SplitEntry[] | null> => {
        if (!orderId || entries.length === 0) {
            return entries;
        }

        const seq = ++previewSeqRef.current;
        const isStale = () => seq !== previewSeqRef.current;
        setPreviewLoading(true);
        setError('');

        try {
            if (strategy === 'evenly') {
                const response = await splitBillAPI.splitEvenly(orderId, entries.length);
                if (isStale()) return null;
                const nextAmounts = response.data.data.splits.map((split: { amount: number }) => Number(split.amount));
                const nextEntries = buildSplitEntries(entries.length, nextAmounts);
                setSplits(nextEntries);
                return nextEntries;
            }

            if (strategy === 'by-items') {
                const assignmentsPayload = entries.map((entry, index) => ({
                    personName: entry.payerName,
                    itemIds: orderItems
                        .filter((item) => assignments[item.id] === index)
                        .map((item) => item.id)
                })).filter((assignment) => assignment.itemIds.length > 0);

                if (assignmentsPayload.length === 0) {
                    const nextEntries = buildSplitEntries(entries.length, Array(entries.length).fill(0));
                    setSplits(nextEntries);
                    return nextEntries;
                }

                const response = await splitBillAPI.splitByItems(orderId, assignmentsPayload);
                if (isStale()) return null;
                const amountByName = new Map<string, number>(
                    response.data.data.splits.map((split: { personName: string; total: number }) => [split.personName, Number(split.total)])
                );
                const nextEntries = entries.map((entry) => ({
                    ...entry,
                    amount: (amountByName.get(entry.payerName) ?? 0).toFixed(2)
                }));
                setSplits(nextEntries);
                return nextEntries;
            }

            const response = await splitBillAPI.splitByAmount(orderId, entries.map((entry) => ({
                personName: entry.payerName,
                amount: parseFloat(entry.amount) || 0
            })));
            if (isStale()) return null;

            if (response.data.data.valid === false) {
                setError(response.data.data.error);
                return null;
            }

            const nextEntries = entries.map((entry, index) => ({
                ...entry,
                amount: Number(response.data.data.splits[index]?.amount ?? entry.amount).toFixed(2)
            }));
            setSplits(nextEntries);
            return nextEntries;
        } catch (err: unknown) {
            if (isStale()) return null;
            setError(axiosErrorMessage(err, 'No se pudo recalcular la división.'));
            return null;
        } finally {
            if (!isStale()) setPreviewLoading(false);
        }
    }, [buildSplitEntries, itemAssignments, orderId, orderItems, splits]);

    useEffect(() => {
        if (!isOpen || mode !== 'split' || splits.length === 0) {
            return;
        }

        if (splitStrategy === 'by-items' && Object.keys(itemAssignments).length === 0 && orderItems.length > 0) {
            initializeItemAssignments(splits.length);
            return;
        }

        if (!orderId) {
            return;
        }

        // Debounce: avoid firing a preview request on every keystroke/edit.
        const handle = setTimeout(() => {
            void recalculateSplitPreview(splitStrategy);
        }, 350);
        return () => clearTimeout(handle);
    }, [initializeItemAssignments, isOpen, itemAssignments, mode, orderId, orderItems.length, recalculateSplitPreview, splitStrategy, splits.length]);

    const getSplitTotal = () => splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
    const getSplitRemaining = () => Math.round((totalWithTip - getSplitTotal()) * 100) / 100;

    const handleSinglePayment = async () => {
        const tendered = parseFloat(amountTendered) || 0;
        const total = totalWithTip;

        if (selectedMethod === null) {
            setError('Selecciona un método de pago');
            return;
        }

        if (isCashSelected && !hasUsableCashShift) {
            setError('Para cobrar en efectivo abre un turno vigente en la misma sucursal de la orden.');
            return;
        }

        if (isCashSelected && tendered < total) {
            setError('El monto ingresado es menor al total');
            return;
        }

        setLoading(true);
        setError('');
        setPendingNotice('');

        try {
            if (!orderId) { setError('No se ha creado la orden'); setLoading(false); return; }

            const response = await paymentsAPI.create({
                orderId,
                paymentMethodId: selectedMethod,
                amount: total,
            }, {
                operationType: 'CREATE_PAYMENT',
                entityTempId: `payment-${Date.now()}`
            });

            // Offline: the request was only queued, NOT confirmed by the server.
            // Do not report success or close the order — keep it open until sync.
            if ((response.data as ApiEnvelope)._offline) {
                setHasQueuedPayment(true);
                setPendingNotice('Sin conexión: el pago quedó en cola de sincronización. La orden permanece ABIERTA y solo se marcará como pagada cuando se confirme al reconectar.');
                setLoading(false);
                return;
            }

            onPaymentSuccess({ offlineQueued: false });
            handleClose();
        } catch (err: unknown) {
            setError(axiosErrorMessage(err, 'Error al procesar el pago'));
        } finally {
            setLoading(false);
        }
    };

    const handleSplitPayment = async () => {
        if (splits.some(s => !s.payerName.trim())) {
            setError('Cada comensal debe tener un nombre');
            return;
        }

        setLoading(true);
        setError('');
        setPendingNotice('');

        try {
            if (!orderId) { setError('No se ha creado la orden'); setLoading(false); return; }

            const effectiveSplits = await recalculateSplitPreview(splitStrategy, splits, itemAssignments) || splits;
            if (!hasUsableCashShift && effectiveSplits.some((split) => split.paymentMethodId === cashMethodId)) {
                setError('La división contiene efectivo, pero no hay un turno vigente en la sucursal de la orden.');
                setLoading(false);
                return;
            }
            const previewTotal = effectiveSplits.reduce((sum, split) => sum + (parseFloat(split.amount) || 0), 0);
            const remaining = Math.round((totalWithTip - previewTotal) * 100) / 100;

            if (Math.abs(remaining) > 0.02) {
                setError(`La suma de los pagos no coincide con el total. Diferencia: ${currencySymbol}${remaining.toFixed(2)}`);
                setLoading(false);
                return;
            }

            // There is no atomic batch/split payment endpoint, so charges are
            // applied sequentially. We track which ones succeed and, on any
            // failure, STOP and report the partial state explicitly instead of
            // claiming overall success. A subsequent click retries only the
            // remaining diners (already-paid indexes are skipped).
            const succeeded = [...paidSplitIndexes];
            const nameOf = (idx: number) => effectiveSplits[idx]?.payerName || `Pago ${idx + 1}`;

            for (let i = 0; i < effectiveSplits.length; i++) {
                if (succeeded.includes(i)) continue;
                const split = effectiveSplits[i];

                let response;
                try {
                    response = await paymentsAPI.create({
                        orderId,
                        paymentMethodId: split.paymentMethodId,
                        amount: parseFloat(split.amount) || 0,
                        reference: split.reference || undefined,
                        payerName: split.payerName,
                    }, {
                        operationType: 'CREATE_PAYMENT',
                        entityTempId: `payment-${orderId}-${i}`
                    });
                } catch (err: unknown) {
                    setPaidSplitIndexes(succeeded);
                    const okNames = succeeded.map(nameOf);
                    const pendingNames = effectiveSplits
                        .map((_, idx) => idx)
                        .filter((idx) => idx > i || (idx !== i && !succeeded.includes(idx)));
                    setError(
                        `Falló el cobro de "${nameOf(i)}": ${axiosErrorMessage(err, 'error al procesar el pago')}. ` +
                        (okNames.length ? `Ya se cobraron: ${okNames.join(', ')}. ` : '') +
                        (pendingNames.length ? `Pendientes: ${pendingNames.map(nameOf).join(', ')}. ` : '') +
                        'Vuelve a presionar "Confirmar" para reintentar solo los pagos pendientes.'
                    );
                    setLoading(false);
                    return;
                }

                // Offline-queued split payments are not confirmed; stop and keep
                // the order open rather than reporting success.
                if ((response.data as ApiEnvelope)._offline) {
                    setHasQueuedPayment(true);
                    setPaidSplitIndexes(succeeded);
                    const okNames = succeeded.map(nameOf);
                    setPendingNotice(
                        `Sin conexión: el cobro de "${nameOf(i)}" quedó en cola de sincronización, por lo que la división no pudo completarse. ` +
                        (okNames.length ? `Ya se cobraron: ${okNames.join(', ')}. ` : '') +
                        'La orden permanece ABIERTA hasta poder cobrar el resto con conexión.'
                    );
                    setLoading(false);
                    return;
                }

                succeeded.push(i);
                setPaidSplitIndexes([...succeeded]);
            }

            onPaymentSuccess({ offlineQueued: false });
            handleClose();
        } catch (err: unknown) {
            setError(axiosErrorMessage(err, 'Error al procesar pagos'));
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const change = calculateChange();

    return (
        <div
            className="modal-overlay-new"
            onClick={loading ? undefined : handleClose}
        >
            <div
                ref={dialogRef}
                className="payment-modal-new"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="payment-header">
                    <h2 id={titleId}>Procesar Pago</h2>
                    <div className="payment-mode-toggle">
                        <button
                            type="button"
                            className={`payment-mode-btn ${mode === 'single' ? 'active' : ''}`}
                            onClick={() => setMode('single')}
                            disabled={hasQueuedPayment || paidSplitIndexes.length > 0}
                        >
                            Pago Único
                        </button>
                        <button
                            type="button"
                            className={`payment-mode-btn ${mode === 'split' ? 'active' : ''}`}
                            onClick={() => {
                                setMode('split');
                                setSplitStrategy('evenly');
                                if (splits.length === 0) {
                                    splitEvenlyAmong(2);
                                }
                            }}
                            disabled={hasQueuedPayment || paidSplitIndexes.length > 0}
                        >
                            <Users size={14} />
                            Dividir Cuenta
                        </button>
                        <button
                            type="button"
                            className="close-btn-new"
                            onClick={handleClose}
                            disabled={loading}
                            aria-label="Cerrar modal de pago"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="payment-body">
                    {mode === 'single' ? (
                        <>
                            {/* === SINGLE MODE === */}
                            <div className="payment-left">
                                <div className="total-display">
                                    <div className="total-label">Total a Pagar</div>
                                    <div className="total-amount-large">{currencySymbol}{totalWithTip.toFixed(2)}</div>
                                </div>

                                <div className="section">
                                    <div className="section-title">Método de Pago</div>
                                    {methodsLoading && paymentMethods.length === 0 ? (
                                        <div style={{ padding: '10px 12px', color: 'var(--color-neutral-600)', fontSize: '0.85rem' }}>
                                            Cargando métodos de pago...
                                        </div>
                                    ) : methodsError ? (
                                        <div className="error-message-new">{methodsError}</div>
                                    ) : (
                                        <div className="payment-methods-grid">
                                            {paymentMethods.map(method => {
                                                const Icon = method.icon;
                                                return (
                                                    <button key={method.id}
                                                        className={`payment-method-card ${selectedMethod === method.id ? 'active' : ''}`}
                                                        type="button"
                                                        disabled={!hasUsableCashShift && method.id === cashMethodId}
                                                        title={!hasUsableCashShift && method.id === cashMethodId
                                                            ? 'Requiere turno vigente en la misma sucursal'
                                                            : undefined}
                                                        onClick={() => setSelectedMethod(method.id)}>
                                                        <Icon size={24} /><span>{method.name}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {isCashSelected && (
                                    <div className="section">
                                        <div className="section-title">Monto Recibido</div>
                                        <div className="cash-input-group">
                                            <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{currencySymbol}</span>
                                            <input type="number" step="0.01" value={amountTendered}
                                                onChange={(e) => setAmountTendered(e.target.value)}
                                                className="cash-input" autoFocus placeholder="0.00" />
                                        </div>
                                        <div className="quick-amounts">
                                            {[5, 10, 20].map(m => (
                                                <button key={m} onClick={() => handleQuickAmount(m)} className="quick-btn">
                                                    Redondear {currencySymbol}{m}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="payment-right">
                                <div className="section">
                                    <div className="section-title"><DollarSign size={16} /> Propina</div>
                                    {!allowLocalTipEditing && (
                                        <div style={{
                                            padding: '10px 12px',
                                            borderRadius: '10px',
                                            background: 'var(--color-neutral-50)',
                                            border: '1px solid var(--color-neutral-200)',
                                            color: 'var(--color-neutral-600)',
                                            fontSize: '0.82rem',
                                            marginBottom: '12px'
                                        }}>
                                            La propina y descuentos se toman de la orden registrada para mantener el cobro sincronizado con caja.
                                        </div>
                                    )}
                                    <div className="tip-grid">
                                        {[10, 15, 20].map(pct => (
                                            <button key={pct}
                                                className={`tip-card ${tipPercentage === pct ? 'active' : ''}`}
                                                disabled={!allowLocalTipEditing}
                                                onClick={() => { setTipPercentage(pct); setCustomTip(''); setShowCustomTipInput(false); }}
                                                style={!allowLocalTipEditing ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
                                                <div className="tip-percent">{allowLocalTipEditing ? `${pct}%` : 'Aplicada'}</div>
                                                <div className="tip-amount">{currencySymbol}{(allowLocalTipEditing ? calculateTipAmount(orderTotal, pct) : tipAmount).toFixed(2)}</div>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="tip-options">
                                        <button className={`tip-option-btn ${showCustomTipInput ? 'active' : ''}`}
                                            type="button"
                                            disabled={!allowLocalTipEditing}
                                            onClick={() => { setShowCustomTipInput(!showCustomTipInput); setTipPercentage(0); }}
                                            style={!allowLocalTipEditing ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
                                            <Calculator size={16} /> Personalizada
                                        </button>
                                        <button className="tip-option-btn"
                                            type="button"
                                            disabled={!allowLocalTipEditing}
                                            onClick={() => { setTipPercentage(0); setCustomTip(''); setShowCustomTipInput(false); }}
                                            style={!allowLocalTipEditing ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
                                            Sin propina
                                        </button>
                                    </div>
                                    {showCustomTipInput && allowLocalTipEditing && (
                                        <input type="number" step="0.01" value={customTip}
                                            onChange={(e) => setCustomTip(e.target.value)}
                                            className="custom-tip-input" placeholder="Ingrese monto" autoFocus />
                                    )}
                                </div>

                                {isCashSelected && parseFloat(amountTendered) >= totalWithTip && (
                                    <div className="section change-section">
                                        <div className="section-title">Cambio</div>
                                        <div className="change-display-reorganized">
                                            <span className="change-amount-large">{currencySymbol}{change.toFixed(2)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        /* === SPLIT MODE === */
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div className="total-display" style={{ textAlign: 'center' }}>
                                <div className="total-label">Total de la Orden</div>
                                <div className="total-amount-large">{currencySymbol}{totalWithTip.toFixed(2)}</div>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                {[
                                    { value: 'evenly', label: 'Equitativa' },
                                    { value: 'by-items', label: 'Por platos' },
                                    { value: 'by-amount', label: 'Por monto' }
                                ].map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => {
                                            const nextStrategy = option.value as SplitStrategy;
                                            setSplitStrategy(nextStrategy);
                                            if (splits.length === 0) {
                                                splitEvenlyAmong(2);
                                            }
                                            if (nextStrategy === 'by-items' && Object.keys(itemAssignments).length === 0) {
                                                initializeItemAssignments(Math.max(splits.length, 2));
                                            }
                                        }}
                                        disabled={paidSplitIndexes.length > 0}
                                        style={{
                                            padding: '6px 14px',
                                            borderRadius: '999px',
                                            border: `1px solid ${splitStrategy === option.value ? 'var(--color-primary, #2563eb)' : 'var(--color-neutral-200)'}`,
                                            background: splitStrategy === option.value ? 'var(--color-primary, #2563eb)' : 'var(--color-neutral-50)',
                                            color: splitStrategy === option.value ? '#fff' : 'var(--color-neutral-700)',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            fontSize: '0.82rem'
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>

                            {/* Quick split buttons */}
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                {[2, 3, 4].map(n => (
                                    <button key={n} onClick={() => {
                                        splitEvenlyAmong(n);
                                        if (splitStrategy === 'by-items') {
                                            initializeItemAssignments(n);
                                        }
                                    }} disabled={paidSplitIndexes.length > 0}
                                        style={{
                                            padding: '6px 16px', borderRadius: '8px', border: '1px solid var(--color-neutral-200)',
                                            background: splits.length === n ? 'var(--color-primary, #2563eb)' : 'var(--color-neutral-50)',
                                            color: splits.length === n ? '#fff' : 'var(--color-neutral-700)',
                                            cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'
                                        }}>
                                        Dividir en {n}
                                    </button>
                                ))}
                                <button disabled={paidSplitIndexes.length > 0} onClick={() => {
                                    addSplit();
                                    if (splitStrategy === 'by-items') {
                                        initializeItemAssignments(splits.length + 1);
                                    }
                                }}
                                    style={{
                                        padding: '6px 16px', borderRadius: '8px', border: '1px dashed var(--color-neutral-300)',
                                        background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                                        fontSize: '0.85rem', color: 'var(--color-neutral-600)'
                                }}>
                                    <Plus size={14} /> Agregar
                                </button>
                                {orderId && (
                                    <button disabled={paidSplitIndexes.length > 0} onClick={() => void recalculateSplitPreview(splitStrategy)}
                                        style={{
                                            padding: '6px 16px', borderRadius: '8px', border: '1px solid var(--color-neutral-200)',
                                            background: 'var(--color-neutral-50)', cursor: 'pointer',
                                            fontWeight: 600, fontSize: '0.85rem'
                                        }}>
                                        {previewLoading ? 'Calculando...' : 'Recalcular'}
                                    </button>
                                )}
                            </div>

                            {/* Split entries */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '340px', overflowY: 'auto', padding: '4px' }}>
                                {splits.map((split, idx) => (
                                    <div key={idx} style={{
                                        display: 'flex', gap: '8px', alignItems: 'center',
                                        padding: '10px 12px', borderRadius: '10px',
                                        background: 'var(--color-neutral-50)', border: '1px solid var(--color-neutral-200)'
                                    }}>
                                        <input
                                            type="text" value={split.payerName}
                                            onChange={(e) => updateSplit(idx, 'payerName', e.target.value)}
                                            disabled={paidSplitIndexes.includes(idx)}
                                            placeholder="Nombre" style={{
                                                flex: 1, padding: '6px 10px', borderRadius: '6px',
                                                border: '1px solid var(--color-neutral-200)', fontSize: '0.85rem',
                                                background: 'var(--bg-primary, #fff)'
                                            }} />

                                        <Select
                                            className="payment-split-select"
                                            value={
                                                paymentMethods.find((m) => m.id === split.paymentMethodId)
                                                    ? { value: split.paymentMethodId, label: paymentMethods.find((m) => m.id === split.paymentMethodId)!.name }
                                                    : null
                                            }
                                            onChange={(option: SingleValue<{ value: number; label: string }>) =>
                                                option && updateSplit(idx, 'paymentMethodId', option.value)}
                                            isDisabled={paidSplitIndexes.includes(idx)}
                                            options={paymentMethods
                                                .filter((m) => hasUsableCashShift || m.id !== cashMethodId)
                                                .map((m) => ({ value: m.id, label: m.name }))}
                                            isSearchable={false}
                                        />

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{currencySymbol}</span>
                                            <input type="number" step="0.01" value={split.amount}
                                                onChange={(e) => updateSplit(idx, 'amount', e.target.value)}
                                                disabled={splitStrategy === 'by-items' || paidSplitIndexes.includes(idx)}
                                                style={{
                                                    width: '80px', padding: '6px 8px', borderRadius: '6px',
                                                    border: '1px solid var(--color-neutral-200)', fontSize: '0.85rem',
                                                    textAlign: 'right', background: splitStrategy === 'by-items' ? 'var(--color-neutral-100)' : 'var(--bg-primary, #fff)'
                                                }} />
                                        </div>

                                        <input type="text" value={split.reference}
                                            onChange={(e) => updateSplit(idx, 'reference', e.target.value)}
                                            disabled={paidSplitIndexes.includes(idx)}
                                            placeholder="Ref. (opc.)" style={{
                                                width: '90px', padding: '6px 8px', borderRadius: '6px',
                                                border: '1px solid var(--color-neutral-200)', fontSize: '0.8rem',
                                                background: 'var(--bg-primary, #fff)'
                                            }} />

                                        <button onClick={() => removeSplit(idx)} disabled={paidSplitIndexes.length > 0}
                                            style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: 'var(--color-error, #ef4444)', padding: '4px'
                                            }}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {splitStrategy === 'by-items' && orderItems.length > 0 && (
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    padding: '12px',
                                    borderRadius: '12px',
                                    border: '1px solid var(--color-neutral-200)',
                                    background: 'var(--color-neutral-50)'
                                }}>
                                    <div style={{ fontWeight: 700 }}>Asignación por plato</div>
                                    {orderItems.map((item) => (
                                        <div key={item.id} style={{
                                            display: 'grid',
                                            gridTemplateColumns: '1fr auto',
                                            gap: '10px',
                                            alignItems: 'center'
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 600 }}>{item.quantity}x {item.menuItem?.name}</div>
                                                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                                                    {currencySymbol}{Number(item.subtotal).toFixed(2)}
                                                </div>
                                            </div>
                                            <Select
                                                className="payment-split-assign-select"
                                                value={{
                                                    value: itemAssignments[item.id] ?? 0,
                                                    label: splits[itemAssignments[item.id] ?? 0]?.payerName || splits[0]?.payerName || ''
                                                }}
                                                onChange={(option: SingleValue<{ value: number; label: string }>) =>
                                                    option && setItemAssignments((prev) => ({
                                                        ...prev,
                                                        [item.id]: option.value
                                                    }))}
                                                options={splits.map((split, index) => ({
                                                    value: index,
                                                    label: split.payerName
                                                }))}
                                                isSearchable={false}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Split summary */}
                            {splits.length > 0 && (
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '10px 16px', borderRadius: '10px',
                                    background: Math.abs(getSplitRemaining()) < 0.02 ? 'var(--color-success, #22c55e)10' : 'var(--color-warning, #f59e0b)10',
                                    border: `1px solid ${Math.abs(getSplitRemaining()) < 0.02 ? 'var(--color-success, #22c55e)' : 'var(--color-warning, #f59e0b)'}`,
                                    fontWeight: 600, fontSize: '0.9rem'
                                }}>
                                    <span>Suma pagos: {currencySymbol}{getSplitTotal().toFixed(2)}</span>
                                    <span style={{ color: Math.abs(getSplitRemaining()) < 0.02 ? 'var(--color-success, #22c55e)' : 'var(--color-error, #ef4444)' }}>
                                        {Math.abs(getSplitRemaining()) < 0.02 ? 'Cuadrado' : `Restante: ${currencySymbol}${getSplitRemaining().toFixed(2)}`}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="payment-footer">
                    {!branchHasWarehouse && (
                        <div className="error-message-new">
                            No se puede cobrar: esta sucursal no tiene un almacén configurado.
                            Configura un almacén en Bodegas para habilitar el cobro.
                        </div>
                    )}
                    {!hasUsableCashShift && cashMethodId !== null && (
                        <div className="error-message-new">
                            Efectivo no está disponible: abre un turno vigente en la misma sucursal. Los otros métodos sí pueden procesarse.
                        </div>
                    )}
                    {error && <div className="error-message-new">{error}</div>}
                    {pendingNotice && (
                        <div style={{
                            padding: '10px 12px',
                            borderRadius: '10px',
                            background: 'var(--color-warning, #f59e0b)18',
                            border: '1px solid var(--color-warning, #f59e0b)',
                            color: 'var(--color-warning, #b45309)',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            marginBottom: '8px'
                        }}>
                            {pendingNotice}
                        </div>
                    )}
                    <div className="footer-actions">
                        <button className="btn-cancel" onClick={handleClose} disabled={loading}>Cancelar</button>
                        <button className="btn-confirm"
                            onClick={mode === 'single' ? handleSinglePayment : handleSplitPayment}
                            disabled={
                                loading || previewLoading || hasQueuedPayment || !branchHasWarehouse ||
                                (mode === 'single' && (selectedMethod === null || (isCashSelected && (!hasUsableCashShift || parseFloat(amountTendered) < totalWithTip)))) ||
                                (mode === 'split' && Math.abs(getSplitRemaining()) > 0.02)
                            }>
                            {loading
                                ? 'Procesando...'
                                : previewLoading
                                    ? 'Calculando...'
                                    : mode === 'split'
                                        ? (paidSplitIndexes.length > 0
                                            ? `Reintentar ${Math.max(splits.length - paidSplitIndexes.length, 0)} Pagos`
                                            : `Confirmar ${splits.length} Pagos`)
                                        : 'Confirmar Pago'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PaymentModal;
