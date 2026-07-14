import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { X, DollarSign, Users, CreditCard, Banknote, Smartphone, Calculator, Plus, Trash2, type LucideIcon } from 'lucide-react';
import { paymentsAPI, splitBillAPI } from '../services/api';
import Select from './Select';
import type { SingleValue } from 'react-select';
import {
    calculateTipAmount,
    calculateTotalWithTip,
    formatMoneyInput,
    moneyToCents,
    parseMoneyInput,
    splitTotalEvenly,
} from '../utils/payment';
import type { Order, PaymentMethodType } from '../types';
import { isCashPaymentMethodType } from '../utils/paymentAccess';
import { newIdempotencyKey } from '../utils/idempotency';
import './PaymentModal.css';

interface PaymentMethodOption {
    id: number;
    name: string;
    type: PaymentMethodType;
    icon: LucideIcon;
}

const resolveMethodIcon = (type: PaymentMethodType): LucideIcon => {
    if (type === 'CASH') return Banknote;
    if (type === 'CARD') return CreditCard;
    if (type === 'BANK_TRANSFER') return Smartphone;
    return DollarSign;
};

interface SplitEntry {
    id: string;
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
    hasUsableCashShift = true,
}: PaymentModalProps) => {
    const [mode, setMode] = useState<'single' | 'split'>('single');

    // Payment methods are validated server-side against the company's DB rows;
    // the available IDs are NOT guaranteed to be {1,2,3}, so load them at runtime.
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
    const [methodsLoading, setMethodsLoading] = useState(false);
    const [methodsError, setMethodsError] = useState('');
    const cashMethodId = useMemo(
        () => paymentMethods.find((m) => isCashPaymentMethodType(m.type))?.id ?? null,
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
    const [remainingBalance, setRemainingBalance] = useState(orderTotal);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [balanceError, setBalanceError] = useState('');
    const [tipPercentage, setTipPercentage] = useState<number>(0);
    const [customTip, setCustomTip] = useState<string>('');
    const [showCustomTipInput, setShowCustomTipInput] = useState(false);

    // Split mode state
    const [splits, setSplits] = useState<SplitEntry[]>([]);
    const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>('evenly');
    const [itemQuantities, setItemQuantities] = useState<Record<number, number[]>>({});
    const [previewLoading, setPreviewLoading] = useState(false);
    // Indexes of splits already charged successfully, so a retry after a partial
    // failure does NOT double-charge the diners who already paid.
    const [paidSplitIndexes, setPaidSplitIndexes] = useState<number[]>([]);
    // Once any split request is sent, preserve the exact bodies and keys. A lost
    // response may still have charged the server; recalculating before replaying
    // would change the fingerprint and defeat durable idempotency.
    const [hasAttemptedSplitPayments, setHasAttemptedSplitPayments] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const singlePaymentKeyRef = useRef(newIdempotencyKey());
    const splitPaymentKeysRef = useRef<string[]>([]);

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
                const rows = (res.data?.data || []) as Array<{ id: number; name: string; type: PaymentMethodType; active?: boolean }>;
                const options = rows
                    .filter((row) => row.active !== false)
                    .map((row) => ({ id: row.id, name: row.name, type: row.type, icon: resolveMethodIcon(row.type) }));
                setPaymentMethods(options);
                setSelectedMethod((prev) => (prev !== null
                    && options.some((o) => o.id === prev)
                    && (hasUsableCashShift || prev !== options.find((o) => isCashPaymentMethodType(o.type))?.id)
                    ? prev
                    : (hasUsableCashShift ? options.find((o) => isCashPaymentMethodType(o.type))?.id : null)
                        ?? options.find((o) => !isCashPaymentMethodType(o.type))?.id
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
            setItemQuantities({});
            setPreviewLoading(false);
            setPaidSplitIndexes([]);
            setHasAttemptedSplitPayments(false);
            setBalanceLoading(false);
            setRemainingBalance(orderTotal);
            setBalanceError('');
            singlePaymentKeyRef.current = newIdempotencyKey();
            splitPaymentKeysRef.current = [];
        }
    }, [isOpen, orderTotal]);

    useEffect(() => {
        if (!isOpen || !orderId) return;
        let cancelled = false;
        setBalanceLoading(true);
        setBalanceError('');
        paymentsAPI.getSummary(orderId)
            .then((response) => {
                if (cancelled) return;
                const remaining = Number(response.data?.data?.remaining);
                if (!Number.isFinite(remaining) || remaining < 0) {
                    throw new Error('Saldo pendiente inválido');
                }
                const normalized = Math.round(remaining * 100) / 100;
                setRemainingBalance(normalized);
                setAmountTendered(normalized.toFixed(2));
                if (normalized <= 0) setBalanceError('La orden ya no tiene saldo pendiente.');
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setBalanceError(axiosErrorMessage(err, 'No se pudo validar el saldo pendiente de la orden.'));
                }
            })
            .finally(() => {
                if (!cancelled) setBalanceLoading(false);
            });
        return () => { cancelled = true; };
    }, [isOpen, orderId]);

    const persistedTipAmount = Number(order?.tipAmount || 0);
    const hasPersistedOrder = Boolean(orderId && order);
    const allowLocalTipEditing = !hasPersistedOrder;
    const tipAmount = allowLocalTipEditing
        ? calculateTipAmount(orderTotal, tipPercentage, customTip)
        : persistedTipAmount;
    const persistedOrLocalTotal = allowLocalTipEditing
        ? calculateTotalWithTip(orderTotal, tipAmount)
        : Number(order?.total || orderTotal);
    const totalWithTip = hasPersistedOrder ? remainingBalance : persistedOrLocalTotal;

    const tenderedAmount = parseMoneyInput(amountTendered);
    const tenderedCents = tenderedAmount === null ? 0 : moneyToCents(tenderedAmount);
    const totalCents = moneyToCents(totalWithTip);
    const originalOrderCents = moneyToCents(Number(order?.total ?? orderTotal));
    const alreadyPaidCents = Math.max(0, originalOrderCents - totalCents);

    const calculateChange = () => Math.max(0, tenderedCents - totalCents) / 100;

    const buildSplitEntries = useCallback((count: number, amounts?: number[], previous: SplitEntry[] = []) => {
        return Array.from({ length: count }, (_, index) => ({
            id: previous[index]?.id || newIdempotencyKey(),
            payerName: previous[index]?.payerName || `Comensal ${index + 1}`,
            paymentMethodId: previous[index]?.paymentMethodId || defaultMethodId || 0,
            amount: (amounts?.[index] ?? 0).toFixed(2),
            reference: previous[index]?.reference || ''
        }));
    }, [defaultMethodId]);

    const handleQuickAmount = (multiplier: number) => {
        const rounded = Math.ceil(totalWithTip / multiplier) * multiplier;
        setAmountTendered(rounded.toFixed(2));
    };

    // Split helpers
    const addSplit = () => {
        const nextCount = splits.length + 1;
        const amounts = splitTotalEvenly(totalWithTip, nextCount);
        setSplits(buildSplitEntries(nextCount, amounts, splits));
        setPaidSplitIndexes([]);
    };

    const removeSplit = (index: number) => {
        const nextSplits = splits.filter((_, i) => i !== index);
        setSplits(nextSplits);
        setPaidSplitIndexes([]);
        setItemQuantities((previous) => Object.fromEntries(Object.entries(previous).map(([itemId, quantities]) => {
            const next = quantities.filter((_, payerIndex) => payerIndex !== index);
            if (next.length > 0) next[0] += quantities[index] ?? 0;
            return [itemId, next];
        })));
    };

    const updateSplit = (index: number, field: keyof SplitEntry, value: string | number) => {
        const updated = [...splits];
        updated[index] = { ...updated[index], [field]: value };
        setSplits(updated);
    };

    const splitEvenlyAmong = (count: number) => {
        const amounts = splitTotalEvenly(totalWithTip, count);
        setSplits(buildSplitEntries(count, amounts, splits));
        setPaidSplitIndexes([]);
        initializeItemAssignments(count);
    };

    const initializeItemAssignments = useCallback((count: number) => {
        const nextAssignments: Record<number, number[]> = {};
        orderItems.forEach((item, index) => {
            const quantities = Array<number>(count).fill(0);
            quantities[index % count] = item.quantity;
            nextAssignments[item.id] = quantities;
        });
        setItemQuantities(nextAssignments);
    }, [orderItems]);

    // Monotonic id used to ignore stale split-preview responses. Each invocation
    // claims the latest id; if a newer call starts before this one resolves, this
    // call's results are discarded (it neither updates state nor returns entries).
    const previewSeqRef = useRef(0);
    const splitPreviewSnapshotRef = useRef({
        strategy: splitStrategy,
        entries: splits,
        assignments: itemQuantities,
    });
    splitPreviewSnapshotRef.current = {
        strategy: splitStrategy,
        entries: splits,
        assignments: itemQuantities,
    };

    const recalculateSplitPreview = useCallback(async (
        strategy: SplitStrategy,
        entries: SplitEntry[],
        assignments: Record<number, number[]>
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
                const nextEntries = buildSplitEntries(entries.length, nextAmounts, entries);
                setSplits(nextEntries);
                return nextEntries;
            }

            if (strategy === 'by-items') {
                const assignmentsPayload = entries.map((entry, index) => ({
                    personName: entry.payerName,
                    items: orderItems
                        .map((item) => ({ orderItemId: item.id, quantity: assignments[item.id]?.[index] ?? 0 }))
                        .filter((item) => item.quantity > 0)
                })).filter((assignment) => assignment.items.length > 0);

                if (assignmentsPayload.length === 0) {
                    const nextEntries = buildSplitEntries(entries.length, Array(entries.length).fill(0), entries);
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
                amount: parseMoneyInput(entry.amount) || 0
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
    }, [buildSplitEntries, orderId, orderItems]);

    const splitPreviewFingerprint = useMemo(() => JSON.stringify({
        strategy: splitStrategy,
        count: splits.length,
        payers: splits.map((split) => split.payerName),
        amounts: splitStrategy === 'by-amount' ? splits.map((split) => split.amount) : undefined,
        assignments: splitStrategy === 'by-items' ? itemQuantities : undefined,
    }), [itemQuantities, splitStrategy, splits]);

    const itemAssignmentsComplete = useMemo(() => splitStrategy !== 'by-items' || (
        orderItems.every((item) => (itemQuantities[item.id] ?? []).reduce((sum, quantity) => sum + quantity, 0) === item.quantity)
        && splits.every((_, payerIndex) => orderItems.some((item) => (itemQuantities[item.id]?.[payerIndex] ?? 0) > 0))
    ), [itemQuantities, orderItems, splitStrategy, splits]);

    useEffect(() => {
        const snapshot = splitPreviewSnapshotRef.current;
        if (!isOpen || mode !== 'split' || snapshot.entries.length === 0) {
            return;
        }

        if (snapshot.strategy === 'by-items' && Object.keys(snapshot.assignments).length === 0 && orderItems.length > 0) {
            initializeItemAssignments(snapshot.entries.length);
            return;
        }

        if (snapshot.strategy === 'by-items' && !itemAssignmentsComplete) return;

        if (!orderId) {
            return;
        }

        // Debounce: avoid firing a preview request on every keystroke/edit.
        const handle = setTimeout(() => {
            const latest = splitPreviewSnapshotRef.current;
            void recalculateSplitPreview(latest.strategy, latest.entries, latest.assignments);
        }, 350);
        return () => clearTimeout(handle);
        // The fingerprint intentionally excludes server-calculated amounts for
        // even/item splits, so applying a preview cannot trigger another preview.
    }, [initializeItemAssignments, isOpen, itemAssignmentsComplete, mode, orderId, orderItems.length, recalculateSplitPreview, splitPreviewFingerprint]);

    const getSplitTotalCents = () => splits.reduce(
        (sum, split) => sum + moneyToCents(parseMoneyInput(split.amount) || 0),
        0
    );
    const getSplitTotal = () => getSplitTotalCents() / 100;
    const getSplitRemaining = () => (totalCents - getSplitTotalCents()) / 100;
    const paidInSessionCents = paidSplitIndexes.reduce(
        (sum, index) => sum + moneyToCents(parseMoneyInput(splits[index]?.amount ?? '') || 0),
        0
    );
    const totalPaidCents = Math.min(originalOrderCents, alreadyPaidCents + paidInSessionCents);
    const pendingAfterPaymentsCents = Math.max(0, originalOrderCents - totalPaidCents);

    const handleSinglePayment = async () => {
        const tendered = tenderedAmount || 0;
        const total = totalCents / 100;

        if (selectedMethod === null) {
            setError('Selecciona un método de pago');
            return;
        }

        if (isCashSelected && !hasUsableCashShift) {
            setError('Para cobrar en efectivo abre un turno vigente en la misma sucursal de la orden.');
            return;
        }

        if (isCashSelected && moneyToCents(tendered) < totalCents) {
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
            }, singlePaymentKeyRef.current);

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
        if (!itemAssignmentsComplete) {
            setError('Asigna exactamente todas las unidades y al menos una a cada comensal.');
            return;
        }

        setLoading(true);
        setError('');
        setPendingNotice('');

        try {
            if (!orderId) { setError('No se ha creado la orden'); setLoading(false); return; }

            const effectiveSplits = hasAttemptedSplitPayments
                ? splits
                : await recalculateSplitPreview(splitStrategy, splits, itemQuantities) || splits;
            if (!hasUsableCashShift && effectiveSplits.some((split) => split.paymentMethodId === cashMethodId)) {
                setError('La división contiene efectivo, pero no hay un turno vigente en la sucursal de la orden.');
                setLoading(false);
                return;
            }
            const previewTotalCents = effectiveSplits.reduce(
                (sum, split) => sum + moneyToCents(parseMoneyInput(split.amount) || 0),
                0
            );
            const remainingCents = totalCents - previewTotalCents;
            const remaining = remainingCents / 100;

            if (remainingCents !== 0) {
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
                const splitAmount = (parseMoneyInput(split.amount) || 0);
                // A by-items rebuild can legitimately return zero for a named
                // diner whose previous payment already covered that share.
                if (splitAmount <= 0) {
                    succeeded.push(i);
                    setPaidSplitIndexes([...succeeded]);
                    continue;
                }

                let response;
                try {
                    setHasAttemptedSplitPayments(true);
                    response = await paymentsAPI.create({
                        orderId,
                        paymentMethodId: split.paymentMethodId,
                        amount: splitAmount,
                        reference: split.reference || undefined,
                        payerName: split.payerName,
                    }, {
                        operationType: 'CREATE_PAYMENT',
                        entityTempId: `payment-${orderId}-${i}`
                    }, splitPaymentKeysRef.current[i] ||= newIdempotencyKey());
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
                            aria-pressed={mode === 'single'}
                            onClick={() => setMode('single')}
                            disabled={hasQueuedPayment || hasAttemptedSplitPayments}
                        >
                            Pago Único
                        </button>
                        <button
                            type="button"
                            className={`payment-mode-btn ${mode === 'split' ? 'active' : ''}`}
                            aria-pressed={mode === 'split'}
                            onClick={() => {
                                setMode('split');
                                if (splits.length === 0) {
                                    splitEvenlyAmong(2);
                                }
                            }}
                            disabled={hasQueuedPayment || hasAttemptedSplitPayments}
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
                                        <label className="section-title" htmlFor="payment-amount-tendered">Monto Recibido</label>
                                        <div className="cash-input-group">
                                            <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{currencySymbol}</span>
                                            <input
                                                type="text"
                                                id="payment-amount-tendered"
                                                inputMode="decimal"
                                                value={amountTendered}
                                                onFocus={(event) => {
                                                    const editable = event.currentTarget.value.replace(/,/g, '');
                                                    if (editable !== event.currentTarget.value) setAmountTendered(editable);
                                                }}
                                                onBlur={() => setAmountTendered((value) => formatMoneyInput(value))}
                                                onChange={(event) => {
                                                    const next = event.target.value.replace(/,/g, '');
                                                    if (/^\d*(?:\.\d{0,2})?$/.test(next)) setAmountTendered(next);
                                                }}
                                                className="cash-input"
                                                autoFocus
                                                placeholder="0.00"
                                                aria-invalid={amountTendered.length > 0 && tenderedAmount === null}
                                            />
                                        </div>
                                        <div className="quick-amounts">
                                            {[5, 10, 20].map(m => (
                                                <button type="button" key={m} onClick={() => handleQuickAmount(m)} className="quick-btn">
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

                                {isCashSelected && tenderedCents >= totalCents && (
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
                        <div className="split-mode-content">
                            <div className="total-display" style={{ textAlign: 'center' }}>
                                <div className="total-label">Saldo a dividir</div>
                                <div className="total-amount-large">{currencySymbol}{totalWithTip.toFixed(2)}</div>
                            </div>

                            <div className="split-financial-summary" aria-label="Resumen de división de cuenta">
                                <div><span>Total factura</span><strong>{currencySymbol}{(originalOrderCents / 100).toFixed(2)}</strong></div>
                                <div><span>Total pagado</span><strong>{currencySymbol}{(totalPaidCents / 100).toFixed(2)}</strong></div>
                                <div><span>Saldo de la orden</span><strong>{currencySymbol}{(pendingAfterPaymentsCents / 100).toFixed(2)}</strong></div>
                                <div><span>Total asignado</span><strong>{currencySymbol}{getSplitTotal().toFixed(2)}</strong></div>
                                <div><span>Por asignar</span><strong>{currencySymbol}{getSplitRemaining().toFixed(2)}</strong></div>
                            </div>

                            <div className="split-toolbar">
                                {[
                                    { value: 'evenly', label: 'Equitativa' },
                                    { value: 'by-items', label: 'Por platos' },
                                    { value: 'by-amount', label: 'Por monto' }
                                ].map((option) => (
                                    <button
                                        type="button"
                                        key={option.value}
                                        onClick={() => {
                                            const nextStrategy = option.value as SplitStrategy;
                                            setSplitStrategy(nextStrategy);
                                            if (splits.length === 0) {
                                                splitEvenlyAmong(2);
                                            }
                                            if (nextStrategy === 'by-items' && Object.keys(itemQuantities).length === 0) {
                                                initializeItemAssignments(Math.max(splits.length, 2));
                                            }
                                        }}
                                        disabled={hasAttemptedSplitPayments}
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
                            <div className="split-toolbar">
                                {[2, 3, 4].map(n => (
                                    <button type="button" key={n} onClick={() => {
                                        splitEvenlyAmong(n);
                                        if (splitStrategy === 'by-items') {
                                            initializeItemAssignments(n);
                                        }
                                    }} disabled={hasAttemptedSplitPayments}
                                        style={{
                                            padding: '6px 16px', borderRadius: '8px', border: '1px solid var(--color-neutral-200)',
                                            background: splits.length === n ? 'var(--color-primary, #2563eb)' : 'var(--color-neutral-50)',
                                            color: splits.length === n ? '#fff' : 'var(--color-neutral-700)',
                                            cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem'
                                        }}>
                                        Dividir en {n}
                                    </button>
                                ))}
                                <button type="button" disabled={hasAttemptedSplitPayments} onClick={() => {
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
                                    <button type="button" disabled={hasAttemptedSplitPayments || !itemAssignmentsComplete} onClick={() => void recalculateSplitPreview(splitStrategy, splits, itemQuantities)}
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
                            <div className="split-entry-list">
                                {splits.map((split, idx) => (
                                    <div className="split-entry" key={split.id} style={{
                                        display: 'flex', gap: '8px', alignItems: 'center',
                                        padding: '10px 12px', borderRadius: '10px',
                                        background: 'var(--color-neutral-50)', border: '1px solid var(--color-neutral-200)'
                                    }}>
                                        <input
                                            type="text" value={split.payerName}
                                            aria-label={`Nombre del comensal ${idx + 1}`}
                                            onChange={(e) => updateSplit(idx, 'payerName', e.target.value)}
                                            disabled={hasAttemptedSplitPayments}
                                            className="split-text-input" placeholder="Nombre" style={{
                                                flex: 1, padding: '6px 10px', borderRadius: '6px',
                                                border: '1px solid var(--color-neutral-200)', fontSize: '0.85rem',
                                                background: 'var(--bg-primary, #fff)'
                                            }} />

                                        <Select
                                            className="payment-split-select"
                                            inputId={`split-payment-method-${split.id}`}
                                            aria-label={`Método de pago de ${split.payerName}`}
                                            variant="modal"
                                            value={
                                                paymentMethods.find((m) => m.id === split.paymentMethodId)
                                                    ? { value: split.paymentMethodId, label: paymentMethods.find((m) => m.id === split.paymentMethodId)!.name }
                                                    : null
                                            }
                                            onChange={(option: SingleValue<{ value: number; label: string }>) =>
                                                option && updateSplit(idx, 'paymentMethodId', option.value)}
                                            isDisabled={hasAttemptedSplitPayments}
                                            options={paymentMethods
                                                .filter((m) => hasUsableCashShift || m.id !== cashMethodId)
                                                .map((m) => ({ value: m.id, label: m.name }))}
                                            isSearchable={false}
                                        />

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{currencySymbol}</span>
                                            <input className="split-amount-input" type="number" step="0.01" value={split.amount}
                                                aria-label={`Monto de ${split.payerName}`}
                                                onChange={(e) => updateSplit(idx, 'amount', e.target.value)}
                                                disabled={splitStrategy === 'by-items' || hasAttemptedSplitPayments}
                                                style={{
                                                    width: '80px', padding: '6px 8px', borderRadius: '6px',
                                                    border: '1px solid var(--color-neutral-200)', fontSize: '0.85rem',
                                                    textAlign: 'right', background: splitStrategy === 'by-items' ? 'var(--color-neutral-100)' : 'var(--bg-primary, #fff)'
                                                }} />
                                        </div>

                                        <input className="split-text-input" type="text" value={split.reference}
                                            aria-label={`Referencia opcional de ${split.payerName}`}
                                            onChange={(e) => updateSplit(idx, 'reference', e.target.value)}
                                            disabled={hasAttemptedSplitPayments}
                                            placeholder="Ref. (opc.)" style={{
                                                width: '90px', padding: '6px 8px', borderRadius: '6px',
                                                border: '1px solid var(--color-neutral-200)', fontSize: '0.8rem',
                                                background: 'var(--bg-primary, #fff)'
                                            }} />

                                        <button type="button" onClick={() => removeSplit(idx)} disabled={hasAttemptedSplitPayments}
                                            aria-label={`Eliminar pago de ${split.payerName}`}
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
                                <div className="split-items-panel" style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    padding: '12px',
                                    borderRadius: '12px',
                                    border: '1px solid var(--color-neutral-200)',
                                    background: 'var(--color-neutral-50)'
                                }}>
                                    <div style={{ fontWeight: 700 }}>Asignación por unidades</div>
                                    {orderItems.map((item) => {
                                        const quantities = itemQuantities[item.id] ?? Array<number>(splits.length).fill(0);
                                        const assigned = quantities.reduce((sum, quantity) => sum + quantity, 0);
                                        const pending = item.quantity - assigned;
                                        return (
                                            <div key={item.id} className="split-item-allocation">
                                                <div className="split-item-heading">
                                                    <div>
                                                        <strong>{item.quantity}x {item.menuItem?.name}</strong>
                                                        <small>{currencySymbol}{Number(item.subtotal).toFixed(2)}</small>
                                                    </div>
                                                    <span className={pending === 0 ? 'complete' : 'pending'}>
                                                        {pending === 0 ? 'Completo' : `${pending} sin asignar`}
                                                    </span>
                                                </div>
                                                <div className="split-quantity-grid">
                                                    {splits.map((split, payerIndex) => {
                                                        const others = assigned - (quantities[payerIndex] ?? 0);
                                                        const max = Math.max(0, item.quantity - others);
                                                        return (
                                                            <label key={split.id}>
                                                                <span>{split.payerName}</span>
                                                                <input
                                                                    type="number"
                                                                    inputMode="numeric"
                                                                    min={0}
                                                                    max={max}
                                                                    step={1}
                                                                    value={quantities[payerIndex] ?? 0}
                                                                    disabled={hasAttemptedSplitPayments}
                                                                    aria-label={`Unidades de ${item.menuItem?.name || `producto ${item.id}`} para ${split.payerName}`}
                                                                    onChange={(event) => {
                                                                        const raw = Number(event.target.value);
                                                                        const nextQuantity = Number.isInteger(raw) ? Math.max(0, Math.min(max, raw)) : 0;
                                                                        setItemQuantities((current) => {
                                                                            const next = [...(current[item.id] ?? Array<number>(splits.length).fill(0))];
                                                                            next[payerIndex] = nextQuantity;
                                                                            return { ...current, [item.id]: next };
                                                                        });
                                                                    }}
                                                                />
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {!itemAssignmentsComplete && (
                                        <div className="split-allocation-warning" role="status">
                                            Distribuye todas las unidades y asigna al menos una a cada comensal.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Split summary */}
                            {splits.length > 0 && (
                                <div style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '10px 16px', borderRadius: '10px',
                                    background: getSplitRemaining() === 0 ? 'color-mix(in srgb, var(--color-success) 10%, transparent)' : 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                                    border: `1px solid ${getSplitRemaining() === 0 ? 'var(--color-success)' : 'var(--color-warning)'}`,
                                    fontWeight: 600, fontSize: '0.9rem'
                                }}>
                                    <span>Suma pagos: {currencySymbol}{getSplitTotal().toFixed(2)}</span>
                                    <span style={{ color: getSplitRemaining() === 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                        {getSplitRemaining() === 0 ? 'Cuadrado' : `Restante: ${currencySymbol}${getSplitRemaining().toFixed(2)}`}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="payment-footer">
                    {!hasUsableCashShift && cashMethodId !== null && (
                        <div className="error-message-new">
                            Efectivo no está disponible: abre un turno vigente en la misma sucursal. Los otros métodos sí pueden procesarse.
                        </div>
                    )}
                    {error && <div className="error-message-new" role="alert">{error}</div>}
                    {balanceError && <div className="error-message-new" role="alert">{balanceError}</div>}
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
                        <button type="button" className="btn-cancel" onClick={handleClose} disabled={loading}>Cancelar</button>
                        <button type="button" className="btn-confirm"
                            onClick={mode === 'single' ? handleSinglePayment : handleSplitPayment}
                            disabled={
                                loading || previewLoading || balanceLoading || Boolean(balanceError) || hasQueuedPayment || totalWithTip <= 0 ||
                                (mode === 'single' && (selectedMethod === null || (isCashSelected && (!hasUsableCashShift || tenderedAmount === null || tenderedCents < totalCents)))) ||
                                (mode === 'split' && (getSplitRemaining() !== 0 || !itemAssignmentsComplete))
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
